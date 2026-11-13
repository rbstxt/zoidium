"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sceneTargets } = require("../plugins/precomp-plus/precomp-runtime.js");

test("finds each direct Scene clip in video track order", () => {
  const sources = [{ id: "comp", tracks: [
    { type: 1, clips: [{ object: { type: 4 } }] },
    { type: 0, clips: [{ object: { type: 2 } }, { properties: { name: "First" }, object: { type: 4 } }] },
    { type: 0, clips: [{ object: { type: 4 } }] },
  ] }];
  assert.deepEqual(sceneTargets(sources, { object: { compId: "comp" } }), [
    { trackIndex: 0, clipIndex: 1, name: "First" },
    { trackIndex: 1, clipIndex: 0, name: "Scene" },
  ]);
  assert.deepEqual(sceneTargets(sources, { object: { compId: "missing" } }), []);
  assert.deepEqual(sceneTargets(sources, { object: {} }), []);
  assert.deepEqual(sceneTargets([{ id: "comp", tracks: null }], { object: { compId: "comp" } }), []);
});
