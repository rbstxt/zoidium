"use strict";

/*
 * Text+ is a 3D parent object that renders descendant Text objects as one
 * mesh per character. The source Text object stays in the CM3 object tree,
 * owns its material, and keeps its normal transform. Only its runtime
 * geometry is replaced while it has a Text+ ancestor.
 */

const SCHEMA_VERSION = 5;
const TEXT_PLUS_TYPE = "zoidium:text-plus/text-plus";
const TEXT_PLUS_NAME = "Character Transform";
const GRADIENT_TRANSFORM_SCHEMA_VERSION = 1;
const GRADIENT_TRANSFORM_TYPE = "zoidium:text-plus/gradient-transform";
const GRADIENT_TRANSFORM_NAME = "Gradient Transform";
const CHARACTER_SHAKE_SCHEMA_VERSION = 4;
const CHARACTER_SHAKE_TYPE = "zoidium:text-plus/character-shake";
const CHARACTER_SHAKE_NAME = "Character Shake";
const SELECTED_TRANSFORM_SCHEMA_VERSION = 3;
const SELECTED_TRANSFORM_TYPE = "zoidium:text-plus/selected-transform";
const SELECTED_TRANSFORM_NAME = "Selected Character Transform";
const SELECTED_SHAKE_SCHEMA_VERSION = 4;
const SELECTED_SHAKE_TYPE = "zoidium:text-plus/selected-shake";
const SELECTED_SHAKE_NAME = "Selected Character Shake";
const RANDOM_SCATTER_SCHEMA_VERSION = 3;
const RANDOM_SCATTER_TYPE = "zoidium:text-plus/random-scatter";
const RANDOM_SCATTER_NAME = "Random Scatter";
const DELAY_ORDERS = ["start", "end", "middle", "random"];
const DELAY_ORDER_LABELS = [
  "Forward",
  "Reverse",
  "Center out",
  "Random",
];
const PIVOT_LABELS = ["Character", "Text"];
const MAX_ANCESTOR_DEPTH = 64;
const RANDOM_ORDER_CACHE_LIMIT = 64;
const DEGREES_TO_RADIANS = Math.PI / 180;
const PZ_EULER_ORDERS = new Set(["XYZ", "YZX", "ZXY", "XZY", "YXZ", "ZYX"]);

const randomOrderCache = new Map();

const state = {
  PZ: null,
  THREE: null,
  editor: null,
  objectClasses: [],
  unregisterObjectClasses: [],
  textPropertyDefinitionsOriginal: null,
  textPropertyDefinitionsPatched: null,
  textUpdateGeometryOriginal: null,
  textUpdateGeometryPatched: null,
  textUpdateOriginal: null,
  textUpdatePatched: null,
  textUnloadOriginal: null,
  textUnloadPatched: null,
  splitStates: new WeakMap(),
  splitTexts: new Set(),
};

/* ------------------------------------------------------------------ values */

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vector3(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  return [
    numberValue(value[0], fallback[0]),
    numberValue(value[1], fallback[1]),
    numberValue(value[2], fallback[2]),
  ];
}

function cloneJson(value) {
  // Shared JSON clone (zoidium/shared/props.js). Pinned by
  // test/migrate-shared-pins.test.js.
  return ZoidiumPluginApis.props.cloneJson(value);
}

function normalizeObjectData(data, type, name, schemaVersion) {
  const normalized = data && typeof data === "object" ? cloneJson(data) : {};
  if (!Array.isArray(normalized.objects)) normalized.objects = [];
  if (!Array.isArray(normalized.customProperties)) normalized.customProperties = [];
  if (!normalized.properties || typeof normalized.properties !== "object") {
    normalized.properties = {};
  }
  if (
    !normalized.characterProperties ||
    typeof normalized.characterProperties !== "object"
  ) {
    normalized.characterProperties = {};
  }
  if (!Object.prototype.hasOwnProperty.call(normalized.properties, "name")) {
    normalized.properties.name = name;
  }
  normalized.type = type;
  normalized.schemaVersion = schemaVersion;
  return normalized;
}

function defaultObjectData(data) {
  return normalizeObjectData(
    data,
    TEXT_PLUS_TYPE,
    TEXT_PLUS_NAME,
    SCHEMA_VERSION
  );
}

function defaultCharacterShakeData(data) {
  return normalizeObjectData(
    data,
    CHARACTER_SHAKE_TYPE,
    CHARACTER_SHAKE_NAME,
    CHARACTER_SHAKE_SCHEMA_VERSION
  );
}

function defaultGradientTransformData(data) {
  return normalizeObjectData(
    data,
    GRADIENT_TRANSFORM_TYPE,
    GRADIENT_TRANSFORM_NAME,
    GRADIENT_TRANSFORM_SCHEMA_VERSION
  );
}

function defaultSelectedTransformData(data) {
  return normalizeObjectData(
    data,
    SELECTED_TRANSFORM_TYPE,
    SELECTED_TRANSFORM_NAME,
    SELECTED_TRANSFORM_SCHEMA_VERSION
  );
}

function defaultSelectedShakeData(data) {
  return normalizeObjectData(
    data,
    SELECTED_SHAKE_TYPE,
    SELECTED_SHAKE_NAME,
    SELECTED_SHAKE_SCHEMA_VERSION
  );
}

function defaultRandomScatterData(data) {
  return normalizeObjectData(
    data,
    RANDOM_SCATTER_TYPE,
    RANDOM_SCATTER_NAME,
    RANDOM_SCATTER_SCHEMA_VERSION
  );
}

/* ------------------------------------------------------------------- delay */

function seedHash(seed) {
  // Shared text seed folding (zoidium/shared/random.js): integer seeds keep
  // their truncated identity, fractional seeds fold every float64 bit into
  // the state. Pinned bit-for-bit on numbers by
  // test/migrate-shared-pins.test.js. Production seeds are always finite
  // numbers (every call boundary coerces with numberValue first).
  return ZoidiumPluginApis.random.textSeedHash(seed);
}

function seedCacheKey(seed) {
  // Keyed on the shared seed hash, so the cache partitions seeds exactly the
  // way the random stream does: equal hashes always give equal streams.
  return "h:" + ZoidiumPluginApis.random.textSeedHash(seed);
}

function seededRandom(seed, index, channel) {
  // Shared text seeded random (zoidium/shared/random.js). Pinned bit-for-bit
  // on numbers by test/migrate-shared-pins.test.js.
  return ZoidiumPluginApis.random.textSeededRandom(seed, index, channel);
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function orderedRange(minimum, maximum) {
  return [
    Math.min(minimum[0], maximum[0]),
    Math.min(minimum[1], maximum[1]),
    Math.min(minimum[2], maximum[2]),
  ];
}

function orderedRangeMaximum(minimum, maximum) {
  return [
    Math.max(minimum[0], maximum[0]),
    Math.max(minimum[1], maximum[1]),
    Math.max(minimum[2], maximum[2]),
  ];
}

function randomVector(minimum, maximum, seed, index, channelOffset) {
  return [
    lerp(minimum[0], maximum[0], seededRandom(seed, index, channelOffset)),
    lerp(
      minimum[1],
      maximum[1],
      seededRandom(seed, index, channelOffset + 1)
    ),
    lerp(
      minimum[2],
      maximum[2],
      seededRandom(seed, index, channelOffset + 2)
    ),
  ];
}

function getRandomScatterTransform(amount, ranges, seed, index) {
  const strength = Math.max(0, numberValue(amount, 0));
  if (strength === 0) {
    return {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
  }
  const positionMinimum = orderedRange(
    vector3(ranges.positionMin, [0, 0, 0]),
    vector3(ranges.positionMax, [0, 0, 0])
  );
  const positionMaximum = orderedRangeMaximum(
    vector3(ranges.positionMin, [0, 0, 0]),
    vector3(ranges.positionMax, [0, 0, 0])
  );
  const rotationMinimum = orderedRange(
    vector3(ranges.rotationMin, [0, 0, 0]),
    vector3(ranges.rotationMax, [0, 0, 0])
  );
  const rotationMaximum = orderedRangeMaximum(
    vector3(ranges.rotationMin, [0, 0, 0]),
    vector3(ranges.rotationMax, [0, 0, 0])
  );
  const scaleMinimum = orderedRange(
    vector3(ranges.scaleMin, [1, 1, 1]),
    vector3(ranges.scaleMax, [1, 1, 1])
  );
  const scaleMaximum = orderedRangeMaximum(
    vector3(ranges.scaleMin, [1, 1, 1]),
    vector3(ranges.scaleMax, [1, 1, 1])
  );
  const targetPosition = randomVector(
    positionMinimum,
    positionMaximum,
    seed,
    index,
    20
  );
  const targetRotation = randomVector(
    rotationMinimum,
    rotationMaximum,
    seed,
    index,
    23
  );
  const targetScale = randomVector(
    scaleMinimum,
    scaleMaximum,
    seed,
    index,
    26
  );

  return {
    position: targetPosition.map((value) => value * strength),
    rotation: targetRotation.map((value) => value * strength),
    scale: targetScale.map((value) =>
      Math.max(0.001, lerp(1, value, strength))
    ),
  };
}

function getRandomOrder(count, seed) {
  const characters = Math.max(0, Math.trunc(numberValue(count, 0)));
  const key = characters + ":" + seedCacheKey(seed);
  const cached = randomOrderCache.get(key);
  if (cached) return cached;

  const order = [];
  for (let index = 0; index < characters; index += 1) order.push(index);
  for (let index = characters - 1; index > 0; index -= 1) {
    const swap = Math.floor(seededRandom(seed, index, 11) * (index + 1));
    const value = order[index];
    order[index] = order[swap];
    order[swap] = value;
  }

  if (randomOrderCache.size >= RANDOM_ORDER_CACHE_LIMIT) randomOrderCache.clear();
  randomOrderCache.set(key, order);
  return order;
}

// Rank 0 starts first. Every following rank waits one more delay step.
function getDelayRank(order, index, count, seed) {
  const characters = Math.max(0, Math.trunc(numberValue(count, 0)));
  if (characters <= 1) return 0;
  const position = Math.min(
    Math.max(Math.trunc(numberValue(index, 0)), 0),
    characters - 1
  );

  if (order === "end") return characters - 1 - position;
  if (order === "middle") {
    const center = Math.floor((characters - 1) / 2);
    const offset = position - center;
    if (offset === 0) return 0;
    const distance = Math.abs(offset);
    return distance * 2 - (offset > 0 ? 1 : 0);
  }
  if (order === "random") {
    const rank = getRandomOrder(characters, seed).indexOf(position);
    return rank < 0 ? position : rank;
  }
  return position;
}

function getCharacterDelay(order, index, count, delayPerCharacter, seed) {
  const step = Math.max(0, numberValue(delayPerCharacter, 0));
  if (step === 0) return 0;
  return getDelayRank(order, index, count, seed) * step;
}

function getShakeAngle(amplitude, period, phase) {
  const frames = numberValue(period, 0);
  const radians = numberValue(amplitude, 0);
  if (!(frames > 0) || radians === 0) return 0;
  return (
    radians * Math.sin((2 * Math.PI * numberValue(phase, 0)) / frames)
  );
}

/* ------------------------------------------------------------------ layout */

// THREE r91 lays out text from the font's horizontal advance values. Keep the
// same UTF-16 unit iteration here so the generated character meshes occupy the
// same positions as the untouched TextGeometry.
function getTextLayout(text, fontData, size, spacing = 0) {
  const data = fontData && typeof fontData === "object" ? fontData : {};
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
  const characterSpacing = numberValue(spacing, 0);
  const bounds = data.boundingBox || {};
  const lineHeight =
    (numberValue(bounds.yMax, 0) -
      numberValue(bounds.yMin, 0) +
      numberValue(data.underlineThickness, 0)) *
    scale;
  const glyphs = data.glyphs || {};
  const characters = String(text == null ? "" : text).split("");
  const units = [];
  let cursorX = 0;
  let cursorY = 0;

  for (let sourceIndex = 0; sourceIndex < characters.length; sourceIndex += 1) {
    const character = characters[sourceIndex];
    if (character === "\n") {
      cursorX = 0;
      cursorY -= lineHeight;
      continue;
    }
    const glyph = glyphs[character] || glyphs["?"] || null;
    const advance = glyph ? numberValue(glyph.ha, 0) * scale : 0;
    units.push({
      character,
      sourceIndex,
      index: units.length,
      x: cursorX,
      y: cursorY,
      advance,
    });
    cursorX += advance + characterSpacing;
  }

  return { units, count: units.length, lineHeight };
}

function getCenterOffset(bounds, positionMode) {
  if (!bounds || !bounds.min || !bounds.max) return [0, 0, 0];
  const minimum = vector3(bounds.min, [0, 0, 0]);
  const maximum = vector3(bounds.max, [0, 0, 0]);
  const offset = [
    -(minimum[0] + maximum[0]) / 2,
    -(minimum[1] + maximum[1]) / 2,
    -(minimum[2] + maximum[2]) / 2,
  ];

  switch (Math.round(numberValue(positionMode, 0))) {
    case 1:
      offset[0] = 0;
      break;
    case 2:
      offset[0] *= 2;
      break;
    case 3:
      offset[1] *= 2;
      break;
    case 4:
      offset[1] = 0;
      break;
    case 5:
      offset[2] *= 2;
      break;
    case 6:
      offset[2] = 0;
      break;
  }
  return offset;
}

function getTextCenter(bounds, centerOffset) {
  if (!bounds || !bounds.min || !bounds.max) return [0, 0, 0];
  const minimum = vector3(bounds.min, [0, 0, 0]);
  const maximum = vector3(bounds.max, [0, 0, 0]);
  const offset = vector3(centerOffset, [0, 0, 0]);
  return minimum.map(
    (value, index) => (value + maximum[index]) / 2 + offset[index]
  );
}

function getAncestorObject(object) {
  if (!object) return null;
  // A hostile parentObject getter must not break the ancestor walk.
  try {
    return object.parentObject || null;
  } catch (_error) {
    return null;
  }
}

function collectTextPlusObjects(textObject) {
  const objects = [];
  const visited = new Set();
  let current = getAncestorObject(textObject);
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    if (current.zoidiumTextPlusObject === true) objects.push(current);
    current = getAncestorObject(current);
  }
  objects.reverse();
  return objects;
}

module.exports = {
  SCHEMA_VERSION,
  TEXT_PLUS_TYPE,
  TEXT_PLUS_NAME,
  GRADIENT_TRANSFORM_SCHEMA_VERSION,
  GRADIENT_TRANSFORM_TYPE,
  GRADIENT_TRANSFORM_NAME,
  CHARACTER_SHAKE_SCHEMA_VERSION,
  CHARACTER_SHAKE_TYPE,
  CHARACTER_SHAKE_NAME,
  SELECTED_TRANSFORM_SCHEMA_VERSION,
  SELECTED_TRANSFORM_TYPE,
  SELECTED_TRANSFORM_NAME,
  SELECTED_SHAKE_SCHEMA_VERSION,
  SELECTED_SHAKE_TYPE,
  SELECTED_SHAKE_NAME,
  RANDOM_SCATTER_SCHEMA_VERSION,
  RANDOM_SCATTER_TYPE,
  RANDOM_SCATTER_NAME,
  DELAY_ORDERS,
  DELAY_ORDER_LABELS,
  PIVOT_LABELS,
  MAX_ANCESTOR_DEPTH,
  RANDOM_ORDER_CACHE_LIMIT,
  DEGREES_TO_RADIANS,
  PZ_EULER_ORDERS,
  state,
  numberValue,
  vector3,
  cloneJson,
  normalizeObjectData,
  defaultObjectData,
  defaultCharacterShakeData,
  defaultGradientTransformData,
  defaultSelectedTransformData,
  defaultSelectedShakeData,
  defaultRandomScatterData,
  seedHash,
  seedCacheKey,
  seededRandom,
  lerp,
  orderedRange,
  orderedRangeMaximum,
  randomVector,
  getRandomScatterTransform,
  getRandomOrder,
  getDelayRank,
  getCharacterDelay,
  getShakeAngle,
  getTextLayout,
  getCenterOffset,
  getTextCenter,
  getAncestorObject,
  collectTextPlusObjects,
};
