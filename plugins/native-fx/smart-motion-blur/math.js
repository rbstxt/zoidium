"use strict";

// All distances in the public settings and stored fields are project pixels.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ID = "smartmotionblur";
const DISPLAY_NAME = "Smart Motion Blur";
const RANGE = 256;
const QUANTIZATION = 32767 / RANGE;

function properties(types) {
  const number = (name, value, min, max, step, decimals) => ({
    dynamic: true,
    name,
    type: types.NUMBER,
    value,
    min,
    max,
    step,
    decimals,
  });
  const option = (name, items) => ({
    dynamic: true,
    name,
    type: types.OPTION,
    value: 0,
    items,
  });
  return {
    amount: number("Blur Amount", 0.5, 0, 1, 0.01, 2),
    sensitivity: number("Motion Sensitivity", 70, 0, 100, 1, 0),
    smoothness: number("Vector Smoothness", 50, 0, 100, 1, 0),
    maxDisplacement: number("Max Displacement (px/frame)", 256, 1, 256, 1, 0),
    analysis: option("Analysis Frames", "Both;Previous;Next"),
    quality: option("Quality", "Balanced;High"),
    view: option("View", "Result;Motion Vectors;Confidence"),
  };
}

function readSettings(props, frame) {
  const defaults = properties({ NUMBER: 0, OPTION: 1 });
  const result = {};
  for (const [key, def] of Object.entries(defaults)) {
    let v;
    try {
      v = Number(props[key]?.get(frame));
    } catch (_error) {
      v = NaN;
    }
    const hi = def.max ?? def.items.split(";").length - 1;
    result[key] = clamp(Number.isFinite(v) ? v : def.value, def.min ?? 0, hi);
    if (def.items) result[key] = Math.round(result[key]);
  }
  return result;
}

function offsets(analysis) {
  return analysis === 1 ? [-1] : analysis === 2 ? [1] : [-1, 1];
}
function sampleCount(amount, speed, quality) {
  return clamp(
    Math.ceil((clamp(amount, 0, 1) * Math.max(0, speed)) / 2),
    8,
    quality ? 64 : 32,
  );
}
function shutterTimes(amount, count) {
  return Array.from(
    { length: count },
    (_, i) => ((i + 0.5) / count - 0.5) * clamp(amount, 0, 1),
  );
}
function neighbors(samples, current) {
  let previous = null,
    next = null;
  for (const tap of samples) {
    const d = tap.frame - current;
    // The sampler clamps to length - 1e-9. Treat that epsilon as a duplicate.
    if (d < -1e-7 && (!previous || tap.frame > previous.frame)) previous = tap;
    if (d > 1e-7 && (!next || tap.frame < next.frame)) next = tap;
  }
  return { previous, next };
}
function scale(processing, project) {
  return processing.map((v, i) => v / Math.max(1, project[i]));
}
function toProcessing(vector, ratio) {
  return vector.map((v, i) => v * ratio[i]);
}
function toProject(vector, ratio) {
  return vector.map((v, i) => v / ratio[i]);
}
function packComponent(value) {
  const code = clamp(
    Math.round(clamp(value, -RANGE, RANGE) * QUANTIZATION) + 32768,
    1,
    65535,
  );
  return [Math.floor(code / 256), code % 256];
}
function unpackComponent(bytes) {
  return (bytes[0] * 256 + bytes[1] - 32768) / QUANTIZATION;
}
function pack(vector) {
  return [...packComponent(vector[0]), ...packComponent(vector[1])];
}
function unpack(bytes) {
  return [
    unpackComponent(bytes.slice(0, 2)),
    unpackComponent(bytes.slice(2, 4)),
  ];
}
function pyramidSizes(width, height) {
  const levels = [];
  for (let factor = 2; factor <= 64; factor *= 2) {
    levels.push([
      Math.max(1, Math.ceil(width / factor)),
      Math.max(1, Math.ceil(height / factor)),
    ]);
    if (Math.min(...levels[levels.length - 1]) <= 8) break;
  }
  return levels;
}
module.exports = {
  ID,
  DISPLAY_NAME,
  RANGE,
  properties,
  readSettings,
  offsets,
  sampleCount,
  shutterTimes,
  neighbors,
  scale,
  toProcessing,
  toProject,
  pack,
  unpack,
  pyramidSizes,
};
