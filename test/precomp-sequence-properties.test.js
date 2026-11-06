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
