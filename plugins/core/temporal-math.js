// Zoidium Core — temporal math (split from temporal-render.js).
// Pure frame helpers shared by temporal effects. Loads first of the
// temporal core scripts; later scripts read these exports from the shared
// registry (browser classic scripts) or through require (Node tests).
(function temporalMathPart(global) {
  "use strict";

  var registry = global.__zoidiumTemporalParts || (global.__zoidiumTemporalParts = {});

  const EPSILON = 1e-9;
  const PATCH_MARKER = "__zoidiumTemporalRenderPatch";
  const LAYER_UPDATE_MARKER = "__zoidiumTemporalLayerUpdatePatch";
  const EFFECT_UPDATE_MARKER = "__zoidiumTemporalEffectUpdatePatch";
  const SCHEDULE_PREPARE_MARKER = "__zoidiumTemporalSchedulePreparePatch";
  const PLAYBACK_SCHEDULE_MARKER = "__zoidiumTemporalPlaybackSchedulePatch";
  const VIEWPORT_RENDER_MARKER = "__zoidiumTemporalViewportRenderPatch";
  const EXPORT_FRAME_MARKER = "__zoidiumTemporalExportFramePatch";
  const MAX_FRAME_SAMPLES = 16;
  const MAX_FRAME_SAMPLER_DEPTH = 8;
  // Explicit per-tap frame lists (Time Displacement slices, CC Wide Time
  // forward/backward steps) may need more taps than the evenly spaced Echo
  // plan; they stay bounded by their own cap and reuse the same pooled
  // scratch targets.
  const MAX_EXPLICIT_FRAME_SAMPLES = 64;

  function finiteNumber(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  // Canonical frame helpers shared by temporal effects (A10). Older local
  // names below stay as aliases so existing callers keep working.
  function clampFrame(frame, clipLength, extrapolate) {
    const value = finiteNumber(frame, 0);
    if (extrapolate) return value;
    const clamped = Math.max(0, value);
    if (!(clipLength > 0)) return clamped;
    return Math.min(clamped, Math.max(0, clipLength - EPSILON));
  }

  function clampLocalFrame(frame, clipLength, extrapolate) {
    return clampFrame(frame, clipLength, extrapolate);
  }

  function quantizeFrame(localFrame, projectRate, targetRate, extrapolate) {
    const rate = finiteNumber(projectRate, 30);
    const fps = finiteNumber(targetRate, 0);
    const input = finiteNumber(localFrame, 0);
    if (!(rate > 0) || !(fps > 0)) return extrapolate ? input : Math.max(0, input);

    const seconds = (extrapolate ? input : Math.max(0, input)) / rate;
    const quantizedSeconds = Math.floor(seconds * fps + EPSILON) / fps;
    return quantizedSeconds * rate;
  }

  function quantizeLocalFrame(localFrame, projectRate, targetRate, extrapolate) {
    return quantizeFrame(localFrame, projectRate, targetRate, extrapolate);
  }

  function offsetFrame(frame, offsetFrames) {
    return finiteNumber(frame, 0) + finiteNumber(offsetFrames, 0);
  }

  function readFpsProp(property, frame, fallback) {
    let value;
    try {
      value = Number(property && property.get ? property.get(frame) : NaN);
    } catch (_error) {
      // An unreadable rate property keeps the caller's fallback.
      return fallback;
    }
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function applyTemporalOperators(localFrame, projectRate, operators, clipLength, extrapolate) {
    let result = clampLocalFrame(localFrame, clipLength, extrapolate);
    for (const operator of operators || []) {
      if (!operator || operator.enabled === false) continue;
      if (operator.kind === "time-offset") {
        result += finiteNumber(operator.offsetFrames, 0);
      } else if (operator.kind === "posterize-time") {
        result = quantizeLocalFrame(result, projectRate, operator.fps, extrapolate);
      }
      result = clampLocalFrame(result, clipLength, extrapolate);
    }
    return result;
  }

  // A sampler's clock already includes the prefix's translations. Rebase
  // those translations before replaying its ordered quantizers on a tap.
  // An offset-only prefix therefore leaves its taps unchanged.
  function mapFrameSamplerInputFrame(frame, projectRate, operators, clipLength, extrapolate) {
    const active = (operators || []).filter(operator => operator && operator.enabled !== false);
    if (!active.some(operator => operator.kind === "posterize-time")) return frame;
    const translation = active.reduce((offset, operator) => offset +
      (operator.kind === "time-offset" ? finiteNumber(operator.offsetFrames, 0) : 0), 0);
    return applyTemporalOperators(frame - translation, projectRate, active, clipLength, extrapolate);
  }

  function clampUnit(value, fallback) {
    return Math.min(1, Math.max(0, finiteNumber(value, fallback)));
  }

  function planFrameSamples(
    outputFrame,
    count,
    offsetFrames,
    startOpacity,
    decay,
    minimumFrame,
    maximumFrame,
  ) {
    const total = Math.min(
      MAX_FRAME_SAMPLES,
      Math.max(0, Math.round(finiteNumber(count, 0))),
    );
    const output = finiteNumber(outputFrame, 0);
    const offset = finiteNumber(offsetFrames, 0);
    const opacity = clampUnit(startOpacity, 1);
    const attenuation = clampUnit(decay, 1);
    const minimum = finiteNumber(minimumFrame, Number.NEGATIVE_INFINITY);
    const maximum = finiteNumber(maximumFrame, Number.POSITIVE_INFINITY);
    const lower = Math.min(minimum, maximum);
    const upper = Math.max(minimum, maximum);
    const samples = [];

    for (let index = 1; index <= total; index += 1) {
      const frame = Math.min(upper, Math.max(lower, output + offset * index));
      samples.push({
        frame,
        index,
        opacity: opacity * Math.pow(attenuation, index - 1),
      });
    }
    return samples;
  }

  // buildFrameSamplePlan keeps its historic name; planFrameSamples is the
  // canonical alias other effects should use.
  function buildFrameSamplePlan(
    outputFrame,
    count,
    offsetFrames,
    startOpacity,
    decay,
    minimumFrame,
    maximumFrame,
  ) {
    return planFrameSamples(
      outputFrame,
      count,
      offsetFrames,
      startOpacity,
      decay,
      minimumFrame,
      maximumFrame,
    );
  }

  // Explicit per-tap plan for samplers whose tap times are not evenly spaced
  // (Time Displacement slices, CC Wide Time forward/backward steps).
  // `offsets` are frame offsets relative to `outputFrame`; each tap is
  // clamped to [minimumFrame, maximumFrame] like the Echo plan (frames before
  // the clip start and after its end freeze on the edge frame) and the tap
  // count is capped at MAX_EXPLICIT_FRAME_SAMPLES. Every tap keeps full
  // opacity; the effect owns its own combination weights. Pure and
  // deterministic: same inputs always produce the same plan.
  function planExplicitFrameSamples(outputFrame, offsets, minimumFrame, maximumFrame) {
    const output = finiteNumber(outputFrame, 0);
    const minimum = finiteNumber(minimumFrame, Number.NEGATIVE_INFINITY);
    const maximum = finiteNumber(maximumFrame, Number.POSITIVE_INFINITY);
    const lower = Math.min(minimum, maximum);
    const upper = Math.max(minimum, maximum);
    const list = Array.isArray(offsets) ? offsets : [];
    const total = Math.min(MAX_EXPLICIT_FRAME_SAMPLES, list.length);
    const samples = [];
    for (let index = 0; index < total; index += 1) {
      const frame = Math.min(upper, Math.max(lower, output + finiteNumber(list[index], 0)));
      samples.push({ frame, index, opacity: 1 });
    }
    return samples;
  }

  function mapTemporalFrameWithScopes(
    localFrame,
    projectRate,
    operators,
    scopeOperators,
    clipLength,
    clipStart,
    extrapolate,
  ) {
    const start = finiteNumber(clipStart, 0);
    const sourceLocalFrame = applyTemporalOperators(
      localFrame,
      projectRate,
      operators,
      clipLength,
      extrapolate,
    );
    const sourceProjectFrame = applyTemporalOperators(
      start + sourceLocalFrame,
      projectRate,
      scopeOperators,
      undefined,
      extrapolate,
    );
    return clampLocalFrame(sourceProjectFrame - start, clipLength, extrapolate);
  }

  registry.math = {
    EPSILON: EPSILON,
    PATCH_MARKER: PATCH_MARKER,
    LAYER_UPDATE_MARKER: LAYER_UPDATE_MARKER,
    EFFECT_UPDATE_MARKER: EFFECT_UPDATE_MARKER,
    SCHEDULE_PREPARE_MARKER: SCHEDULE_PREPARE_MARKER,
    PLAYBACK_SCHEDULE_MARKER: PLAYBACK_SCHEDULE_MARKER,
    VIEWPORT_RENDER_MARKER: VIEWPORT_RENDER_MARKER,
    EXPORT_FRAME_MARKER: EXPORT_FRAME_MARKER,
    MAX_FRAME_SAMPLES: MAX_FRAME_SAMPLES,
    MAX_EXPLICIT_FRAME_SAMPLES: MAX_EXPLICIT_FRAME_SAMPLES,
    MAX_FRAME_SAMPLER_DEPTH: MAX_FRAME_SAMPLER_DEPTH,
    finiteNumber: finiteNumber,
    clampFrame: clampFrame,
    clampLocalFrame: clampLocalFrame,
    quantizeFrame: quantizeFrame,
    quantizeLocalFrame: quantizeLocalFrame,
    offsetFrame: offsetFrame,
    readFpsProp: readFpsProp,
    applyTemporalOperators: applyTemporalOperators,
    mapFrameSamplerInputFrame: mapFrameSamplerInputFrame,
    clampUnit: clampUnit,
    planFrameSamples: planFrameSamples,
    planExplicitFrameSamples: planExplicitFrameSamples,
    buildFrameSamplePlan: buildFrameSamplePlan,
    mapTemporalFrameWithScopes: mapTemporalFrameWithScopes,
  };
  if (typeof module === "object" && module.exports) module.exports = registry.math;
})(typeof globalThis !== "undefined" ? globalThis : this);

