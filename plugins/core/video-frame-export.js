(function installDeterministicVideoExportPatch() {
  "use strict";

  if (!PZ.schedule || !PZ.export || PZ.schedule.prototype.__zoidiumVideoExportPatch) {
    return;
  }

  const HAVE_METADATA = 1;
  const HAVE_CURRENT_DATA = 2;
  const DEFAULT_TIMEOUT_MS = 15000;
  const FRAME_CALLBACK_GRACE_MS = 500;
  const SAME_TIME_EPSILON = 1e-7;
  // Allow media clocks coarsened by browser timer-precision settings.
  // This tolerance validates seek completion, not reuse of a decoded frame.
  const SEEK_TIME_EPSILON = 2e-3;

  const diagnostics = (PZ.videoFrameExportDiagnostics =
    PZ.videoFrameExportDiagnostics || {
      enabled: false,
      maxRecords: 2000,
      records: [],
      clear() {
        this.records.length = 0;
      },
    });

  function recordDiagnostic(record) {
    if (!diagnostics.enabled) return;
    diagnostics.records.push(record);
    if (diagnostics.records.length > diagnostics.maxRecords) {
      diagnostics.records.splice(0, diagnostics.records.length - diagnostics.maxRecords);
    }
  }

  function getSourceId(video) {
    return video.currentSrc || video.src || "";
  }

  function clampMediaTime(video, requestedTime) {
    let mediaTime = Number.isFinite(requestedTime) ? requestedTime : 0;
    mediaTime = Math.max(0, mediaTime);

    if (Number.isFinite(video.duration) && video.duration > 0) {
      mediaTime = Math.min(mediaTime, Math.max(0, video.duration - 1e-7));
    }

    return mediaTime;
  }

  function waitForExport(promise, policy) {
    return new Promise((resolve, reject) => {
      const signal = policy.signal;
      const aborted = () => { cleanUp(); reject(signal.reason); };
      const cleanUp = () => signal.removeEventListener("abort", aborted);
      signal.addEventListener("abort", aborted, { once: true });
      Promise.resolve(promise).then(value => { cleanUp(); resolve(value); }, error => { cleanUp(); reject(error); });
      if (signal.aborted) aborted();
    });
  }
  const decoderQueues = new WeakMap();
  function safeMessage(error) {
    return String(error?.message || error || "Unknown video failure")
      .replace(/(?:blob:|file:|https?:)[^\s<>"']+/gi, "[media source]");
  }
  function mediaError(video) {
    if (video.error) throw video.error;
  }
  function waitForEvent(video, event, timeoutMs, policy, action) {
    return new Promise((resolve, reject) => {
      let timeoutId;
      const cleanUp = () => {
        clearTimeout(timeoutId);
        video.removeEventListener(event, done);
        video.removeEventListener("error", failed);
        policy?.signal?.removeEventListener("abort", aborted);
      };
      const fail = error => { cleanUp(); reject(error); };
      const failed = () => fail(video.error || new Error("Video decode failed."));
      const aborted = () => fail(policy.signal.reason || new Error("Export stopped."));
      const done = () => {
        try { mediaError(video); policy?.check?.(); }
        catch (error) { fail(error); return; }
        cleanUp(); resolve();
      };
      try {
        mediaError(video); policy?.check?.();
        video.addEventListener(event, done);
        video.addEventListener("error", failed);
        policy?.signal?.addEventListener("abort", aborted, { once: true });
        timeoutId = setTimeout(() => fail(new Error(`Timed out waiting for video ${event}.`)), timeoutMs);
        action?.();
      } catch (error) { fail(error); }
    });
  }
  function waitForMetadata(video, timeoutMs, policy) {
    mediaError(video);
    if (video.readyState >= HAVE_METADATA) return Promise.resolve();
    return waitForEvent(video, "loadedmetadata", timeoutMs, policy);
  }
  function presentedFrame(video) {
    if (typeof video.requestVideoFrameCallback !== "function") return { promise: Promise.resolve(null), cancel() {} };
    let callbackId, timeoutId, finish;
    const cancel = () => {
      clearTimeout(timeoutId);
      if (callbackId != null) video.cancelVideoFrameCallback?.(callbackId);
      finish?.(null);
    };
    const promise = new Promise(resolve => {
      finish = resolve;
      timeoutId = setTimeout(cancel, FRAME_CALLBACK_GRACE_MS);
      callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        clearTimeout(timeoutId); callbackId = null; resolve(metadata || null);
      });
    });
    return { promise, cancel };
  }
  async function decode(schedule, requestedTime, context) {
    const video = schedule.el;
    if (!video) return;
    const policy = context?.exportPolicy;
    const timeoutMs = diagnostics.timeoutMs || DEFAULT_TIMEOUT_MS;
    let stage = "metadata";
    for (let attempt = 0; attempt < 2; attempt++) {
      let presentation = null;
      try {
        policy?.check?.();
        stage = "metadata";
        await waitForMetadata(video, timeoutMs, policy);
        const mediaTime = clampMediaTime(video, requestedTime);
        const sourceId = getSourceId(video);
        const state = schedule.__zoidiumVideoExportState || {};
        schedule.__zoidiumVideoExportState = state;
        stage = "before seek";
        mediaError(video); policy?.check?.();
        const reused = Math.abs(video.currentTime - mediaTime) <= SAME_TIME_EPSILON &&
          !video.seeking && video.readyState >= HAVE_CURRENT_DATA &&
          (!state.sourceId || state.sourceId === sourceId);
        let metadata = null;
        if (!reused) {
          presentation = presentedFrame(video);
          await waitForEvent(video, "seeked", timeoutMs, policy, () => { video.currentTime = mediaTime; });
          stage = "after seek";
          mediaError(video); policy?.check?.();
          if (Math.abs(video.currentTime - mediaTime) > SEEK_TIME_EPSILON || video.seeking) {
            throw new Error("Video seek completed at a different requested time.");
          }
          metadata = await presentation.promise;
        }
        stage = "texture validation";
        mediaError(video); policy?.check?.();
        if (getSourceId(video) !== sourceId || video.readyState < HAVE_CURRENT_DATA) {
          throw new Error("The requested video frame is unavailable.");
        }
        Object.assign(state, { sourceId, requestedTime: mediaTime,
          presentedMediaTime: Number.isFinite(metadata?.mediaTime) ? metadata.mediaTime : video.currentTime });
        if (schedule.texture) schedule.texture.needsUpdate = true;
        recordDiagnostic({ source: sourceId, requestedMediaTime: mediaTime,
          presentedMediaTime: state.presentedMediaTime, difference: state.presentedMediaTime - mediaTime, reused });
        return;
      } catch (error) {
        presentation?.cancel();
        // Reset the browser decoder once. The HTML element and its texture
        // stay bound to the same clip, and the retry repeats the exact time.
        if (attempt === 0 && policy && video.error && typeof video.load === "function") {
          policy.check?.();
          const source = schedule.currentItem?.media?.url || getSourceId(video);
          if (source) {
            video.pause?.(); video.removeAttribute?.("src"); video.load();
            video.src = source; video.load();
            delete schedule.__zoidiumVideoExportState;
            continue;
          }
        }
        const clip = schedule.currentItem?.clip;
        let name = clip?.name || clip?.object?.name || schedule.currentItem?.media?.filename || "video clip";
        try { name = clip?.properties?.name?.get?.() || name; } catch (_nameError) { /* Retain the clip fallback. */ }
        throw new Error(`Video decode failed for clip "${safeMessage(name)}", requested media time ${Number(requestedTime).toFixed(6)}s, output frame ${policy?.outputIndex ?? "unknown"}, stage ${stage}: ${safeMessage(error)}`, { cause: error });
      } finally { presentation?.cancel(); }
    }
  }
  PZ.schedule.prototype.decodeFrame = function decodeExactExportFrame(time, context) {
    if (!this.el) return Promise.resolve();
    context ||= this.__zoidiumExportContext;
    const element = this.el;
    const previous = decoderQueues.get(element);
    const run = () => decode(this, time, context);
    const pending = previous ? previous.catch(() => {}).then(run) : run();
    decoderQueues.set(element, pending);
    pending.finally(() => {
      if (decoderQueues.get(element) === pending) decoderQueues.delete(element);
    }).catch(() => {});
    return pending;
  };

  const originalUnload = PZ.export.prototype.unload;
  PZ.export.prototype.unload = function unloadExportResources() {
    if (this.__zoidiumExportDisposed) return;
    this.__zoidiumExportDisposed = true;
    const guard = this.__zoidiumExportGuard;
    guard?.canvas?.removeEventListener?.("webglcontextlost", guard.onLoss);
    if (this.compositor) delete this.compositor.__zoidiumExportPolicy;
    if (originalUnload) originalUnload.call(this);
    else { this.compositor?.unload?.(); this.renderer?.dispose?.(); }
  };
  PZ.export.prototype.checkExportContext = function checkExportContext(stage = "before encoder submission") {
    globalThis.ZoidiumCommunityEffectHost?.assertExport(this.sequence?.parentProject || this.sequence, this);
    let guard = this.__zoidiumExportGuard;
    if (!guard) {
      const controller = new AbortController();
      guard = this.__zoidiumExportGuard = { controller,
        canvas: this.renderer?.domElement || this.renderer?.context?.canvas };
      guard.onLoss = () => { guard.lost = true; controller.abort(this.exportContextError()); };
      guard.canvas?.addEventListener?.("webglcontextlost", guard.onLoss);
      this.exportPolicy = { outputIndex: this.framesRendered, signal: controller.signal,
        communityBypass: Boolean(this.__zoidiumCommunityBypass),
        check: () => this.checkExportContext("during preparation") };
      if (this.compositor) this.compositor.__zoidiumExportPolicy = this.exportPolicy;
    }
    if (guard.lost || this.renderer?.context?.isContextLost?.() || this.renderer?.getContext?.()?.isContextLost?.()) {
      throw this.exportContextError(stage);
    }
    if (guard.controller.signal.aborted) throw guard.controller.signal.reason;
  };
  PZ.export.prototype.exportContextError = function exportContextError(stage = "context loss event") {
    const pending = this.__zoidiumPendingFrame;
    const index = pending?.index ?? this.exportPolicy?.outputIndex ?? this.framesRendered;
    const frame = pending?.frame ?? this.frame;
    const rate = this.sequence?.properties?.rate?.get?.() || 30;
    return new Error(`WebGL context lost at output index ${index}, project frame ${frame}, time ${(frame / rate).toFixed(6)}s (${stage}). Start a new export.`);
  };
  PZ.export.prototype.failExportFrame = function failExportFrame(error) {
    this.__zoidiumExportGuard?.controller.abort(error || new Error("Export stopped."));
    if (this.__zoidiumPendingFrame) {
      this.framesRendered = this.__zoidiumPendingFrame.index;
      this.frame = this.__zoidiumPendingFrame.frame;
      this.__zoidiumPendingFrame = null;
    }
    this.frameWaiting = -1; this.framePromise = null;
    // Original schedules belong to the editor. Release their decoder source
    // on failure; update() reloads it from the clip on the next preparation.
    // Cancellation preserves their current frame for the resumed preview.
    if (error?.name !== "AbortError") for (const schedule of this.sequence?.videoSchedules || []) {
      schedule.el?.pause?.(); schedule.el?.removeAttribute?.("src"); schedule.el?.load?.();
      schedule.decoder?.process?.kill?.(); schedule.currentItem = null;
    }
    this.unload();
  };

  PZ.export.prototype.renderVideoFrame = async function renderDeterministicVideoFrame(output) {
    const temporal = PZ.zoidium?.temporal;
    temporal?.registerExportCompositor?.(this.compositor);
    if (this.framesRendered >= this.totalFrames) return 0;

    // Image export uses rate=0. In that mode frameAdvance is Infinity, so
    // calculating the first frame as 0 * Infinity produces NaN. The export
    // constructor already initializes `frame` to the requested start frame;
    // keep using that value so Single Frame Capture also prepares frame 0.
    const projectFrame = this.frame;

    let releaseSamples;
    try {
      this.checkExportContext("before preparation");
      this.exportPolicy.outputIndex = this.framesRendered;
      this.frameSamplerRoot = this.compositor;
      releaseSamples = temporal?.beginExportSamples?.(this.compositor);
      this.frame = projectFrame;
      this.frameWaiting = projectFrame;
      this.framePromise = this.sequence.prepare(projectFrame, this);
      await waitForExport(this.framePromise, this.exportPolicy);
      this.checkExportContext("after preparation");
      await waitForExport(temporal?.prepareExportSamples?.(this, projectFrame), this.exportPolicy);
      this.checkExportContext("after shutter preparation");
      this.compositor.renderSequence(projectFrame);
      this.checkExportContext("after composition");

      if (output && this.readPixelsWorkaround) {
        const context = this.renderer.context;
        const drawingBufferWidth = context.drawingBufferWidth;
        const drawingBufferHeight = context.drawingBufferHeight;
        this.readPixelsCtx.drawImage(
          context.canvas,
          0,
          0,
          drawingBufferWidth,
          drawingBufferHeight,
          0,
          -drawingBufferHeight,
          drawingBufferWidth,
          drawingBufferHeight,
        );
        output.set(
          this.readPixelsCtx.getImageData(
            0,
            0,
            drawingBufferWidth,
            drawingBufferHeight,
          ).data,
        );
      } else if (output) {
        const context = this.renderer.context;
        context.readPixels(
          0,
          0,
          this.params.width,
          this.params.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          output,
        );
      }

      this.checkExportContext("after pixel capture");
      if (!output) this.__zoidiumPendingFrame = { index: this.framesRendered, frame: projectFrame };
      this.framesRendered += 1;
      this.frame += this.frameAdvance;
      this.frameWaiting = -1;
      this.framePromise = null;
      return 1;
    } catch (error) {
      try { this.failExportFrame(error); } catch (_cleanupError) { /* Preserve the frame failure. */ }
      throw error;
    } finally { releaseSamples?.(); }
  };

  PZ.export.prototype.getVideoFrame = function getDeterministicVideoFrame(output) {
    return this.renderVideoFrame(output);
  };

  PZ.schedule.prototype.__zoidiumVideoExportPatch = true;
})();
