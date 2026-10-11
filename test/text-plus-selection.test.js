"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("character number input is one-based, ordered, and ignores invalid entries", () => {
  assert.deepEqual(_test.parseCharacterSelection("1,4,5", 5), [0, 3, 4]);
  assert.deepEqual(_test.parseCharacterSelection("1.2.3.", 5), [0, 1, 2]);
  assert.deepEqual(_test.parseCharacterSelection("5．4。2", 5), [1, 3, 4]);
  assert.deepEqual(_test.parseCharacterSelection("5, 1, 1，3 2", 5), [
    0,
    1,
    2,
    4,
  ]);
  assert.deepEqual(
    _test.parseCharacterSelection("0,-1,2x5,text,6,3", 5),
    [2]
  );
  assert.deepEqual(_test.parseCharacterSelection("", 5), []);
});

test("selected transform delays only the entered character numbers", () => {
  const property = (value) => ({
    get(frame) {
      return typeof value === "function" ? value(frame) : value;
    },
  });
  const selectedTransform = {
    zoidiumTextPlusMode: "selected-transform",
    properties: {
      characterNumbers: property("1,4,5"),
      delayOrder: property(0),
      randomSeed: property(1),
      delayPerCharacter: property(3),
      charPosition: property((frame) => [frame, 0, 0]),
      charScale: property([1, 1, 1]),
      charRotation: property([0, 0, 0]),
      charEulerOrder: property("XYZ"),
    },
  };

  const first = _test.getTextPlusControls(selectedTransform, 10, 0, 5);
  const fourth = _test.getTextPlusControls(selectedTransform, 10, 3, 5);
  const fifth = _test.getTextPlusControls(selectedTransform, 10, 4, 5);
  const second = _test.getTextPlusControls(selectedTransform, 10, 1, 5);

  assert.deepEqual(first.position, [10, 0, 0]);
  assert.deepEqual(fourth.position, [7, 0, 0]);
  assert.deepEqual(fifth.position, [4, 0, 0]);
  assert.deepEqual(second.position, [0, 0, 0]);
  assert.equal(second.shake, 0);
});

test("selected shake leaves characters outside its number list unchanged", () => {
  const property = (value) => ({ get: () => value });
  const selectedShake = {
    zoidiumTextPlusMode: "selected-shake",
    properties: {
      characterNumbers: property("2"),
      shakeDelayOrder: property(0),
      shakeRandomSeed: property(1),
      shakeDelayPerCharacter: property(0),
      shakeAxis: property([1, 0, 0]),
      shakeAmplitude: property(Math.PI / 2),
      shakePeriod: property(4),
      shakePhase: property(1),
    },
  };

  const first = _test.getTextPlusControls(selectedShake, 1, 0, 3);
  const second = _test.getTextPlusControls(selectedShake, 1, 1, 3);

  assert.equal(first.shake, 0);
  assert.deepEqual(second.shakeAxis, [1, 0, 0]);
  assert.ok(Math.abs(second.shake - Math.PI / 2) < 1e-9);
});
