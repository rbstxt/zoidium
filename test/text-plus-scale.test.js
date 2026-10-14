"use strict";

// Text scale compensation: the Text object's own scale applies to glyph
// geometry and layout positions, while per-character rotations happen in
// unscaled space.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const utils = require("../plugins/text-plus/text-plus-utils.js");
const { _test } = plugin;

/* ------------------------------------------------------- minimal 3D fakes */

function makeFakeThree() {
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }

    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
      return this;
    }

    lengthSq() {
      return this.x * this.x + this.y * this.y + this.z * this.z;
    }

    normalize() {
      const length = Math.sqrt(this.lengthSq()) || 1;
      this.x /= length;
      this.y /= length;
      this.z /= length;
      return this;
    }

    applyMatrix4(matrix) {
      const e = matrix.elements;
      const x = this.x, y = this.y, z = this.z;
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      const safe = w === 0 ? 1 : w;
      this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) / safe;
      this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) / safe;
      this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) / safe;
      return this;
    }
  }

  class Euler {
    constructor(x = 0, y = 0, z = 0, order = "XYZ") {
      this.x = x;
      this.y = y;
      this.z = z;
      this.order = order;
    }

    set(x, y, z, order = "XYZ") {
      this.x = x;
      this.y = y;
      this.z = z;
      this.order = order;
      return this;
    }
  }

  class Quaternion {
    constructor(x = 0, y = 0, z = 0, w = 1) {
      this.x = x;
      this.y = y;
      this.z = z;
      this.w = w;
    }

    setFromEuler(euler) {
      if (euler.order !== "XYZ") throw new Error("fake supports XYZ only");
      const cx = Math.cos(euler.x / 2), sx = Math.sin(euler.x / 2);
      const cy = Math.cos(euler.y / 2), sy = Math.sin(euler.y / 2);
      const cz = Math.cos(euler.z / 2), sz = Math.sin(euler.z / 2);
      this.x = sx * cy * cz + cx * sy * sz;
      this.y = cx * sy * cz - sx * cy * sz;
      this.z = cx * cy * sz - sx * sy * cz;
      this.w = cx * cy * cz + sx * sy * sz;
      return this;
    }

    setFromAxisAngle(axis, angle) {
      const half = angle / 2;
      const sine = Math.sin(half);
      this.x = axis.x * sine;
      this.y = axis.y * sine;
      this.z = axis.z * sine;
      this.w = Math.cos(half);
      return this;
    }

    multiply(other) {
      const x = this.x, y = this.y, z = this.z, w = this.w;
      this.x = w * other.x + x * other.w + y * other.z - z * other.y;
      this.y = w * other.y - x * other.z + y * other.w + z * other.x;
      this.z = w * other.z + x * other.y - y * other.x + z * other.w;
      this.w = w * other.w - x * other.x - y * other.y - z * other.z;
      return this;
    }
  }

  class Matrix4 {
    constructor() {
      this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }

    copy(source) {
      this.elements = source.elements.slice();
      return this;
    }

    makeTranslation(x, y, z) {
      this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
      return this;
    }

    compose(position, quaternion, scale) {
      const e = this.elements;
      const { x, y, z, w } = quaternion;
      const xx = x * x, yy = y * y, zz = z * z;
      const xy = x * y, xz = x * z, yz = y * z;
      const wx = w * x, wy = w * y, wz = w * z;
      e[0] = (1 - 2 * (yy + zz)) * scale.x;
      e[1] = (2 * (xy + wz)) * scale.x;
      e[2] = (2 * (xz - wy)) * scale.x;
      e[3] = 0;
      e[4] = (2 * (xy - wz)) * scale.y;
      e[5] = (1 - 2 * (xx + zz)) * scale.y;
      e[6] = (2 * (yz + wx)) * scale.y;
      e[7] = 0;
      e[8] = (2 * (xz + wy)) * scale.z;
      e[9] = (2 * (yz - wx)) * scale.z;
      e[10] = (1 - 2 * (xx + yy)) * scale.z;
      e[11] = 0;
      e[12] = position.x;
      e[13] = position.y;
      e[14] = position.z;
      e[15] = 1;
      return this;
    }

    multiplyMatrices(left, right) {
      const a = left.elements, b = right.elements, e = this.elements;
      const out = new Array(16);
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          out[column * 4 + row] =
            a[row] * b[column * 4] +
            a[4 + row] * b[column * 4 + 1] +
            a[8 + row] * b[column * 4 + 2] +
            a[12 + row] * b[column * 4 + 3];
        }
      }
      this.elements = out;
      return this;
    }

    multiply(other) {
      return this.multiplyMatrices(this, other);
    }

    premultiply(other) {
      return this.multiplyMatrices(other, this);
    }

    determinant() {
      const e = this.elements;
      const n11 = e[0], n12 = e[4], n13 = e[8], n14 = e[12];
      const n21 = e[1], n22 = e[5], n23 = e[9], n24 = e[13];
      const n31 = e[2], n32 = e[6], n33 = e[10], n34 = e[14];
      const n41 = e[3], n42 = e[7], n43 = e[11], n44 = e[15];
      return (
        n41 * (n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 +
          n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
        n42 * (n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 -
          n13 * n21 * n34 - n14 * n23 * n31 + n13 * n24 * n31) +
        n43 * (n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 +
          n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
        n44 * (-n13 * n22 * n31 - n11 * n23 * n32 - n12 * n21 * n33 +
          n11 * n22 * n33 + n13 * n21 * n32 + n12 * n23 * n31)
      );
    }

    getInverse(source) {
      const m = source.elements, e = this.elements;
      const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3];
      const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7];
      const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11];
      const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15];
      const t11 =
        n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 -
        n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
      const t12 =
        n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 +
        n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
      const t13 =
        n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 -
        n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
      const t14 =
        n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 +
        n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
      const determinant = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
      if (determinant === 0) throw new Error("singular matrix");
      const inverse = 1 / determinant;
      e[0] = t11 * inverse;
      e[1] =
        (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 +
          n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * inverse;
      e[2] =
        (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 -
          n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * inverse;
      e[3] =
        (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 +
          n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * inverse;
      e[4] = t12 * inverse;
      e[5] =
        (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 -
          n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * inverse;
      e[6] =
        (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 +
          n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * inverse;
      e[7] =
        (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 -
          n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * inverse;
      e[8] = t13 * inverse;
      e[9] =
        (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 +
          n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * inverse;
      e[10] =
        (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 -
          n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * inverse;
      e[11] =
        (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 +
          n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * inverse;
      e[12] = t14 * inverse;
      e[13] =
        (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 -
          n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * inverse;
      e[14] =
        (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 +
          n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * inverse;
      e[15] =
        (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 -
          n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * inverse;
      return this;
    }
  }

  class Object3D {
    constructor() {
      this.name = "";
      this.userData = {};
      this.position = new Vector3();
      this.rotation = new Euler();
      this.quaternion = new Quaternion();
      this.scale = new Vector3(1, 1, 1);
      this.matrix = new Matrix4();
      this.matrixWorld = new Matrix4();
      this.matrixAutoUpdate = true;
      this.matrixWorldNeedsUpdate = false;
      this.parent = null;
      this.children = [];
    }

    add(child) {
      if (child.parent) child.parent.remove(child);
      child.parent = this;
      this.children.push(child);
      return this;
    }

    remove(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      if (child.parent === this) child.parent = null;
      return this;
    }

    updateMatrix() {
      this.quaternion.setFromEuler(this.rotation);
      this.matrix.compose(this.position, this.quaternion, this.scale);
      return this;
    }

    updateMatrixWorld() {
      if (this.matrixAutoUpdate) this.updateMatrix();
      if (this.parent) {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      } else {
        this.matrixWorld.copy(this.matrix);
      }
      for (const child of this.children) child.updateMatrixWorld();
      return this;
    }

    traverse(callback) {
      callback(this);
      for (const child of this.children.slice()) child.traverse(callback);
    }
  }

  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.isMesh = true;
      this.geometry = geometry;
      this.material = material;
    }
  }

  const glyphBox = {
    min: { x: 1.28, y: 0, z: 0 },
    max: { x: 14.76, y: 24.72, z: 3 },
  };
  class ExtrudeGeometry {
    constructor() {
      this.boundingBox = {
        min: { ...glyphBox.min },
        max: { ...glyphBox.max },
      };
      this.attributes = { position: { count: 120 } };
    }

    computeBoundingBox() {}

    dispose() {}
  }

  class Geometry {}

  return { Vector3, Euler, Quaternion, Matrix4, Object3D, Mesh, ExtrudeGeometry, Geometry };
}

/* ------------------------------------------------------------- scene fakes */

const GLYPH_ADVANCE = 10;

function makeFontData() {
  const glyph = { ha: 500 };
  return {
    resolution: 1000,
    boundingBox: { yMax: 700, yMin: -200, underlineThickness: 100 },
    glyphs: { A: glyph, B: glyph, "?": glyph },
  };
}

function makeTextObject(THREE, { textScale, text }) {
  const property = (value) => ({ get: () => value });
  const sourceMesh = new THREE.Mesh(null, { name: "face" });
  sourceMesh.castShadow = false;
  sourceMesh.receiveShadow = false;
  sourceMesh.visible = true;
  const textObject = {
    properties: {
      text: property(text),
      size: property([20, 3]),
      detail: property(5),
      spacing: property(0),
      positionMode: property(0),
      scale: property(textScale),
      bevel: property(0),
      bevelSize: property([0.1, 0.5]),
      bevelSide: property(0),
      bevelProfile: property(1),
      bevelTension: property(0.5),
      bevelDetail: property(3),
    },
    font: { font3d: { data: makeFontData() } },
    threeObj: sourceMesh,
  };
  return textObject;
}

function makeTransformLayer({ rotation, position = [0, 0, 0], scale = [1, 1, 1], pivot = 0 } = {}) {
  const property = (value) => ({ get: () => value });
  return {
    zoidiumTextPlusMode: "character-transform",
    zoidiumTextPlusObject: true,
    threeObj: {},
    characterProperties: {
      charPosition: property(position),
      charScale: property(scale),
      charRotation: property(rotation),
      charEulerOrder: property("XYZ"),
      pivot: property(pivot),
      delayPerCharacter: property(0),
      delayOrder: property(0),
      randomSeed: property(1),
    },
  };
}

function characterMeshes(textObject) {
  const found = [];
  textObject.threeObj.traverse((node) => {
    if (node.isMesh && node.userData && node.userData.zoidiumTextPlusCharacter) {
      found.push(node);
    }
  });
  return found;
}

function worldDepth(THREE, mesh, box) {
  let minimum = Infinity, maximum = -Infinity;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).applyMatrix4(mesh.matrixWorld);
        minimum = Math.min(minimum, point.z);
        maximum = Math.max(maximum, point.z);
      }
    }
  }
  return maximum - minimum;
}

function matricesClose(left, right, epsilon = 1e-9) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]) < epsilon);
}

function withFakeThree(run) {
  const THREE = makeFakeThree();
  const previous = utils.state.THREE;
  utils.state.THREE = THREE;
  try {
    return run(THREE);
  } finally {
    utils.state.THREE = previous;
  }
}

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
