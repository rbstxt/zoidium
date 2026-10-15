"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../plugins/scene-plus/scene-field-edit-math.js");
const { rotateXYZ } = require("../plugins/scene-plus/effector-core.js");
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function near(actual, expected) {
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-8, `${actual} != ${expected}`));
}

test("view plane unprojection respects the rendered camera and canvas offset", () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  const camera = identity.slice(); camera[12] = 20; camera[13] = -3; camera[14] = 10;
  near(math.viewPlanePoint([400, 100], rect, camera, identity, [0, 0, 5], [0, 0, 1]), [20.5, -2.5, 5]);
  assert.equal(math.viewPlanePoint([400, 100], rect, camera, identity, [0, 0, 5], [1, 0, 0]), null);
  assert.equal(math.viewPlanePoint([400, 100], { ...rect, width: 0 }, camera, identity, [0, 0, 5], [0, 0, 1]), null);
});

test("perspective rays intersect a plane at the field depth", () => {
  // Inverse of a perspective projection with near 1, far 100, fov 90.
  const inverse = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, -0.495, 0, 0, -1, 0.505];
  const rect = { left: 0, top: 0, width: 200, height: 200 };
  near(math.viewPlanePoint([150, 75], rect, identity, inverse, [0, 0, -10], [0, 0, 1]), [5, 2.5, -10]);
});

test("world view-plane motion becomes effector-local motion under rotated nonuniform scale", () => {
  const world = [0, 2, 0, 0, -3, 0, 0, 0, 0, 0, 4, 0, 80, -30, 20, 1];
  near(math.localDelta([80, -30, 20], [74, -22, 32], world), [4, 2, 3]);
  near(math.localViewAxis([0, 0, 1], world), [0, 0, 1]);
  assert.equal(math.localDelta([0, 0, 0], [1, 1, 1], new Array(16).fill(0)), null);
});

test("screen rotation wraps across the angle boundary without a full turn", () => {
  assert.ok(Math.abs(math.screenAngle([-100, 1], [-100, -1], [0, 0])) < 0.03);
  assert.equal(math.screenAngle([0, 0], [100, 0], [0, 0]), 0);
  assert.ok(Math.abs(math.screenAngle([100, 0], [0, -100], [0, 0]) - Math.PI / 2) < 1e-10);
});

test("field rotation composes the view-axis turn with existing XYZ degree properties", () => {
  near(math.rotateField([400, -270, 720], [0, 0, 1], 0), [400, -270, 720]);
  near(math.rotateField([0, 0, 0], [0, 0, 1], Math.PI / 2), [0, 0, 90]);
  const original = [25, 40, -15], rotated = math.rotateField(original, [0, 0, 1], Math.PI / 3);
  for (const point of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    near(rotateXYZ(point, rotated), rotateXYZ(rotateXYZ(point, original), [0, 0, 60]));
  }
  const singular = math.rotateField([0, 90, 20], [0, 0, 1], 0.3);
  near(rotateXYZ([1, 1, 1], singular), rotateXYZ(rotateXYZ([1, 1, 1], [0, 90, 20]), [0, 0, 0.3 * 180 / Math.PI]));
});

test("resize preserves axis ratios, remains positive, and is reversible", () => {
  const initial = [100, 50, 25], grown = math.resizeField(initial, [30, -20]);
  near(math.resizeField(grown, [-30, 20]), initial);
  assert.equal(grown[0] / grown[1], 2);
  near(math.resizeField(initial, [-1e6, 0]), [0.01, 0.01, 0.01]);
});

test("editor installation restores its native property renderer and every listener on disposal", () => {
  const { installFieldEdit } = require("../plugins/scene-plus/scene-field-edit.js");
  const previous = { CM: globalThis.CM, ui: globalThis.ZoidiumUI };
  function surface() {
    const listeners = new Set();
    return { listeners, style: {}, addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } };
  }
  function observable() {
    const listeners = new Set();
    return { listeners, watch(fn) { listeners.add(fn); }, unwatch(fn) { listeners.delete(fn); } };
  }
  const canvas = surface(), document = surface(), window = surface();
  canvas.ownerDocument = document; document.defaultView = window;
  const list = []; list.onListChanged = observable();
  const viewport = { renderMode: true, canvas, helper3d: { objects: list }, onEditChanged: observable() };
  const editor = { history: { operation: null }, mainViewport: viewport, onProjectChanged: observable() };
  const originalInput = () => {};
  const PZ = { ui: { controls: { generateInput3: originalInput }, properties: class {} } };
  try {
    globalThis.CM = editor; globalThis.ZoidiumUI = { controls: {} };
    const installed = installFieldEdit(PZ, {});
    assert.notEqual(PZ.ui.controls.generateInput3, originalInput);
    assert.equal(canvas.listeners.size, 1);
    assert.equal(installed.isEditing(null), false);
    // An ordinary canvas drag with no selected object follows the native path.
    assert.doesNotThrow(() => [...canvas.listeners][0]({ button: 0, target: canvas,
      preventDefault() { assert.fail("inactive field editing consumed a native drag"); } }));
    assert.equal(document.listeners.size, 3);
    assert.equal(window.listeners.size, 1);
    assert.equal(list.onListChanged.listeners.size, 1);
    installed.dispose(); installed.dispose();
    assert.equal(PZ.ui.controls.generateInput3, originalInput);
    for (const item of [canvas, document, window, list.onListChanged, viewport.onEditChanged, editor.onProjectChanged]) assert.equal(item.listeners.size, 0);
  } finally { globalThis.CM = previous.CM; globalThis.ZoidiumUI = previous.ui; }
});
