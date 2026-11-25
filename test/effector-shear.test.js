"use strict";

// Shear deformer: pure vertex offsets per axis pair, field weighting, the
// property round trip, Delay's vertex filter, and the unchanged Twist and Warp
// outputs.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const core = require("../plugins/scene-plus/effector-core.js");
const { createStageCache, evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const { _test } = require("../plugins/scene-plus/scene-plus.js");
const { nativeHost } = require("./expressions-plus-harness");

const projectRoot = path.resolve(__dirname, "..");
const RELATION = { identity: true };

function box() {
  return new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ]);
}

function closeTo(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);
}

function fnv(array) {
  const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  let hash = 2166136261 >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

test("Shear moves a box along Direction in proportion to the Axis coordinate", () => {
  for (const axis of [0, 1, 2]) for (const direction of [0, 1, 2]) {
    if (axis === direction) continue;
    const amount = 0.5, pivot = [0.25, -0.5, 1];
    const positions = box();
    const before = Float32Array.from(positions);
    core.shearPositions(positions, amount, axis, direction, pivot);
    for (let index = 0; index < positions.length; index += 3) {
      const expected = amount * (before[index + axis] - pivot[axis]);
      closeTo(positions[index + direction], before[index + direction] + expected,
        1e-6);
      for (const other of [0, 1, 2]) {
        if (other === direction) continue;
        assert.equal(positions[index + other], before[index + other], `axis ${axis} direction ${direction} keeps ${other}`);
      }
    }
  }
});

test("Shear with Direction equal to Axis stretches along that axis", () => {
  const positions = Float32Array.from([0, 0, 0, 2, 0, 0]);
  core.shearPositions(positions, 0.5, 0, 0, [0, 0, 0]);
  closeTo(positions[0], 0);
  closeTo(positions[3], 3);
});

test("Shear is an identity for zero amount, a zero field weight, and non-finite input", () => {
  const positions = box();
  const before = Array.from(positions);
  core.shearPositions(positions, 0, 0, 1, [0, 0, 0]);
  assert.deepEqual(Array.from(positions), before);
  const blocked = { type: 2, position: [1000, 0, 0], scale: [10, 10, 10], falloff: 0 };
  core.shearPositions(positions, 1, 0, 1, [0, 0, 0], blocked);
  assert.deepEqual(Array.from(positions), before, "a field weight of zero leaves every vertex");
  core.shearPositions(positions, Number.NaN, 0, 1, [0, 0, 0]);
  assert.deepEqual(Array.from(positions), before);
});

test("Shear saves and loads its properties and reproduces the same vertices", () => {
  const { PZ, THREE } = nativeHost();
  const Shear = _test.createShearClass(PZ, THREE);
  const original = new Shear();
  original.load({ type: "zoidium:repeater/shear", objects: [], properties: {} });
  original.properties.amount.set(0.5, 0);
  original.properties.axis.set(2);
  original.properties.direction.set(0);
  original.properties.pivot.set([1, 2, 3], 0);
  const saved = JSON.parse(JSON.stringify(original));
  assert.equal(saved.type, "zoidium:repeater/shear");

  const copy = new Shear();
  copy.load(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), saved, "the saved data round trips");
  assert.equal(copy.properties.amount.get(0), 0.5);
  assert.equal(copy.properties.axis.get(), 2);
  assert.equal(copy.properties.direction.get(), 0);
  assert.deepEqual(Array.from(copy.properties.pivot.get(0)), [1, 2, 3]);
  assert.equal(copy.defaultName, "Shear");

  const before = box();
  const expected = Float32Array.from(before);
  core.shearPositions(expected, 0.5, 2, 0, [1, 2, 3]);
  const actual = Float32Array.from(before);
  copy.deformPositions(actual, 0, {});
  assert.deepEqual(Array.from(actual), Array.from(expected));

  const command = copy.workerCommand(0);
  assert.equal(command.kind, "shear");
  assert.equal(command.amount, 0.5);
  assert.equal(command.axis, 2);
  assert.equal(command.direction, 0);
  assert.deepEqual(Array.from(command.pivot), [1, 2, 3]);
});

test("Shear is registered in the Effector menu with an object class", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "plugins/scene-plus/manifest.json"), "utf8"));
  const menu = manifest.objectTypes.flatMap(group => group.list || []);
  assert.ok(menu.some(entry => entry.type === "zoidium:repeater/shear" && entry.name === "Shear"));
  assert.ok(manifest.objectClasses.some(entry => entry.type === "zoidium:repeater/shear"));
  assert.equal(typeof _test.createShearClass, "function");
});

test("Delay over Shear uses the vertex filter and averages the sheared vertices", () => {
  const base = {
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 2, 2, 0]),
    count: 4,
    attributes: {},
    index: new Uint16Array([0, 2, 1, 1, 2, 3]),
    groups: [],
    smooth: false,
  };
  const shear = (amount) => ({ kind: "shear", relation: RELATION, amount, axis: 0, direction: 1,
    pivot: [0, 0, 0], field: { type: 0 } });
  const commands = [shear(0.4), { kind: "delay", relation: RELATION, mode: 1, strength: 1, window: 2,
    history: [[shear(0.1)], [shear(0.2)]] }];
  const result = evaluateMesh({ base, sourceId: "shear-delay", polygonCount: 1, commands }, createStageCache());

  const expected = Float32Array.from(base.positions);
  core.shearPositions(expected, 0.15, 0, 1, [0, 0, 0]);
  for (let index = 0; index < expected.length; index += 1) closeTo(result.positions[index], expected[index]);
});

test("Twist and Warp keep their published vertex outputs", () => {
  const twist = box();
  core.twistPositions(twist, Math.PI / 2, 1, 0.25);
  assert.equal(fnv(twist), "c109df01");
  const warp = box();
  core.warpPositions(warp, Math.PI / 3, 0, 0.1);
  assert.equal(fnv(warp), "c9a82959");
});
