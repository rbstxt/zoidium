"use strict";

// Text+ per-character control readers: delay, shake, gradient, selection,
// and scatter controls evaluated at a frame. Depends on utils (values, delay
// math) and properties (getTextPlusProperties).

const {
  DELAY_ORDERS,
  getCharacterDelay,
  getRandomScatterTransform,
  getShakeAngle,
  lerp,
  numberValue,
  vector3,
} = require("./text-plus-utils.js");
const { getTextPlusProperties } = require("./text-plus-properties.js");

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

module.exports = {
  propertyValue,
  getConfiguredCharacterOffset,
  getDelayedFrame,
  neutralCharacterControls,
  getCharacterTransformControls,
  getCharacterShakeControls,
  getPivot,
  lerpVector,
  getGradientTransformControls,
  parseCharacterSelection,
  getSelectedCharacterContext,
  getRandomScatterControls,
  getTextPlusControls,
};
