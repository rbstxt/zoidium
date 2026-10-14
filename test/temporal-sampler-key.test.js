"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { frameSamplerInputKey: key } = require("../plugins/core/temporal-sampler.js");

// Unscoped keys serialize the whole sequence, cut before the sampler unless
// an expression, layer input or composition could read the cut effects.
function unscoped(h, value) {
  return value === key(h.sequence, h.root) || value.startsWith("effect-prefix");
}

function fixture() {
  const prefix = { type: "exposure", properties: { value: 1 } };
  const effect = { type: "echo", properties: { decay: 0.7 } };
  const suffix = { type: "negative", properties: { amount: 1 } };
  const layer = { type: 4, properties: { resolution: [80, 40] },
    objects: [{ type: 6, properties: { fov: 45 } }], effects: [prefix, effect, suffix],
    toJSON() { return { type: this.type, properties: this.properties, objects: this.objects, effects: this.effects }; } };
  const clip = { start: 0, length: 100, object: layer, properties: { time: [0, 100] },
    toJSON() { return { start: this.start, length: this.length, object: this.object, properties: this.properties, link: this.link }; } };
  const sequence = { properties: { rate: 30, resolution: [80, 40] }, videoTracks: [
    { enabled: true, clips: [clip] }, { enabled: true, clips: [{ object: { color: "red" } }] },
  ], parentProject: { assets: { list: { source: { url: "first", sha256: "a" } } } },
  toJSON() { return { properties: this.properties, videoTracks: this.videoTracks }; } };
  const root = { readBuffer: { width: 80, height: 40 } };
  const stage = { layer, clip, effect, effectIndex: 1, trackIndex: 0 };
  return { prefix, effect, suffix, layer, clip, sequence, root, stage, key: scope => key(sequence, root, stage, scope) };
}

test("scoped input keys omit the sampler and later effects, but keep all prefix operators", () => {
  const h = fixture(), original = h.key();
  assert.ok(original.includes("layer-prefix"));
  h.effect.properties.decay = 0.2;
  h.suffix.properties.amount = 0.5;
  assert.equal(h.key(), original);
  for (const type of ["exposure", "timeoffset", "posterizetime", "timedisplacement", "echo"]) {
    h.prefix.type = type;
    const before = h.key();
    h.prefix.properties.value++;
    assert.notEqual(h.key(), before, type);
  }
});

test("other tracks are omitted only for proven local inputs", () => {
  const h = fixture(), original = h.key();
  h.sequence.videoTracks[1].clips[0].object.color = "blue";
  h.sequence.videoTracks[1].enabled = false;
  assert.equal(h.key(), original);
  h.sequence.videoTracks[0].enabled = false;
  assert.notEqual(h.key(), original);
});

test("every serialized input change matters, including keys, graph controls, timing and settings", () => {
  for (const change of [
    h => { h.layer.properties.position = { keyframes: [{ frame: 2, value: 3, tween: 1 }] }; },
    h => { h.layer.objects[0].properties.fov++; },
    h => { h.clip.start++; }, h => { h.clip.length++; },
    h => { h.clip.properties.time[1]++; },
    h => { h.sequence.properties.rate = 60; },
    h => { h.sequence.properties.resolution[0]++; },
    h => { h.sequence.properties.background = "blue"; },
    h => { h.root.readBuffer.width++; },
    h => { h.root.__zoidiumRenderSettings = { mode: "contain", aspectRatio: [1, 1] }; },
    h => { h.root.renderer = { shadowMap: { type: 2 } }; },
    h => { h.root.renderer = { shadowMap: { enabled: true } }; },
    h => { h.sequence.parentProject.assets.list.source.url = "second"; },
    h => { h.sequence.parentProject.assets.list.source = { url: "first", sha256: "a" }; },
  ]) {
    const h = fixture(), before = h.key();
    change(h);
    assert.notEqual(h.key(), before, change.toString());
  }
});

test("unknown content, cross-layer reads, expressions and tracking use the whole-sequence key", () => {
  for (const change of [
    h => { h.layer.type = 1; }, h => { h.layer.type = 2; },
    h => { h.layer.type = "zoidium:future/layer"; },
    h => { h.layer.objects[0].type = "zoidium:future/object"; },
    h => { h.layer.objects[0].material = { type: "custom" }; },
    h => { h.prefix.type = "displacementmap"; },
    h => { h.layer.properties.position = { expression: "focusDistanceTo('other')" }; },
    h => { h.clip.properties.time = { expression: "time * 2" }; },
    h => { h.layer.properties.source = "track:id:other"; },
    h => { h.layer.properties.compId = "comp-1"; },
    h => { h.sequence.videoTracks[0].track3d = true; },
    h => { h.clip.link = [1, 2]; },
    h => { const serialize = h.layer.toJSON; h.layer.toJSON = function () { return { ...serialize.call(this), extra: true }; }; },
  ]) {
    const h = fixture(); change(h);
    assert.ok(unscoped(h, h.key()), change.toString());
    const before = h.key();
    h.sequence.videoTracks[1].clips[0].object.color = "blue";
    assert.notEqual(h.key(), before);
  }
  const h = fixture();
  assert.ok(unscoped(h, h.key({ effect: {}, trackIndex: 1 })));
});

test("whole-sequence keys still omit the sampler and later effects unless something reads them", () => {
  const h = fixture();
  h.layer.type = 1;
  const original = h.key();
  assert.ok(original.startsWith("effect-prefix"));
  h.effect.properties.decay = 0.2;
  h.suffix.properties.amount = 0.5;
  assert.equal(h.key(), original, "own and later effect edits keep the inputs");
  assert.equal(h.layer.toJSON().effects.length, 3, "the live serializer is restored");
  assert.equal(Object.prototype.hasOwnProperty.call(h.layer, "toJSON"), true);
  h.prefix.properties.value++;
  assert.notEqual(h.key(), original, "prefix edits invalidate");
  const prefixed = h.key();
  h.sequence.videoTracks[1].clips[0].object.color = "blue";
  assert.notEqual(h.key(), prefixed, "other tracks stay in the whole key");
  for (const read of [{ expression: "time" }, "track:id:other", { compId: "comp-1" }]) {
    const r = fixture();
    r.layer.type = 1;
    r.sequence.videoTracks[1].clips[0].object.source = read;
    const before = r.key();
    assert.equal(before, key(r.sequence, r.root), JSON.stringify(read));
    r.effect.properties.decay = 0.2;
    assert.notEqual(r.key(), before, "a reader of the cut effects keeps them in the key");
  }
});

test("undo returns the original exact content key", () => {
  const h = fixture(), original = h.key();
  h.layer.objects[0].properties.fov++;
  assert.notEqual(h.key(), original);
  h.layer.objects[0].properties.fov--;
  assert.equal(h.key(), original);
});

test("scoped preparation never serializes unrelated tracks or the sequence", () => {
  const h = fixture();
  h.sequence.toJSON = () => { throw new Error("whole sequence serialized"); };
  h.sequence.videoTracks[1].toJSON = () => { throw new Error("other track serialized"); };
  assert.ok(h.key().includes("layer-prefix"));
});

test("classification checks authored serializers and ignores producer-owned THREE materials", () => {
  const h = fixture();
  h.layer.objects = [{ type: 13, material: { type: "ShaderMaterial" },
    toJSON() { return { type: 13, properties: { brightness: 1 }, stack: [] }; } }];
  assert.ok(h.key().includes("layer-prefix"));
  h.layer.objects[0].toJSON = () => ({ type: "zoidium:unknown/object", properties: {} });
  assert.ok(unscoped(h, h.key()));
});

test("serializer-added expression and composition metadata trigger fallback", () => {
  for (const field of ["expression", "comp", "compId", "_zoidiumLayerInput", "_zoidiumSourceTrack"]) {
    const h = fixture();
    h.layer.properties.custom = { toJSON: () => ({ [field]: "external" }) };
    assert.equal(h.key(), key(h.sequence, h.root), field);
  }
});

test("native clip links coordinate edits without reading linked-track pixels", () => {
  const previous = global.PZ;
  class ClipLink { constructor(id) { this.id = id; } toJSON() { return this.id; } }
  global.PZ = { clipLink: ClipLink };
  try {
    const h = fixture();
    h.clip.link = new ClipLink(0);
    const original = h.key();
    assert.ok(original.includes("layer-prefix"));
    h.sequence.videoTracks[1].clips[0].object.color = "blue";
    assert.equal(h.key(), original);
    h.clip.link.id = 1;
    assert.notEqual(h.key(), original);
  } finally { if (previous === undefined) delete global.PZ; else global.PZ = previous; }
});
