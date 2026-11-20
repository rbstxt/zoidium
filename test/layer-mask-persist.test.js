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

test("nullish clip edits reach the native method", () => {
  class Tracks {
    moveClip() { return "native fallback"; }
  }
  installMaskPersistence({ layer: { prototype: {} }, ui: { timeline: { tracks: Tracks } } }, () => {});
  const tracks = new Tracks();
  assert.equal(tracks.moveClip(null), "native fallback");
  assert.equal(tracks.moveClip(), "native fallback");
});

test("native left trim shifts both mask key encodings with the clip history", () => {
  function Tracks() {}
  const native = Tracks.prototype.moveClip = function (edit) {
    this.observed = this.timeline.sequence.videoTracks[0].clips[0].object[FIELD];
    return { ...edit, offset: -edit.offset };
  };
  const layer = { [FIELD]: [mask(), mask("m2")] };
  const grouped = layer[FIELD][0].properties.path;
  grouped.animated = true;
  grouped.keyframes.push({ ...grouped.keyframes[0], frame: 40, tween: 3 });
  layer[FIELD][1].properties.path = {
    objects: grouped.keyframes[0].value.map(value => ({ animated: true,
      keyframes: [{ frame: 2, value, tween: 1 }, { frame: 34, value, tween: 3 }] })),
  };
  layer[FIELD][1].locked = true;
  const before = JSON.parse(JSON.stringify(layer[FIELD]));
  const tracks = new Tracks();
  tracks.timeline = { sequence: { videoTracks: [{ clips: [{ object: layer }] }] } };
  const cleanup = [];
  installMaskPersistence({ layer: { prototype: {} }, ui: { timeline: { tracks: Tracks } } }, fn => cleanup.push(fn));

  const undo = tracks.moveClip({ type: 0, oldTrackIdx: 0, oldIdx: 0, offset: -5 });
  assert.equal(tracks.observed, layer[FIELD]);
  assert.deepEqual(tracks.observed[0].properties.path.keyframes.map(key => key.frame), [-5, 35]);
  assert.deepEqual(tracks.observed[1].properties.path.objects[0].keyframes.map(key => key.frame), [-3, 29]);
  assert.equal(tracks.observed[1].properties.path.objects[0].keyframes[1].tween, 3);
  assert.equal(tracks.observed[1].locked, true);
  const redo = tracks.moveClip(undo);
  assert.deepEqual(layer[FIELD], before);
  tracks.moveClip(redo);
  assert.deepEqual(layer[FIELD][0].properties.path.keyframes.map(key => key.frame), [-5, 35]);
  cleanup.reverse().forEach(fn => fn());
  assert.equal(Tracks.prototype.moveClip, native);
});
