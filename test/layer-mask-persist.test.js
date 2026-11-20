"use strict";
// Mask persistence: loaded project JSON populates the live layer field and
// the live field serializes back, including pen-added masks the manager's
// load-time retention would otherwise drop.
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FIELD } = require("../plugins/shape-plus/mask-model.js");
const { installMaskPersistence } = require("../plugins/shape-plus/mask-persist.js");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");

const cache = process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources");
const hasNativeTracks = ["three.r91.min.js", "core-1.0.102.js", "ui-1.0.72.js"]
  .every(file => fs.existsSync(path.join(cache, file)));

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

function trimFixture() {
  function Tracks() {}
  const native = Tracks.prototype.moveClip = function (edit) {
    this.observed = this.timeline.sequence.videoTracks[0].clips[0].object[FIELD];
    const { start, length } = clip;
    if (edit.start !== undefined) clip.start = edit.start;
    if (edit.length !== undefined) clip.length = edit.length;
    return { ...edit, start, length, offset: -edit.offset };
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
  const clip = { start: 12, length: 78, object: layer };
  const tracks = new Tracks();
  tracks.timeline = { sequence: { videoTracks: [{ clips: [clip] }] } };
  const cleanup = [];
  installMaskPersistence({ layer: { prototype: {} }, ui: { timeline: { tracks: Tracks } } }, fn => cleanup.push(fn));
  return { Tracks, tracks, clip, layer, before, native, cleanup };
}

test("native left trim shifts both mask key encodings with the clip history", () => {
  const { Tracks, tracks, layer, before, native, cleanup } = trimFixture();

  const undo = tracks.moveClip({ type: 0, oldTrackIdx: 0, oldIdx: 0, start: 17, length: 73, offset: -5 });
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

test("an end trim leaves mask frames alone, even if an edit carries an offset", () => {
  const { tracks, layer, before, clip } = trimFixture();
  const undo = tracks.moveClip({ type: 0, oldTrackIdx: 0, oldIdx: 0, start: 12, length: 70, offset: -8 });
  assert.equal(clip.length, 70);
  assert.deepEqual(layer[FIELD], before);
  const redo = tracks.moveClip(undo);
  assert.equal(clip.length, 78);
  assert.deepEqual(layer[FIELD], before);
  tracks.moveClip(redo);
  assert.equal(clip.length, 70);
  assert.deepEqual(layer[FIELD], before);
});

test("a whole move keeps mask keys clip-local even if a proxy offset matches its delta", () => {
  const { tracks, layer, before, clip } = trimFixture();
  const undo = tracks.moveClip({ type: 0, oldTrackIdx: 0, oldIdx: 0, start: 17, length: 78, offset: -5 });
  assert.equal(clip.start, 17);
  assert.deepEqual(layer[FIELD], before);
  const redo = tracks.moveClip(undo);
  assert.equal(clip.start, 12);
  assert.deepEqual(layer[FIELD], before);
  tracks.moveClip(redo);
  assert.equal(clip.start, 17);
  assert.deepEqual(layer[FIELD], before);
});

test("trimming both handles still pins mask keys when the source time moves with the start", () => {
  const { tracks, layer } = trimFixture();
  tracks.moveClip({
    type: 0, oldTrackIdx: 0, oldIdx: 0, start: 17, length: 78, offset: -5,
    timeStart: 5 / 30, timeEnd: 83 / 30,
  });
  assert.deepEqual(layer[FIELD][0].properties.path.keyframes.map(key => key.frame), [-5, 35]);
});

test("CM3 commits multiple trim proxies through moveClip and replays them together", { skip: !hasNativeTracks }, () => {
  const context = host();
  const { PZ } = context;
  const { project, clip } = fixture(context);
  const { sequence } = project;
  const editor = editorFor(PZ, project);
  const tracks = Object.create(PZ.ui.timeline.tracks.prototype);
  tracks.timeline = { sequence, editor, pxToFrame: pixels => pixels };
  tracks.updateSequenceLength = () => {};
  tracks.videoContainer = { children: [] };
  const cleanups = [];
  installMaskPersistence(PZ, fn => cleanups.push(fn));

  const clips = [clip];
  for (let index = 1; index < 3; index++) {
    const track = new PZ.track.video();
    sequence.videoTracks.push(track);
    const clip = new PZ.clip.video(6);
    track.clips.push(clip);
    clip.object.properties.load();
    clips.push(clip);
  }
  const proxies = clips.map((clip, index) => {
    clip.start = 12 + index * 10;
    clip.length = 78;
    clip.properties.load();
    clip.object[FIELD] = [mask()];
    const path = clip.object[FIELD][0].properties.path;
    path.keyframes[0].frame = 10;
    const proxy = {
      pz_offset: -5, style: { left: `${clip.start + 5}px`, width: "73px" },
      classList: { contains: name => name === "proxy" },
    };
    const parent = {
      pz_object: sequence.videoTracks[index],
      parentElement: tracks.videoContainer,
    };
    proxy.parentElement = parent;
    proxy.pz_clip = { pz_object: clip, parentElement: parent };
    parent.children = [proxy.pz_clip, proxy];
    tracks.videoContainer.children.push(parent);
    return proxy;
  });
  const read = () => clips.map(clip => {
    const local = clip.object[FIELD][0].properties.path.keyframes[0].frame;
    return [clip.start, clip.length, local, clip.start + local];
  });
  const before = [[12, 78, 10, 22], [22, 78, 10, 32], [32, 78, 10, 42]];
  const trimmed = [[17, 73, 5, 22], [27, 73, 5, 32], [37, 73, 5, 42]];
  editor.history.startOperation();
  tracks.moveClipProxies(proxies);
  editor.history.finishOperation();
  assert.deepEqual(read(), trimmed);
  assert.equal(editor.history.undoStack.length, 1);
  editor.history.undo();
  assert.deepEqual(read(), before);
  editor.history.redo();
  assert.deepEqual(read(), trimmed);
  cleanups.reverse().forEach(fn => fn());
});
