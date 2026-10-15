"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const geometry = require("../plugins/text-plus/text-plus-geometry.js");
const { state } = require("../plugins/text-plus/text-plus-utils.js");

class Vector {
  set(...value) { this.value = value; return this; }
}
class Node {
  constructor() { this.children = []; this.userData = {}; this.position = new Vector(); this.scale = new Vector(1, 1, 1); }
  add(node) { node.parent = this; this.children.push(node); }
  remove(node) { this.children.splice(this.children.indexOf(node), 1); node.parent = null; }
  clone() {
    const node = new this.constructor();
    node.userData = JSON.parse(JSON.stringify(this.userData));
    node.geometry = this.geometry;
    for (const child of this.children) node.add(child.clone());
    return node;
  }
}
class Mesh extends Node {
  constructor(g, material) { super(); this.geometry = g; this.material = material; }
}
class Geometry {
  constructor(shapes = []) {
    this.vertices = shapes.length ? [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }] : [];
  }
  computeBoundingBox() {
    this.boundingBox = this.vertices.length ? { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } } : null;
  }
  dispose() { this.disposed = true; }
}
function withText(run) {
  const old = state.THREE;
  state.THREE = { Geometry, ExtrudeGeometry: Geometry, Object3D: Node, Mesh, Vector3: Vector };
  // The legacy Font API fallback emits a shape for every non-space glyph.
  const font = { generateShapes: c => c.trim() ? [{}] : [] };
  const text = { threeObj: new Mesh(new Geometry([{}]), {}), font: { font3d: font },
    properties: { text: { get: () => "O O\nO" }, characterIndexOffset: { get: () => 9 }, characterCountOverride: { get: () => 20 } } };
  try { run(text); } finally {
    geometry.clearCharacterSplitRequests();
    geometry.restoreTextRendering(text);
    state.THREE = old;
  }
}

test("Text+ identity splitting has no saved parent and restores the same whole geometry after its last owner releases", () => {
  withText(text => {
    const whole = text.threeObj.geometry;
    geometry.syncTextRendering(text, 0);
    assert.equal(text.threeObj.geometry, whole);
    const a = geometry.requestCharacterSplit(text, {}), b = geometry.requestCharacterSplit(text, {});
    geometry.syncTextRendering(text, 0);
    assert.notEqual(text.threeObj.geometry, whole);
    assert.equal(text.parentObject, undefined);
    const entries = geometry.getSplitState(text).entries;
    assert.deepEqual(entries.map(entry => entry.anchor.userData.zoidiumTextPlusCharacter), [
      { index: 0, sourceIndex: 0, count: 4 }, { index: 1, sourceIndex: 1, count: 4 },
      { index: 2, sourceIndex: 2, count: 4 }, { index: 3, sourceIndex: 4, count: 4 },
    ]);
    assert.equal(entries[1].mesh, null, "spaces retain anchors and identity without render geometry");
    for (const entry of entries.filter(item => item.mesh)) {
      assert.deepEqual(entry.mesh.userData.zoidiumTextPlusCharacter, entry.anchor.userData.zoidiumTextPlusCharacter);
      assert.deepEqual(entry.mesh.clone().userData, entry.mesh.userData);
      assert.notEqual(entry.mesh.clone().userData.zoidiumTextPlusCharacter, entry.mesh.userData.zoidiumTextPlusCharacter);
    }
    a(); a();
    geometry.syncTextRendering(text, 45);
    assert.notEqual(text.threeObj.geometry, whole);
    b();
    assert.equal(text.threeObj.geometry, whole);
    assert.equal(whole.disposed, undefined);
    assert.equal(text.threeObj.children.length, 0);
    for (const entry of entries) {
      assert.equal(entry.anchor.userData.zoidiumTextPlusCharacter, undefined);
      if (entry.mesh) assert.equal(entry.mesh.userData.zoidiumTextPlusCharacter, undefined);
      if (entry.geometry) assert.equal(entry.geometry.disposed, true);
    }
  });
});

test("identity requests can be cleared on Text+ disposal and leave no later split", () => {
  withText(text => {
    const whole = text.threeObj.geometry;
    const release = geometry.requestCharacterSplit(text, {});
    geometry.syncTextRendering(text, 0);
    geometry.clearCharacterSplitRequests();
    geometry.restoreTextRendering(text);
    geometry.syncTextRendering(text, 179);
    assert.equal(text.threeObj.geometry, whole);
    release(); release();
    assert.equal(text.threeObj.children.length, 0);
  });
});

test("a stale request release cannot remove requests acquired after Text disposal", () => {
  withText(text => {
    const whole = text.threeObj.geometry;
    const old = geometry.requestCharacterSplit(text, {});
    geometry.clearCharacterSplitRequests(text);
    const current = geometry.requestCharacterSplit(text, {});
    old();
    geometry.syncTextRendering(text, 0);
    assert.notEqual(text.threeObj.geometry, whole);
    current();
    assert.equal(text.threeObj.geometry, whole);
  });
});
