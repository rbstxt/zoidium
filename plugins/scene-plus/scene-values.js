"use strict";

// Effector value helpers: schema constants, numeric/vector math, seeded
// random transforms, and the legacy serialized-data migrations. Pure
// functions with no host access, shared by the repeater and effector files.

const MAX_REPEATS = 128;
const FULL_TURN = Math.PI * 2;
const SCHEMA_VERSION = 2;
const EFFECTOR_SCHEMA_VERSION = 1;
const TWIST_TYPE = "zoidium:repeater/twist";
const WARP_TYPE = "zoidium:repeater/warp";
const SHEAR_TYPE = "zoidium:repeater/shear";
const DEGREES_TO_RADIANS = Math.PI / 180;
const VORONOI_TYPE = "zoidium:repeater/voronoi-fracture";
const DEFAULT_FRACTURE_CELLS = 24;
const MAX_FRACTURE_CELLS = 1000;
const { DEFAULT_LIMITS: FRACTURE_LIMITS } = require("./effector-fracture.js");
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
  return ZoidiumPluginApis.props.numberValue(value, fallback);
}

function integerValue(value, fallback, minimum, maximum) {
  const number = Math.round(numberValue(value, fallback));
  return Math.min(maximum, Math.max(minimum, number));
}

function getCount(property, frame) {
  const currentFrame = Number.isFinite(frame) ? frame : 0;
  return integerValue(property?.get?.(currentFrame), 1, 1, MAX_REPEATS);
}

function gridCounts(properties, frame) {
  const currentFrame = Number.isFinite(frame) ? frame : 0;
  return {
    x: integerValue(properties?.countX?.get?.(currentFrame), 3, 1, MAX_REPEATS),
    y: integerValue(properties?.countY?.get?.(currentFrame), 3, 1, MAX_REPEATS),
    z: integerValue(properties?.countZ?.get?.(currentFrame), 1, 1, MAX_REPEATS),
  };
}

// The grid volume is clamped so one repeater never clones more copies than
// every other mode. Copies fill X first, then Y, then Z, so clamping keeps a
// deterministic complete prefix of that order.
function getRepeaterCount(mode, properties, frame) {
  if (mode === "grid") {
    const counts = gridCounts(properties, frame);
    return Math.min(MAX_REPEATS, counts.x * counts.y * counts.z);
  }
  return getCount(properties?.count, frame);
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

// Shared JSON clone (zoidium/shared/props.js). Pinned by
// test/migrate-shared-pins.test.js.
function cloneJson(value) {
  return ZoidiumPluginApis.props.cloneJson(value);
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
    const quality = stored(properties.curveQuality);
    const level = (quality === 0 || quality === "0") ? 0 : Math.min(4, Math.max(0, Math.round(Math.log(Math.max(1, numberValue(stored(properties.polygonCount), 16))) / Math.log(4))));
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

// Shared seeded random (zoidium/shared/random.js). Pinned bit-for-bit by
// test/migrate-shared-pins.test.js.
function seededRandom(seed, index, channel) {
  return ZoidiumPluginApis.random.sceneSeededRandom(seed, index, channel);
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

// Option indices match the XY;XZ;YZ property items.
function radialPosition(angle, radius, plane) {
  const cos = Math.cos(angle) * radius;
  const sin = Math.sin(angle) * radius;
  if (plane === 0) return [cos, sin, 0];
  if (plane === 2) return [0, cos, sin];
  return [cos, 0, sin];
}

// Align spins every copy around the circle normal by its own angle, so the
// source's local X axis (its local Y in the YZ plane) faces outward.
function radialRotation(angle, plane, align, rotationStep, index) {
  const rotation = scaleVector(rotationStep, index);
  if (!align) return rotation;
  if (plane === 0) rotation[2] += angle;
  else if (plane === 2) rotation[0] += angle;
  else rotation[1] -= angle;
  return rotation;
}

function radialTransform(index, count, controls) {
  const plane = Math.round(numberValue(controls.plane, 1));
  const start = numberValue(controls.startAngle, 0);
  const sweep = numberValue(controls.sweep, FULL_TURN);
  const closed = Math.abs(Math.abs(sweep) - FULL_TURN) < 1e-9;
  const step = closed ? sweep / count : count > 1 ? sweep / (count - 1) : 0;
  const angle = start + step * index;
  const amount = count > 1 ? index / (count - 1) : 0;
  return {
    position: radialPosition(angle, numberValue(controls.radius, 100), plane),
    rotation: radialRotation(
      angle,
      plane,
      Boolean(controls.align),
      vectorValue(controls.rotationStep, [0, 0, 0]),
      index,
    ),
    scale: lerpVector([1, 1, 1], vectorValue(controls.scaleEnd, [1, 1, 1]), amount),
  };
}

function gridTransform(index, controls) {
  const counts = controls.counts || {};
  const x = integerValue(counts.x, 3, 1, MAX_REPEATS);
  const y = integerValue(counts.y, 3, 1, MAX_REPEATS);
  const z = integerValue(counts.z, 1, 1, MAX_REPEATS);
  const cell = [
    index % x,
    Math.floor(index / x) % y,
    Math.floor(index / (x * y)),
  ];
  const spacing = vectorValue(controls.spacing, [50, 50, 50]);
  const centered = Boolean(controls.centered);
  const offset = (value, count, gap) =>
    (centered ? value - (count - 1) / 2 : value) * gap;
  return {
    position: [
      offset(cell[0], x, spacing[0]),
      offset(cell[1], y, spacing[1]),
      offset(cell[2], z, spacing[2]),
    ],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
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

  if (mode === "radial") {
    return radialTransform(index, count, controls);
  }

  if (mode === "grid") {
    return gridTransform(index, controls);
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
  MAX_REPEATS, FULL_TURN, SCHEMA_VERSION, EFFECTOR_SCHEMA_VERSION, TWIST_TYPE,
  WARP_TYPE, SHEAR_TYPE, VORONOI_TYPE, DEGREES_TO_RADIANS, DEFAULT_FRACTURE_CELLS,
  MAX_FRACTURE_CELLS, FRACTURE_LIMITS, LEGACY_EFFECTOR_TYPES, SHAPE_KIND_NAMES,
  isPresetShape, nameNewSourceShapes, numberValue, integerValue, getCount,
  gridCounts, getRepeaterCount, getEchoFrame, getEchoFrames, vectorValue,
  cloneJson, lerp, lerpVector, scaleVector, migrateEffectorData, seededRandom,
  randomVector, safeRange, safeRangeMaximum, getTransform,
  migrateLegacyEffectorRecord
};
