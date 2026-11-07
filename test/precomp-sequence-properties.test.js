"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

test("composition switches replace scalar and grouped sequence keyframes", () => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const sandbox = { module: { exports: {} }, PZ: { ui: {} }, console,
    require: () => ({ clone, applyTrackSwitches() {} }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    "../plugins/precomp-plus/comps-timeline.js"), "utf8"), sandbox);
  const sample = { value: 16, frame: 0, tween: 1 };
  const scalar = { keyframes: [clone(sample)] };
  const axis = { keyframes: [{ value: 3, frame: 0, tween: 1 }] };
  const group = { objects: [axis] };
  const properties = [scalar, group];
  const serialize = () => ({ properties: clone(properties), videoTracks: [], audioTracks: [] });
  const initial = serialize();
  const sequence = { properties, videoTracks: [], audioTracks: [], load(json) {
    // Native CM3 loads into existing keyframe lists by appending.
    scalar.keyframes.push(...json.properties[0].keyframes);
    axis.keyframes.push(...json.properties[1].objects[0].keyframes);
  } };
  const editor = { project: { sequence, ui: { onChanged: { update() {} } } } };
  for (let i = 0; i < 40; i++) {
    const saved = serialize();
    sandbox.module.exports.applySequence(editor, saved);
    assert.equal(sequence.properties, properties, "property identities remain stable for watchers");
    assert.deepEqual(serialize(), initial);
  }
});

test("composition switches unload outgoing clips before removing their tracks", () => {
  const released = [];
  const sandbox = { module: { exports: {} }, PZ: { ui: {} }, console,
    require: () => ({ clone: value => JSON.parse(JSON.stringify(value)), applyTrackSwitches() {} }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    "../plugins/precomp-plus/comps-timeline.js"), "utf8"), sandbox);
  const sequence = { properties: [], videoTracks: [], audioTracks: [], load() {} };
  for (const type of ["videoTracks", "audioTracks"]) {
    sequence[type].push({ clips: [{ unload() {
      assert.equal(sequence[type].length, 1, "project ancestry is still available during unload");
      released.push(type);
    } }] });
  }
  const editor = { project: { sequence, ui: { onChanged: { update() {} } } } };
  sandbox.module.exports.applySequence(editor, { videoTracks: [], audioTracks: [] });
  assert.deepEqual(released, ["videoTracks", "audioTracks"]);
  assert.equal(sequence.videoTracks.length, 0);
  assert.equal(sequence.audioTracks.length, 0);
});

function nativeFixture() {
  const { PZ } = require("./helpers/editor-identity-host.cjs").host();
  const module = { exports: {} }, clone = value => JSON.parse(JSON.stringify(value));
  new Function("require", "PZ", "module", fs.readFileSync(path.join(__dirname,
    "../plugins/precomp-plus/comps-timeline.js"), "utf8"))(() => ({ clone, applyTrackSwitches() {} }), PZ, module);
  const project = new PZ.project(); project.sequence.properties.load();
  project.ui = { onChanged: new PZ.observable() };
  const editor = { project, windows: [], onProjectChanged: new PZ.observable() };
  return { PZ, editor, seq: project.sequence, clone, clear: () => module.exports.clearHistory(editor), apply: json => module.exports.applySequence(editor, json) };
}

test("partial and default sequence JSON preserves omitted keys without accumulating defaults", () => {
  const f = nativeFixture(), p = f.seq.properties.motionBlurSamples;
  p.set(37); const before = JSON.stringify(p);
  for (const properties of [undefined, {}, [], { motionBlurSamples: {} }, { motionBlurSamples: { animated: false } }]) {
    for (let i = 0; i < 20; i++) {
      f.apply({ length: 60, properties, videoTracks: [], audioTracks: [] });
      assert.equal(JSON.stringify(p), before);
      assert.equal(p.get(0), 37);
    }
  }
  f.apply({ length: 60, properties: { motionBlurSamples: { animated: false, keyframes: [{ value: 16, frame: 0, tween: 1 }] } }, videoTracks: [], audioTracks: [] });
  assert.equal(p.get(0), 16); assert.equal(p.keyframes.length, 1);
});

test("legacy grouped keyframes and omitted axes survive sequence replacement", () => {
  const f = nativeFixture();
  f.seq.properties.add("legacy", { dynamic: true, group: true, type: 1, objects: [
    { dynamic: true, type: 0, value: 3 }, { dynamic: true, type: 0, value: 4 },
  ] });
  const group = f.seq.properties.legacy; group.load();
  const legacy = { length: 60, properties: { legacy: { animated: true, keyframes: [
    { value: [10, 20], frame: 0, tween: 1 }, { value: [30, 40], frame: 30, tween: 1 },
  ] } }, videoTracks: [], audioTracks: [] };
  for (let i = 0; i < 20; i++) {
    f.apply(legacy); assert.deepEqual(Array.from(group.get(0)), [10, 20]);
    assert.deepEqual(Array.from(group.objects, p => p.keyframes.length), [2, 2]);
  }
  const partial = f.clone(legacy); delete partial.properties.legacy.keyframes;
  partial.properties.legacy.objects = [{ animated: true, keyframes: [{ value: 99, frame: 0, tween: 1 }] }];
  f.apply(partial);
  assert.deepEqual(Array.from(group.get(0)), [99, 20]);
  assert.deepEqual(Array.from(group.objects, p => p.keyframes.length), [1, 2]);
});

test("a failing outgoing clip cannot stop the remaining cleanup or sequence replacement", () => {
  const f = nativeFixture(), calls = [], errors = [];
  const track = new f.PZ.track.video(); f.seq.videoTracks.push(track);
  track.clips.push({ unload() { calls.push(1); throw Error("broken plugin"); } }, { unload() { calls.push(2); } });
  const error = console.error; console.error = (...args) => errors.push(args);
  try { f.apply({ length: 99, properties: {}, videoTracks: [], audioTracks: [] }); }
  finally { console.error = error; }
  assert.deepEqual(calls, [1, 2]); assert.equal(errors.length, 1);
  assert.equal(f.seq.length, 99); assert.equal(f.seq.videoTracks.length, 0);
  assert.equal(f.seq.properties.motionBlurSamples.keyframes.length, 1);
});


test("native undo and redo cannot replay pre-switch edits and work for new edits", () => {
  const f = nativeFixture(), p = f.seq.properties.motionBlurSamples;
  const history = f.editor.history = new f.PZ.ui.history(f.editor); history.projectChanged();
  function exchange({ value }) {
    const previous = p.get(0); p.set(value);
    history.pushCommand(exchange, { value: previous });
  }
  function edit(value) { history.startOperation(); exchange({ value }); history.finishOperation(); }
  edit(32); history.undo(); assert.equal(p.get(0), 16);
  assert.equal(history.redoStack.length, 1);
  f.apply({ length: 99, properties: {}, videoTracks: [], audioTracks: [] }); f.clear();
  history.undo(); history.redo(); assert.equal(p.get(0), 16);
  assert.equal(history.undoStack.length, 0); assert.equal(history.redoStack.length, 0);
  edit(55); history.undo(); assert.equal(p.get(0), 16);
  history.redo(); assert.equal(p.get(0), 55);
});
