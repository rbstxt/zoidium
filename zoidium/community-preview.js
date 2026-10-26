"use strict";

(function (root) {
  function install({ getEffects, stamp, sameStamp, PZ = root.PZ, viewport = root.CM?.mainViewport,
    enabled = () => true, report = message => root.console.warn(message) }) {
    const pending = new WeakSet(), patched = [], reported = new Set();
    let active = true;
    function patch(target) {
      const original = target?._render;
      if (typeof original !== "function") return;
      const wrapped = function () {
        if (this.__zoidiumCommunityPrepared) return original.apply(this, arguments);
        if (!active || !enabled() || this.renderMode ||
            this.__zoidiumPlayerPlusPaused && !this.__zoidiumPlayerPlusRenderOnce) return original.apply(this, arguments);
        const project = this.editor?.project, sequence = this.compositor?._sequence;
        if (!project || sequence !== project.sequence) return original.apply(this, arguments);
        const effects = getEffects().filter(e => e.parentProject === project && !e._communityOpaque);
        if (!effects.length) return original.apply(this, arguments);
        if (pending.has(this)) return;
        const frame = this.editor.playback.currentFrame, view = this, args = arguments;
        const renderOnce = view.__zoidiumPlayerPlusRenderOnce;
        const temporal = PZ.zoidium?.temporal, parts = root.__zoidiumTemporalParts;
        const context = { sequence, frameSamplerRoot: this.compositor };
        const jobs = [], seen = new Set();
        function visit(layer, localFrame, depth = 0) {
          if (depth > 8 || seen.has(layer)) throw new Error("LOCAL_DEPENDENCY_UNAVAILABLE: composition nesting limit exceeded");
          seen.add(layer);
          const sourceFrame = temporal?.mapLayerFrame(layer, localFrame)?.sourceFrame ?? localFrame;
          for (const effect of effects) if (effect.parentLayer === layer) {
            const stage = parts?.layers.findFrameSamplerStage(sequence, effect, frame);
            const control = stage ? parts.sampler.getFrameSamplerControlFrame(stage, sourceFrame) : sourceFrame;
            const authority = { ...context, frameSamplerDepth: 1, scopeId: 0,
              stageId: stage ? parts.layers.frameSamplerIdentity(effect) : undefined };
            jobs.push({ effect, frame: sourceFrame, control, authority });
          }
          if (layer.nestedTracks) {
            const childFrame = sourceFrame + (layer.offset || 0);
            layer.setCompTime?.(childFrame);
            for (const track of layer.nestedTracks()) {
              if (track.enabled === false) continue;
              const clip = track.getCurrentClip?.(childFrame);
              if (clip) visit(clip.object, childFrame - clip.start, depth + 1);
            }
          } else if (PZ.layer?.composite && layer instanceof PZ.layer.composite) {
            for (const child of layer.objects || []) visit(child, sourceFrame, depth + 1);
          }
          seen.delete(layer);
        }
        // The isolated path never calls native content preparation. Audit
        // before clock evaluation, capture, and the final synchronous draw.
        const policy = effects[0]._community.temporal?.policy;
        try {
          policy?.assertStage(sequence, {}, frame, true);
          for (const track of sequence.videoTracks || []) {
            if (track.enabled === false) continue;
            const clip = track.getCurrentClip?.(frame);
            if (clip) visit(clip.object, frame - clip.start);
          }
        } catch (error) {
          for (const effect of effects) { effect._community.temporal?.clear();
            if (root.ZoidiumCommunityEffectHost) root.ZoidiumCommunityEffectHost.status(effect, error.message);
            else effect._communityError = error.message; }
          const message = String(error.message).slice(0, 4096);
          if (!reported.has(message)) { reported.add(message); report(message); }
          return;
        }
        if (!jobs.length) return original.apply(this, arguments);
        if (jobs.length > 64) throw new Error("Community preview supports at most 64 effects per frame.");
        const baseline = stamp(jobs[0].effect, jobs[0].frame);
        const isCurrent = () => active && enabled() && view.editor.project === project &&
          view.editor.playback.currentFrame === frame && sameStamp(baseline, stamp(jobs[0].effect, jobs[0].frame));
        function draw() {
          if (!isCurrent()) return;
          policy?.assertStage(sequence, {}, frame, true);
          const before = view.__zoidiumPlayerPlusRenderOnce;
          const beforePolicy = view.compositor.__zoidiumCommunityResourcePolicy;
          const beforePrepared = view.__zoidiumCommunityPrepared;
          try {
            view.__zoidiumPlayerPlusRenderOnce = renderOnce;
            view.__zoidiumCommunityPrepared = true;
            view.compositor.__zoidiumCommunityResourcePolicy = policy;
            return original.apply(view, args);
          } finally {
            view.__zoidiumPlayerPlusRenderOnce = before;
            view.__zoidiumCommunityPrepared = beforePrepared;
            view.compositor.__zoidiumCommunityResourcePolicy = beforePolicy;
          }
        }
        const ready = jobs.every(job => {
          const cache = job.effect._community.temporal;
          // Cached guest results still await the local store's exact-hash
          // authorization check and the sampler's GPU-input validation.
          if (cache) return false;
          const receipt = job.effect._community.receipt;
          return receipt && sameStamp(receipt.authority, stamp(job.effect, job.frame));
        });
        if (ready) return draw();
        pending.add(this);
        void (async () => {
          try {
            temporal?.registerExportCompositor(view.compositor);
            for (const job of jobs) {
              if (!isCurrent()) return;
              await job.effect.prepare(job.frame, context);
            }
            draw();
          } catch (error) {
            for (const job of jobs) {
              job.effect._community.temporal?.clear();
              if (root.ZoidiumCommunityEffectHost) root.ZoidiumCommunityEffectHost.status(job.effect, String(error.message).slice(0, 4096));
              else job.effect._communityError = String(error.message).slice(0, 4096);
            }
            const message = "Community preview preparation failed: " + String(error.message).slice(0, 4096);
            if (!reported.has(message)) { reported.add(message); report(message); }
            if (!String(error.message).includes("LOCAL_DEPENDENCY_UNAVAILABLE")) draw();
          }
        })().catch(error => {
          const message = "Community preview draw failed: " + String(error.message).slice(0, 4096);
          if (!reported.has(message)) { reported.add(message); report(message); }
        }).finally(() => pending.delete(view));
      };
      target._render = wrapped; patched.push({ target, original, wrapped });
    }
    patch(PZ?.ui?.viewport?.prototype);
    patch(viewport);
    return () => {
      if (!active) return; active = false;
      for (const { target, original, wrapped } of patched) if (target._render === wrapped) target._render = original;
    };
  }
  if (typeof module === "object" && module.exports) module.exports = { install };
  else root.ZoidiumCommunityPreview = { install };
})(globalThis);
