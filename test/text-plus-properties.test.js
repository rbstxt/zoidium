"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("transform and shake parents expose separate 3D controls", () => {
  const PZ = {
    property: {
      type: {
        NUMBER: 0,
        VECTOR3: 2,
        OPTION: 6,
        LIST: 9,
        TEXT: 10,
      },
    },
    object3d: { eulerOrders: [{ name: "XYZ", value: "XYZ" }] },
  };
  const transform = _test.createTransformPropertyDefinitions(PZ, false);
  const shake = _test.createShakePropertyDefinitions(PZ, false);
  const selectedTransform = _test.createTransformPropertyDefinitions(PZ, true);
  const selectedShake = _test.createShakePropertyDefinitions(PZ, true);
  const gradient = _test.createGradientTransformPropertyDefinitions(PZ);

  assert.equal(transform.charPosition.type, PZ.property.type.VECTOR3);
  assert.equal(transform.charScale.type, PZ.property.type.VECTOR3);
  assert.equal(transform.charScale.linkRatio, true);
  assert.equal(transform.charRotation.type, PZ.property.type.VECTOR3);
  assert.equal(transform.charPosition.interpolated, true);
  assert.ok(
    transform.charPosition.objects.every(
      (component) => component.interpolated === true
    )
  );
  assert.equal(transform.delayPerCharacter.interpolated, true);
  assert.equal(transform.pivot.name, "Pivot");
  assert.equal(transform.pivot.items, "Character;Text");
  assert.equal(transform.pivot.value, 0);
  assert.equal(transform.randomSeed.dynamic, true);
  assert.equal(transform.randomSeed.interpolated, true);
  assert.equal(transform.shakeAmplitude, undefined);

  assert.equal(shake.shakeAxis.type, PZ.property.type.VECTOR3);
  assert.equal(shake.shakeAxis.objects.length, 3);
  assert.equal(shake.shakeAmplitude.interpolated, true);
  assert.equal(shake.shakePeriod.interpolated, true);
  assert.equal(shake.shakePhase.interpolated, true);
  assert.equal(shake.shakeDelayPerCharacter.interpolated, true);
  assert.equal(shake.shakeRandomSeed.dynamic, true);
  assert.equal(shake.shakeRandomSeed.interpolated, true);
  assert.equal(shake.pivot.name, "Pivot");
  assert.equal(shake.charPosition, undefined);

  assert.equal(
    transform.delayOrder.items,
    "Forward;Reverse;Center out;Random"
  );
  assert.equal(
    shake.shakeDelayOrder.items,
    "Forward;Reverse;Center out;Random"
  );
  assert.equal(transform.delayPerCharacter.name, "Delay");
  assert.equal(transform.charPosition.name, "Position");
  assert.equal(transform.charScale.name, "Scale");
  assert.equal(transform.charRotation.name, "Rotation");
  assert.equal(transform.charEulerOrder.name, "Rotation order");
  assert.equal(transform.delayOrder.name, "Delay order");
  assert.equal(transform.randomSeed.name, "Seed");
  assert.equal(shake.shakeAmplitude.name, "Amplitude");
  assert.equal(shake.shakePeriod.name, "Period");
  assert.equal(shake.shakePhase.name, "Phase");
  assert.equal(shake.shakeAxis.name, "Axis");
  assert.equal(shake.shakeDelayPerCharacter.name, "Phase offset");
  assert.equal(shake.shakeDelayOrder.name, "Offset order");
  assert.equal(shake.shakeRandomSeed.name, "Seed");
  assert.equal(selectedTransform.characterNumbers.type, PZ.property.type.TEXT);
  assert.equal(selectedTransform.characterNumbers.value, "1");
  assert.equal(selectedShake.characterNumbers.type, PZ.property.type.TEXT);

  assert.equal(gradient.firstPosition.name, "First position");
  assert.equal(gradient.firstScale.name, "First scale");
  assert.equal(gradient.firstRotation.name, "First rotation");
  assert.equal(gradient.lastPosition.name, "Last position");
  assert.equal(gradient.lastScale.name, "Last scale");
  assert.equal(gradient.lastRotation.name, "Last rotation");
  assert.equal(gradient.gradientEulerOrder.name, "Rotation order");
  assert.equal(gradient.firstScale.linkRatio, true);
  assert.equal(gradient.lastScale.linkRatio, true);
  assert.equal(gradient.pivot, undefined);
  for (const name of [
    "firstPosition",
    "firstScale",
    "firstRotation",
    "lastPosition",
    "lastScale",
    "lastRotation",
  ]) {
    assert.equal(gradient[name].interpolated, true);
    assert.ok(
      gradient[name].objects.every(
        (component) => component.interpolated === true
      )
    );
  }
});

test("Random Scatter controls match the requested transform ranges", () => {
  const PZ = {
    property: {
      type: {
        NUMBER: 0,
        VECTOR3: 2,
        OPTION: 6,
      },
    },
  };
  const definitions = _test.createRandomScatterPropertyDefinitions(PZ);

  assert.equal(definitions.amount.name, "Amount");
  assert.equal(definitions.amount.dynamic, true);
  assert.equal(definitions.amount.interpolated, true);
  assert.equal(definitions.amount.value, 0);
  assert.equal(definitions.pivot.name, "Pivot");
  assert.equal(definitions.pivot.items, "Character;Text");
  assert.equal(definitions.positionMin.name, "Min position");
  assert.equal(definitions.positionMax.name, "Max position");
  assert.equal(definitions.rotationMin.name, "Min rotation");
  assert.equal(definitions.rotationMax.name, "Max rotation");
  assert.equal(definitions.scaleMin.name, "Min scale");
  assert.equal(definitions.scaleMax.name, "Max scale");
  assert.deepEqual(definitions.positionMin.value, [-10, -10, -10]);
  assert.deepEqual(definitions.positionMax.value, [10, 10, 10]);
  assert.deepEqual(definitions.rotationMin.value, [0, 0, 0]);
  assert.deepEqual(definitions.rotationMax.value, [0, 0, 0]);
  assert.deepEqual(definitions.scaleMin.value, [1, 1, 1]);
  assert.deepEqual(definitions.scaleMax.value, [1, 1, 1]);
  assert.equal(definitions.scaleMin.linkRatio, true);
  assert.equal(definitions.scaleMax.linkRatio, true);
  for (const name of [
    "positionMin",
    "positionMax",
    "rotationMin",
    "rotationMax",
    "scaleMin",
    "scaleMax",
  ]) {
    assert.equal(definitions[name].interpolated, true);
    assert.ok(
      definitions[name].objects.every(
        (component) => component.interpolated === true
      )
    );
  }
  assert.equal(definitions.seed.name, "Seed");
  assert.equal(definitions.seed.dynamic, true);
  assert.equal(definitions.seed.interpolated, true);
});
