// Zoidium Core — temporal layers (split from temporal-render.js).
// Clip/layer/operator mapping. Loads after temporal-math.js.
(function temporalLayersPart(global) {
  "use strict";

  var registry = global.__zoidiumTemporalParts || (global.__zoidiumTemporalParts = {});

  var math = registry.math;
  if (!math && typeof module === "object" && module.exports) {
    math = require("./temporal-math.js");
    registry.math = math;
  }
  if (!math) throw new Error("[Zoidium] temporal-math.js must load before temporal-layers.js.");
  var EFFECT_UPDATE_MARKER = math.EFFECT_UPDATE_MARKER;
  var finiteNumber = math.finiteNumber;
  var mapTemporalFrameWithScopes = math.mapTemporalFrameWithScopes;

  function getSequenceForLayer(layer) {
    try {
      return layer?.getParentOfType?.(PZ.sequence) || layer?.parentProject?.sequence || null;
    } catch (_error) {
      // Detached layers resolve against no sequence.
      return null;
    }
  }

  function getClipForLayer(layer) {
    try {
      return layer?.tryGetParentOfType?.(PZ.clip) || null;
    } catch (_error) {
      // Detached layers belong to no clip.
      return null;
    }
  }

  function isTopLevelClipLayer(layer, clip) {
    return Boolean(layer && clip && clip.object === layer);
  }

  function getProjectRate(layer, sequence) {
    const value = sequence?.properties?.rate?.get?.();
    return finiteNumber(value, 30);
  }

  function isAdjustmentLayer(layer) {
    const AdjustmentLayer = typeof PZ !== "undefined" ? PZ.layer?.adjustment : null;
    return Boolean(AdjustmentLayer && layer instanceof AdjustmentLayer);
  }

  function isSceneLayer(layer) {
    const SceneLayer = typeof PZ !== "undefined" ? PZ.layer?.scene : null;
    return Boolean(SceneLayer && layer instanceof SceneLayer);
  }

  function isExtrapolatableLayer(layer) {
    // Procedural layers (Scene, Adjustment) can evaluate beyond their clip
    // out-point: shader time keeps running and keyframed properties hold
    // their end values. Media-backed content still clamps (freeze) because
    // there are no frames beyond the media duration. Video texture seeks
    // clamp independently in video-frame-export.js.
    return isSceneLayer(layer) || isAdjustmentLayer(layer);
  }

  function findScheduleItemAtFrame(schedule, projectFrame) {
    const items = schedule?.items;
    if (!items || typeof items.length !== "number") return null;
    if (!Number.isFinite(projectFrame)) return null;
    const padding = finiteNumber(schedule?.padding, 0);
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item) continue;
      const start = finiteNumber(item.start, 0);
      const length = finiteNumber(item.length, 0);
      if (projectFrame >= start - padding && projectFrame < start + length) {
        return { item, index };
      }
    }
    return null;
  }

  function getVideoTrackIndex(sequence, layer) {
    const tracks = sequence?.videoTracks;
    if (!tracks || !layer) return -1;
    for (let index = 0; index < tracks.length; index += 1) {
      if (tracks[index]?.layer === layer) return index;
    }
    return -1;
  }

  function isClipActiveAtProjectFrame(clip, projectFrame) {
    const start = finiteNumber(clip?.start, 0);
    const length = finiteNumber(clip?.length, 0);
    return projectFrame >= start && projectFrame < start + length;
  }

  function readTemporalOperatorsInRange(layer, start, end, controlFrame) {
    const effects = layer?.effects;
    if (!effects || typeof effects.length !== "number") return [];
    const operators = [];
    for (let index = start; index < Math.min(end, effects.length); index += 1) {
      const effect = effects[index];
      const descriptor = effect?._zoidiumTemporal;
      if (!descriptor || typeof descriptor.getOperator !== "function") continue;
      try {
        const operator = descriptor.getOperator(effect, controlFrame);
        if (operator) operators.push(operator);
      } catch (error) {
        console.error("[Zoidium] temporal effect evaluation failed:", error);
      }
    }
    return operators;
  }

  function readTemporalOperators(layer, controlFrame) {
    return readTemporalOperatorsInRange(layer, 0, Infinity, controlFrame);
  }

  function readTemporalOperatorsBeforeIndex(layer, index, controlFrame) {
    return readTemporalOperatorsInRange(layer, 0, index, controlFrame);
  }

  function readTemporalOperatorsAfterIndex(layer, index, controlFrame) {
    return readTemporalOperatorsInRange(layer, index + 1, Infinity, controlFrame);
  }

  function getFrameSamplerScope() {
    const contexts = typeof PZ !== "undefined" ? PZ.zoidium?.temporal?.contexts : null;
    return contexts?.[contexts.length - 1]?.frameSamplerScope;
  }

  function getAdjustmentEffectFrame(layer, effect, frame) {
    if (!isAdjustmentLayer(layer) || getFrameSamplerScope()?.layer === layer) return frame;

    const effects = layer?.effects;
    const index = effects?.indexOf?.(effect) ?? -1;
    if (index < 0) return frame;

    const scopeOperators = readTemporalOperatorsAfterIndex(layer, index, frame);
    if (scopeOperators.length === 0) return frame;

    const clip = getClipForLayer(layer);
    const sequence = getSequenceForLayer(layer);
    return mapTemporalFrameWithScopes(
      frame,
      getProjectRate(layer, sequence),
      [],
      scopeOperators,
      finiteNumber(clip?.length, 0),
      finiteNumber(clip?.start, 0),
      true,
    );
  }

  function installEffectUpdatePatches(state, layer) {
    const effects = layer?.effects;
    if (!effects || typeof effects.length !== "number") return;

    for (let index = 0; index < effects.length; index += 1) {
      const effect = effects[index];
      if (!effect || effect[EFFECT_UPDATE_MARKER] || typeof effect.update !== "function") {
        continue;
      }

      const originalUpdate = effect.update;
      effect.update = function temporalEffectUpdate(frame) {
        const evaluationFrame = getAdjustmentEffectFrame(layer, effect, frame);
        return originalUpdate.call(this, evaluationFrame);
      };
      Object.defineProperty(effect, EFFECT_UPDATE_MARKER, {
        configurable: true,
        value: true,
      });
    }
  }

  function readAdjustmentScopeOperators(sequence, targetLayer, projectFrame) {
    const targetIndex = getVideoTrackIndex(sequence, targetLayer);
    if (targetIndex < 0) return [];

    const operators = [];
    const tracks = sequence?.videoTracks || [];
    // CM3 renders videoTracks from low to high index. A later Adjustment
    // layer is therefore above the target and sees the accumulated result
    // from every lower track.
    const scope = getFrameSamplerScope();
    const end = scope ? Math.min(tracks.length, scope.trackIndex) : tracks.length;
    for (let index = targetIndex + 1; index < end; index += 1) {
      const adjustmentLayer = tracks[index]?.layer;
      if (!isAdjustmentLayer(adjustmentLayer)) continue;

      const adjustmentClip = getClipForLayer(adjustmentLayer);
      if (!isTopLevelClipLayer(adjustmentLayer, adjustmentClip)) continue;
      if (!isClipActiveAtProjectFrame(adjustmentClip, projectFrame)) continue;

      const controlFrame = projectFrame - finiteNumber(adjustmentClip.start, 0);
      operators.push(...readTemporalOperators(adjustmentLayer, controlFrame));
    }
    return operators;
  }

  function getTemporalLayerFrame(layer, localFrame, sequence) {
    const clip = getClipForLayer(layer);
    if (!isTopLevelClipLayer(layer, clip)) return null;

    const rawLocalFrame = finiteNumber(localFrame, 0);
    const outputProjectFrame = finiteNumber(clip.start, 0) + rawLocalFrame;
    // The clip contributes nothing when the output frame is outside its
    // range (its track layer is null and the compositor skips it). Mapping
    // such frames would make hidden clips visible at a warped end-state.
    if (!isClipActiveAtProjectFrame(clip, outputProjectFrame)) return null;

    const projectRate = getProjectRate(layer, sequence);
    const outputLocalFrame = rawLocalFrame;
    const operators = isAdjustmentLayer(layer)
      ? []
      : readTemporalOperators(layer, outputLocalFrame);
    const scopeOperators = readAdjustmentScopeOperators(
      sequence,
      layer,
      outputProjectFrame,
    );
    if (operators.length === 0 && scopeOperators.length === 0) return null;

    const extrapolate = isExtrapolatableLayer(layer);
    const sourceFrame = mapTemporalFrameWithScopes(
      rawLocalFrame,
      projectRate,
      operators,
      scopeOperators,
      finiteNumber(clip.length, 0),
      finiteNumber(clip.start, 0),
      extrapolate,
    );
    return {
      clip,
      localFrame: outputLocalFrame,
      sourceFrame,
      projectFrame: clip.start + sourceFrame,
      projectRate,
    };
  }

  function getScheduleSourceFrame(schedule, projectFrame) {
    if (!Number.isFinite(projectFrame)) return projectFrame;
    // Use the item active at the output frame. Reading currentItem here
    // would return the previous frame's item because the original prepare()
    // has not run yet for this frame, which breaks mappings at clip
    // boundaries.
    const found = findScheduleItemAtFrame(schedule, projectFrame);
    const clip = found?.item?.clip || schedule?.currentItem?.clip;
    if (!found || !clip) return projectFrame;
    const layer = clip?.object;
    if (!layer) return projectFrame;
    const sequence = clip?.parentProject?.sequence || null;
    const localFrame = projectFrame - finiteNumber(clip.start, 0);
    const mapped = getTemporalLayerFrame(layer, localFrame, sequence);
    return mapped ? mapped.projectFrame : projectFrame;
  }

  function canRenderLayer(layer) {
    if (!layer) return false;
    if (isSceneLayer(layer) && !layer.pass?.camera) return false;
    if (layer instanceof PZ.layer.composite && !layer.objects?.length) return false;
    return true;
  }

  function findFrameSamplerStage(sequence, effect, projectFrame) {
    const tracks = sequence?.videoTracks || [];
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex += 1) {
      const track = tracks[trackIndex];
      if (!track || track.enabled === false) continue;
      let clip = track.getCurrentClip?.(projectFrame);
      let layer = clip?.object;
      let effectIndex = layer?.effects?.indexOf?.(effect) ?? -1;
      if (effectIndex < 0) {
        // Procedural temporal operators may evaluate an output-active owner
        // beyond its clip range. Locate its stage by identity in that case.
        clip = track.clips?.find?.((candidate) => candidate.object?.effects?.includes?.(effect));
        layer = clip?.object;
        effectIndex = layer?.effects?.indexOf?.(effect) ?? -1;
      }
      if (!clip || !layer || effectIndex < 0) continue;
      return { clip, effect, effectIndex, layer, trackIndex };
    }
    return null;
  }

  registry.layers = {
    getSequenceForLayer: getSequenceForLayer,
    getClipForLayer: getClipForLayer,
    isTopLevelClipLayer: isTopLevelClipLayer,
    getProjectRate: getProjectRate,
    isAdjustmentLayer: isAdjustmentLayer,
    isSceneLayer: isSceneLayer,
    isExtrapolatableLayer: isExtrapolatableLayer,
    findScheduleItemAtFrame: findScheduleItemAtFrame,
    getVideoTrackIndex: getVideoTrackIndex,
    isClipActiveAtProjectFrame: isClipActiveAtProjectFrame,
    readTemporalOperators: readTemporalOperators,
    readTemporalOperatorsBeforeIndex: readTemporalOperatorsBeforeIndex,
    readTemporalOperatorsAfterIndex: readTemporalOperatorsAfterIndex,
    getAdjustmentEffectFrame: getAdjustmentEffectFrame,
    installEffectUpdatePatches: installEffectUpdatePatches,
    readAdjustmentScopeOperators: readAdjustmentScopeOperators,
    getTemporalLayerFrame: getTemporalLayerFrame,
    getScheduleSourceFrame: getScheduleSourceFrame,
    canRenderLayer: canRenderLayer,
    findFrameSamplerStage: findFrameSamplerStage,
  };
  if (typeof module === "object" && module.exports) module.exports = registry.layers;
})(typeof globalThis !== "undefined" ? globalThis : this);

