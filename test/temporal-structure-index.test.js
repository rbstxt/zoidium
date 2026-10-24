"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function host(count = 1, signals = true) {
  class Observable { update() {} }
  const list = items => Object.assign(items, signals ? { onListChanged: new Observable() } : {});
  class Layer {
    constructor() { this.effects = list([]); }
    tryGetParentOfType() { return this.clip; }
  }
  Layer.composite = class extends Layer { constructor() { super(); this.objects = list([]); } };
  Layer.adjustment = class extends Layer {};
  const sequence = { properties: { rate: { get: () => 30 } }, parentProject: { ui: { onChanged: new Observable() } } };
  let reads = 0;
  function track(layer = new Layer(), start = 0) {
    const clip = { start, length: 100, object: layer };
    layer.clip = clip;
    return { layer, enabled: true, clips: list([clip]) };
  }
  const tracks = list(Array.from({ length: count }, () => track()));
  sequence.videoTracks = new Proxy(tracks, { get(target, key) {
    if (/^\d+$/.test(String(key))) reads++;
    return Reflect.get(target, key);
  } });
  const documentEvents = new Map();
  const sandbox = { console, PZ: { observable: Observable, layer: Layer },
    document: { addEventListener: (name, fn) => { const callbacks = documentEvents.get(name) || []; callbacks.push(fn); documentEvents.set(name, callbacks); } } };
  vm.createContext(sandbox);
  for (const part of ["math", "layers"]) {
    vm.runInContext(fs.readFileSync(`plugins/core/temporal-${part}.js`, "utf8"), sandbox);
  }
  const api = sandbox.__zoidiumTemporalParts.layers;
  const operator = (offset = 5) => ({ _zoidiumTemporal: { getOperator: (_effect, frame) =>
    ({ kind: "time-offset", offsetFrames: typeof offset === "function" ? offset(frame) : offset }) } });
  return { api, PZ: sandbox.PZ, sequence, tracks, track, Layer, list, operator, documentEvents,
    reads: () => reads, reset: () => { reads = 0; } };
}

test("420 ordinary tracks avoid quadratic mapping reads after the structural scan", () => {
  const h = host(420);
  h.api.usesSingleEvaluation(h.sequence);
  h.reset();
  for (let hook = 0; hook < 2; hook++) for (const track of h.tracks) {
    assert.equal(h.api.getTemporalLayerFrame(track.layer, 13, h.sequence), null);
  }
  assert.equal(h.reads(), 0);
});

test("schedule flags do not walk inactive clips again", () => {
  const h = host(420);
  h.tracks[419].layer.effects.push(h.operator());
  assert.equal(h.api.usesSingleEvaluation(h.sequence), true);
  h.reset();
  for (let i = 0; i < 420; i++) assert.equal(h.api.usesSingleEvaluation(h.sequence), true);
  assert.equal(h.reads(), 0);
});

for (const name of ["track insertion", "track removal", "track reorder", "clip insertion", "clip removal",
  "effect insertion", "effect removal", "project load", "project change", "undo", "redo", "plugin disable/enable"]) {
  test("structure flags and track lookup refresh after " + name, () => {
    const h = host(2);
    const adjustment = h.track(new h.Layer.adjustment());
    adjustment.layer.effects.push(h.operator());
    h.tracks.push(adjustment);
    h.tracks.onListChanged.update();
    assert.equal(h.api.usesSingleEvaluation(h.sequence), true);
    const lower = h.tracks[0].layer;
    if (name === "track insertion") { h.tracks.unshift(h.track()); h.tracks.onListChanged.update(); }
    else if (name === "track removal") { h.tracks.splice(1, 1); h.tracks.onListChanged.update(); }
    else if (name === "track reorder") { h.tracks.reverse(); h.tracks.onListChanged.update(); }
    else if (name === "clip insertion") {
      const next = h.track(); adjustment.clips.push(next.clips[0]); adjustment.clips.onListChanged.update();
    } else if (name === "clip removal") { adjustment.clips.splice(0); adjustment.layer = null; adjustment.clips.onListChanged.update(); }
    else if (name === "effect insertion") { lower.effects.push(h.operator(2)); lower.effects.onListChanged.update(); }
    else if (name === "effect removal") { adjustment.layer.effects.splice(0); adjustment.layer.effects.onListChanged.update(); }
    else if (name === "plugin disable/enable") {
      delete adjustment.layer.effects[0]._zoidiumTemporal;
      h.documentEvents.get("zoidium:plugin-state-change")?.forEach(fn => fn());
    } else {
      adjustment.layer.effects.splice(0);
      if (name === "project load") h.documentEvents.get("zoidium:project-load-start")?.forEach(fn => fn());
      else h.sequence.parentProject.ui.onChanged.update();
    }
    const expected = name === "effect insertion" ? 20 :
      ["clip removal", "effect removal", "project load", "project change", "undo", "redo", "plugin disable/enable", "track reorder"].includes(name) ? null : 18;
    assert.equal(h.api.getTemporalLayerFrame(lower, 13, h.sequence)?.sourceFrame ?? null, expected);
    const temporal = !["clip removal", "effect removal", "project load", "project change", "undo", "redo", "plugin disable/enable"].includes(name);
    assert.equal(h.api.usesSingleEvaluation(h.sequence), temporal);
  });
}

test("active clip identity and sampler scope stay frame-local; operator values are never cached", () => {
  const h = host(2);
  const adjustment = h.track(new h.Layer.adjustment());
  let value = 5;
  adjustment.layer.effects.push(h.operator(() => value));
  h.tracks.push(adjustment); h.tracks.onListChanged.update();
  const layer = h.tracks[0].layer;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame, 18);
  value = 9;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame, 22);
  adjustment.layer = null;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence), null);
  adjustment.layer = adjustment.clips[0].object;
  adjustment.clips[0].start = 20;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence), null);
  assert.equal(h.api.getTemporalLayerFrame(layer, 20, h.sequence).sourceFrame, 29);
});

test("plain lists retain the uncached fallback", () => {
  const h = host(2, false);
  assert.equal(h.api.usesSingleEvaluation(h.sequence), false);
  h.tracks[1].layer.effects.push(h.operator());
  assert.equal(h.api.usesSingleEvaluation(h.sequence), true);
});

test("adjustment index preserves noncommutative order and sampler scope", () => {
  const h = host();
  const lower = h.tracks[0].layer;
  const a = h.track(new h.Layer.adjustment()), b = h.track(new h.Layer.adjustment());
  a.layer.effects.push(h.operator(2));
  b.layer.effects.push({ _zoidiumTemporal: { getOperator: () => ({ kind: "posterize-time", fps: 3 }) } });
  h.tracks.push(a, b); h.tracks.onListChanged.update();
  const original = h.api.getTemporalLayerFrame(lower, 13, h.sequence).sourceFrame;
  h.tracks.splice(1, 2, b, a); h.tracks.onListChanged.update();
  assert.notEqual(h.api.getTemporalLayerFrame(lower, 13, h.sequence).sourceFrame, original);
  h.PZ.zoidium = { temporal: { contexts: [{ frameSamplerScope: { trackIndex: 1 } }] } };
  assert.equal(h.api.getTemporalLayerFrame(lower, 13, h.sequence), null);
  h.PZ.zoidium.temporal.contexts[0].frameSamplerScope.trackIndex = 2;
  assert.notEqual(h.api.getTemporalLayerFrame(lower, 13, h.sequence), null);
});

test("enabled tracks read their current active layer without caching it", () => {
  const h = host();
  const adjustment = h.track(new h.Layer.adjustment());
  adjustment.layer.effects.push(h.operator());
  h.tracks.push(adjustment); h.tracks.onListChanged.update();
  const layer = h.tracks[0].layer, owner = adjustment.layer;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame, 18);
  adjustment.enabled = false; adjustment.layer = null;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence), null);
  adjustment.enabled = true; adjustment.layer = owner;
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame, 18);
});

test("nested composite effect lists invalidate both temporal and sampler flags", () => {
  const h = host();
  const parent = new h.Layer.composite(), child = new h.Layer();
  parent.objects.push(child);
  h.tracks.push(h.track(parent)); h.tracks.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence), false);
  child.effects.push(h.operator()); child.effects.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence, true), true);
  child.effects.push({ _zoidiumFrameSampler: {} }); child.effects.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence, true), false);
  parent.objects.splice(0); parent.objects.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence), false);
});

test("replacing the sequence track list rebuilds indexes", () => {
  const h = host();
  assert.equal(h.api.usesSingleEvaluation(h.sequence), false);
  const owner = h.track(); owner.layer.effects.push(h.operator());
  h.sequence.videoTracks = h.list([owner]);
  assert.equal(h.api.usesSingleEvaluation(h.sequence), true);
  assert.equal(h.api.getVideoTrackIndex(h.sequence, owner.layer), 0);
});

test("effect reorder refreshes membership without caching operator order", () => {
  const h = host();
  const layer = h.tracks[0].layer;
  layer.effects.push(h.operator(2), { _zoidiumTemporal: { getOperator: () => ({ kind: "posterize-time", fps: 3 }) } });
  const before = h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame;
  layer.effects.reverse(); layer.effects.onListChanged.update();
  assert.notEqual(h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame, before);
});

test("switching to an inserted clip uses its new layer index immediately", () => {
  const h = host(2);
  h.tracks[1].layer.effects.push(h.operator());
  h.api.usesSingleEvaluation(h.sequence);
  const next = h.track();
  h.tracks[0].clips.push(next.clips[0]); h.tracks[0].clips.onListChanged.update();
  h.tracks[0].layer = next.layer;
  assert.equal(h.api.getVideoTrackIndex(h.sequence, next.layer), 0);
});

test("late effect initialization invalidates cached descriptor flags", () => {
  const h = host(), layer = h.tracks[0].layer;
  const effect = { properties: h.list([]) };
  layer.effects.push(effect); layer.effects.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence), false);
  Object.assign(effect, h.operator());
  effect.properties.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence, true), true);
  assert.equal(h.api.getTemporalLayerFrame(layer, 13, h.sequence).sourceFrame, 18);
  effect._zoidiumFrameSampler = {};
  effect.properties.onListChanged.update();
  assert.equal(h.api.usesSingleEvaluation(h.sequence, true), false);
});
