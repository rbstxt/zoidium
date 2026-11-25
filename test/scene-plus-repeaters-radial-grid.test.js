"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("../plugins/scene-plus/scene-plus.js");
const { createRepeaterClass } = require("../plugins/scene-plus/scene-repeaters.js");
const { host } = require("./helpers/editor-identity-host.cjs");

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-9,
      `${message || "value"} [${index}]: ${actual[index]} != ${expected[index]}`,
    );
  }
};

const radial = (overrides = {}) => ({
  radius: 100,
  plane: 1,
  startAngle: 0,
  sweep: TAU,
  align: false,
  rotationStep: [0, 0, 0],
  scaleEnd: [1, 1, 1],
  ...overrides,
});

const grid = (overrides = {}) => ({
  counts: { x: 3, y: 2, z: 1 },
  spacing: [10, 20, 30],
  centered: false,
  ...overrides,
});

test("radial copies close the full circle and stay open for other sweeps", () => {
  const transform = (index, count, controls) =>
    _test.getTransform("radial", index, count, controls, 1);
  near(transform(0, 4, radial()).position, [100, 0, 0]);
  near(transform(1, 4, radial()).position, [0, 0, 100]);
  near(transform(2, 4, radial()).position, [-100, 0, 0]);
  near(transform(3, 4, radial()).position, [0, 0, -100]);

  // Other sweeps divide by N - 1 and include both ends.
  near(transform(1, 3, radial({ sweep: Math.PI })).position, [0, 0, 100]);
  near(transform(2, 3, radial({ sweep: Math.PI })).position, [-100, 0, 0]);
  near(transform(1, 3, radial({ sweep: Math.PI, startAngle: Math.PI / 2 })).position, [-100, 0, 0]);
  near(transform(2, 3, radial({ sweep: 0 })).position, [100, 0, 0]);
});

test("radial copies use the selected plane and radius", () => {
  const position = (plane, index) =>
    _test.getTransform("radial", index, 4, radial({ plane, radius: 50 }), 1).position;
  near(position(0, 1), [0, 50, 0]);
  near(position(1, 1), [0, 0, 50]);
  near(position(2, 1), [0, 0, 50]);
  near(position(2, 2), [0, -50, 0]);
  near(position(0, 2), [-50, 0, 0]);
});

test("align to circle adds the radial angle and the per-index rotation step", () => {
  const rotation = (plane, align, index) => _test.getTransform(
    "radial",
    index,
    4,
    radial({ plane, align, rotationStep: [0.1, 0.2, 0.3] }),
    1,
  ).rotation;
  near(rotation(0, false, 1), [0.1, 0.2, 0.3]);
  near(rotation(0, true, 1), [0.1, 0.2, 0.3 + Math.PI / 2]);
  near(rotation(1, true, 1), [0.1, 0.2 - Math.PI / 2, 0.3]);
  near(rotation(2, true, 1), [0.1 + Math.PI / 2, 0.2, 0.3]);
});

test("radial scale end interpolates like the linear repeater", () => {
  const scale = (index, count) => _test.getTransform(
    "radial",
    index,
    count,
    radial({ scaleEnd: [2, 3, 4] }),
    1,
  ).scale;
  near(scale(0, 3), [1, 1, 1]);
  near(scale(1, 3), [1.5, 2, 2.5]);
  near(scale(2, 3), [2, 3, 4]);
  near(scale(0, 1), [1, 1, 1]);
});

test("grid copies fill X, then Y, then Z and centre on the repeater origin", () => {
  const position = (index, controls) =>
    _test.getTransform("grid", index, 6, controls, 1).position;
  const open = [
    [0, 0, 0], [10, 0, 0], [20, 0, 0],
    [0, 20, 0], [10, 20, 0], [20, 20, 0],
  ];
  open.forEach((expected, index) => near(position(index, grid()), expected));

  const centred = grid({ centered: true });
  near(position(0, centred), [-10, -10, 0]);
  near(position(1, centred), [0, -10, 0]);
  near(position(2, centred), [10, -10, 0]);
  near(position(3, centred), [-10, 10, 0]);
  near(position(5, centred), [10, 10, 0]);

  const layer = _test.getTransform("grid", 6, 8, grid({
    counts: { x: 2, y: 2, z: 2 },
  }), 1);
  near(layer.position, [0, 20, 30]);
  near(layer.rotation, [0, 0, 0]);
  near(layer.scale, [1, 1, 1]);
});

test("radial and grid property tables expose their documented defaults", () => {
  const PZ = { property: { type: { NUMBER: 0, VECTOR3: 2, OPTION: 3 } } };
  const radialTable = _test.makeProperties(PZ, "radial", () => {});
  assert.equal(radialTable.count.value, 8);
  assert.equal(radialTable.count.dynamic, true);
  assert.equal(radialTable.radius.name, "Radius");
  assert.equal(radialTable.radius.value, 100);
  assert.equal(radialTable.plane.items, "XY;XZ;YZ");
  assert.equal(radialTable.plane.value, 1);
  assert.equal(radialTable.startAngle.name, "Start angle");
  assert.equal(radialTable.startAngle.value, 0);
  assert.equal(radialTable.startAngle.scaleFactor, DEG);
  assert.equal(radialTable.sweep.name, "Sweep");
  assert.equal(radialTable.sweep.value, TAU);
  assert.equal(radialTable.sweep.scaleFactor, DEG);
  assert.equal(radialTable.align.items, "off;on");
  assert.equal(radialTable.align.value, 0);
  assert.equal(radialTable.rotationStep.scaleFactor, DEG);
  for (const axis of radialTable.rotationStep.objects) {
    assert.equal(axis.scaleFactor, DEG);
  }
  assert.equal(radialTable.scaleEnd.objects[0].value, 1);
  assert.equal(radialTable.scaleEnd.linkRatio, true);

  const gridTable = _test.makeProperties(PZ, "grid", () => {});
  assert.equal(gridTable.count, undefined);
  assert.deepEqual(
    [gridTable.countX.value, gridTable.countY.value, gridTable.countZ.value],
    [3, 3, 1],
  );
  for (const name of ["countX", "countY", "countZ"]) {
    assert.equal(gridTable[name].step, 1);
    assert.equal(gridTable[name].decimals, 0);
    assert.equal(gridTable[name].min, 1);
    assert.equal(gridTable[name].max, 128);
    assert.equal(gridTable[name].dynamic, true);
  }
  assert.equal(gridTable.spacing.name, "Spacing");
  assert.deepEqual(gridTable.spacing.objects.map((axis) => axis.value), [50, 50, 50]);
  assert.equal(gridTable.centered.items, "off;on");
  assert.equal(gridTable.centered.value, 1);
});

test("getRepeaterCount clamps the grid volume to MAX_REPEATS", () => {
  const PZ = { property: { type: { NUMBER: 0, VECTOR3: 2, OPTION: 3 } } };
  assert.equal(
    _test.getRepeaterCount("grid", {
      countX: { get: () => 4 },
      countY: { get: () => 3 },
      countZ: { get: () => 2 },
    }, 0),
    24,
  );
  assert.equal(
    _test.getRepeaterCount("grid", {
      countX: { get: () => 20 },
      countY: { get: () => 20 },
      countZ: { get: () => 20 },
    }, 0),
    128,
  );
  assert.equal(
    _test.getRepeaterCount("radial", { count: { get: () => 8 } }, 0),
    8,
  );
  void PZ;
});

test("existing repeater transforms keep their pinned output", () => {
  assert.deepEqual(
    _test.getTransform("step", 2, 4, {
      positionStep: [1, 2, 3],
      rotationStep: [0, 0, 0],
      scaleStep: [2, 2, 2],
    }, 7),
    { position: [2, 4, 6], rotation: [0, 0, 0], scale: [4, 4, 4] },
  );
  assert.deepEqual(
    _test.getTransform("linear", 2, 5, {
      positionEnd: [10, 20, 30],
      rotationEnd: [0, 90, 0],
      scaleEnd: [2, 2, 2],
    }, 1),
    { position: [5, 10, 15], rotation: [0, 45, 0], scale: [1.5, 1.5, 1.5] },
  );
  assert.deepEqual(
    _test.getTransform("random", 3, 10, {
      positionMin: [0, 0, 0],
      positionMax: [10, 10, 10],
      rotationMin: [0, 0, 0],
      rotationMax: [0, 0, 0],
      scaleMin: [1, 1, 1],
      scaleMax: [1, 1, 1],
    }, 99),
    {
      position: [7.8834776929579675, 8.414368510711938, 0.4097414202988148],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
  );
  assert.deepEqual(
    _test.getTransform("echo", 3, 10, {
      positionStep: [2, 0, 0],
      rotationStep: [0, 0, 0],
      scaleStep: [1, 1, 1],
    }, 1),
    { position: [6, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  );
});

for (const [mode, type] of [
  ["radial", "zoidium:repeater/radial-repeater"],
  ["grid", "zoidium:repeater/grid-repeater"],
]) {
  test(`${mode} repeater retains authored properties through save and load`, () => {
    const { PZ, THREE } = host();
    const Repeater = createRepeaterClass(PZ, THREE, mode, type);
    const initial = new Repeater();
    initial.load();
    const authored = plain(initial);
    assert.equal(authored.type, type);
    const expected = mode === "radial"
      ? ["count", "radius", "plane", "startAngle", "sweep", "align", "rotationStep", "scaleEnd"]
      : ["countX", "countY", "countZ", "spacing", "centered"];
    for (const key of expected) {
      assert.ok(authored.repeaterProperties[key], `${mode} saves ${key}`);
    }
    const author = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value.keyframes)) {
        const key = value.keyframes[0];
        value.animated = true;
        value.keyframes = [
          { ...key, value: 2.25, frame: 0 },
          { ...key, value: 4.5, frame: 20 },
        ];
        return;
      }
      for (const child of Object.values(value)) author(child);
    };
    author(authored.repeaterProperties);

    const original = new Repeater();
    original.load(authored);
    const saved = plain(original);
    assert.deepEqual(saved, authored);

    const duplicate = new Repeater();
    duplicate.load(saved);
    assert.deepEqual(plain(duplicate), saved);
    for (const key of Object.keys(saved.repeaterProperties)) {
      const left = original.repeaterProperties[key];
      const right = duplicate.repeaterProperties[key];
      if (typeof left?.get === "function") {
        for (const frame of [0, 7, 20]) {
          assert.deepEqual(plain(left.get(frame)), plain(right.get(frame)), `${key} at ${frame}`);
        }
      }
    }
  });
}

function repeaterStub(mode, repeaterProperties) {
  const { PZ, THREE } = host();
  const Repeater = createRepeaterClass(PZ, THREE, mode, `zoidium:repeater/${mode}`);
  return Object.assign(Object.create(Repeater.prototype), {
    __zoidiumRepeater: true,
    _mode: mode,
    repeaterProperties,
  });
}

const property = (value) => ({ get: () => value });

test("clone-position points follow every repeater kind", () => {
  const step = repeaterStub("step", {
    count: property(3), positionStep: property([10, 0, 0]),
    rotationStep: property([0, 0, 0]), scaleStep: property([1, 1, 1]),
  });
  assert.deepEqual(_test.repeaterPointPositions(step, 0), [
    [0, 0, 0], [10, 0, 0], [20, 0, 0],
  ]);

  const linear = repeaterStub("linear", {
    count: property(3), positionEnd: property([9, 0, 0]),
    rotationEnd: property([0, 0, 0]), scaleEnd: property([1, 1, 1]),
  });
  assert.deepEqual(_test.repeaterPointPositions(linear, 0), [
    [0, 0, 0], [4.5, 0, 0], [9, 0, 0],
  ]);

  const random = repeaterStub("random", {
    count: property(3), seed: property(1),
    positionMin: property([0, 0, 0]), positionMax: property([10, 10, 10]),
    rotationMin: property([0, 0, 0]), rotationMax: property([0, 0, 0]),
    scaleMin: property([1, 1, 1]), scaleMax: property([1, 1, 1]),
  });
  const randomPoints = _test.repeaterPointPositions(random, 0);
  assert.equal(randomPoints.length, 3);
  assert.deepEqual(randomPoints[0], [0, 0, 0]);
  assert.notDeepEqual(randomPoints[1], randomPoints[2]);

  const echo = repeaterStub("echo", { count: property(4), delay: property(2) });
  assert.deepEqual(_test.repeaterPointPositions(echo, 10), [
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ]);

  const radialStub = repeaterStub("radial", {
    count: property(4), radius: property(100), plane: property(1),
    startAngle: property(0), sweep: property(TAU), align: property(0),
    rotationStep: property([0, 0, 0]), scaleEnd: property([1, 1, 1]),
  });
  near(_test.repeaterPointPositions(radialStub, 0)[1], [0, 0, 100]);

  const gridStub = repeaterStub("grid", {
    countX: property(3), countY: property(2), countZ: property(1),
    spacing: property([10, 20, 30]), centered: property(0),
  });
  assert.deepEqual(_test.repeaterPointPositions(gridStub, 0), [
    [0, 0, 0], [10, 0, 0], [20, 0, 0],
    [0, 20, 0], [10, 20, 0], [20, 20, 0],
  ]);
});

function fakeThree() {
  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.needsUpdate = false;
    }
  }
  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.disposed = false;
      this.range = [0, Infinity];
    }
    addAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
    setDrawRange(start, count) { this.range = [start, count]; }
    dispose() { this.disposed = true; }
  }
  class Matrix4 {
    copy(other) { this.elements = (other.elements || []).slice(); return this; }
  }
  class Points {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.parent = null;
      this.matrix = new Matrix4();
      this.matrixWorld = new Matrix4();
      this.layers = { mask: 0, set(bit) { this.mask = 1 << bit; } };
      this.disposed = false;
      this.onBeforeRender = null;
    }
    updateMatrix() {}
  }
  return {
    BufferAttribute,
    BufferGeometry,
    PointsMaterial: class { constructor(options) { Object.assign(this, options); this.disposed = false; } dispose() { this.disposed = true; } },
    Points,
    Matrix4,
  };
}

function installHarness() {
  const THREE = fakeThree();
  const previous = globalThis.CM;
  const scene = {
    children: [],
    add(object) { object.parent = this; this.children.push(object); },
    remove(object) {
      const index = this.children.indexOf(object);
      if (index >= 0) this.children.splice(index, 1);
      object.parent = null;
    },
  };
  const list = [];
  const listeners = new Set();
  list.onListChanged = {
    watch(fn) { listeners.add(fn); },
    unwatch(fn) { listeners.delete(fn); },
  };
  const refresh = () => { for (const fn of [...listeners]) fn(); };
  const projectListeners = new Set();
  const editor = {
    mainViewport: { threeObj: scene, helper3d: { objects: list } },
    playback: { currentFrame: 0 },
    onProjectChanged: {
      watch(fn) { projectListeners.add(fn); },
      unwatch(fn) { projectListeners.delete(fn); },
    },
  };
  globalThis.CM = editor;
  const dispose = _test.installRepeaterPoints(THREE, editor);
  return {
    THREE, scene, list, refresh, editor, dispose,
    listeners, projectListeners,
    restore() { dispose(); globalThis.CM = previous; },
  };
}

test("clone-position points appear only for one selected repeater and dispose", () => {
  const harness = installHarness();
  try {
    const { scene, list, refresh } = harness;
    const step = repeaterStub("step", {
      count: property(3), positionStep: property([10, 0, 0]),
      rotationStep: property([0, 0, 0]), scaleStep: property([1, 1, 1]),
    });
    step.threeObj = {
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] },
      parent: scene,
      updateMatrixWorld() {},
    };
    refresh();
    assert.equal(scene.children.length, 0);

    list.push(step);
    refresh();
    assert.equal(scene.children.length, 1);
    const points = scene.children[0];
    assert.equal(points.layers.mask, 2, "points stay on editor layer 1");
    assert.equal(points.geometry.range[1], 3);
    assert.equal(points.geometry.attributes.position.array[3], 10);
    assert.equal(points.material.sizeAttenuation, false);
    assert.equal(points.material.depthTest, false);
    assert.deepEqual(points.matrix.elements, step.threeObj.matrixWorld.elements);

    // A selected non-repeater hides them.
    list.push({ threeObj: { parent: scene } });
    refresh();
    assert.equal(scene.children.length, 0);
    assert.equal(points.geometry.disposed, true);
    assert.equal(points.material.disposed, true);
    list.pop();

    const grid = repeaterStub("grid", {
      countX: property(2), countY: property(2), countZ: property(1),
      spacing: property([5, 5, 5]), centered: property(1),
    });
    grid.threeObj = { matrixWorld: { elements: [] }, parent: scene, updateMatrixWorld() {} };
    list.pop();
    list.push(grid);
    refresh();
    assert.equal(scene.children.length, 1);
    const gridPoints = scene.children[0];
    assert.equal(gridPoints.geometry.range[1], 4);
    assert.deepEqual(Array.from(gridPoints.geometry.attributes.position.array.slice(0, 3)), [-2.5, -2.5, 0]);

    // Removing the selected repeater while it stays in the selection list
    // releases the overlay on its next update.
    grid.threeObj.parent = null;
    gridPoints.onBeforeRender();
    assert.equal(scene.children.length, 0);
    assert.equal(gridPoints.geometry.disposed, true);

    list.pop();
    refresh();
    assert.equal(harness.listeners.size, 1);
  } finally {
    harness.restore();
  }
});

test("clone-position points are released with the editor installation", () => {
  const harness = installHarness();
  const { scene, list, refresh, listeners, projectListeners } = harness;
  try {
    const step = repeaterStub("step", {
      count: property(2), positionStep: property([1, 0, 0]),
      rotationStep: property([0, 0, 0]), scaleStep: property([1, 1, 1]),
    });
    step.threeObj = { matrixWorld: { elements: [] }, parent: scene, updateMatrixWorld() {} };
    list.push(step);
    refresh();
    assert.equal(scene.children.length, 1);
    const points = scene.children[0];
    harness.dispose();
    assert.equal(scene.children.length, 0);
    assert.equal(points.geometry.disposed, true);
    assert.equal(listeners.size, 0);
    assert.equal(projectListeners.size, 0);
  } finally {
    globalThis.CM = undefined;
  }
});
