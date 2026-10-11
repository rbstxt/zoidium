"use strict";

// Effector value helpers: schema constants, numeric/vector math, seeded
// random transforms, and the legacy serialized-data migrations. Pure
// functions with no host access, shared by the repeater and effector files.

const MAX_REPEATS = 128;
const SCHEMA_VERSION = 2;
const EFFECTOR_SCHEMA_VERSION = 1;
const TWIST_TYPE = "zoidium:repeater/twist";
const WARP_TYPE = "zoidium:repeater/warp";
const DEGREES_TO_RADIANS = Math.PI / 180;
const VORONOI_TYPE = "zoidium:repeater/voronoi-fracture";
const DEFAULT_FRACTURE_CELLS = 24;
const MAX_FRACTURE_CELLS = 1000;
const FRACTURE_LIMITS = Object.freeze({
  maxSourceTriangles: 40000,
  maxOutputTriangles: 400000,
  maxCapVertices: 512,
});
const LEGACY_EFFECTOR_TYPES = Object.freeze({
  7: TWIST_TYPE,
  8: WARP_TYPE,
  9: VORONOI_TYPE,
});

// Preset shape kinds CM3's PZ.object3d.shape.createMesh() names, keyed by the
// serialized objectType. New source shapes added to a repeater are named from
// this table so the tree shows "Box"/"Sphere" instead of the generic "Shape".
const SHAPE_KIND_NAMES = Object.freeze({
  0: "Shape",
  1: "Box",
  2: "Cylinder",
  3: "Rectangle",
  4: "Circle",
  5: "Sphere",
  6: "Donut",
  7: "Wire",
  99: "Geometry",
});

function isPresetShape(object) {
  return Boolean(
    object &&
    typeof object.objectType === "number" &&
    object.properties &&
    object.properties.geometryProperties
  );
}

// CM3's shape.load() calls properties.load() with the picker data, which resets
// the name createMesh() set to the generic default. Restore the kind name for
// freshly added source shapes only; children restored from saved data are
// tagged by load() and keep their stored names.
function nameNewSourceShapes(objects) {
  if (!objects || typeof objects.length !== "number") return;
  for (const source of objects) {
    if (!isPresetShape(source) || source.__zoidiumSourceFromData) continue;
    const name = source.properties.name;
    if (!name || typeof name.set !== "function" || typeof name.get !== "function") continue;
    const current = name.get();
    if (current !== "Shape" && current !== source.defaultName) continue;
    const kind = SHAPE_KIND_NAMES[source.objectType];
    if (kind && kind !== "Shape") name.set(kind);
  }
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integerValue(value, fallback, minimum, maximum) {
  const number = Math.round(numberValue(value, fallback));
  return Math.min(maximum, Math.max(minimum, number));
}

function getCount(property, frame) {
  const currentFrame = Number.isFinite(frame) ? frame : 0;
  return integerValue(property?.get?.(currentFrame), 1, 1, MAX_REPEATS);
}

function getEchoFrame(frame, index, delay) {
  const currentFrame = Math.max(0, numberValue(frame, 0));
  const copyIndex = Math.max(0, Math.trunc(numberValue(index, 0)));
  const frameDelay = Math.max(0, numberValue(delay, 0));
  return Math.max(0, currentFrame - copyIndex * frameDelay);
}

function getEchoFrames(frame, count, delay) {
  const copies = integerValue(count, 1, 1, MAX_REPEATS);
  const frames = [];
  for (let index = 0; index < copies; index += 1) {
    frames.push(getEchoFrame(frame, index, delay));
  }
  return frames;
}

function vectorValue(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  return [
    numberValue(value[0], fallback[0]),
    numberValue(value[1], fallback[1]),
    numberValue(value[2], fallback[2]),
  ];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

function lerpVector(start, end, amount) {
  return [
    lerp(start[0], end[0], amount),
    lerp(start[1], end[1], amount),
    lerp(start[2], end[2], amount),
  ];
}

function scaleVector(value, amount) {
  return [value[0] * amount, value[1] * amount, value[2] * amount];
}

function migrateEffectorData(data) {
  const normalized = data && typeof data === "object" ? data : {};
  const properties = normalized.properties && typeof normalized.properties === "object"
    ? { ...normalized.properties }
    : {};
  if (properties.polygonCount === undefined && properties.smoothness !== undefined) {
    const legacyValue = properties.smoothness;
    const legacyLevel = integerValue(
      legacyValue && typeof legacyValue === "object" ? legacyValue.value : legacyValue,
      2,
      1,
      3
    );
    const polygonCount = 4 ** legacyLevel;
    properties.polygonCount = legacyValue && typeof legacyValue === "object"
      ? { ...legacyValue, value: polygonCount }
      : polygonCount;
  }
  const stored = value => value && typeof value === "object" && !Array.isArray(value) ? value.value : value;
  if (properties.subdivision === undefined && (properties.polygonCount !== undefined || properties.curveQuality !== undefined)) {
    const level = stored(properties.curveQuality) === 0 ? 0 : Math.min(4, Math.max(0, Math.round(Math.log(Math.max(1, numberValue(stored(properties.polygonCount), 16))) / Math.log(4))));
    properties.subdivision = level;
  }
  const legacyField = normalized.legacyField === true || (properties.field !== undefined && properties.fieldFalloff === undefined);
  // CM3 dynamic properties require keyframes, even for a formerly static value.
  for (const key of ["field", "fieldPosition", "fieldScale", "fieldRotation", "fragmentDirection", "fragmentRotation"]) {
    const value = properties[key];
    if (value === undefined || value && (value.keyframes || value.objects || value.expression)) continue;
    properties[key] = { animated: false, keyframes: [{ frame: 0, value: stored(value), tween: key === "field" ? 0 : 1 }] };
  }
  return { ...normalized, legacyField, properties };
}

function seededRandom(seed, index, channel) {
  let value = (Math.trunc(seed) | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function randomVector(minimum, maximum, seed, index, channelOffset) {
  return [
    lerp(minimum[0], maximum[0], seededRandom(seed, index, channelOffset)),
    lerp(minimum[1], maximum[1], seededRandom(seed, index, channelOffset + 1)),
    lerp(minimum[2], maximum[2], seededRandom(seed, index, channelOffset + 2)),
  ];
}

function safeRange(minimum, maximum) {
  return [
    Math.min(minimum[0], maximum[0]),
    Math.min(minimum[1], maximum[1]),
    Math.min(minimum[2], maximum[2]),
  ];
}

function safeRangeMaximum(minimum, maximum) {
  return [
    Math.max(minimum[0], maximum[0]),
    Math.max(minimum[1], maximum[1]),
    Math.max(minimum[2], maximum[2]),
  ];
}

function getTransform(mode, index, count, controls, seed) {
  if (mode === "linear") {
    const amount = count > 1 ? index / (count - 1) : 0;
    return {
      position: scaleVector(controls.positionEnd, amount),
      rotation: scaleVector(controls.rotationEnd, amount),
      scale: lerpVector([1, 1, 1], controls.scaleEnd, amount),
    };
  }

  if (mode === "random") {
    if (index === 0) {
      return {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
    }
    const positionMin = safeRange(controls.positionMin, controls.positionMax);
    const positionMax = safeRangeMaximum(controls.positionMin, controls.positionMax);
    const rotationMin = safeRange(controls.rotationMin, controls.rotationMax);
    const rotationMax = safeRangeMaximum(controls.rotationMin, controls.rotationMax);
    const scaleMin = safeRange(controls.scaleMin, controls.scaleMax);
    const scaleMax = safeRangeMaximum(controls.scaleMin, controls.scaleMax);
    return {
      position: randomVector(positionMin, positionMax, seed, index, 0),
      rotation: randomVector(rotationMin, rotationMax, seed, index, 3),
      scale: randomVector(scaleMin, scaleMax, seed, index, 6),
    };
  }

  return {
    position: scaleVector(controls.positionStep, index),
    rotation: scaleVector(controls.rotationStep, index),
    scale: [
      Math.pow(Math.max(0.001, controls.scaleStep[0]), index),
      Math.pow(Math.max(0.001, controls.scaleStep[1]), index),
      Math.pow(Math.max(0.001, controls.scaleStep[2]), index),
    ],
  };
}

// Numeric types 7/8/9 come from the Davidium Effector+ project format. They
// load as the namespaced classes, and saving writes the namespaced type.
function migrateLegacyEffectorRecord(data) {
  if (!data || typeof data !== "object") return data;
  const mapped = LEGACY_EFFECTOR_TYPES[data.type];
  return mapped ? { ...data, type: mapped } : data;
}

module.exports = {
  MAX_REPEATS, SCHEMA_VERSION, EFFECTOR_SCHEMA_VERSION, TWIST_TYPE, WARP_TYPE,
  VORONOI_TYPE, DEGREES_TO_RADIANS, DEFAULT_FRACTURE_CELLS, MAX_FRACTURE_CELLS,
  FRACTURE_LIMITS, LEGACY_EFFECTOR_TYPES, SHAPE_KIND_NAMES, isPresetShape,
  nameNewSourceShapes, numberValue, integerValue, getCount, getEchoFrame,
  getEchoFrames, vectorValue, cloneJson, lerp, lerpVector, scaleVector,
  migrateEffectorData, seededRandom, randomVector, safeRange, safeRangeMaximum,
  getTransform, migrateLegacyEffectorRecord
};
