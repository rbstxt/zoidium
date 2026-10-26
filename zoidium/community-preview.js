"use strict";

(function (root) {
  // The ordinary CM3 viewport draws synchronously. This preview bridge waits
  // only for community template jobs on top-level layers. It never prepares
  // native content, samples another frame, or invokes an asset loader.
  function install({ getEffects, stamp, sameStamp, PZ = root.PZ, viewport = root.CM?.mainViewport,
    enabled = () => true, report = message => root.console.warn(message) }) {
    const pending = new WeakSet(), patched = [], reported = new Set();
    let active = true;
    function patch(target) {
      const original = target?._render;
      if (typeof original !== "function") return;
      const wrapped = function () {
        if (!active || !enabled() || this.renderMode ||
            this.__zoidiumPlayerPlusPaused && !this.__zoidiumPlayerPlusRenderOnce) return original.apply(this, arguments);
        const project = this.editor?.project, sequence = this.compositor?._sequence;
        if (!project || sequence !== project.sequence) return original.apply(this, arguments);
        const frame = this.editor.playback.currentFrame;
        const effects = getEffects().filter(e => e.parentProject === project && !e._communityOpaque);
        const jobs = [];
        for (const track of sequence.videoTracks || []) {
          if (track.enabled === false) continue;
          const clip = track.getCurrentClip?.(frame);
          if (!clip) continue;
          for (const effect of effects) if (effect.parentLayer === clip.object) jobs.push({ effect, frame: frame - clip.start });
        }
        if (!jobs.length) return original.apply(this, arguments);
        // Only one bounded batch can be pending per viewport. Receipts still
        // need to match when the pass draws after native layer evaluation.
        if (pending.has(this)) return;
        if (jobs.every(job => {
          const receipt = job.effect._community.receipt;
          return receipt && sameStamp(receipt.authority, stamp(job.effect, job.frame));
        })) return original.apply(this, arguments);
        if (jobs.length > 64) throw new Error("Community preview supports at most 64 effects per frame.");
        pending.add(this);
        const args = arguments, view = this, renderOnce = view.__zoidiumPlayerPlusRenderOnce;
        void (async () => {
          try { for (const job of jobs) await job.effect.prepare(job.frame); }
          catch (error) {
            const message = "Community preview preparation failed: " + String(error.message).slice(0, 4096);
            if (!reported.has(message)) { reported.add(message); report(message); }
          }
          if (!active || !enabled() || view.editor.project !== project || view.editor.playback.currentFrame !== frame) return;
          // Keep the single draw permission across the asynchronous job. The
          // Player+ button clears its marker when its synchronous call returns.
          const before = view.__zoidiumPlayerPlusRenderOnce;
          try { view.__zoidiumPlayerPlusRenderOnce = renderOnce; original.apply(view, args); }
          finally { view.__zoidiumPlayerPlusRenderOnce = before; }
        })().catch(error => {
          const message = "Community preview draw failed: " + String(error.message).slice(0, 4096);
          if (!reported.has(message)) { reported.add(message); report(message); }
        }).finally(() => pending.delete(view));
      };
      target._render = wrapped; patched.push({ target, original, wrapped });
    }
    patch(PZ?.ui?.viewport?.prototype);
    // Player+ also wraps existing viewport instances during plugin startup.
    patch(viewport);
    return () => {
      if (!active) return; active = false;
      for (const { target, original, wrapped } of patched) if (target._render === wrapped) target._render = original;
    };
  }
  if (typeof module === "object" && module.exports) module.exports = { install };
  else root.ZoidiumCommunityPreview = { install };
})(globalThis);
