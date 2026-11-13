"use strict";
// Layer masks for Scene and Adjustment layers.
//
// A mask collection is a flat list of Shape+ path items ("kind": "path"),
// each carrying four extra top-level fields: mode, feather, opacity and
// invert. The path itself keeps the exact Shape+ animated format (vertexIds,
// six channels per vertex, per-channel keyframes), so the Shape+ pen,
// keyframe and history machinery edits masks unchanged. Mask-only code reads
// the extra fields; Shape+ validation ignores them.
//
// Mask collections persist as plain JSON on the native layer object under
// FIELD. The plugin manager retains unknown layer fields across load and
// save, so projects keep their masks even while this code is disabled (the
// masks simply do not render). Mask space is sequence-resolution pixels with
// the origin at the top-left and y growing down, matching the viewport pen
// overlay and the coverage raster.
const { flattenPath, lengthTable } = require("./path.js");
const { primitivePath } = require("./primitives.js");

// Own data property on the native Scene/Adjustment layer object. Never read
// or written by CM3 itself; the manager's field preservation merges the live
// value back on save, which also keeps the preview-cache key covering it.
const FIELD = "zoidiumMasks";
// Last update frame stashed per layer for mask evaluation. Set at runtime
// only, never present at load, so it is never serialized.
const FRAME_KEY = "__zoidiumLayerMaskFrame";
const MODES = ["add", "subtract", "intersect"];
const MAX_MASKS = 32;
const MAX_FEATHER = 500;
const MAX_POINTS = 256;
const VERTEX_MODES = ["corner", "smooth", "symmetric", "independent"];

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// The live value is the persistence source of truth. Anything else (a
// missing field, a lone object, loaded garbage) reads as no masks.
function getMasks(layer) {
  const data = layer?.[FIELD];
  return Array.isArray(data) ? data : [];
}

function setMasks(layer, masks) {
  validateMasks(masks);
  layer[FIELD] = masks;
}

function createMask(id, name, point) {
  const vertex = Array.isArray(point) ? point.slice(0, 2) : [0, 0];
  return {
    id,
    kind: "path",
    mode: "add",
    feather: 0,
    opacity: 1,
    invert: 0,
    vertexIds: ["v1"],
    vertexModes: {},
    properties: {
      name,
      enabled: 1,
      closed: 0,
      path: {
        animated: false,
        keyframes: [{ frame: 0, value: [...vertex, 0, 0, 0, 0], tween: 1 }],
      },
    },
  };
}

// Accepts the native { animated, keyframes } group encoding and the
// split-channel { objects } encoding emitted by detached test doubles (the
// shared PZ stub serializes groups per channel). Returns the native
// encoding. In the browser the native property serializer already emits the
// native encoding, so this is a no-op there.
function coercePath(path, channels) {
  if (!path || typeof path !== "object" || Array.isArray(path))
    throw Error("Layer mask needs a path");
  if (Array.isArray(path.keyframes)) return path;
  const objects = path.objects;
  if (!Array.isArray(objects) || objects.length !== channels ||
      !objects.every(channel => channel && typeof channel === "object"))
    throw Error("Layer mask path needs at least one keyframe");
  const frames = [...new Set(objects.flatMap(channel =>
    Array.isArray(channel.keyframes) ? channel.keyframes.map(key => key?.frame) : []))]
    .filter(frame => typeof frame === "number" && Number.isFinite(frame))
    .sort((a, b) => a - b);
  if (!frames.length) throw Error("Layer mask path needs at least one keyframe");
  const at = (channel, frame) => {
    const keys = (channel.keyframes || []).slice().sort((a, b) => a.frame - b.frame);
    let previous = keys[0];
    for (const next of keys.slice(1)) {
      if (frame > next.frame) {
        previous = next;
        continue;
      }
      if (next.tween === 0) return previous.value;
      const span = next.frame - previous.frame || 1;
      return previous.value + (next.value - previous.value) * ((frame - previous.frame) / span);
    }
    return previous.value;
  };
  return {
    animated: objects.some(channel => !!channel.animated),
    keyframes: frames.map(frame => ({
      frame,
      value: objects.map(channel => at(channel, frame)),
      tween: 1,
    })),
  };
}

function validateMasks(masks) {
  if (!Array.isArray(masks)) throw Error("Layer masks must be an array");
  if (masks.length > MAX_MASKS) throw Error("Layer masks support at most " + MAX_MASKS + " masks");
  const ids = new Set();
  for (const mask of masks) {
    if (!mask || typeof mask !== "object" || Array.isArray(mask)) throw Error("Layer mask must be an object");
    if (mask.kind !== "path") throw Error("Layer masks hold only paths");
    if (typeof mask.id !== "string" || !mask.id || mask.id.length > 128) throw Error("Layer mask needs a short string id");
    if (ids.has(mask.id)) throw Error("Duplicate layer mask id");
    ids.add(mask.id);
    if (!MODES.includes(mask.mode)) throw Error("Layer mask mode must be one of " + MODES.join(", "));
    if (!isFiniteNumber(mask.feather) || mask.feather < 0 || mask.feather > MAX_FEATHER)
      throw Error("Layer mask feather must be between 0 and " + MAX_FEATHER + " px");
    if (!isFiniteNumber(mask.opacity) || mask.opacity < 0 || mask.opacity > 1)
      throw Error("Layer mask opacity must be between 0 and 1");
    const invert = mask.invert === true ? 1 : mask.invert === false ? 0 : mask.invert;
    if (invert !== 0 && invert !== 1) throw Error("Layer mask invert must be off or on");
    if (mask.enabled !== undefined && mask.enabled !== 0 && mask.enabled !== 1)
      throw Error("Layer mask enabled must be off or on");
    const vertexIds = mask.vertexIds;
    if (!Array.isArray(vertexIds) || vertexIds.length < 1 || vertexIds.length > 256 ||
        new Set(vertexIds).size !== vertexIds.length ||
        !vertexIds.every(id => typeof id === "string" && id && id.length <= 128))
      throw Error("Layer mask needs 1-256 unique vertex ids");
    if (mask.vertexModes !== undefined) {
      if (!mask.vertexModes || typeof mask.vertexModes !== "object" || Array.isArray(mask.vertexModes))
        throw Error("Layer mask vertex modes must be an object");
      for (const mode of Object.values(mask.vertexModes))
        if (!VERTEX_MODES.includes(mode)) throw Error("Unknown layer mask vertex mode");
    }
    const properties = mask.properties;
    if (!properties || typeof properties !== "object") throw Error("Layer mask needs properties");
    if (properties.closed !== 0 && properties.closed !== 1 && properties.closed !== true && properties.closed !== false)
      throw Error("Layer mask closed must be off or on");
    const path = properties.path;
    if (!path || typeof path !== "object") throw Error("Layer mask needs a path");
    if (!Array.isArray(path.keyframes) || !path.keyframes.length)
      throw Error("Layer mask path needs at least one keyframe");
    const channels = vertexIds.length * 6;
    for (const key of path.keyframes) {
      if (!key || typeof key !== "object") throw Error("Layer mask keyframe must be an object");
      if (!isFiniteNumber(key.frame)) throw Error("Layer mask keyframe needs a finite frame");
      if (!Array.isArray(key.value) || key.value.length !== channels || !key.value.every(isFiniteNumber))
        throw Error("Layer mask keyframe value must hold 6 finite numbers per vertex");
    }
  }
  return masks;
}

function maskNameTaken(masks, name) {
  return masks.some(mask => mask?.properties?.name === name);
}

// "Mask 1", "Mask 2", ... across the collection, like AE.
function ensureNames(masks) {
  for (const mask of masks) {
    if (typeof mask?.properties?.name === "string" && mask.properties.name && mask.properties.name !== "Path") continue;
    let n = 1;
    while (maskNameTaken(masks, "Mask " + n)) n++;
    mask.properties.name = "Mask " + n;
  }
  return masks;
}

// Per-pixel combine. `base` is the accumulated coverage, `alpha` the feathered,
// opacity-weighted, inverted mask alpha, both in 0..1.
function combineValue(base, alpha, mode, isFirst) {
  if (isFirst) return mode === "subtract" ? 0 : alpha;
  if (mode === "add") return base + alpha * (1 - base);
  if (mode === "subtract") return base * (1 - alpha);
  return Math.min(base, alpha);
}

// Equally spaced samples along the evaluated path for shader placement.
// Closed paths wrap; open paths stay open (the coverage raster closes them,
// sampling does not). Degenerate paths repeat their single point.
function samplePoints(evaluated, count = MAX_POINTS) {
  const flat = flattenPath({ vertices: evaluated.vertices, closed: evaluated.closed });
  const n = Math.max(2, Math.min(count, MAX_POINTS));
  if (!flat.points.length) {
    // Degenerate path (a lone pen click): repeat its single point.
    const single = evaluated.vertices[0]?.point?.slice() || [0, 0];
    return { points: Array.from({ length: n }, () => single.slice()), length: 0, closed: evaluated.closed };
  }
  const table = lengthTable(flat.points, evaluated.closed);
  const total = table.total;
  const points = [];
  for (let i = 0; i < n; i++) {
    const target = total === 0 ? 0 : (evaluated.closed ? (total * i) / n : (total * i) / (n - 1));
    points.push(sampleAt(flat.points, table.lengths, target, evaluated.closed));
  }
  return { points, length: total, closed: evaluated.closed };
}

function sampleAt(points, lengths, target, closed) {
  if (!points.length) return [0, 0];
  if (points.length === 1 || target <= 0) return points[0].slice();
  const last = lengths[lengths.length - 1];
  if (target >= last) return points[closed ? 0 : points.length - 1].slice();
  let lo = 0, hi = lengths.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= target) lo = mid;
    else hi = mid;
  }
  const span = lengths[hi] - lengths[lo] || 1;
  const t = (target - lengths[lo]) / span;
  const a = points[lo % points.length], b = points[(lo + 1) % points.length];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Mask pixels (origin top-left, y down) to shader UV. Verified against the
// coverage texture orientation in the browser suite; keep both conversions
// in this one place.
function toUV(points, width, height) {
  return points.map(([x, y]) => [x / width, 1 - y / height]);
}

// Evaluate one live mask Content item at a clip-local frame through the real
// (or test-host) property interpolation. Returns geometry plus the stored
// mask parameters; callers merge in enabled/params from the collection JSON.
function evaluateMask(item, frame) {
  const evaluated = item.evaluate(frame);
  const path = primitivePath(evaluated);
  return {
    id: evaluated.id,
    name: typeof evaluated.properties?.name === "string" ? evaluated.properties.name : "",
    enabled: evaluated.properties?.enabled !== 0,
    vertices: path.vertices,
    closed: path.closed,
  };
}

// Shader+ Path property reference. `track` identifies the source track the
// same way Layer Input tokens do (a stable per-track token, not an index);
// `mask` is the mask id, or `path` a Shape+ path id on that track's layer.
const REFERENCE_VERSION = 1;
function formatReference(reference) {
  return JSON.stringify({ version: REFERENCE_VERSION, ...reference });
}
function parseReference(value) {
  let data;
  try {
    data = typeof value === "string" ? JSON.parse(value) : value;
  } catch (_error) {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (data.version !== REFERENCE_VERSION) return null;
  if (data.source === "mask") {
    if (typeof data.track !== "string" || !data.track || typeof data.mask !== "string" || !data.mask) return null;
    return { source: "mask", track: data.track, mask: data.mask };
  }
  if (data.source === "shape") {
    if (typeof data.track !== "string" || !data.track || typeof data.path !== "string" || !data.path) return null;
    return { source: "shape", track: data.track, path: data.path };
  }
  return null;
}

module.exports = {
  FIELD, FRAME_KEY, MODES, MAX_MASKS, MAX_FEATHER, MAX_POINTS, REFERENCE_VERSION,
  getMasks, setMasks, createMask, validateMasks, ensureNames, coercePath, combineValue,
  samplePoints, toUV, evaluateMask, formatReference, parseReference,
};
