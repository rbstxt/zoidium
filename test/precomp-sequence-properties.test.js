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
