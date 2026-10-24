"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const createWorldPosition = require("../plugins/optical-flares/optflares-world.js");

// Translation-only matrices keep these operation counts independent of Three.
class Matrix {
  constructor() { this.elements = Array(16).fill(0); }
  compose(position) { this.elements[12] = position.x; return this; }
  equals(other) { return this.elements.every((value, index) => value === other.elements[index]); }
  copy(other) { this.elements = other.elements.slice(); return this; }
  multiplyMatrices(parent, local) {
    this.copy(local); this.elements[12] += parent.elements[12]; return this;
  }
}
function fixture() {
  let updates = 0;
  const node = (parent, x) => ({
    parent, position: { x }, matrixAutoUpdate: true,
    matrix: new Matrix().compose({ x }), matrixWorld: new Matrix(),
    updateMatrix() { updates++; this.matrix.compose(this.position); },
    updateMatrixWorld() { throw new Error("whole subtree refreshed"); },
  });
  const root = node(null, 1), group = node(root, 2), light = node(group, 3);
  root.matrixWorld.copy(root.matrix);
  group.matrixWorld.multiplyMatrices(root.matrixWorld, group.matrix);
  light.matrixWorld.multiplyMatrices(group.matrixWorld, light.matrix);
  return { world: createWorldPosition({ Matrix4: Matrix }), root, group, light, updates: () => updates };
}

test("ten parented flares and their under-quads reuse established world matrices", () => {
  const h = fixture();
  for (let i = 0; i < 20; i++) assert.deepEqual(h.world({ threeObj: h.light }, true), [6, 0, 0]);
  assert.equal(h.updates(), 0);
});

test("standalone evaluation updates the ancestor chain without visiting siblings", () => {
  const h = fixture();
  h.group.position.x = 10;
  assert.deepEqual(h.world({ threeObj: h.light }), [14, 0, 0]);
  assert.equal(h.updates(), 3);
});

test("render callbacks can edit parent transforms or explicit local matrices", () => {
  const h = fixture();
  h.group.position.x = 10;
  assert.deepEqual(h.world({ threeObj: h.light }, true), [14, 0, 0]);
  assert.equal(h.updates(), 2);
  h.group.matrixAutoUpdate = false;
  h.group.matrix.elements[12] = 20;
  h.group.matrixWorldNeedsUpdate = true;
  assert.deepEqual(h.world({ threeObj: h.light }, true), [24, 0, 0]);
  assert.equal(h.updates(), 3);
  assert.deepEqual(h.world({ threeObj: h.light }, true), [24, 0, 0]);
  assert.equal(h.updates(), 3);
});
