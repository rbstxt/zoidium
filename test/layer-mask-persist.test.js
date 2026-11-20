"use strict";
// Mask persistence: loaded project JSON populates the live layer field and
// the live field serializes back, including pen-added masks the manager's
// load-time retention would otherwise drop.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { FIELD } = require("../plugins/shape-plus/mask-model.js");
const { installMaskPersistence } = require("../plugins/shape-plus/mask-persist.js");

function mask(id = "m1") {
  return { id, kind: "path", mode: "add", feather: 0, opacity: 1, invert: 0,
    vertexIds: ["a", "b"], vertexModes: {},
    properties: { name: "Mask", enabled: 1, closed: 1,
      path: { animated: false, keyframes: [{ frame: 0, value: [0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0], tween: 1 }] } } };
}

function stub() {
  const calls = { loads: 0 };
  const PZ = { layer: { prototype: {
    load(data) { calls.loads++; this.type = data?.type; },
    toJSON() { return { type: this.type || 4 }; },
  } } };
  const native = [PZ.layer.prototype.load, PZ.layer.prototype.toJSON];
  const disposed = [];
  installMaskPersistence(PZ, cleanup => disposed.push(cleanup));
  return { PZ, calls, disposed, native };
}

test("loaded masks populate the live field and serialize back", () => {
  const { PZ } = stub();
  const layer = Object.create(PZ.layer.prototype);
  layer.load({ type: 4, [FIELD]: [mask()] });
  assert.deepEqual(layer[FIELD], [mask()]);
  layer[FIELD].push(mask("m2"));
  const json = layer.toJSON();
  assert.deepEqual(json[FIELD].map(m => m.id), ["m1", "m2"]);
});

test("missing or corrupt masks leave the layer alone", () => {
  const { PZ } = stub();
  const plain = Object.create(PZ.layer.prototype);
  plain.load({ type: 4 });
  assert.equal(plain[FIELD], undefined);
  assert.deepEqual(plain.toJSON(), { type: 4 });
  const corrupt = Object.create(PZ.layer.prototype);
  corrupt.load({ type: 4, [FIELD]: [{ id: "x", kind: "group" }] });
  assert.equal(corrupt[FIELD], undefined);
  corrupt[FIELD] = "garbage";
  assert.deepEqual(corrupt.toJSON(), { type: 4 });
});

test("disposal restores the native methods", () => {
  const { PZ, disposed, native } = stub();
  assert.notDeepEqual([PZ.layer.prototype.load, PZ.layer.prototype.toJSON], native);
  for (const cleanup of disposed) cleanup();
  assert.deepEqual([PZ.layer.prototype.load, PZ.layer.prototype.toJSON], native);
});

test("adjustment overrides load and save without calling the base layer", () => {
  function Layer() {}
  Layer.prototype.load = function () {};
  Layer.prototype.toJSON = function () { return { type: 0 }; };
  Layer.adjustment = function Adjustment() {};
  Layer.adjustment.prototype = Object.create(Layer.prototype);
  Layer.adjustment.prototype.load = function (data) { this.type = data.type; };
  Layer.adjustment.prototype.toJSON = function () { return { type: this.type }; };
  const cleanup = [];
  installMaskPersistence({ layer: Layer }, fn => cleanup.push(fn));
  const layer = new Layer.adjustment();
  layer.load({ type: 1, [FIELD]: [mask()] });
  assert.deepEqual(layer[FIELD], [mask()]);
  layer[FIELD].push(mask("m2"));
  assert.deepEqual(layer.toJSON()[FIELD].map(entry => entry.id), ["m1", "m2"]);
  cleanup.forEach(fn => fn());
  assert.equal(layer.toJSON()[FIELD], undefined);
});
