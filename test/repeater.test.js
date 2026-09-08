"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("../plugins/scene-plus/scene-plus.js");

test("new repeaters start without an implicit Shape source", () => {
  assert.deepEqual(_test.defaultSourceData({ type: "zoidium:repeater/repeater" }).objects, []);
  assert.deepEqual(
    _test.defaultSourceData({
      type: "zoidium:repeater/repeater",
      objects: [{ type: 0, objectType: 1 }],
    }).objects,
    [{ type: 0, objectType: 1 }]
  );
});

test("count is dynamic and is evaluated at the current frame", () => {
  const definitions = _test.makeProperties(
    { property: { type: { NUMBER: 0 } } },
    "step",
    () => {},
  );
  assert.equal(definitions.count.dynamic, true);

  const count = {
    get(frame) {
      return frame < 10 ? 2 : 4;
    },
  };
  assert.equal(_test.getCount(count, 0), 2);
  assert.equal(_test.getCount(count, 10), 4);
  assert.equal(_test.getCount({ get: () => 1000 }, 0), 128);
});

test("step repeater uses the configured transform step", () => {
  const result = _test.getTransform(
    "step",
    3,
    5,
    {
      positionStep: [2, 3, 4],
      rotationStep: [0.1, 0.2, 0.3],
      scaleStep: [2, 0.5, 1],
    },
    1
  );

  assert.deepEqual(result.position, [6, 9, 12]);
  assert.ok(result.rotation.every((value, index) => Math.abs(value - [0.3, 0.6, 0.9][index]) < 1e-9));
  assert.deepEqual(result.scale, [8, 0.125, 1]);
});

test("linear repeater places copies evenly between both endpoints", () => {
  const controls = {
    positionEnd: [40, 20, 0],
    rotationEnd: [0, 0, Math.PI],
    scaleEnd: [2, 0.5, 1],
  };

  assert.deepEqual(_test.getTransform("linear", 0, 5, controls, 1), {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  assert.deepEqual(_test.getTransform("linear", 2, 5, controls, 1), {
    position: [20, 10, 0],
    rotation: [0, 0, Math.PI / 2],
    scale: [1.5, 0.75, 1],
  });
  assert.deepEqual(_test.getTransform("linear", 4, 5, controls, 1), {
    position: controls.positionEnd,
    rotation: controls.rotationEnd,
    scale: controls.scaleEnd,
  });
});

test("random repeater is deterministic and stays inside its ranges", () => {
  const controls = {
    positionMin: [-2, -3, -4],
    positionMax: [2, 3, 4],
    rotationMin: [-1, -2, -3],
    rotationMax: [1, 2, 3],
    scaleMin: [0.5, 0.75, 1],
    scaleMax: [1.5, 1.25, 2],
  };
  assert.deepEqual(_test.getTransform("random", 0, 10, controls, 99), {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  });
  const first = _test.getTransform("random", 7, 10, controls, 99);
  const second = _test.getTransform("random", 7, 10, controls, 99);

  assert.deepEqual(first, second);
  for (let axis = 0; axis < 3; axis += 1) {
    assert.ok(first.position[axis] >= controls.positionMin[axis]);
    assert.ok(first.position[axis] <= controls.positionMax[axis]);
    assert.ok(first.rotation[axis] >= controls.rotationMin[axis]);
    assert.ok(first.rotation[axis] <= controls.rotationMax[axis]);
    assert.ok(first.scale[axis] >= controls.scaleMin[axis]);
    assert.ok(first.scale[axis] <= controls.scaleMax[axis]);
  }
});
