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
  objectClasses: [],
  unregisterObjectClasses: [],
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
  return JSON.parse(JSON.stringify(value));
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

function seededRandom(seed, index, channel) {
  let value = (Math.trunc(seed) | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
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
  const key = characters + ":" + (Math.trunc(seed) | 0);
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
function getTextLayout(text, fontData, size) {
  const data = fontData && typeof fontData === "object" ? fontData : {};
  const resolution = numberValue(data.resolution, 1000);
  const scale = resolution !== 0 ? numberValue(size, 100) / resolution : 0;
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
    cursorX += advance;
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

/* -------------------------------------------------------------- properties */

function vectorDefinition(PZ, definition) {
  const axisNames = ["X", "Y", "Z"];
  return {
    dynamic: true,
    interpolated: true,
    group: true,
    name: definition.name,
    type: PZ.property.type.VECTOR3,
    value: definition.value.slice(),
    ...(definition.scaleFactor
      ? { scaleFactor: definition.scaleFactor }
      : {}),
    ...(definition.linkRatio ? { linkRatio: true } : {}),
    objects: definition.value.map((value, index) => ({
      dynamic: true,
      interpolated: true,
      name: `${definition.name}.${axisNames[index]}`,
      type: PZ.property.type.NUMBER,
      value,
      ...(definition.min == null ? {} : { min: definition.min }),
      ...(definition.scaleFactor
        ? { scaleFactor: definition.scaleFactor }
        : {}),
      step: definition.step == null ? 1 : definition.step,
      decimals: definition.decimals == null ? 2 : definition.decimals,
    })),
  };
}

function dynamicNumberDefinition(PZ, name, value, options) {
  return {
    dynamic: true,
    interpolated: true,
    name,
    type: PZ.property.type.NUMBER,
    value,
    ...(options || {}),
  };
}

function createPropertyCategory(PZ, owner, name, definitions) {
  const properties = new PZ.propertyList(definitions, owner);
  Object.defineProperty(properties, "_zoidiumCategoryName", {
    value: name,
    configurable: true,
  });
  const propertyIndex = owner.children.indexOf(owner.properties);
  owner.children.splice(propertyIndex + 1, 0, properties);
  return properties;
}

function getTextPlusProperties(textPlus) {
  return textPlus.characterProperties || textPlus.properties || {};
}

function characterSelectionDefinition(PZ) {
  return {
    name: "Characters",
    type: PZ.property.type.TEXT,
    value: "1",
  };
}

function createTransformPropertyDefinitions(PZ, selectedOnly) {
  const type = PZ.property.type;

  return {
    ...(selectedOnly
      ? { characterNumbers: characterSelectionDefinition(PZ) }
      : {}),
    charPosition: vectorDefinition(PZ, {
      name: "Position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    charScale: vectorDefinition(PZ, {
      name: "Scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    charRotation: vectorDefinition(PZ, {
      name: "Rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    charEulerOrder: {
      name: "Rotation order",
      type: type.LIST,
      value: "XYZ",
      items: PZ.object3d.eulerOrders,
    },
    pivot: pivotDefinition(PZ),
    delayPerCharacter: dynamicNumberDefinition(
      PZ,
      "Delay",
      0,
      {
        min: 0,
        step: 1,
        decimals: 2,
      }
    ),
    delayOrder: {
      name: "Delay order",
      type: type.OPTION,
      items: DELAY_ORDER_LABELS.join(";"),
      value: 0,
    },
    randomSeed: {
      name: "Seed",
      type: type.NUMBER,
      value: 1,
      step: 1,
      decimals: 0,
    },
  };
}

function pivotDefinition(PZ) {
  return {
    name: "Pivot",
    type: PZ.property.type.OPTION,
    items: PIVOT_LABELS.join(";"),
    value: 0,
  };
}

function createGradientTransformPropertyDefinitions(PZ) {
  const type = PZ.property.type;
  return {
    firstPosition: vectorDefinition(PZ, {
      name: "First position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    firstScale: vectorDefinition(PZ, {
      name: "First scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    firstRotation: vectorDefinition(PZ, {
      name: "First rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    lastPosition: vectorDefinition(PZ, {
      name: "Last position",
      value: [0, 0, 0],
      step: 1,
      decimals: 2,
    }),
    lastScale: vectorDefinition(PZ, {
      name: "Last scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    lastRotation: vectorDefinition(PZ, {
      name: "Last rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    gradientEulerOrder: {
      name: "Rotation order",
      type: type.LIST,
      value: "XYZ",
      items: PZ.object3d.eulerOrders,
    },
  };
}

function createShakePropertyDefinitions(PZ, selectedOnly) {
  const type = PZ.property.type;
  return {
    ...(selectedOnly
      ? { characterNumbers: characterSelectionDefinition(PZ) }
      : {}),
    shakeAmplitude: dynamicNumberDefinition(PZ, "Amplitude", 0, {
      scaleFactor: DEGREES_TO_RADIANS,
      min: 0,
      max: 360,
      step: 1,
      decimals: 1,
    }),
    shakePeriod: dynamicNumberDefinition(PZ, "Period", 24, {
      min: 0,
      step: 1,
      decimals: 2,
    }),
    shakePhase: dynamicNumberDefinition(
      PZ,
      "Phase",
      0,
      {
        step: 1,
        decimals: 2,
      }
    ),
    shakeAxis: vectorDefinition(PZ, {
      name: "Axis",
      value: [0, 0, 1],
      step: 0.1,
      decimals: 3,
    }),
    pivot: pivotDefinition(PZ),
    shakeDelayPerCharacter: dynamicNumberDefinition(
      PZ,
      "Phase offset",
      0,
      {
        min: 0,
        step: 1,
        decimals: 2,
      }
    ),
    shakeDelayOrder: {
      name: "Offset order",
      type: type.OPTION,
      items: DELAY_ORDER_LABELS.join(";"),
      value: 0,
    },
    shakeRandomSeed: {
      name: "Seed",
      type: type.NUMBER,
      value: 1,
      step: 1,
      decimals: 0,
    },
  };
}

function createRandomScatterPropertyDefinitions(PZ) {
  const type = PZ.property.type;
  return {
    amount: {
      dynamic: true,
      interpolated: true,
      name: "Amount",
      type: type.NUMBER,
      value: 0,
      min: 0,
      step: 0.05,
      decimals: 2,
    },
    pivot: pivotDefinition(PZ),
    positionMin: vectorDefinition(PZ, {
      name: "Min position",
      value: [-10, -10, -10],
      step: 1,
      decimals: 2,
    }),
    positionMax: vectorDefinition(PZ, {
      name: "Max position",
      value: [10, 10, 10],
      step: 1,
      decimals: 2,
    }),
    rotationMin: vectorDefinition(PZ, {
      name: "Min rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    rotationMax: vectorDefinition(PZ, {
      name: "Max rotation",
      value: [0, 0, 0],
      scaleFactor: DEGREES_TO_RADIANS,
      step: 1,
      decimals: 1,
    }),
    scaleMin: vectorDefinition(PZ, {
      name: "Min scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    scaleMax: vectorDefinition(PZ, {
      name: "Max scale",
      value: [1, 1, 1],
      min: 0.001,
      step: 0.01,
      decimals: 3,
      linkRatio: true,
    }),
    seed: {
      name: "Seed",
      type: type.NUMBER,
      value: 1,
      step: 1,
      decimals: 0,
    },
  };
}

function propertyValue(property, frame, fallback) {
  if (!property || typeof property.get !== "function") return fallback;
  const value = property.get(frame);
  return value === undefined ? fallback : value;
}

function getConfiguredCharacterOffset(
  properties,
  frame,
  index,
  count,
  delayName,
  orderName,
  seedName
) {
  const orderIndex = Math.max(
    0,
    Math.min(
      DELAY_ORDERS.length - 1,
      Math.round(numberValue(propertyValue(properties[orderName], frame, 0), 0))
    )
  );
  const order = DELAY_ORDERS[orderIndex];
  const seed = numberValue(propertyValue(properties[seedName], frame, 1), 1);
  const step = numberValue(propertyValue(properties[delayName], frame, 0), 0);
  return getCharacterDelay(order, index, count, step, seed);
}

function getDelayedFrame(
  properties,
  frame,
  index,
  count,
  delayName,
  orderName,
  seedName
) {
  const delay = getConfiguredCharacterOffset(
    properties,
    frame,
    index,
    count,
    delayName,
    orderName,
    seedName
  );
  return Math.max(0, numberValue(frame, 0) - delay);
}

function neutralCharacterControls(frame) {
  const currentFrame = numberValue(frame, 0);
  return {
    transformFrame: currentFrame,
    shakeFrame: currentFrame,
    position: [0, 0, 0],
    scale: [1, 1, 1],
    rotation: [0, 0, 0],
    eulerOrder: "XYZ",
    pivot: "character",
    shakeAxis: [0, 0, 1],
    shake: 0,
  };
}

function getCharacterTransformControls(textPlus, frame, index, count) {
  const properties = getTextPlusProperties(textPlus);
  const transformFrame = getDelayedFrame(
    properties,
    frame,
    index,
    count,
    "delayPerCharacter",
    "delayOrder",
    "randomSeed"
  );
  const read = (name, fallback) =>
    propertyValue(properties[name], transformFrame, fallback);

  return {
    ...neutralCharacterControls(frame),
    transformFrame,
    position: vector3(read("charPosition", [0, 0, 0]), [0, 0, 0]),
    scale: vector3(read("charScale", [1, 1, 1]), [1, 1, 1]),
    rotation: vector3(read("charRotation", [0, 0, 0]), [0, 0, 0]),
    eulerOrder: String(read("charEulerOrder", "XYZ")),
    pivot: getPivot(read("pivot", 0)),
  };
}

function getCharacterShakeControls(textPlus, frame, index, count) {
  const properties = getTextPlusProperties(textPlus);
  const shakeFrame = numberValue(frame, 0);
  const phaseOffset = getConfiguredCharacterOffset(
    properties,
    frame,
    index,
    count,
    "shakeDelayPerCharacter",
    "shakeDelayOrder",
    "shakeRandomSeed"
  );
  const read = (name, fallback) =>
    propertyValue(properties[name], shakeFrame, fallback);
  const amplitude = numberValue(read("shakeAmplitude", 0), 0);
  const period = numberValue(read("shakePeriod", 0), 0);
  const phase = numberValue(read("shakePhase", 0), 0) - phaseOffset;

  return {
    ...neutralCharacterControls(frame),
    shakeFrame,
    shakePhase: phase,
    shakePhaseOffset: phaseOffset,
    shakeAxis: vector3(read("shakeAxis", [0, 0, 1]), [0, 0, 1]),
    shake: getShakeAngle(amplitude, period, phase),
    pivot: getPivot(read("pivot", 0)),
  };
}

function getPivot(value) {
  return Math.round(numberValue(value, 0)) === 1 ? "text" : "character";
}

function lerpVector(start, end, amount, fallback) {
  const first = vector3(start, fallback);
  const last = vector3(end, fallback);
  if (amount === 0) return first;
  if (amount === 1) return last;
  return first.map((value, index) => lerp(value, last[index], amount));
}

function getGradientTransformControls(textPlus, frame, index, count) {
  const properties = getTextPlusProperties(textPlus);
  const read = (name, fallback) =>
    propertyValue(properties[name], frame, fallback);
  const characterCount = Math.max(1, Math.trunc(numberValue(count, 1)));
  const characterIndex = Math.min(
    Math.max(Math.trunc(numberValue(index, 0)), 0),
    characterCount - 1
  );
  const amount = characterCount === 1 ? 0 : characterIndex / (characterCount - 1);

  return {
    ...neutralCharacterControls(frame),
    position: lerpVector(
      read("firstPosition", [0, 0, 0]),
      read("lastPosition", [0, 0, 0]),
      amount,
      [0, 0, 0]
    ),
    scale: lerpVector(
      read("firstScale", [1, 1, 1]),
      read("lastScale", [1, 1, 1]),
      amount,
      [1, 1, 1]
    ),
    rotation: lerpVector(
      read("firstRotation", [0, 0, 0]),
      read("lastRotation", [0, 0, 0]),
      amount,
      [0, 0, 0]
    ),
    eulerOrder: String(read("gradientEulerOrder", "XYZ")),
  };
}

function parseCharacterSelection(value, count) {
  const maximum = Math.max(
    0,
    Math.trunc(numberValue(count, Number.MAX_SAFE_INTEGER))
  );
  const selected = [];
  const seen = new Set();
  const parts = String(value == null ? "" : value).split(
    /[,.\u3002\uFF0C\uFF0E\s]+/
  );

  for (const part of parts) {
    if (!/^\d+$/.test(part)) continue;
    const characterNumber = Number(part);
    if (
      !Number.isSafeInteger(characterNumber) ||
      characterNumber < 1 ||
      characterNumber > maximum
    ) {
      continue;
    }
    const index = characterNumber - 1;
    if (seen.has(index)) continue;
    seen.add(index);
    selected.push(index);
  }
  selected.sort((left, right) => left - right);
  return selected;
}

function getSelectedCharacterContext(textPlus, frame, index, count) {
  const properties = getTextPlusProperties(textPlus);
  const value = propertyValue(
    properties.characterNumbers,
    frame,
    ""
  );
  const selected = parseCharacterSelection(value, count);
  const selectedIndex = selected.indexOf(index);
  if (selectedIndex < 0) return null;
  return { index: selectedIndex, count: selected.length };
}

function getRandomScatterControls(scatter, frame, index) {
  const properties = getTextPlusProperties(scatter);
  const read = (name, fallback) =>
    propertyValue(properties[name], frame, fallback);
  const transform = getRandomScatterTransform(
    read("amount", 0),
    {
      positionMin: read("positionMin", [-10, -10, -10]),
      positionMax: read("positionMax", [10, 10, 10]),
      rotationMin: read("rotationMin", [0, 0, 0]),
      rotationMax: read("rotationMax", [0, 0, 0]),
      scaleMin: read("scaleMin", [1, 1, 1]),
      scaleMax: read("scaleMax", [1, 1, 1]),
    },
    numberValue(read("seed", 1), 1),
    index
  );
  return {
    transformFrame: numberValue(frame, 0),
    shakeFrame: numberValue(frame, 0),
    position: transform.position,
    scale: transform.scale,
    rotation: transform.rotation,
    eulerOrder: "XYZ",
    pivot: getPivot(read("pivot", 0)),
    shakeAxis: [0, 0, 1],
    shake: 0,
  };
}

function getTextPlusControls(textPlus, frame, index, count) {
  const mode = textPlus.zoidiumTextPlusMode;
  if (mode === "random-scatter") {
    return getRandomScatterControls(textPlus, frame, index);
  }
  if (mode === "gradient-transform") {
    return getGradientTransformControls(textPlus, frame, index, count);
  }

  let targetIndex = index;
  let targetCount = count;
  if (mode === "selected-transform" || mode === "selected-shake") {
    const selected = getSelectedCharacterContext(
      textPlus,
      frame,
      index,
      count
    );
    if (!selected) return neutralCharacterControls(frame);
    targetIndex = selected.index;
    targetCount = selected.count;
  }

  if (mode === "character-shake" || mode === "selected-shake") {
    return getCharacterShakeControls(
      textPlus,
      frame,
      targetIndex,
      targetCount
    );
  }
  return getCharacterTransformControls(
    textPlus,
    frame,
    targetIndex,
    targetCount
  );
}

/* ----------------------------------------------------------- text rendering */

function sameObjects(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function finiteBox(geometry) {
  if (!geometry || typeof geometry.computeBoundingBox !== "function") return null;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (
    !box ||
    !box.min ||
    !box.max ||
    !Number.isFinite(box.min.x) ||
    !Number.isFinite(box.min.y) ||
    !Number.isFinite(box.min.z) ||
    !Number.isFinite(box.max.x) ||
    !Number.isFinite(box.max.y) ||
    !Number.isFinite(box.max.z)
  ) {
    return null;
  }
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

function expandBounds(bounds, box, x, y) {
  if (!box) return;
  bounds.min[0] = Math.min(bounds.min[0], box.min[0] + x);
  bounds.min[1] = Math.min(bounds.min[1], box.min[1] + y);
  bounds.min[2] = Math.min(bounds.min[2], box.min[2]);
  bounds.max[0] = Math.max(bounds.max[0], box.max[0] + x);
  bounds.max[1] = Math.max(bounds.max[1], box.max[1] + y);
  bounds.max[2] = Math.max(bounds.max[2], box.max[2]);
  bounds.empty = false;
}

function textGeometryOptions(textObject, font) {
  const rawSize = propertyValue(textObject.properties?.size, 0, [20, 3]);
  const size = Array.isArray(rawSize) ? rawSize : [20, 3];
  const rawBevelSize = propertyValue(
    textObject.properties?.bevelSize,
    0,
    [0.1, 0.5]
  );
  const bevelSize = Array.isArray(rawBevelSize) ? rawBevelSize : [0.1, 0.5];
  return {
    size: numberValue(size[0], 20),
    height: numberValue(size[1], 3),
    curveSegments: numberValue(propertyValue(textObject.properties?.detail, 0, 5), 5),
    font,
    bevelEnabled: Boolean(propertyValue(textObject.properties?.bevel, 0, 0)),
    bevelThickness: numberValue(bevelSize[0], 0.1),
    bevelSize: numberValue(bevelSize[1], 0.5),
    material: 0,
    extrudeMaterial: 1,
  };
}

function copyMeshState(source, target) {
  if (!source || !target) return;
  target.material = source.material;
  target.castShadow = source.castShadow;
  target.receiveShadow = source.receiveShadow;
  target.visible = source.visible;
  target.frustumCulled = source.frustumCulled;
  target.renderOrder = source.renderOrder;
  target.renderDepth = source.renderDepth;
  target.customDepthMaterial = source.customDepthMaterial;
  target.customDistanceMaterial = source.customDistanceMaterial;
  if (source.layers && target.layers) target.layers.mask = source.layers.mask;
}

function disposeCharacterRendering(splitState) {
  if (!splitState) return;
  if (splitState.renderRoot?.parent) {
    splitState.renderRoot.parent.remove(splitState.renderRoot);
  }
  for (const entry of splitState.entries || []) entry.geometry?.dispose?.();
  splitState.renderRoot = null;
  splitState.entries = [];
  splitState.layers = [];
}

function buildCharacterRendering(textObject, splitState, layers) {
  const THREE = state.THREE;
  const sourceMesh = textObject.threeObj;
  const font = textObject.font?.font3d;
  if (!THREE || !sourceMesh || !font) return;

  disposeCharacterRendering(splitState);
  const rawText = propertyValue(textObject.properties?.text, 0, "");
  const rawSize = propertyValue(textObject.properties?.size, 0, [20, 3]);
  const size = Array.isArray(rawSize) ? numberValue(rawSize[0], 20) : 20;
  const layout = getTextLayout(rawText, font.data, size);
  const options = textGeometryOptions(textObject, font);
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    empty: true,
  };
  const pending = [];

  try {
    for (const unit of layout.units) {
      let geometry = null;
      let box = null;
      geometry = new THREE.TextGeometry(unit.character, options);
      box = finiteBox(geometry);
      if (!box) {
        geometry.dispose?.();
        geometry = null;
      }
      expandBounds(bounds, box, unit.x, unit.y);
      pending.push({ unit, geometry, box });
    }
  } catch (error) {
    for (const item of pending) item.geometry?.dispose?.();
    throw error;
  }

  const positionMode = propertyValue(textObject.properties?.positionMode, 0, 0);
  const centerOffset = getCenterOffset(
    bounds.empty ? null : bounds,
    positionMode
  );
  const renderRoot = new THREE.Object3D();
  renderRoot.name = "Text+ characters";
  renderRoot.zoidiumTextPlusCharacters = true;
  const textPivot = new THREE.Object3D();
  textPivot.name = "Text center";
  textPivot.position.set(
    ...getTextCenter(bounds.empty ? null : bounds, centerOffset)
  );
  renderRoot.add(textPivot);
  const entries = [];

  for (const item of pending) {
    const center = item.box
      ? [
          (item.box.min[0] + item.box.max[0]) / 2,
          (item.box.min[1] + item.box.max[1]) / 2,
          (item.box.min[2] + item.box.max[2]) / 2,
        ]
      : [item.unit.advance / 2, 0, 0];
    const anchor = new THREE.Object3D();
    anchor.name = `Character ${item.unit.index + 1}`;
    anchor.position.set(
      item.unit.x + center[0] + centerOffset[0],
      item.unit.y + center[1] + centerOffset[1],
      center[2] + centerOffset[2]
    );
    renderRoot.add(anchor);

    const nodes = [];
    let parent = anchor;
    for (let index = 0; index < layers.length; index += 1) {
      const node = new THREE.Object3D();
      node.name = `${layers[index].defaultName || "Text+"} ${index + 1}`;
      node.zoidiumTextPlusAxis = new THREE.Vector3();
      parent.add(node);
      parent = node;
      nodes.push(node);
    }

    let mesh = null;
    if (item.geometry) {
      mesh = new THREE.Mesh(item.geometry, sourceMesh.material);
      mesh.name = item.unit.character;
      mesh.position.set(-center[0], -center[1], -center[2]);
      copyMeshState(sourceMesh, mesh);
      parent.add(mesh);
    }

    entries.push({
      index: item.unit.index,
      count: layout.count,
      character: item.unit.character,
      geometry: item.geometry,
      anchor,
      textPivot,
      nodes,
      mesh,
    });
  }

  sourceMesh.add(renderRoot);
  splitState.renderRoot = renderRoot;
  splitState.entries = entries;
  splitState.layers = layers.slice();
}

function captureSourceGeometry(textObject, splitState) {
  const THREE = state.THREE;
  const mesh = textObject.threeObj;
  if (!THREE || !mesh || mesh.geometry === splitState.emptyGeometry) return false;

  if (splitState.fullGeometry && splitState.fullGeometry !== mesh.geometry) {
    splitState.fullGeometry.dispose?.();
  }
  splitState.fullGeometry = mesh.geometry;
  splitState.emptyGeometry = new THREE.Geometry();
  mesh.geometry = splitState.emptyGeometry;
  return true;
}

function getMatrixToAncestor(THREE, object, ancestor) {
  if (!THREE?.Matrix4 || !object || !ancestor) return null;
  const matrix = new THREE.Matrix4();
  let current = object;

  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    if (current === ancestor) return matrix;
    if (!current.matrix) return null;
    if (current.matrixAutoUpdate !== false) current.updateMatrix?.();
    matrix.premultiply(current.matrix);
    current = current.parent || null;
  }
  return null;
}

function applyReferenceSpaceCharacterTransform(
  THREE,
  node,
  controls,
  referenceObject,
  pivotObject
) {
  if (
    !THREE?.Matrix4 ||
    !THREE.Vector3 ||
    !THREE.Euler ||
    !THREE.Quaternion ||
    !node?.parent ||
    !node.matrix ||
    !referenceObject
  ) {
    return false;
  }

  const parentToReference = getMatrixToAncestor(
    THREE,
    node.parent,
    referenceObject
  );
  if (!parentToReference) return false;
  const pivotToReference = pivotObject
    ? getMatrixToAncestor(THREE, pivotObject, referenceObject)
    : parentToReference;
  if (!pivotToReference) return false;
  if (
    typeof parentToReference.determinant === "function" &&
    Math.abs(parentToReference.determinant()) < 1e-12
  ) {
    return false;
  }

  const order = PZ_EULER_ORDERS.has(controls.eulerOrder)
    ? controls.eulerOrder
    : "XYZ";
  const pivot = new THREE.Vector3(0, 0, 0).applyMatrix4(pivotToReference);
  const position = new THREE.Vector3(...controls.position);
  const scale = new THREE.Vector3(...controls.scale);
  const rotation = new THREE.Euler(
    controls.rotation[0],
    controls.rotation[1],
    controls.rotation[2],
    order
  );
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  const shake = numberValue(controls.shake, 0);
  if (shake !== 0) {
    const shakeAxis = new THREE.Vector3(
      ...vector3(controls.shakeAxis, [0, 0, 1])
    );
    if (shakeAxis.lengthSq() > 1e-12) {
      quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(shakeAxis.normalize(), shake)
      );
    }
  }
  const transform = new THREE.Matrix4().compose(position, quaternion, scale);
  const aroundPivot = new THREE.Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(transform)
    .multiply(
      new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z)
    );
  const localTransform = new THREE.Matrix4()
    .getInverse(parentToReference)
    .multiply(aroundPivot)
    .multiply(parentToReference);

  node.matrixAutoUpdate = false;
  node.matrix.copy(localTransform);
  node.matrixWorldNeedsUpdate = true;
  return true;
}

function getCharacterTransformReference(textPlus, controls, textPivot) {
  const pivotObject = controls.pivot === "text" ? textPivot : null;
  return {
    pivotObject,
    referenceObject: pivotObject?.parent || textPlus?.threeObj || null,
  };
}

function applyCharacterTransform(node, controls, textPlus, textPivot) {
  const { pivotObject, referenceObject } = getCharacterTransformReference(
    textPlus,
    controls,
    textPivot
  );
  if (
    (textPlus?.zoidiumTextPlusMode === "random-scatter" || pivotObject) &&
    applyReferenceSpaceCharacterTransform(
      state.THREE,
      node,
      controls,
      referenceObject,
      pivotObject
    )
  ) {
    return;
  }

  node.matrixAutoUpdate = true;
  node.position.set(...controls.position);
  node.scale.set(...controls.scale);
  const order = PZ_EULER_ORDERS.has(controls.eulerOrder)
    ? controls.eulerOrder
    : "XYZ";
  node.rotation.set(
    controls.rotation[0],
    controls.rotation[1],
    controls.rotation[2],
    order
  );

  const axis = node.zoidiumTextPlusAxis;
  axis.set(...controls.shakeAxis);
  if (axis.lengthSq() > 1e-12 && controls.shake !== 0) {
    node.rotateOnAxis(axis.normalize(), controls.shake);
  }
}

function updateCharacterRendering(textObject, splitState, layers, frame) {
  const sourceMesh = textObject.threeObj;
  if (!state.THREE || !sourceMesh) return;
  if (!sameObjects(splitState.layers, layers)) {
    buildCharacterRendering(textObject, splitState, layers);
  }

  for (const entry of splitState.entries) {
    copyMeshState(sourceMesh, entry.mesh);
    for (let index = 0; index < layers.length; index += 1) {
      const controls = getTextPlusControls(
        layers[index],
        frame,
        entry.index,
        entry.count
      );
      applyCharacterTransform(
        entry.nodes[index],
        controls,
        layers[index],
        entry.textPivot
      );
    }
  }
}

function getSplitState(textObject) {
  let splitState = state.splitStates.get(textObject);
  if (splitState) return splitState;
  splitState = {
    fullGeometry: null,
    emptyGeometry: null,
    renderRoot: null,
    entries: [],
    layers: [],
  };
  state.splitStates.set(textObject, splitState);
  state.splitTexts.add(textObject);
  return splitState;
}

function restoreTextRendering(textObject) {
  const splitState = state.splitStates.get(textObject);
  if (!splitState) return;
  disposeCharacterRendering(splitState);
  const mesh = textObject?.threeObj;
  if (mesh && mesh.geometry === splitState.emptyGeometry) {
    mesh.geometry = splitState.fullGeometry || mesh.geometry;
  } else if (
    splitState.fullGeometry &&
    mesh?.geometry !== splitState.fullGeometry
  ) {
    splitState.fullGeometry.dispose?.();
  }
  if (splitState.emptyGeometry && mesh?.geometry !== splitState.emptyGeometry) {
    splitState.emptyGeometry.dispose?.();
  }
  state.splitStates.delete(textObject);
  state.splitTexts.delete(textObject);
}

function syncTextRendering(textObject, frame) {
  const layers = collectTextPlusObjects(textObject);
  if (layers.length === 0) {
    restoreTextRendering(textObject);
    return;
  }
  if (!textObject?.threeObj || !textObject.font?.font3d) return;

  const splitState = getSplitState(textObject);
  const geometryChanged = captureSourceGeometry(textObject, splitState);
  if (
    geometryChanged ||
    !splitState.renderRoot ||
    !sameObjects(splitState.layers, layers)
  ) {
    buildCharacterRendering(textObject, splitState, layers);
  }
  updateCharacterRendering(textObject, splitState, layers, frame);
}

/* ------------------------------------------------------------------ plugin */

function createTextParentObjectClass(PZ, definition) {
  const propertyDefinitions = definition.createProperties(PZ);

  class TextParentObject extends PZ.object3d.group {
    constructor() {
      super();
      this.objects.name = definition.objectsName;
      this.characterProperties = createPropertyCategory(
        PZ,
        this,
        "Character",
        propertyDefinitions
      );
      this.type = definition.type;
    }

    load(data) {
      const normalized = definition.normalize(data);
      super.load(normalized);
      this.characterProperties.load(normalized.characterProperties);
      this.type = definition.type;
    }

    toJSON() {
      const data = super.toJSON();
      data.type = definition.type;
      data.schemaVersion = definition.schemaVersion;
      data.characterProperties = this.characterProperties;
      return data;
    }
  }

  TextParentObject.prototype.defaultName = definition.name;
  TextParentObject.prototype.zoidiumTextPlusObject = true;
  TextParentObject.prototype.zoidiumTextPlusMode = definition.mode;
  return TextParentObject;
}

function getTextParentDefinitions() {
  return [
    {
      type: TEXT_PLUS_TYPE,
      schemaVersion: SCHEMA_VERSION,
      name: TEXT_PLUS_NAME,
      mode: "character-transform",
      objectsName: "Text",
      createProperties: (PZ) => createTransformPropertyDefinitions(PZ, false),
      normalize: defaultObjectData,
    },
    {
      type: GRADIENT_TRANSFORM_TYPE,
      schemaVersion: GRADIENT_TRANSFORM_SCHEMA_VERSION,
      name: GRADIENT_TRANSFORM_NAME,
      mode: "gradient-transform",
      objectsName: "Text",
      createProperties: createGradientTransformPropertyDefinitions,
      normalize: defaultGradientTransformData,
    },
    {
      type: CHARACTER_SHAKE_TYPE,
      schemaVersion: CHARACTER_SHAKE_SCHEMA_VERSION,
      name: CHARACTER_SHAKE_NAME,
      mode: "character-shake",
      objectsName: "Text",
      createProperties: (PZ) => createShakePropertyDefinitions(PZ, false),
      normalize: defaultCharacterShakeData,
    },
    {
      type: SELECTED_TRANSFORM_TYPE,
      schemaVersion: SELECTED_TRANSFORM_SCHEMA_VERSION,
      name: SELECTED_TRANSFORM_NAME,
      mode: "selected-transform",
      objectsName: "Text",
      createProperties: (PZ) => createTransformPropertyDefinitions(PZ, true),
      normalize: defaultSelectedTransformData,
    },
    {
      type: SELECTED_SHAKE_TYPE,
      schemaVersion: SELECTED_SHAKE_SCHEMA_VERSION,
      name: SELECTED_SHAKE_NAME,
      mode: "selected-shake",
      objectsName: "Text",
      createProperties: (PZ) => createShakePropertyDefinitions(PZ, true),
      normalize: defaultSelectedShakeData,
    },
    {
      type: RANDOM_SCATTER_TYPE,
      schemaVersion: RANDOM_SCATTER_SCHEMA_VERSION,
      name: RANDOM_SCATTER_NAME,
      mode: "random-scatter",
      objectsName: "Text",
      createProperties: createRandomScatterPropertyDefinitions,
      normalize: defaultRandomScatterData,
    },
  ];
}

function installTextPatches(PZ) {
  const prototype = PZ.object3d?.text?.prototype;
  if (!prototype || typeof prototype.update !== "function") return false;
  const originalUpdate = prototype.update;
  const originalUnload = prototype.unload;

  const patchedUpdate = function update(frame) {
    originalUpdate.call(this, frame);
    try {
      syncTextRendering(this, frame);
    } catch (error) {
      restoreTextRendering(this);
      console.error("Text+ could not rebuild a 3D Text object", error);
    }
  };
  patchedUpdate._zoidiumTextPlusPatched = true;

  const patchedUnload = function unload() {
    restoreTextRendering(this);
    if (typeof originalUnload === "function") {
      return originalUnload.apply(this, arguments);
    }
    return undefined;
  };
  patchedUnload._zoidiumTextPlusPatched = true;

  prototype.update = patchedUpdate;
  prototype.unload = patchedUnload;
  state.textUpdateOriginal = originalUpdate;
  state.textUpdatePatched = patchedUpdate;
  state.textUnloadOriginal = originalUnload;
  state.textUnloadPatched = patchedUnload;
  return true;
}

function restoreTextPatches() {
  const PZ = state.PZ;
  const prototype = PZ?.object3d?.text?.prototype;
  if (prototype?.update === state.textUpdatePatched) {
    prototype.update = state.textUpdateOriginal;
  }
  if (prototype?.unload === state.textUnloadPatched) {
    prototype.unload = state.textUnloadOriginal;
  }
  state.textUpdateOriginal = null;
  state.textUpdatePatched = null;
  state.textUnloadOriginal = null;
  state.textUnloadPatched = null;
}

function activate(context) {
  if (state.PZ) return;
  const { PZ, window, object3d } = context || {};
  const THREE = window?.THREE;
  if (
    !PZ?.object3d?.group ||
    !PZ.object3d.text ||
    !PZ.property ||
    !THREE?.TextGeometry ||
    !object3d
  ) {
    throw new Error("Text+ requires the CM3 3D Text API and Zoidium object registry.");
  }

  state.PZ = PZ;
  state.THREE = THREE;
  if (!installTextPatches(PZ)) {
    deactivate();
    throw new Error("Text+ could not install its 3D Text bindings.");
  }

  try {
    for (const definition of getTextParentDefinitions()) {
      const ObjectClass = createTextParentObjectClass(PZ, definition);
      state.objectClasses.push(ObjectClass);
      state.unregisterObjectClasses.push(
        object3d.registerClass({
          type: definition.type,
          schemaVersion: definition.schemaVersion,
          name: definition.name,
          factory: () => new ObjectClass(),
        })
      );
    }
  } catch (error) {
    deactivate();
    throw error;
  }
}

function deactivate() {
  restoreTextPatches();
  for (const textObject of Array.from(state.splitTexts)) {
    restoreTextRendering(textObject);
  }
  for (const unregister of state.unregisterObjectClasses) {
    try {
      unregister();
    } catch (error) {
      console.error("Text+ could not unregister a 3D parent object", error);
    }
  }
  state.PZ = null;
  state.THREE = null;
  state.objectClasses = [];
  state.unregisterObjectClasses = [];
  state.splitStates = new WeakMap();
  state.splitTexts = new Set();
}

module.exports = {
  activate,
  deactivate,
  _test: {
    CHARACTER_SHAKE_TYPE,
    DELAY_ORDERS,
    GRADIENT_TRANSFORM_TYPE,
    RANDOM_SCATTER_TYPE,
    SELECTED_SHAKE_TYPE,
    SELECTED_TRANSFORM_TYPE,
    TEXT_PLUS_TYPE,
    applyReferenceSpaceCharacterTransform,
    collectTextPlusObjects,
    createRandomScatterPropertyDefinitions,
    createGradientTransformPropertyDefinitions,
    createPropertyCategory,
    createShakePropertyDefinitions,
    createTransformPropertyDefinitions,
    defaultCharacterShakeData,
    defaultGradientTransformData,
    defaultObjectData,
    defaultRandomScatterData,
    defaultSelectedShakeData,
    defaultSelectedTransformData,
    getAncestorObject,
    getCenterOffset,
    getCharacterDelay,
    getCharacterShakeControls,
    getCharacterTransformControls,
    getCharacterTransformReference,
    getDelayRank,
    getMatrixToAncestor,
    getGradientTransformControls,
    getRandomOrder,
    getRandomScatterControls,
    getRandomScatterTransform,
    getSelectedCharacterContext,
    getShakeAngle,
    getTextLayout,
    getTextCenter,
    getTextPlusProperties,
    getTextPlusControls,
    parseCharacterSelection,
    seededRandom,
    lerpVector,
  },
};
