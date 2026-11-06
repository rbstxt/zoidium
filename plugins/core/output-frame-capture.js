// Unverified preview textures stay private until a later GPU error check.
(function outputFrameCaptureModule(global) {
  "use strict";

  const MAX_PENDING = 4;
  const MAX_PENDING_BYTES = 64 * 1024 * 1024;

  class CaptureQueue {
    constructor({ store, available, failed, quiet, host = global, THREE = global.THREE }) {
      Object.assign(this, { store, available, failed, quiet, host, THREE });
      this.pending = new Set();
      this.bytes = 0;
      this.timer = null;
      this.blocked = new Set();
      this.contexts = new Set();
      this.checks = 0;
      this.discarded = 0;
    }
    schedule() {
      if (this.timer !== null || (!this.pending.size && !this.contexts.size)) return;
      const check = () => {
        this.timer = null;
        if (!this.quiet()) { this.schedule(); return; }
        this.check();
      };
      // Yield a frame before checking. Unlike an idle callback, this task
      // also runs during playback; input and history still postpone it.
      this.timer = this.host.setTimeout(check, 16);
    }
    cancelTimer() {
      if (this.timer === null) return;
      this.host.clearTimeout(this.timer);
      this.timer = null;
    }
    valid(item) {
      const { controller, key, generation, revision, project, signal, epoch } = item;
      return !controller.disposed && controller.key === key && controller.generation === generation &&
        this.store.generation === revision && controller.viewport.editor.project === project && signal() === epoch;
    }
    finish(item, clean) {
      if (!this.pending.delete(item)) return;
      this.bytes -= item.entry.bytes;
      if (!clean || !this.valid(item) || !this.available(item.gl)) {
        this.discarded += 1;
        if (this.available(item.gl)) item.entry.dispose();
        item.resolve(null);
      } else {
        item.entry.complete = true;
        item.resolve(item.entry);
      }
    }
    invalidate(controller) {
      for (const item of Array.from(this.pending)) {
        if (!controller || item.controller === controller) this.finish(item, false);
      }
      // A cancelled copy can still have raised an error. Drain that context
      // before later captures can publish, even when its owner was replaced.
      if (!this.pending.size && !this.contexts.size) this.cancelTimer();
    }
    check() {
      this.cancelTimer();
      const contexts = new Set(this.contexts);
      let clean = this.blocked.size === 0;
      for (const gl of contexts) {
        if (!this.available(gl)) { clean = false; continue; }
        this.checks += 1;
        try {
          // Drain all flags: an unrelated error must not hide OUT_OF_MEMORY.
          for (let count = 0; count < 32; count += 1) {
            const error = gl.getError();
            if (error === gl.NO_ERROR) break;
            clean = false;
            this.failed(gl, error);
            if (!this.available(gl)) break;
          }
          if (!this.available(gl)) clean = false;
        } catch (_error) { clean = false; }
      }
      this.blocked.clear();
      this.contexts.clear();
      for (const item of Array.from(this.pending)) this.finish(item, clean);
    }
    capture(controller, frame, signal) {
      const renderer = controller.viewport.renderer, gl = renderer.context;
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, bytes = width * height * 4;
      // A frame larger than the pending byte cap may occupy the queue alone.
      const limit = Math.min(this.store.effectiveLimit, Math.max(MAX_PENDING_BYTES, bytes));
      if (!this.available(gl) || !this.store.effectiveLimit) return Promise.resolve(null);
      if (bytes > this.store.effectiveLimit) {
        controller.reason = "One frame exceeds the preview cache memory limit";
        return Promise.resolve(null);
      }
      if (this.blocked.has(gl) || this.pending.size >= MAX_PENDING || this.bytes + bytes > limit) {
        controller.reason = "Waiting for preview capture verification";
        return Promise.resolve(null);
      }
      const T = this.THREE, format = gl.getContextAttributes().alpha ? T.RGBAFormat : T.RGBFormat;
      const type = T.UnsignedByteType;
      // Pending textures consume the same session budget as verified entries.
      const reservation = this.store.take(this.bytes + bytes, entry => entry.renderer === renderer &&
        entry.width === width && entry.height === height && entry.format === format && entry.type === type);
      if (!reservation) {
        controller.reason = "One frame exceeds the preview cache memory limit";
        return Promise.resolve(null);
      }
      const revision = this.store.generation;
      let target = reservation.recycled?.target;
      try {
        target ||= new T.WebGLRenderTarget(width, height, { minFilter: T.NearestFilter, magFilter: T.NearestFilter,
          format, type, depthBuffer: false, stencilBuffer: false });
        target.texture.generateMipmaps = false;
        renderer.setRenderTarget(target);
        renderer.setRenderTarget(null);
        renderer.setTexture2D(target.texture, 0);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
      } catch (_error) {
        controller.reason = "GPU capture failed";
        // A failed allocation poisons every copy since the last clean check.
        this.blocked.add(gl);
        this.contexts.add(gl);
        this.invalidate();
        if (this.available(gl)) { renderer.setRenderTarget(null); target?.dispose(); }
        this.schedule();
        return Promise.resolve(null);
      }
      if (!this.available(gl) || revision !== this.store.generation) {
        if (this.available(gl)) target.dispose();
        return Promise.resolve(null);
      }
      let released = false;
      const entry = { target, frame, bytes, renderer, width, height, format, type,
        owner: controller.id, complete: false, dispose: () => { if (!released) { released = true; target.dispose(); } } };
      const promise = new Promise(resolve => {
        const item = { entry, resolve, gl, controller, key: controller.key, generation: controller.generation,
          revision, project: controller.viewport.editor.project, signal, epoch: signal() };
        entry.isCurrent = () => this.valid(item) && this.available(gl);
        this.pending.add(item);
      });
      this.bytes += bytes;
      this.contexts.add(gl);
      this.schedule();
      return promise;
    }
    dispose() {
      this.invalidate();
      this.blocked.clear();
      this.contexts.clear();
      this.cancelTimer();
    }
  }

  const api = { CaptureQueue };
  if (typeof module === "object" && module.exports) module.exports = api;
  else global.ZoidiumOutputFrameCapture = api;
})(typeof window !== "undefined" ? window : globalThis);
