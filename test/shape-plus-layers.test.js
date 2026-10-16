"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { loadManager } = require("./plugin-manager-overlays.test");
const TYPE = "zoidium:shape-plus/shape-layer";
function host() {
  class Layer { load() {} unload() {} }
  Layer.create = type => { if (typeof type === "number" && type > 8) throw Error("unknown"); return Object.assign(new Layer(), { type }); };
  const picker = [{ type: 6, name: "Shape" }];
  const sandbox = { PZ: { layer: Layer, ui: { objectTypes: { get: () => picker } } }, console };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-apis.js", "utf8"), sandbox);
  return { ...sandbox, picker, apis: sandbox.ZoidiumPluginApis };
}
test("namespaced layer factories and pickers dispose independently; Camera 9 stays numeric", () => {
  const h = host(), original = h.PZ.layer.create;
  const remove = h.apis.layers.registerType({ id: "shape-plus/layer", type: TYPE, factory: () => new h.PZ.layer() });
  const camera = h.apis.layers.registerType({ id: "camera-plus/camera", type: 9, legacyType: 9, factory: () => new h.PZ.layer() });
  const picker = h.apis.layers.registerPicker({ type: TYPE, name: "Shape+" });
  assert.equal(h.PZ.layer.create(TYPE).type, TYPE);
  assert.equal(h.PZ.layer.create(9).type, 9);
  assert.throws(() => h.apis.layers.registerType({ id: "x", type: TYPE, factory() {} }), /collision/);
  assert.throws(() => h.apis.layers.registerType({ id: "x", type: 6, legacyType: 6, factory() {} }), /collision/);
  remove(); remove(); picker(); picker();
  assert.equal(h.PZ.layer.create(9).type, 9);
  assert.equal(h.picker.length, 1);
  camera();
  assert.equal(h.PZ.layer.create, original);
});
test("unknown namespaced layer payload survives exact JSON bytes and hydrates on enable", async () => {
  const { sandbox, manager: m } = loadManager(), h = host();
  sandbox.PZ = h.PZ;
  m.installNumericFallbacks();
  const payload = { type: TYPE, schemaVersion: 1, renderVersion: 1, properties: { name: "Shape+", unknown: [0, null, "abc"] }, effects: [], contents: [{ kind: "path", id: "p", extra: { z: 3, a: 2 } }], future: { value: 1 } };
  const bytes = JSON.stringify(payload);
  const layer = h.PZ.layer.create(TYPE), track = { layer }, clip = { children: [layer], object: layer, parent: { parent: track } };
  layer.parent = clip;
  await layer.load(payload);
  payload.future.value = 9;
  assert.equal(JSON.stringify(layer), bytes);
  const release = h.apis.layers.registerType({ id: "shape-plus/layer", type: TYPE, factory: () => {
    const result = new h.PZ.layer(); result.load = data => { result.saved = data; }; return result;
  } });
  await m.restoreMissingNumericLayers("shape-plus");
  assert.equal(clip.object.type, TYPE);
  assert.equal(JSON.stringify(clip.object.saved), bytes);
  assert.equal(track.layer, clip.object);
  assert.equal(m.missingNumericLayers.size, 0);
  release();
});
