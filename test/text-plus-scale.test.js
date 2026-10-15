"use strict";

// Text scale compensation: the Text object's own scale applies to glyph
// geometry and layout positions, while per-character rotations happen in
// unscaled space.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;

/* ------------------------------------------------------- minimal 3D fakes */

const { makeTextObject, makeTransformLayer, characterMeshes, worldDepth, matricesClose, withFakeThree } = require("./text-scale-harness.js");

/* ------------------------------------------------------------------ tests */

test("Text scale is read from the animated scale property", () => {
  const animated = { get: (frame) => (frame < 10 ? [1, 2, 3] : [4, 5, 6]) };
  assert.deepEqual(_test.getSplitTextScale({ properties: { scale: animated } }, 3), [1, 2, 3]);
  assert.deepEqual(_test.getSplitTextScale({ properties: { scale: animated } }, 12), [4, 5, 6]);
  assert.deepEqual(_test.getSplitTextScale({ properties: {} }, 0), [1, 1, 1]);
  assert.deepEqual(_test.getSplitTextScale({}, 0), [1, 1, 1]);
});

test("Character offsets are scaled like layout positions", () => {
  assert.deepEqual(_test.scaleCharacterOffset([2, 3, 0], [5, -1, 7]), [10, -3, 0]);
  assert.deepEqual(_test.scaleCharacterOffset([-1, 1, 1], [5, 0, 0]), [-5, 0, 0]);
  assert.deepEqual(_test.scaleCharacterOffset(undefined, [5, 0, 0]), [5, 0, 0]);
});

test("Neutralizing captures the scale and restores it on dispose", () => {
  const scale = {
    x: 1, y: 1, z: 0,
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    },
  };
  const textObject = {
    properties: { scale: { get: () => [1, 1, 0] } },
    threeObj: { scale },
  };
  const splitState = {};
  assert.deepEqual(_test.neutralizeTextScale(textObject, splitState, 0), [1, 1, 0]);
  assert.deepEqual(splitState.textScale, [1, 1, 0]);
  assert.deepEqual([scale.x, scale.y, scale.z], [1, 1, 1]);
  _test.restoreTextScale(textObject, splitState);
  assert.deepEqual([scale.x, scale.y, scale.z], [1, 1, 0]);
  // Restoring without a captured scale leaves the mesh untouched.
  _test.restoreTextScale(textObject, {});
  assert.deepEqual([scale.x, scale.y, scale.z], [1, 1, 0]);
});

test("Character rotation applies in unscaled space for a flat text", () => {
  withFakeThree((THREE) => {
    const textObject = makeTextObject(THREE, { textScale: [1, 1, 0], text: "AB" });
    const layer = makeTransformLayer({ rotation: [Math.PI / 3, 0, 0] });
    const splitState = { entries: [], layers: [] };
    _test.neutralizeTextScale(textObject, splitState, 0);
    assert.deepEqual(
      [textObject.threeObj.scale.x, textObject.threeObj.scale.y, textObject.threeObj.scale.z],
      [1, 1, 1]
    );
    const geometry = require("../plugins/text-plus/text-plus-geometry.js");
    geometry.buildCharacterRendering(textObject, splitState, [layer]);
    geometry.updateCharacterRendering(textObject, splitState, [layer], 0);
    textObject.threeObj.updateMatrixWorld();
    const meshes = characterMeshes(textObject);
    assert.equal(meshes.length, 2);
    // The glyph geometry keeps its local extrusion; the Text scale flattens
    // it on the mesh, and the character rotation tilts it into depth.
    for (const mesh of meshes) {
      assert.deepEqual(
        [mesh.scale.x, mesh.scale.y, mesh.scale.z],
        [1, 1, 0]
      );
    }
    const box = { min: { x: 1.28, y: 0, z: 0 }, max: { x: 14.76, y: 24.72, z: 3 } };
    const depths = meshes.map((mesh) => worldDepth(THREE, mesh, box));
    for (const depth of depths) {
      assert.ok(depth > 20, `expected tilt depth, got ${depth}`);
    }
    // Without character rotation the flat text stays flat.
    const still = makeTextObject(THREE, { textScale: [1, 1, 0], text: "AB" });
    const plain = makeTransformLayer({ rotation: [0, 0, 0] });
    const stillState = { entries: [], layers: [] };
    _test.neutralizeTextScale(still, stillState, 0);
    geometry.buildCharacterRendering(still, stillState, [plain]);
    geometry.updateCharacterRendering(still, stillState, [plain], 0);
    still.threeObj.updateMatrixWorld();
    for (const mesh of characterMeshes(still)) {
      assert.ok(Math.abs(worldDepth(THREE, mesh, box)) < 1e-9);
    }
  });
});

test("Uniform Text scale renders exactly like the uncompensated tree", () => {
  withFakeThree((THREE) => {
    const textScale = [2, 2, 2];
    const rotation = [Math.PI / 3, 0.2, 0];
    const offset = [5, -3, 4];
    const charScale = [1.5, 0.5, 2];
    const textObject = makeTextObject(THREE, { textScale, text: "AB" });
    const layer = makeTransformLayer({ rotation, position: offset, scale: charScale });
    const splitState = { entries: [], layers: [] };
    _test.neutralizeTextScale(textObject, splitState, 0);
    const geometry = require("../plugins/text-plus/text-plus-geometry.js");
    geometry.buildCharacterRendering(textObject, splitState, [layer]);
    geometry.updateCharacterRendering(textObject, splitState, [layer], 0);
    textObject.threeObj.updateMatrixWorld();
    const meshes = characterMeshes(textObject);
    assert.equal(meshes.length, 2);

    // Old composition: parent scale first, then raw anchor, offset,
    // rotation, character scale and mesh offset.
    const entry = splitState.entries[0];
    const { x, y, center, centerOffset } = entry.layout;
    const anchor = [x + center[0] + centerOffset[0], y + center[1] + centerOffset[1], center[2] + centerOffset[2]];
    const compose = (position, rotationEuler, scale) => {
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotationEuler[0], rotationEuler[1], rotationEuler[2], "XYZ")
      );
      return matrix.compose(
        new THREE.Vector3(position[0], position[1], position[2]),
        quaternion,
        new THREE.Vector3(scale[0], scale[1], scale[2])
      );
    };
    const multiplyAll = (matrices) => matrices.reduce(
      (left, right) => new THREE.Matrix4().multiplyMatrices(left, right)
    );
    const oldWorld = multiplyAll([
      compose([0, 0, 0], [0, 0, 0], textScale),
      compose(anchor, [0, 0, 0], [1, 1, 1]),
      compose(offset, rotation, charScale),
      compose([-center[0], -center[1], -center[2]], [0, 0, 0], [1, 1, 1]),
    ]);
    assert.ok(
      matricesClose(meshes[0].matrixWorld.elements, oldWorld.elements),
      "uniform scale must match the legacy composition"
    );
  });
});

test("Non-uniform Text scale with rotation intentionally differs", () => {
  withFakeThree((THREE) => {
    const compose = (position, rotationEuler, scale) => {
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rotationEuler[0], rotationEuler[1], rotationEuler[2], "XYZ")
      );
      return matrix.compose(
        new THREE.Vector3(position[0], position[1], position[2]),
        quaternion,
        new THREE.Vector3(scale[0], scale[1], scale[2])
      );
    };
    // Legacy: parent scale applied after the character rotation flattens it.
    const legacy = new THREE.Matrix4().multiplyMatrices(
      compose([0, 0, 0], [0, 0, 0], [1, 1, 0]),
      compose([0, 0, 0], [Math.PI / 3, 0, 0], [1, 1, 1])
    );
    // Fixed: rotation applied in unscaled space, scale on the glyph.
    const fixed = new THREE.Matrix4().multiplyMatrices(
      compose([0, 0, 0], [Math.PI / 3, 0, 0], [1, 1, 1]),
      compose([0, 0, 0], [0, 0, 0], [1, 1, 0])
    );
    assert.ok(!matricesClose(legacy.elements, fixed.elements));
    const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 10, z: 0 } };
    assert.equal(worldDepth(THREE, { matrixWorld: legacy }, box), 0);
    assert.ok(worldDepth(THREE, { matrixWorld: fixed }, box) > 8);
  });
});

test("Direct character transform scales offsets but keeps rotation", () => {
  const node = {
    matrixAutoUpdate: false,
    position: { set(x, y, z) { this.value = [x, y, z]; } },
    scale: { set(x, y, z) { this.value = [x, y, z]; } },
    rotation: { set(x, y, z, order) { this.value = [x, y, z, order]; } },
    zoidiumTextPlusAxis: { set() {}, lengthSq: () => 0 },
  };
  const controls = {
    position: [5, -2, 3],
    scale: [2, 2, 2],
    rotation: [0.5, 0, 0],
    eulerOrder: "XYZ",
    pivot: "character",
    shakeAxis: [0, 0, 1],
    shake: 0,
  };
  _test.applyCharacterTransform(node, controls, {}, null, [2, 1, 0]);
  assert.deepEqual(node.position.value, [10, -2, 0]);
  assert.deepEqual(node.scale.value, [2, 2, 2]);
  assert.deepEqual(node.rotation.value, [0.5, 0, 0, "XYZ"]);
  assert.deepEqual(controls.position, [5, -2, 3]);
  assert.equal(node.matrixAutoUpdate, true);
});
