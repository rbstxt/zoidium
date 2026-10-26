"use strict";

// Detach guards: getScheduleSourceFrame must not throw when the schedule
// retains a clip whose native clip was deleted (parentProject getter throws).
// Attached calls keep their previous result.

const assert = require("node:assert/strict");
const test = require("node:test");

globalThis.PZ = globalThis.PZ || {};
Object.assign(globalThis.PZ, {
  sequence: globalThis.PZ.sequence || class Sequence {},
  clip: globalThis.PZ.clip || class Clip {},
  layer: globalThis.PZ.layer || {},
  observable: globalThis.PZ.observable || class Observable {},
});
globalThis.PZ.layer.composite = globalThis.PZ.layer.composite || class Composite {};
globalThis.PZ.layer.adjustment = globalThis.PZ.layer.adjustment || class Adjustment {};
globalThis.PZ.layer.scene = globalThis.PZ.layer.scene || class Scene {};

const layers = require("../plugins/core/temporal-layers.js");

function detachedClipError() {
  return new TypeError("Cannot read properties of null (reading 'parentObject')");
}

test("getScheduleSourceFrame returns the project frame for an attached clip without operators", () => {
  const layer = { effects: [] };
  const sequence = { videoTracks: [] };
  const clip = { start: 0, length: 100, object: layer, parentProject: { sequence } };
  const schedule = { items: [{ start: 0, length: 100, clip }] };
  assert.equal(layers.getScheduleSourceFrame(schedule, 12), 12);
});

test("getScheduleSourceFrame does not throw for a detached clip", () => {
  const layer = { effects: [] };
  const clip = {
    start: 0,
    length: 100,
    object: layer,
    get parentProject() { throw detachedClipError(); },
  };
  const schedule = { items: [{ start: 0, length: 100, clip }] };
  assert.equal(layers.getScheduleSourceFrame(schedule, 12), 12);
});

test("getScheduleSourceFrame does not throw when the safe lookup also throws", () => {
  const layer = { effects: [] };
  const clip = {
    start: 0,
    length: 100,
    object: layer,
    get parentProject() { throw detachedClipError(); },
    tryGetParentOfType() { throw detachedClipError(); },
  };
  const schedule = { items: [{ start: 0, length: 100, clip }] };
  assert.equal(layers.getScheduleSourceFrame(schedule, 12), 12);
});

test("getSequenceForClip prefers the project sequence for attached clips", () => {
  const sequence = { videoTracks: [] };
  const clip = { parentProject: { sequence } };
  assert.equal(layers.getSequenceForClip(clip), sequence);
});
