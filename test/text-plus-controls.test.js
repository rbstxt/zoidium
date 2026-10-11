"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("transform delays properties while shake offsets its user-controlled phase", () => {
  const transformReadFrames = [];
  const shakeReadFrames = [];
  const animated = (readFrames, value) => ({
    get(frame) {
      readFrames.push(frame);
      return typeof value === "function" ? value(frame) : value;
    },
  });
  const transform = {
    properties: {
      delayOrder: animated(transformReadFrames, 0),
      randomSeed: animated(transformReadFrames, 1),
      delayPerCharacter: animated(transformReadFrames, 3),
      charPosition: animated(transformReadFrames, (frame) => [frame, 0, 0]),
      charScale: animated(transformReadFrames, [1, 1, 1]),
      charRotation: animated(transformReadFrames, [0, 0, 0]),
      charEulerOrder: animated(transformReadFrames, "XYZ"),
      pivot: animated(transformReadFrames, 1),
    },
  };
  const shake = {
    properties: {
      shakeDelayOrder: animated(shakeReadFrames, 0),
      shakeRandomSeed: animated(shakeReadFrames, 1),
      shakeDelayPerCharacter: animated(shakeReadFrames, 1),
      shakeAxis: animated(shakeReadFrames, [0, 1, 0]),
      shakeAmplitude: animated(shakeReadFrames, Math.PI / 2),
      shakePeriod: animated(shakeReadFrames, 4),
      shakePhase: animated(shakeReadFrames, 3),
      pivot: animated(shakeReadFrames, 1),
    },
  };
  const transformControls = _test.getCharacterTransformControls(
    transform,
    10,
    2,
    4
  );
  const shakeControls = _test.getCharacterShakeControls(shake, 10, 2, 4);

  assert.equal(transformControls.transformFrame, 4);
  assert.deepEqual(transformControls.position, [4, 0, 0]);
  assert.equal(transformControls.shake, 0);
  assert.equal(transformControls.pivot, "text");
  assert.equal(shakeControls.shakeFrame, 10);
  assert.equal(shakeControls.shakePhaseOffset, 2);
  assert.equal(shakeControls.shakePhase, 1);
  assert.deepEqual(shakeControls.position, [0, 0, 0]);
  assert.deepEqual(shakeControls.scale, [1, 1, 1]);
  assert.deepEqual(shakeControls.shakeAxis, [0, 1, 0]);
  assert.ok(Math.abs(shakeControls.shake - Math.PI / 2) < 1e-9);
  assert.equal(shakeControls.pivot, "text");
  assert.ok(transformReadFrames.includes(10));
  assert.ok(transformReadFrames.includes(4));
  assert.ok(shakeReadFrames.every((readFrame) => readFrame === 10));
});

test("shake follows amplitude, period, and phase in radians", () => {
  const quarterTurn = Math.PI / 2;
  assert.ok(Math.abs(_test.getShakeAngle(quarterTurn, 4, 1) - quarterTurn) < 1e-9);
  assert.ok(Math.abs(_test.getShakeAngle(quarterTurn, 4, 3) + quarterTurn) < 1e-9);
  assert.ok(Math.abs(_test.getShakeAngle(quarterTurn, 4, -1) + quarterTurn) < 1e-9);
  assert.equal(_test.getShakeAngle(quarterTurn, 0, 1), 0);
  assert.equal(_test.getShakeAngle(0, 24, 1), 0);
});

test("shake stays still unless the user changes Phase", () => {
  const property = (value) => ({ get: () => value });
  const shake = {
    properties: {
      shakeDelayOrder: property(0),
      shakeRandomSeed: property(1),
      shakeDelayPerCharacter: property(0),
      shakeAxis: property([0, 0, 1]),
      shakeAmplitude: property(1),
      shakePeriod: property(4),
      shakePhase: property(1),
    },
  };

  const start = _test.getCharacterShakeControls(shake, 0, 0, 3);
  const later = _test.getCharacterShakeControls(shake, 20, 0, 3);
  assert.ok(Math.abs(start.shake - 1) < 1e-9);
  assert.equal(later.shake, start.shake);
});

test("shake phase offsets work immediately without an initial hold", () => {
  const property = (value) => ({ get: () => value });
  const shake = {
    properties: {
      shakeDelayOrder: property(0),
      shakeRandomSeed: property(1),
      shakeDelayPerCharacter: property(1),
      shakeAxis: property([0, 0, 1]),
      shakeAmplitude: property(1),
      shakePeriod: property(4),
      shakePhase: property(0),
    },
  };

  const second = _test.getCharacterShakeControls(shake, 0, 1, 3);
  assert.equal(second.shakeFrame, 0);
  assert.equal(second.shakePhaseOffset, 1);
  assert.equal(second.shakePhase, -1);
  assert.ok(Math.abs(second.shake + 1) < 1e-9);
});
