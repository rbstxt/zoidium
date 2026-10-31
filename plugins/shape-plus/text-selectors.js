"use strict";
// Pure range- and wiggly-selector evaluation for Text Animators. No CM3
// objects, no wall clock, no Math.random: every function is deterministic in
// its inputs so renders are identical across reloads and machines.
//
// Integer hashing reuses the ExpressText+ seeded-random construction
// (plugins/expresstext-plus/expresstext-random.js hashSeed/seededRandom),
// reimplemented here so Shape+ keeps no cross-plugin bundle dependency.
// Wiggly noise reuses the Wiggle Paths lattice (deform.js sampleNoise).
const { sampleNoise } = require("./deform.js");
function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
// Deterministic 0..1 hash of an integer seed and salt. Same inputs always
// give the same value; fractional seeds keep their truncated identity.
function hashSeed(seed, salt) {
  let h = (Math.floor(numberValue(seed, 1)) * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function seededRandom(seed, index, channel) {
  return hashSeed(numberValue(seed, 1) * 1000 + index * 131 + channel * 17, 7);
}
// Fisher-Yates permutation of [0..count), deterministic per seed. Same seed
// gives the same order on every machine; any seed change reorders.
function randomPermutation(count, seed) {
  const order = [];
  const n = Math.max(0, Math.trunc(numberValue(count, 0)));
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(seededRandom(seed, i, 101) * (i + 1));
    const swap = order[i]; order[i] = order[j]; order[j] = swap;
  }
  return order;
}
function clamp01(x) { return Math.min(1, Math.max(0, x)); }
// Monotone remaps of a 0..1 selector value. Positive ease slows the curve
// near the named end (slope towards 0); negative values sharpen it (slope
// towards infinity). 0% is the identity in both directions.
function easeLow(value, percent) {
  const v = clamp01(value), amount = numberValue(percent, 0) / 100;
  if (amount >= 0) return Math.pow(v, 1 + amount);
  return Math.pow(v, 1 / (1 - amount));
}
function easeHigh(value, percent) {
  const v = clamp01(value), amount = numberValue(percent, 0) / 100;
  if (amount >= 0) return 1 - Math.pow(1 - v, 1 + amount);
  return 1 - Math.pow(1 - v, 1 / (1 - amount));
}
// Evaluate one range shape at unit i of n. start/end are normalised
// (offset included, start <= end). Square measures the fraction of the
// unit's span covered by the range; every other shape samples the unit
// centre. start === end selects nothing.
function shapeValue(shape, i, n, start, end) {
  if (!(n > 0) || start === end) return 0;
  if (shape === "square") {
    const a = Math.max(start, i / n), b = Math.min(end, (i + 1) / n);
    return clamp01((b - a) * n);
  }
  const c = (i + 0.5) / n;
  if (shape === "rampUp") {
    if (c <= start) return 0;
    if (c >= end) return 1;
    return (c - start) / (end - start);
  }
  if (shape === "rampDown") {
    if (c <= start) return 1;
    if (c >= end) return 0;
    return (end - c) / (end - start);
  }
  if (c <= start || c >= end) return 0;
  const t = (c - start) / (end - start);
  if (shape === "triangle") return t < 0.5 ? t * 2 : (1 - t) * 2;
  if (shape === "round") return Math.sqrt(Math.max(0, 1 - Math.pow(t * 2 - 1, 2)));
  return 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
}
// Normalise selector bounds. Percentage units divide by 100. Index units
// divide by the unit count; a default triple of start 0, end 100, offset 0
// means "to the last unit" (end = n) so an untouched Index selector covers
// the whole text, matching the documented Index defaults.
function normalizeBounds(selector, n) {
  const start = numberValue(selector.selectorStart, 0), end = numberValue(selector.selectorEnd, 100), offset = numberValue(selector.selectorOffset, 0);
  if (selector.selectorUnits !== "index" || !(n > 0)) return { start: start / 100 + offset / 100, end: end / 100 + offset / 100 };
  const rawEnd = start === 0 && offset === 0 && end === 100 ? n : end;
  return { start: start / n + offset / n, end: rawEnd / n + offset / n };
}
// Range value per unit before mode combination: shape, ease remap, amount.
// Returns an array of n values in roughly [-1, 1].
function rangeValues(selector, n) {
  const count = Math.max(0, Math.trunc(n) || 0);
  if (!count) return [];
  const { start, end } = normalizeBounds(selector, count);
  const from = Math.min(start, end), to = Math.max(start, end);
  const order = selector.selectorRandomize ? randomPermutation(count, selector.selectorRandomSeed ?? 0) : null;
  const amount = numberValue(selector.selectorAmount, 100) / 100;
  const result = new Array(count);
  for (let i = 0; i < count; i++) {
    const raw = shapeValue(selector.selectorShape || "square", order ? order[i] : i, count, from, to);
    result[i] = easeHigh(easeLow(raw, selector.selectorEaseLow), selector.selectorEaseHigh) * amount;
  }
  return result;
}
// Combine a selector value with the accumulated value. The first selector of
// an animator starts from 0. The result is clamped to [-1, 1].
function combine(mode, accumulated, value) {
  const a = numberValue(accumulated, 0), b = numberValue(value, 0);
  let result = a + b;
  if (mode === "subtract") result = a - b;
  else if (mode === "intersect") result = a * b;
  else if (mode === "min") result = Math.min(a, b);
  else if (mode === "max") result = Math.max(a, b);
  else if (mode === "difference") result = Math.abs(a - b);
  return Math.min(1, Math.max(-1, result));
}
// Smooth per-unit wiggly noise at a time in seconds, scaled into
// [min, max] (percent). Correlation 100% shares one value across units;
// 0% is fully independent. component selects the noise stream: scalars use
// channel 0, and unlocked vector components each use their own channel.
function wigglyValue(selector, unit, time) {
  const max = numberValue(selector.wigglyMax, 100) / 100, min = numberValue(selector.wigglyMin, -100) / 100;
  const noise = sampleNoise({
    time: numberValue(time, 0),
    frequency: numberValue(selector.wigglesPerSecond, 2),
    correlation: numberValue(selector.correlation, 50),
    temporalPhase: numberValue(selector.temporalPhase, 0),
    spatialPhase: numberValue(selector.spatialPhase, 0),
    seed: Math.round(numberValue(selector.wigglySeed, 0)),
  }, numberValue(unit, 0), selector.component || 0, 0);
  return min + (noise + 1) / 2 * (max - min);
}
module.exports = { numberValue, hashSeed, seededRandom, randomPermutation, clamp01, easeLow, easeHigh, shapeValue, normalizeBounds, rangeValues, combine, wigglyValue };
