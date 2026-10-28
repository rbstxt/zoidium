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
let generation = null;
const letters = new Map();
let identities = new WeakMap();
let nextIdentity = 1;

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

function trackInput(property) {
  if (!property || typeof property.get !== "function") return ["value", property];
  const P = state.PZ && state.PZ.property;
  if (!P) throw new Error("Unknown Delay property reader");
  const proto = Object.getPrototypeOf(property);
  // Reject own getter overrides, subclasses, and expressions, including
  // expressions on vector components. They can read beyond the track.
  if (Object.hasOwn(property, "get") || Object.hasOwn(property, "getClosestKeyframeIndex")) throw new Error("Custom Delay property reader");
  const fallback = property.definition && property.definition.value;
  if (P.static && proto === P.static.prototype) return ["static", identity(property.get), property.value, fallback];
  if (property.expression !== null) throw new Error("Expression Delay property reader");
  if (P.dynamic && P.dynamic.group && proto === P.dynamic.group.prototype) {
    return ["group", identity(property.get), fallback, Array.from(property.objects, trackInput)];
  }
  if (!P.dynamic || !P.dynamic.keyframes || proto !== P.dynamic.keyframes.prototype || !property.keyframes.length) {
    throw new Error("Unknown or empty Delay track");
  }
  const tracks = Array.from(property.keyframes, k => {
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
    return [k.frame, k.value, k.tween, k.controlPoints];
  });
  return ["track", identity(property.get), identity(property.getClosestKeyframeIndex),
    property.frameOffset, property.interpolated, fallback, tracks];
}

function stackInput(layers) {
  return layers.map(layer => {
    if (!layer || !layer.kind) return null;
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
    return [kind, keys.map(key => {
      if (own) {
        const row = own.store[key];
        if (!row) return [key, "owned", undefined];
        if (row.get !== own.getters[key]) throw new Error("Changed Delay row reader");
        return [key, "owned", own.values[key], row.value, row.definition && row.definition.value];
      }
      const property = !props ? undefined : typeof props.get === "function" ? props.get(key) : props[key];
      return [key, trackInput(property)];
    })];
  });
}

function clearDelayCache() {
  generation = null;
  letters.clear();
  identities = new WeakMap();
  nextIdentity = 1;
}

function delayCacheFor(layers, index, list, base, aux) {
  try {
    const world = aux && aux.selfWorld;
    const tween = state.PZ && state.PZ.tween;
    const inputs = [stackInput(layers), list.total, list.order,
      aux && [aux.rate, aux.extent && [aux.extent.lo, aux.extent.hi], aux.bases,
        world && [world.position, world.rotation, world.scale, world.eulerOrder]],
      tween && [tween.easingList.map(e => e.fn && identity(e.fn)),
        ...["linear", "correctCurve", "findZero", "bezier"].map(k => identity(tween[k]))]];
    const fingerprint = encode(inputs);
    if (fingerprint.length > MAX_FINGERPRINT) return null;
    if (generation !== fingerprint) {
      generation = fingerprint;
      letters.clear();
    }
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
    const target = sample(frame);
    values.set(target.position, offset);
    values.set(target.rotation, offset + 3);
    values.set(target.scale, offset + 6);
    entry.frames[slot] = frame;
    return target;
  }
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
    const params = sample(frame);
    values[offset] = params ? 1 : 0;
    if (params) values.set([params.strength, params.mode, +params.position, +params.scale, +params.rotation], offset + 1);
    buffer.frames[slot] = frame;
    return params;
  }
  return values[offset] ? { strength: values[offset + 1], mode: values[offset + 2],
    position: !!values[offset + 3], scale: !!values[offset + 4], rotation: !!values[offset + 5] } : null;
}

module.exports = { cachedDelayParams, cachedDelayTarget, clearDelayCache, delayCacheFor, staticReaders, sectionReaders, MAX_LETTERS, WINDOW_SAMPLES };
