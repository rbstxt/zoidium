"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FrameStore, revisionOf, sizeMiB } = require("../plugins/core/output-frame-store.js");

function entry(bytes = 16, complete = true) {
  return { bytes, complete, released: 0, dispose() { this.released += 1; } };
}

test("finished output LRU counts all entries and releases evicted textures once", () => {
  const cache = new FrameStore(32), a = entry(), b = entry(), c = entry();
  cache.put("a", a); cache.put("b", b); cache.get("a"); cache.put("c", c);
  assert.equal(cache.bytes, 32);
  assert.equal(cache.get("b"), undefined);
  assert.equal(b.released, 1);
  cache.resize(16);
  assert.equal(a.released, 1);
  assert.equal(c.released, 0);
  cache.resize(0);
  assert.equal(c.released, 1);
  cache.clear();
  assert.equal(c.released, 1);
});

test("reserve evicts before allocation and rejects oversized frames", () => {
  const cache = new FrameStore(16), a = entry();
  cache.put("a", a);
  assert.equal(cache.reserve(32), false);
  assert.equal(a.released, 0);
  assert.equal(cache.reserve(16), true);
  assert.equal(cache.bytes, 0);
  assert.equal(a.released, 1);
});

test("unprepared and expired generations cannot store partial output", () => {
  const cache = new FrameStore(32), a = entry(16, false), b = entry();
  assert.equal(cache.put("a", a), false);
  const generation = cache.generation;
  cache.clear();
  assert.equal(cache.put("b", b, generation), false);
  assert.equal(a.released, 1);
  assert.equal(b.released, 1);
  assert.equal(cache.bytes, 0);
});

function scene() {
  const asset = { url: "blob:one", file: {}, sha256: "hash", size: 10 };
  const sequence = { videoTracks: [{ enabled: true, clips: [{ start: 0, length: 180,
    object: { properties: { position: { value: [0, 0], keys: [] }, text: "Hello" }, effects: [] } }] }],
    properties: { resolution: [1920, 1080], rate: 30 } };
  const project = { sequence, assets: { list: { one: asset } }, media: [] };
  const viewport = { editor: { project }, compositor: {}, renderer: {
    context: { drawingBufferWidth: 960, drawingBufferHeight: 540 }, shadowMap: { enabled: true, type: 1 },
  } };
  const ids = new WeakMap(); let next = 0;
  const id = o => {
    if (!o || typeof o !== "object") return o;
    if (!ids.has(o)) ids.set(o, ++next);
    return ids.get(o);
  };
  const plugins = [{ id: "native-fx", version: "10", enabled: true, phase: "enabled" }];
  const key = () => revisionOf(viewport, plugins, id, 0);
  return { sequence, viewport, project, plugins, asset, key };
}

// Every editing surface writes the serialized content. No notification or
// history label is used, so uncommitted scrubs and third-party edits count too.
const edits = {
  "property panel": s => { s.sequence.videoTracks[0].clips[0].object.properties.position.value[0] = 4; },
  "timeline drag": s => { s.sequence.videoTracks[0].clips[0].start = 12; },
  "keyframes": s => { s.sequence.videoTracks[0].clips[0].object.properties.position.keys.push({ frame: 30, value: [10, 0] }); },
  "graph editor": s => { s.sequence.videoTracks[0].clips[0].object.properties.position.expression = "time * 3"; },
  "plugin window": s => { s.sequence.videoTracks[0].clips[0].object.properties.text = "Updated"; },
  "effect insertion": s => { s.sequence.videoTracks[0].clips[0].object.effects.push({ type: "echo", properties: { count: 4 } }); },
  "track toggle": s => { s.sequence.videoTracks[0].enabled = false; },
  "asset replacement": s => { s.asset.file = {}; },
  "asset loading": s => { s.asset.url = "blob:two"; },
  "resolution": s => { s.sequence.properties.resolution = [1280, 720]; },
  "drawing buffer": s => { s.viewport.renderer.context.drawingBufferWidth = 800; },
  "aspect ratio": s => { s.viewport.compositor.__zoidiumRenderSettings = { mode: "contain" }; },
  "preview settings": s => { s.viewport.renderer.gammaOutput = true; },
  "plugin version": s => { s.plugins[0].version = "11"; },
  "plugin disable": s => { s.plugins[0].enabled = false; },
  "project open": s => { s.project.media.push({ name: "New asset" }); },
};
for (const [name, edit] of Object.entries(edits)) test("full output revision observes " + name, () => {
  const s = scene(), before = s.key(); edit(s); assert.notEqual(s.key(), before);
});

test("finished frame revisions distinguish shadow and temporal modes and undo", () => {
  const s = scene(), layer = s.sequence.videoTracks[0].clips[0].object;
  layer.zoidiumShadowMode = "current";
  layer.effects = [{ type: "echo", zoidiumTemporalMode: "current" }];
  const current = s.key();
  layer.zoidiumShadowMode = "legacy";
  const oldShadow = s.key();
  assert.notEqual(oldShadow, current);
  layer.effects[0].zoidiumTemporalMode = "legacy";
  const legacy = s.key();
  assert.notEqual(legacy, oldShadow);
  layer.effects[0].zoidiumTemporalMode = "current";
  assert.equal(s.key(), oldShadow);
  layer.zoidiumShadowMode = "current";
  assert.equal(s.key(), current);
});

test("undo/redo serializations return to exactly their former content key", () => {
  const s = scene(), before = s.key();
  edits["property panel"](s); const edited = s.key();
  s.sequence.videoTracks[0].clips[0].object.properties.position.value[0] = 0;
  assert.equal(s.key(), before);
  edits["property panel"](s); assert.equal(s.key(), edited);
});

test("font completion changes the key even without serialized edits", () => {
  const s = scene();
  assert.notEqual(revisionOf(s.viewport, s.plugins, () => 1, 0), revisionOf(s.viewport, s.plugins, () => 1, 1));
});

test("the size setting is clamped to 0..16384 MiB", () => {
  assert.equal(sizeMiB(0), 0); assert.equal(sizeMiB(-3), 0);
  assert.equal(sizeMiB(NaN), 512); assert.equal(sizeMiB(100000), 16384);
});


test("tiny frames also have a bounded entry count", () => {
  const cache = new FrameStore(100, 2), a = entry(4), b = entry(4), c = entry(4);
  cache.put("a", a); cache.put("b", b); cache.put("c", c);
  assert.equal(cache.entries.size, 2); assert.equal(a.released, 1);
});

test("round trip comparison ignores key order and retains array order", () => {
  const { canonicalJSON } = require("../plugins/core/output-frame-store.js");
  assert.equal(canonicalJSON({ x: 1, y: [2, 3] }), canonicalJSON({ y: [2, 3], x: 1 }));
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
});


test("private graph preserves native numeric and string clip link keys", () => {
  const { restoreLinkKeys } = require("../plugins/core/output-frame-store.js");
  const source = { clipLinks: { links: { 0: { key: 0 }, alpha: { key: "alpha" } } } };
  const target = { clipLinks: { links: { 0: { key: "0" }, alpha: { key: "alpha" } } } };
  restoreLinkKeys(source, target);
  assert.equal(target.clipLinks.links[0].key, 0);
  assert.equal(source.clipLinks.links[0].key, 0);
  assert.equal(target.clipLinks.links.alpha.key, "alpha");
});


test("unknown required plugins and unverified versions fail closed", () => {
  const s = scene(); s.project.plugins = [{ id: "native-fx" }];
  const approved = new Map([["native-fx", "10"]]);
  assert.ok(revisionOf(s.viewport, s.plugins, () => 1, 0, approved));
  s.plugins[0].version = "11";
  assert.equal(revisionOf(s.viewport, s.plugins, () => 1, 0, approved), null);
  s.project.plugins = [{ id: "other" }];
  assert.equal(revisionOf(s.viewport, s.plugins, () => 1, 0, approved), null);
});


test("native font completion invalidates output without a property edit", () => {
  const { assetsComplete } = require("../plugins/core/output-frame-store.js");
  const s = scene(), data = { zoidiumFont3dState: "loading" };
  s.asset.data = new Map([["font", data]]);
  const pending = s.key(); assert.equal(assetsComplete(s.project), false);
  data.zoidiumFont3dState = "ready"; data.font3d = {};
  assert.notEqual(s.key(), pending); assert.equal(assetsComplete(s.project), true);
  data.zoidiumFont3dState = "failed"; assert.equal(assetsComplete(s.project), false);
});

test("incomplete and failed image loads cannot become retained output", () => {
  const { assetsComplete } = require("../plugins/core/output-frame-store.js");
  const s = scene(), image = { tagName: "IMG", complete: false, naturalWidth: 0 };
  s.asset.data = new Map([["image", { el: image }]]);
  const pending = s.key(); assert.equal(assetsComplete(s.project), false);
  image.complete = true; assert.equal(assetsComplete(s.project), false);
  image.naturalWidth = 100; assert.equal(assetsComplete(s.project), true);
  assert.notEqual(s.key(), pending);
});

test("playing, seeking, unready or differently decoded videos fail the completeness gate", () => {
  const { decoderComplete } = require("../plugins/core/output-frame-store.js");
  const s = { lastFrame: 30, currentItem: { start: 0, media: {} },
    el: { paused: true, seeking: false, readyState: 2, currentTime: 1, src: "blob:video" },
    __zoidiumVideoExportState: { sourceId: "blob:video", requestedTime: 1 } };
  assert.equal(decoderComplete(s), true);
  assert.equal(decoderComplete({ ...s, el: { ...s.el, currentTime: 1.333333 },
    __zoidiumVideoExportState: { sourceId: "blob:video", requestedTime: 40 / 30 } }), true);
  for (const change of [{ paused: false }, { seeking: true }, { readyState: 1 }, { currentTime: 0.5 }]) {
    assert.equal(decoderComplete({ ...s, el: { ...s.el, ...change } }), false);
  }
  assert.equal(decoderComplete({ ...s, __zoidiumVideoExportState: null }), false);
  assert.equal(decoderComplete({ ...s, lastFrame: -1 }), true, "padding preload is not an active input");
});

test("track visibility is keyed even when the host serializer omits it", () => {
  const s = scene();
  s.sequence.toJSON = function () { return { properties: this.properties, clips: this.videoTracks[0].clips }; };
  const before = s.key(); s.sequence.videoTracks[0].enabled = false;
  assert.notEqual(s.key(), before);
});


test("the raised byte and entry limits retain more than 512 frames", () => {
  const cache = new FrameStore(16384 * 1024 * 1024);
  for (let i = 0; i < 8193; i++) cache.put(i, entry(4));
  assert.equal(cache.entries.size, 8192);
  assert.equal(cache.get(0), undefined);
  assert.ok(cache.get(8192));
  assert.equal(cache.bytes, 8192 * 4);
});

test("memory pressure evicts at least ten percent and cannot be reset by preferences or clear", () => {
  const cache = new FrameStore(1000);
  const frames = Array.from({ length: 10 }, () => entry(100));
  frames.forEach((frame, i) => cache.put(i, frame));
  assert.equal(cache.memoryPressure(), 1000);
  assert.equal(cache.effectiveLimit, 900);
  assert.equal(cache.bytes, 900);
  assert.equal(frames[0].released, 1);
  cache.clear(); cache.resize(2000);
  assert.equal(cache.effectiveLimit, 900);
  cache.resize(500);
  assert.equal(cache.effectiveLimit, 500);
  cache.resize(2000);
  assert.equal(cache.effectiveLimit, 900);
  cache.put("large", entry(901));
  assert.equal(cache.entries.size, 0);
});

test("context loss drops dead textures without disposal and bounds recovery", () => {
  const cache = new FrameStore(1000), frames = [entry(100), entry(100)];
  frames.forEach((frame, i) => cache.put(i, frame));
  const generation = cache.generation;
  cache.loseContext();
  assert.equal(cache.bytes, 0);
  assert.equal(cache.entries.size, 0);
  assert.deepEqual(frames.map(f => f.released), [0, 0]);
  assert.equal(cache.reserve(1), false);
  assert.equal(cache.put("late", frames[0], generation), false);
  assert.equal(frames[0].released, 0);
  cache.loseContext(); // The event and isContextLost() can describe one loss.
  cache.restoreContext();
  assert.equal(cache.effectiveLimit, 100);
  assert.equal(cache.put("recovered", entry(100)), true);
  cache.loseContext(); cache.restoreContext(); cache.clear(); cache.resize(10000);
  assert.equal(cache.effectiveLimit, 0);
  assert.equal(cache.reserve(1), false);
});

test("failure with no retained frames disables optional allocations for the session", () => {
  const cache = new FrameStore();
  cache.memoryPressure(); cache.resize(16384 * 1024 * 1024);
  assert.equal(cache.reserve(16), false);
});

test("large preferences preserve the default and enforce the byte limit before allocation", () => {
  const MiB = 1024 * 1024, cache = new FrameStore();
  assert.equal(cache.limit, 512 * MiB);
  assert.equal(cache.maxEntries, 8192);
  cache.resize(sizeMiB(16384) * MiB);
  const a = entry(8192 * MiB), b = entry(8192 * MiB);
  assert.equal(cache.put("a", a), true);
  assert.equal(cache.put("b", b), true);
  assert.equal(cache.bytes, 16384 * MiB);
  assert.equal(cache.reserve(1), true);
  assert.equal(a.released, 1);
  assert.equal(cache.bytes, 8192 * MiB);
  assert.equal(cache.reserve(16384 * MiB + 1), false);
  assert.equal(b.released, 0);
});

test("an evicted target transfers ownership only after a complete fresh capture", () => {
  const cache = new FrameStore(32), a = entry(), b = entry();
  cache.put("a", a); cache.put("b", b); cache.get("a");
  const reservation = cache.take(16, () => true);
  assert.equal(reservation.recycled, b);
  assert.equal(cache.entries.has("b"), false);
  assert.equal(b.complete, false);
  assert.equal(cache.bytes, 16);
  assert.equal(b.released, 0);
  assert.equal(cache.put("c", b), false);
  assert.equal(b.released, 1);
});

for (const field of ["renderer", "width", "height", "format", "type"]) {
  test("incompatible recycled " + field + " is disposed before allocation", () => {
    const cache = new FrameStore(16), a = entry();
    const expected = { renderer: {}, width: 2, height: 2, format: "RGBA", type: "byte" };
    Object.assign(a, expected);
    a[field] = field === "renderer" ? {} : "different";
    cache.put("a", a);
    const reservation = cache.take(16, value => Object.keys(expected).every(key => value[key] === expected[key]));
    assert.equal(reservation.recycled, null);
    assert.equal(a.released, 1);
  });
}

test("a recycled target from an expired generation cannot be published", () => {
  const cache = new FrameStore(16), a = entry();
  cache.put("a", a);
  const generation = cache.generation;
  const { recycled } = cache.take(16, () => true);
  cache.clear();
  recycled.complete = true;
  assert.equal(cache.put("new", recycled, generation), false);
  assert.equal(a.released, 1);
  assert.equal(cache.entries.size, 0);
});


test("community data never enters finished-frame or private prefetch approval", () => {
  const s = scene();
  assert.equal(typeof s.key(), "string");
  s.sequence.videoTracks[0].clips[0].object.effects.push({ type: "community-" + "a".repeat(32) + "-fx-gain" });
  assert.equal(s.key(), null);
});


test("video prefetch excludes only decode windows in projects without temporal sampling", () => {
  const { videoPrefetchBlocked } = require("../plugins/core/output-frame-store.js");
  const sequence = { properties: { motionBlur: { get: () => 0 } }, videoSchedules: [
    { padding: 60, items: [{ start: 300, length: 30, media: {} }] },
  ] };
  for (const frame of [0, 1, 150, 239, 330, 400]) assert.equal(videoPrefetchBlocked(sequence, frame, false), false, "frame " + frame);
  for (const frame of [240, 299, 300, 329]) assert.equal(videoPrefetchBlocked(sequence, frame, false), true, "frame " + frame);
  assert.equal(videoPrefetchBlocked(sequence, 0, true), true, "samplers can request distant video frames");
  sequence.properties.motionBlur.get = () => 1;
  assert.equal(videoPrefetchBlocked(sequence, 330, false), true, "motion blur can sample across boundaries");
  sequence.videoSchedules[0].items[0].media = null;
  assert.equal(videoPrefetchBlocked(sequence, 300, true), false, "procedural items have no decoder");
});

test("unknown video schedule bounds never enable private decoding", () => {
  const { videoPrefetchBlocked } = require("../plugins/core/output-frame-store.js");
  for (const item of [{ media: {} }, { start: NaN, length: 20, media: {} }, { start: 300, length: -1, media: {} }]) {
    assert.equal(videoPrefetchBlocked({ videoSchedules: [{ padding: 60, items: [item] }] }, 0, false), true);
  }
  assert.equal(videoPrefetchBlocked({ videoSchedules: [{ items: [{ start: 300, length: 30, media: {} }] }] }, 0, false), true);
});
