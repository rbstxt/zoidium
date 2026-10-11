(function installTemporalRenderPatch(global) {
  "use strict";

  // In the browser the three part files above load first as classic scripts
  // (see plugins/core/manifest.json and zoidium/runtime-config.js) and share
  // their exports through this registry. Node tests load them with require.
  // The IIFE argument is the window in a browser tab but null in Node and in
  // sandboxed VMs, so fall back to globalThis for the registry.
  var host = global || (typeof globalThis !== "undefined" ? globalThis : null);
  var parts = (host && host.__zoidiumTemporalParts) || {};
  if (typeof module === "object" && module.exports) {
    parts = {
      math: require("./temporal-math.js"),
      layers: require("./temporal-layers.js"),
      sampler: require("./temporal-sampler.js"),
    };
    if (host) host.__zoidiumTemporalParts = parts;
  }
  var math = parts.math;
  var layers = parts.layers;
  var sampler = parts.sampler;
  if (!math || !layers || !sampler) {
    throw new Error(
      "[Zoidium] temporal-math.js, temporal-layers.js and temporal-sampler.js must load before temporal-render.js.",
    );
  }
  var EPSILON = math.EPSILON;
  var PATCH_MARKER = math.PATCH_MARKER;
  var LAYER_UPDATE_MARKER = math.LAYER_UPDATE_MARKER;
  var SCHEDULE_PREPARE_MARKER = math.SCHEDULE_PREPARE_MARKER;
  var PLAYBACK_SCHEDULE_MARKER = math.PLAYBACK_SCHEDULE_MARKER;
  var VIEWPORT_RENDER_MARKER = math.VIEWPORT_RENDER_MARKER;
  var EXPORT_FRAME_MARKER = math.EXPORT_FRAME_MARKER;
  var finiteNumber = math.finiteNumber;
  var quantizeFrame = math.quantizeFrame;
  var clampFrame = math.clampFrame;
  var offsetFrame = math.offsetFrame;
  var planFrameSamples = math.planFrameSamples;
  var readFpsProp = math.readFpsProp;
  var applyTemporalOperators = math.applyTemporalOperators;
  var buildFrameSamplePlan = math.buildFrameSamplePlan;
  var clampLocalFrame = math.clampLocalFrame;
  var quantizeLocalFrame = math.quantizeLocalFrame;
  var mapTemporalFrameWithScopes = math.mapTemporalFrameWithScopes;
  var getSequenceForLayer = layers.getSequenceForLayer;
  var getClipForLayer = layers.getClipForLayer;
  var isSceneLayer = layers.isSceneLayer;
  var installEffectUpdatePatches = layers.installEffectUpdatePatches;
  var getTemporalLayerFrame = layers.getTemporalLayerFrame;
  var findScheduleItemAtFrame = layers.findScheduleItemAtFrame;
  var getScheduleSourceFrame = layers.getScheduleSourceFrame;
  var isClipActiveAtProjectFrame = layers.isClipActiveAtProjectFrame;
  var getAdjustmentEffectFrame = layers.getAdjustmentEffectFrame;
  var registerCompositor = sampler.registerCompositor;
  var getFrameSamplerRuntime = sampler.getFrameSamplerRuntime;
  var disposeFrameSamplerRuntime = sampler.disposeFrameSamplerRuntime;
  var resolveFrameSamples = sampler.resolveFrameSamples;
  var prepareFrameSamples = sampler.prepareFrameSamples;
  var prepareLowerSchedules = sampler.prepareLowerSchedules;
  var frameSamplerInputKey = sampler.frameSamplerInputKey;
  var frameSamplerIdentity = sampler.frameSamplerIdentity;
  var renderPreparedPreview = sampler.renderPreparedPreview;

  function getTemporalState() {
    const PZRoot = typeof PZ !== "undefined" ? PZ : null;
    if (!PZRoot) return null;
    PZRoot.zoidium = PZRoot.zoidium || {};
    if (PZRoot.zoidium.temporal) return PZRoot.zoidium.temporal;

    const state = {
      contexts: [],
      compositorsBySequence: new WeakMap(),
      evaluatingLayers: new WeakSet(),
      frameSamplerRuntimes: new WeakMap(),
      preparingEffects: new WeakSet(),
      restoringLayers: new WeakSet(),
      rootSequences: new WeakMap(),
      samplingEffects: new WeakSet(),
      originalLayerUpdate: null,
      originalCompositorUnload: null,
      originalExportGetVideoFrame: null,
      wrappedExportGetVideoFrame: null,
      originalRenderSequence: null,
      originalRenderLayer: null,
      originalSchedulePrepare: null,
      originalPlaybackUpdateSchedule: null,
      originalViewportRender: null,
      layerPrototype: null,
      compositorPrototype: null,
      schedulePrototype: null,
      playbackPrototype: null,
      viewportPrototype: null,
      exportPrototype: null,
      resolveFrameSamples(effect) {
        return resolveFrameSamples(this, effect);
      },
      prepareFrameSamples(effect, frame, context) {
        return prepareFrameSamples(this, effect, frame, context);
      },
      mapLayerFrame(layer, localFrame) {
        const sequence = getSequenceForLayer(layer);
        return getTemporalLayerFrame(layer, localFrame, sequence);
      },
      mapProjectFrame(layer, projectFrame) {
        const clip = getClipForLayer(layer);
        if (!clip || !Number.isFinite(projectFrame)) return null;
        return this.mapLayerFrame(layer, projectFrame - clip.start);
      },
      // Canonical frame helpers for other effects (A10). Other owners'
      // effects should use these instead of re-deriving quantize/plan math.
      quantizeFrame,
      clampFrame,
      offsetFrame,
      planFrameSamples,
      readFpsProp,
      // Shared by video-frame-export.js: registering the export compositor
      // must not depend on wrapper order. Either this wrapper runs (it calls
      // the wrapped function) or the deterministic export runs (it calls
      // this), so the compositor is registered exactly once per frame.
      registerExportCompositor(compositor) {
        return registerCompositor(this, compositor);
      },
    };

    PZRoot.zoidium.temporal = state;
    return state;
  }

  function installLayerUpdatePatch(state) {
    const prototype = PZ.layer?.prototype;
    if (!prototype || prototype[LAYER_UPDATE_MARKER]) return;

    state.layerPrototype = prototype;
    state.originalLayerUpdate = prototype.update;
    prototype.update = function temporalTrackedLayerUpdate(frame) {
      installEffectUpdatePatches(state, this);
      const context = state.contexts[state.contexts.length - 1];
      const mapped =
        context?.renderingSequence &&
        !state.evaluatingLayers.has(this) &&
        !state.restoringLayers.has(this)
          ? state.mapLayerFrame(this, frame)
          : null;

      if (mapped && Math.abs(mapped.sourceFrame - frame) > EPSILON) {
        const renderOnly = isSceneLayer(this);
        this.__zoidiumTemporalLastUpdateFrame = renderOnly
          ? frame
          : mapped.sourceFrame;
        this.__zoidiumTemporalSequenceMapping = {
          localFrame: finiteNumber(frame, 0),
          sourceFrame: mapped.sourceFrame,
          renderOnly,
        };
        if (renderOnly) return state.originalLayerUpdate.apply(this, arguments);
        return state.originalLayerUpdate.call(this, mapped.sourceFrame);
      }

      delete this.__zoidiumTemporalSequenceMapping;
      this.__zoidiumTemporalLastUpdateFrame = frame;
      return state.originalLayerUpdate.apply(this, arguments);
    };
    Object.defineProperty(prototype, LAYER_UPDATE_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installCompositorPatch(state) {
    const prototype = PZ.compositor?.prototype;
    if (!prototype || prototype[PATCH_MARKER]) return;

    state.compositorPrototype = prototype;
    state.originalRenderSequence = prototype.renderSequence;
    state.originalRenderLayer = prototype.renderLayer;
    state.originalCompositorUnload = prototype.unload;

    prototype.renderSequence = function temporalRenderSequence(frame) {
      registerCompositor(state, this);
      state.contexts.push({
        compositor: this,
        frameSamplerDepth: 0,
        outputFrame: frame,
        renderingSequence: true,
        rootCompositor: this,
      });
      try {
        return state.originalRenderSequence.apply(this, arguments);
      } finally {
        state.contexts.pop();
      }
    };

    prototype.unload = function temporalCompositorUnload() {
      disposeFrameSamplerRuntime(state, this);
      return state.originalCompositorUnload.apply(this, arguments);
    };

    prototype.renderLayer = function temporalRenderLayer(layer) {
      const sequenceMapping = layer?.__zoidiumTemporalSequenceMapping;
      if (sequenceMapping && !state.evaluatingLayers.has(layer)) {
        if (sequenceMapping.renderOnly) {
          state.evaluatingLayers.add(layer);
          state.restoringLayers.add(layer);
          try {
            layer.update(sequenceMapping.sourceFrame);
            return state.originalRenderLayer.apply(this, arguments);
          } finally {
            try {
              layer.update(sequenceMapping.localFrame);
              layer.__zoidiumTemporalLastUpdateFrame = sequenceMapping.localFrame;
            } finally {
              delete layer.__zoidiumTemporalSequenceMapping;
              state.restoringLayers.delete(layer);
              state.evaluatingLayers.delete(layer);
            }
          }
        }

        try {
          return state.originalRenderLayer.apply(this, arguments);
        } finally {
          delete layer.__zoidiumTemporalSequenceMapping;
          state.restoringLayers.add(layer);
          try {
            state.originalLayerUpdate.call(layer, sequenceMapping.localFrame);
            layer.__zoidiumTemporalLastUpdateFrame = sequenceMapping.localFrame;
          } finally {
            state.restoringLayers.delete(layer);
          }
        }
      }

      const lastFrame = finiteNumber(layer?.__zoidiumTemporalLastUpdateFrame, NaN);
      const mapped =
        !state.evaluatingLayers.has(layer) && Number.isFinite(lastFrame)
          ? state.mapLayerFrame(layer, lastFrame)
          : null;

      if (!mapped || Math.abs(mapped.sourceFrame - lastFrame) <= EPSILON) {
        return state.originalRenderLayer.apply(this, arguments);
      }

      state.evaluatingLayers.add(layer);
      try {
        layer.update(mapped.sourceFrame);
        return state.originalRenderLayer.apply(this, arguments);
      } finally {
        state.evaluatingLayers.delete(layer);
        layer.update(mapped.localFrame);
      }
    };

    Object.defineProperty(prototype, PATCH_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installSchedulePreparePatch(state) {
    const prototype = PZ.schedule?.prototype;
    if (!prototype || prototype[SCHEDULE_PREPARE_MARKER]) return;

    state.schedulePrototype = prototype;
    state.originalSchedulePrepare = prototype.prepare;
    prototype.prepare = async function temporalSchedulePrepare(projectFrame) {
      const args = Array.prototype.slice.call(arguments, 1);
      const found = findScheduleItemAtFrame(this, projectFrame);
      if (found?.item?.clip) {
        const clip = found.item.clip;
        const layer = clip?.object;
        const sequence = clip?.parentProject?.sequence || null;
        const localFrame = projectFrame - finiteNumber(clip.start, 0);
        const mapped = layer ? getTemporalLayerFrame(layer, localFrame, sequence) : null;
        const isProceduralSchedule =
          this.type === PZ.schedule?.type?.NONE || !found.item.media;
        if (mapped && isProceduralSchedule) {
          // Procedural clips (Scene/Adjustment) can render beyond their
          // out-point. The original prepare() would look up the schedule at
          // the warped source frame, find no item, and leave the previous
          // frame on screen (a long freeze). Evaluate the output-active
          // clip directly at the warped source frame instead.
          this.currentItem = found.item;
          const itemIndex = Array.prototype.indexOf.call(this.items, found.item);
          if (Number.isInteger(itemIndex) && itemIndex >= 0) this.index = itemIndex;
          try {
            clip.update(mapped.projectFrame);
          } catch (_error) {
            // A failing procedural update must not break the export loop.
          }
          try {
            if (typeof clip.prepare === "function") await clip.prepare(mapped.projectFrame, args[0]);
          } catch (_error) {
            // Ignore prepare failures here; the compositor still renders.
          }
          return;
        }
        if (mapped) {
          return state.originalSchedulePrepare.call(this, mapped.projectFrame, ...args);
        }
      }
      const sourceFrame = getScheduleSourceFrame(this, projectFrame);
      return state.originalSchedulePrepare.call(this, sourceFrame, ...args);
    };
    Object.defineProperty(prototype, SCHEDULE_PREPARE_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installPlaybackPatch(state) {
    const prototype = PZ.ui?.playback?.prototype;
    if (!prototype || prototype[PLAYBACK_SCHEDULE_MARKER]) return;

    state.playbackPrototype = prototype;
    state.originalPlaybackUpdateSchedule = prototype.updateSchedule;
    prototype.updateSchedule = function temporalUpdateSchedule(schedule, delta) {
      if (schedule?.type !== PZ.schedule?.type?.VIDEO || !schedule.currentItem) {
        return state.originalPlaybackUpdateSchedule.apply(this, arguments);
      }

      const outputFrame = finiteNumber(this._exactFrame, NaN);
      const nextOutputFrame = outputFrame + finiteNumber(delta, 0);
      const layer = schedule.currentItem.clip?.object;
      const current = state.mapProjectFrame(layer, outputFrame);
      const next = state.mapProjectFrame(layer, nextOutputFrame);
      if (!current || !next) {
        return state.originalPlaybackUpdateSchedule.apply(this, arguments);
      }

      const previousExactFrame = this._exactFrame;
      this._exactFrame = current.projectFrame;
      try {
        return state.originalPlaybackUpdateSchedule.call(
          this,
          schedule,
          next.projectFrame - current.projectFrame,
        );
      } finally {
        this._exactFrame = previousExactFrame;
      }
    };
    Object.defineProperty(prototype, PLAYBACK_SCHEDULE_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installViewportPatch(state) {
    const prototype = PZ.ui?.viewport?.prototype;
    if (!prototype || prototype[VIEWPORT_RENDER_MARKER]) return;

    state.viewportPrototype = prototype;
    state.originalViewportRender = prototype._render;
    prototype._render = function temporalViewportRender() {
      registerCompositor(state, this.compositor);
      if (!this.renderMode || !this.layer) {
        const sequence = this.compositor?._sequence;
        const frame = finiteNumber(this.editor?.playback?.currentFrame, 0);
        const effects = [];
        for (const track of sequence?.videoTracks || []) {
          if (track.enabled === false) continue;
          const clip = track.getCurrentClip?.(frame);
          for (const effect of clip?.object?.effects || []) {
            if (!effect._zoidiumFrameSampler) continue;
            const controlFrame = getAdjustmentEffectFrame(clip.object, effect, frame - clip.start);
            const request = effect._zoidiumFrameSampler.getRequest(effect, controlFrame);
            if (request && request.enabled !== false && Number(request.count) > 0) {
              effects.push({ effect, clip });
            }
          }
        }
        if (effects.length > 0) {
          // One bounded preparation per viewport. The serialization includes
          // clip timing, effect order, expressions, keys and sequence settings.
          const key = JSON.stringify([frame, frameSamplerInputKey(sequence, this.compositor),
            effects.map(({ effect }) => frameSamplerIdentity(effect))]);
          const runtime = getFrameSamplerRuntime(state, this.compositor);
          // Preparation temporarily updates effect uniforms and decoder textures.
          // Even a previously prepared frame must wait until that work finishes.
          if (runtime.previewPending) return;
          if (runtime.previewKey !== key) {
            if (!runtime.previewPending) {
              runtime.previewPending = true;
              const viewport = this;
              (async () => {
                for (const { effect, clip } of effects) {
                  const localFrame = frame - clip.start;
                  const mapped = state.mapLayerFrame(clip.object, localFrame);
                  const sourceFrame = mapped?.sourceFrame ?? localFrame;
                  clip.object.update(sourceFrame);
                  await effect.prepare(sourceFrame,
                    { sequence, frameSamplerRoot: viewport.compositor });
                }
                runtime.previewMedia = await prepareLowerSchedules(sequence,
                  { layer: null, trackIndex: 0 }, frame, { sequence }, runtime, true);
                if (runtime.disposed) return;
                runtime.previewKey = key;
                // Show each completed frame during playback. Waiting for the
                // moving playhead to equal it would starve the preview forever.
                renderPreparedPreview(viewport, runtime, frame);
              })().catch((error) => {
                console.error("[Zoidium] temporal preview preparation failed:", error);
              }).finally(() => {
                runtime.previewPending = false;
                viewport.lastFrame = -1;
              });
            }
            return;
          }
          return renderPreparedPreview(this, runtime, frame);
        }
        return state.originalViewportRender.apply(this, arguments);
      }

      // The 3D editing viewport must remain on the live editing frame. Temporal
      // operators are applied only when the Scene is rendered as a layer in
      // the sequence compositor.
      if (isSceneLayer(this.layer)) {
        return state.originalViewportRender.apply(this, arguments);
      }

      const outputFrame = finiteNumber(this.editor?.playback?.currentFrame, NaN);
      const mapped = state.mapProjectFrame(this.layer, outputFrame);
      if (!mapped || Math.abs(mapped.sourceFrame - mapped.localFrame) <= EPSILON) {
        return state.originalViewportRender.apply(this, arguments);
      }

      this.layer.update(mapped.sourceFrame);
      try {
        this.renderer.render(this.scene, this.camera);
        this.lastFrame = -1;
      } finally {
        this.layer.update(mapped.localFrame);
      }
    };
    Object.defineProperty(prototype, VIEWPORT_RENDER_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function installExportPatch(state) {
    const prototype = PZ.export?.prototype;
    if (!prototype || typeof prototype.getVideoFrame !== "function") return;
    // Chain explicitly: wrap whatever is installed now (the CM3 original or
    // video-frame-export's deterministic replacement) instead of assuming
    // this script loads first. Skip only when the current function is already
    // our wrapper, so a repeated install stays a no-op.
    if (prototype.getVideoFrame === state.wrappedExportGetVideoFrame) return;

    state.exportPrototype = prototype;
    const previous = prototype.getVideoFrame;
    state.originalExportGetVideoFrame = previous;
    const wrapped = (state.wrappedExportGetVideoFrame =
      function temporalExportGetVideoFrame() {
        registerCompositor(state, this.compositor);
        return previous.apply(this, arguments);
      });
    prototype.getVideoFrame = wrapped;
    Object.defineProperty(prototype, EXPORT_FRAME_MARKER, {
      configurable: true,
      value: true,
    });
  }

  function install(globalObject) {
    if (typeof PZ === "undefined" || !PZ.compositor || !PZ.layer || !PZ.schedule) return null;
    const state = getTemporalState();
    if (!state) return null;
    installLayerUpdatePatch(state);
    installCompositorPatch(state);
    installSchedulePreparePatch(state);
    installPlaybackPatch(state);
    installViewportPatch(state);
    installExportPatch(state);
    if (globalObject) globalObject.ZOIDIUM_TEMPORAL = state;
    return state;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      applyTemporalOperators,
      buildFrameSamplePlan,
      clampFrame,
      clampLocalFrame,
      findScheduleItemAtFrame,
      isClipActiveAtProjectFrame,
      mapTemporalFrameWithScopes,
      offsetFrame,
      planFrameSamples,
      quantizeFrame,
      quantizeLocalFrame,
      readFpsProp,
    };
    return;
  }

  install(global);
})(typeof window !== "undefined" ? window : null);

