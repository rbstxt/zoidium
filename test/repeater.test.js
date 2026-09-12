"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("../plugins/scene-plus/scene-plus.js");

test("new repeaters start without an implicit Shape source", () => {
  const data = _test.defaultSourceData({ type: "zoidium:repeater/repeater" });
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.repeaterProperties, {});
  assert.equal(data.schemaVersion, 2);
  assert.deepEqual(
    _test.defaultSourceData({
      type: "zoidium:repeater/repeater",
      objects: [{ type: 0, objectType: 1 }],
    }).objects,
    [{ type: 0, objectType: 1 }]
  );
});

test("Repeater controls live in a separate named category", () => {
  class PropertyList {
    constructor(definitions, parent) {
      this.parent = parent;
      Object.assign(this, definitions || {});
    }

    load(data) {
      this.loadedData = data;
    }
  }

  class Group {
    constructor() {
      this.properties = new PropertyList({}, this);
      this.customProperties = [];
      this.objects = [];
      this.objects.onListChanged = { watch() {}, unwatch() {} };
      this.children = [this.properties, this.customProperties, this.objects];
    }

    load(data) {
      this.properties.load(data.properties);
    }

    toJSON() {
      return {
        properties: this.properties,
        customProperties: this.customProperties,
        objects: this.objects,
      };
    }
  }

  const PZ = {
    propertyList: PropertyList,
    property: { type: { NUMBER: 0, VECTOR3: 2 } },
    object3d: { group: Group },
  };
  const Repeater = _test.createRepeaterClass(
    PZ,
    {},
    "step",
    "zoidium:repeater/repeater"
  );
  const repeater = new Repeater();

  assert.equal(repeater.repeaterProperties._zoidiumCategoryName, "Repeater");
  assert.equal(
    Object.keys(repeater.repeaterProperties).includes("_zoidiumCategoryName"),
    false
  );
  assert.equal(repeater.children[1], repeater.repeaterProperties);
  assert.equal(repeater.properties.count, undefined);
  assert.equal(repeater.repeaterProperties.count.name, "Count");
  assert.equal(repeater.repeaterProperties.positionStep.name, "Position");
  assert.equal(repeater.repeaterProperties.rotationStep.name, "Rotation");
  assert.equal(repeater.repeaterProperties.scaleStep.name, "Scale");

  repeater.load({
    properties: {},
    repeaterProperties: { count: { animated: true } },
    objects: [],
  });
  assert.deepEqual(repeater.repeaterProperties.loadedData, {
    count: { animated: true },
  });
  const serialized = repeater.toJSON();
  assert.equal(serialized.schemaVersion, 2);
  assert.equal(serialized.repeaterProperties, repeater.repeaterProperties);
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

test("every Repeater scale control links its three axes", () => {
  const PZ = { property: { type: { NUMBER: 0, VECTOR3: 2 } } };
  const step = _test.makeProperties(PZ, "step", () => {});
  const linear = _test.makeProperties(PZ, "linear", () => {});
  const random = _test.makeProperties(PZ, "random", () => {});

  assert.equal(step.scaleStep.linkRatio, true);
  assert.equal(linear.scaleEnd.linkRatio, true);
  assert.equal(random.scaleMin.linkRatio, true);
  assert.equal(random.scaleMax.linkRatio, true);
});

test("Repeater labels stay short inside their category", () => {
  const PZ = { property: { type: { NUMBER: 0, VECTOR3: 2 } } };
  const step = _test.makeProperties(PZ, "step", () => {});
  const linear = _test.makeProperties(PZ, "linear", () => {});
  const random = _test.makeProperties(PZ, "random", () => {});
  const echo = _test.makeProperties(PZ, "echo", () => {});

  assert.equal(step.positionStep.name, "Position");
  assert.equal(step.rotationStep.name, "Rotation");
  assert.equal(step.scaleStep.name, "Scale");
  assert.equal(linear.positionEnd.name, "Position");
  assert.equal(linear.rotationEnd.name, "Rotation");
  assert.equal(linear.scaleEnd.name, "Scale");
  assert.equal(random.positionMin.name, "Min position");
  assert.equal(random.positionMax.name, "Max position");
  assert.equal(random.rotationMin.name, "Min rotation");
  assert.equal(random.rotationMax.name, "Max rotation");
  assert.equal(random.scaleMin.name, "Min scale");
  assert.equal(random.scaleMax.name, "Max scale");
  assert.equal(echo.delay.name, "Offset");
});

test("echo frames are derived from the requested frame, never playback history", () => {
  const definitions = _test.makeProperties(
    { property: { type: { NUMBER: 0 } } },
    "echo",
    () => {},
  );

  assert.equal(definitions.delay.dynamic, true);
  assert.equal(definitions.delay.value, 5);
  assert.deepEqual(_test.getEchoFrames(12, 4, 3), [12, 9, 6, 3]);
  assert.deepEqual(_test.getEchoFrames(2, 4, 3), [2, 0, 0, 0]);

  const requested = [12, 2, 7];
  const forward = requested.map((frame) => _test.getEchoFrame(frame, 2, 3));
  const reverse = requested
    .slice()
    .reverse()
    .map((frame) => _test.getEchoFrame(frame, 2, 3))
    .reverse();
  assert.deepEqual(reverse, forward);
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
