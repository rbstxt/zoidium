"use strict";

// Cache only stock, expression-free tracks and the staticProps readers we
// own. Arbitrary getters can close over any project state: never memoize them.
const { state } = require("./expresstext-constants.js");
const { EFFECTOR_BUILDERS } = require("./expresstext-properties.js");
const staticReaders = new WeakMap();
const sectionReaders = new WeakMap();
const WINDOW_SAMPLES = 7202;
const MAX_LETTERS = 48;
const MAX_PARAM_STAGES = 2;
const MAX_FINGERPRINT = 262144;
const keysByKind = new Map();
// One letter cache per stack fingerprint, so alternating objects no longer
// evict each other. Bounded (LRU): scenes with more distinct stacks than
// this keep the most recently evaluated ones.
const MAX_GENERATIONS = 16;
const generations = new Map();
let identities = new WeakMap();
let nextIdentity = 1;
const stats = { targetHits: 0, targetMisses: 0, paramHits: 0, paramMisses: 0 };

function cacheStats() {
  return { ...stats };
}

function identity(value) {
  if (!identities.has(value)) identities.set(value, nextIdentity++);
  return identities.get(value);
}

// Type tags retain -0, non-finite numbers and missing values. No JSON number
// coercion or hash collisions can make two distinct input values share a key.
function encode(value, depth = 0) {
  if (depth > 32) throw new Error("Unsupported Delay cache input");
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number") return `n:${Object.is(value, -0) ? "-0" : value}`;
  if (typeof value === "string") return `s:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${Array.from(value, v => encode(v, depth + 1)).join(",")}]`;
  throw new Error("Unsupported Delay cache input");
}

// Single-pass fingerprint writer. It visits exactly the fields the old
// stackInput/trackInput/encode pipeline visited, with the same type tags
// and the same identity numbering order, but pushes tokens into one parts
// array instead of building an intermediate object graph: the per-letter,
// per-frame fingerprint no longer allocates hundreds of small arrays.
// Depth accounting mirrors encode, so the same inputs hit the same guard.
function pushValue(parts, value, depth) {
  if (depth > 32) throw new Error("Unsupported Delay cache input");
  if (value === null) { parts.push("null"); return; }
  if (value === undefined) { parts.push("undefined"); return; }
  if (typeof value === "number") { parts.push(`n:${Object.is(value, -0) ? "-0" : value}`); return; }
  if (typeof value === "string") { parts.push(`s:${JSON.stringify(value)}`); return; }
  if (typeof value === "boolean") { parts.push(value ? "true" : "false"); return; }
  if (Array.isArray(value)) {
    parts.push("[");
    for (let i = 0; i < value.length; i += 1) {
      if (i) parts.push(",");
      pushValue(parts, value[i], depth + 1);
    }
    parts.push("]");
    return;
  }
  throw new Error("Unsupported Delay cache input");
}

function pushTrackInput(parts, property, depth) {
  if (depth > 32) throw new Error("Unsupported Delay cache input");
  if (!property || typeof property.get !== "function") {
    parts.push('["value",');
    pushValue(parts, property, depth + 1);
    parts.push("]");
    return;
  }
  const P = state.PZ && state.PZ.property;
  if (!P) throw new Error("Unknown Delay property reader");
  const proto = Object.getPrototypeOf(property);
  // Reject own getter overrides, subclasses, and expressions, including
  // expressions on vector components. They can read beyond the track.
  if (Object.hasOwn(property, "get") || Object.hasOwn(property, "getClosestKeyframeIndex")) throw new Error("Custom Delay property reader");
  const fallback = property.definition && property.definition.value;
  if (P.static && proto === P.static.prototype) {
    parts.push('["static",');
    pushValue(parts, identity(property.get), depth + 1);
    parts.push(",");
    pushValue(parts, property.value, depth + 1);
    parts.push(",");
    pushValue(parts, fallback, depth + 1);
    parts.push("]");
    return;
  }
  if (property.expression !== null) throw new Error("Expression Delay property reader");
  if (P.dynamic && P.dynamic.group && proto === P.dynamic.group.prototype) {
    parts.push('["group",');
    pushValue(parts, identity(property.get), depth + 1);
    parts.push(",");
    pushValue(parts, fallback, depth + 1);
    parts.push(",[");
    const objects = property.objects;
    for (let i = 0; i < objects.length; i += 1) {
      if (i) parts.push(",");
      pushTrackInput(parts, objects[i], depth + 2);
    }
    parts.push("]]");
    return;
  }
  if (!P.dynamic || !P.dynamic.keyframes || proto !== P.dynamic.keyframes.prototype || !property.keyframes.length) {
    throw new Error("Unknown or empty Delay track");
  }
  const tracks = property.keyframes;
  parts.push('["track",');
  pushValue(parts, identity(property.get), depth + 1);
  parts.push(",");
  pushValue(parts, identity(property.getClosestKeyframeIndex), depth + 1);
  parts.push(",");
  pushValue(parts, property.frameOffset, depth + 1);
  parts.push(",");
  pushValue(parts, property.interpolated, depth + 1);
  parts.push(",");
  pushValue(parts, fallback, depth + 1);
  parts.push(",[");
  for (let i = 0; i < tracks.length; i += 1) {
    const k = tracks[i];
    // Missing values invoke readProp's mutable fallback. Keep that path cold.
    if (k.value === null || k.value === undefined) throw new Error("Empty Delay keyframe");
    const easing = state.PZ.tween && state.PZ.tween.easingList[k.tween & 255];
    const points = k.controlPoints;
    if (!easing || !(easing.fn === null || typeof easing.fn === "function") ||
        !Array.isArray(points) || points.length !== 2 ||
        points.some(pair => !Array.isArray(pair) || pair.length !== 2 ||
          pair.some(value => typeof value !== "number" || !Number.isFinite(value)))) {
      throw new Error("Unsupported Delay keyframe interpolation");
    }
    if (i) parts.push(",");
    parts.push("[");
    pushValue(parts, k.frame, depth + 3);
    parts.push(",");
    pushValue(parts, k.value, depth + 3);
    parts.push(",");
    pushValue(parts, k.tween, depth + 3);
    parts.push(",");
    pushValue(parts, k.controlPoints, depth + 3);
    parts.push("]");
  }
  parts.push("]]");
}

function pushStackInput(parts, layers, depth) {
  if (depth > 32) throw new Error("Unsupported Delay cache input");
  parts.push("[");
  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (i) parts.push(",");
    if (!layer || !layer.kind) { parts.push("null"); continue; }
    const kind = layer.kind;
    let keys = keysByKind.get(kind);
    if (!keys) {
      const builder = Object.hasOwn(EFFECTOR_BUILDERS, kind) ? EFFECTOR_BUILDERS[kind] : null;
      const PZ = { property: { type: { NUMBER: 0, VECTOR3: 2, OPTION: 6, TEXT: 7 } } };
      keys = builder ? Object.keys(builder(PZ)) : [`${kind}Letters`];
      if (builder) keysByKind.set(kind, keys);
    }
    const props = layer.props;
    const own = props && staticReaders.get(props);
    if (props && typeof props.get === "function" && !own && sectionReaders.get(props) !== props.get) {
      throw new Error("Unknown Delay section reader");
    }
    if (own && props.get !== own.readerGet) throw new Error("Changed Delay reader");
    parts.push("[");
    pushValue(parts, kind, depth + 2);
    parts.push(",[");
    for (let k = 0; k < keys.length; k += 1) {
      const key = keys[k];
      if (k) parts.push(",");
      parts.push("[");
      pushValue(parts, key, depth + 4);
      parts.push(",");
      if (own) {
        const row = own.store[key];
        if (!row) {
          parts.push('["owned",undefined]');
        } else {
          if (row.get !== own.getters[key]) throw new Error("Changed Delay row reader");
          parts.push('["owned",');
          pushValue(parts, own.values[key], depth + 5);
          parts.push(",");
          pushValue(parts, row.value, depth + 5);
          parts.push(",");
          pushValue(parts, row.definition && row.definition.value, depth + 5);
          parts.push("]");
        }
      } else {
        const property = !props ? undefined : typeof props.get === "function" ? props.get(key) : props[key];
        pushTrackInput(parts, property, depth + 4);
      }
      parts.push("]");
    }
    parts.push("]]");
  }
  parts.push("]");
}

// Generation fingerprint for one stack: stack kinds/keys/tracks plus the
// layout, world and easing identities the targets depend on. Rebuilt per
// letter per frame on purpose: in-place keyframe and value edits keep every
// object identity, so only a full re-read detects them.
function fingerprintFor(layers, list, aux) {
  const world = aux && aux.selfWorld;
  const tween = state.PZ && state.PZ.tween;
  const parts = ["["];
  pushStackInput(parts, layers, 1);
  parts.push(",");
  pushValue(parts, list.total, 1);
  parts.push(",");
  pushValue(parts, list.order, 1);
  parts.push(",");
  pushValue(parts, aux && [aux.rate, aux.extent && [aux.extent.lo, aux.extent.hi], aux.bases,
    world && [world.position, world.rotation, world.scale, world.eulerOrder]], 1);
  parts.push(",");
  pushValue(parts, tween && [tween.easingList.map(e => e.fn && identity(e.fn)),
    ...["linear", "correctCurve", "findZero", "bezier"].map(k => identity(tween[k]))], 1);
  parts.push("]");
  return parts.join("");
}

function clearDelayCache() {
  generations.clear();
  stats.targetHits = 0;
  stats.targetMisses = 0;
  stats.paramHits = 0;
  stats.paramMisses = 0;
  identities = new WeakMap();
  nextIdentity = 1;
}

function delayCacheFor(layers, index, list, base, aux) {
  try {
    const fingerprint = fingerprintFor(layers, list, aux);
    if (fingerprint.length > MAX_FINGERPRINT) return null;
    let gen = generations.get(fingerprint);
    if (gen) {
      // LRU: a hit keeps this stack's letters while idle stacks age out.
      generations.delete(fingerprint);
      generations.set(fingerprint, gen);
    } else {
      if (generations.size >= MAX_GENERATIONS) generations.delete(generations.keys().next().value);
      gen = { letters: new Map() };
      generations.set(fingerprint, gen);
    }
    const letters = gen.letters;
    const key = encode([index, base]);
    if (key.length > MAX_FINGERPRINT) return null;
    let entry = letters.get(key);
    if (!entry) {
      if (letters.size >= MAX_LETTERS) letters.delete(letters.keys().next().value);
      entry = { frames: new Float64Array(WINDOW_SAMPLES).fill(-1),
        values: new Float64Array(WINDOW_SAMPLES * 9), params: [] };
    }
    // LRU bounds even scenes with changing bases and many letters.
    letters.delete(key);
    letters.set(key, entry);
    return entry;
  } catch (_unsupported) {
    return null;
  }
}

function cachedDelayTarget(entry, frame, sample) {
  // Fractional tails always sample the current inputs directly.
  if (!entry || !Number.isSafeInteger(frame) || frame < 0) return sample(frame);
  const slot = frame % WINDOW_SAMPLES;
  const offset = slot * 9;
  const values = entry.values;
  if (entry.frames[slot] !== frame) {
    stats.targetMisses += 1;
    const target = sample(frame);
    values.set(target.position, offset);
    values.set(target.rotation, offset + 3);
    values.set(target.scale, offset + 6);
    entry.frames[slot] = frame;
    return target;
  }
  stats.targetHits += 1;
  return {
    position: [values[offset], values[offset + 1], values[offset + 2]],
    rotation: [values[offset + 3], values[offset + 4], values[offset + 5]],
    scale: [values[offset + 6], values[offset + 7], values[offset + 8]],
  };
}

// Delay parameters depend on the same tracks, selections, base and layout as
// targets. The first two stages get bounded buffers; further stages stay cold.
function cachedDelayParams(entry, stage, frame, sample) {
  if (!entry || stage >= MAX_PARAM_STAGES || !Number.isSafeInteger(frame) || frame < 0) return sample(frame);
  let buffer = entry.params[stage];
  if (!buffer) {
    buffer = { frames: new Float64Array(WINDOW_SAMPLES).fill(-1), values: new Float64Array(WINDOW_SAMPLES * 6) };
    entry.params[stage] = buffer;
  }
  const slot = frame % WINDOW_SAMPLES, offset = slot * 6, values = buffer.values;
  if (buffer.frames[slot] !== frame) {
    stats.paramMisses += 1;
    const params = sample(frame);
    values[offset] = params ? 1 : 0;
    if (params) values.set([params.strength, params.mode, +params.position, +params.scale, +params.rotation], offset + 1);
    buffer.frames[slot] = frame;
    return params;
  }
  stats.paramHits += 1;
  return values[offset] ? { strength: values[offset + 1], mode: values[offset + 2],
    position: !!values[offset + 3], scale: !!values[offset + 4], rotation: !!values[offset + 5] } : null;
}

module.exports = { cacheStats, cachedDelayParams, cachedDelayTarget, clearDelayCache, delayCacheFor, staticReaders, sectionReaders, MAX_GENERATIONS, MAX_LETTERS, WINDOW_SAMPLES };
