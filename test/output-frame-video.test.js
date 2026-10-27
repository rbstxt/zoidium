"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const video = require("../plugins/core/output-frame-video.js");
const sampler = require("../plugins/core/temporal-sampler.js");

function fixture() {
  const clips = [0, 0, 50].map(start => ({ start, length: 10, object: {} }));
  const tracks = clips.map(clip => ({ enabled: true, getCurrentClip(frame) {
    return frame >= clip.start && frame < clip.start + clip.length ? clip : null;
  } }));
  const items = clips.map(clip => ({ clip, start: clip.start, length: clip.length, media: {} }));
  const sequence = { videoTracks: tracks, videoSchedules: items.map(item => ({ items: [item], padding: 60 })),
    properties: {}, update() {} };
  return { sequence, clips, items, tracks, snapshot: { project: { sequence }, compositor: {} } };
}

test("exact video input selection includes all visible items and excludes hidden and padded items", () => {
  const f = fixture();
  assert.deepEqual(video.inputs(f.sequence, 0, sampler).map(sample => sample.item), f.items.slice(0, 2));
  f.tracks[0].enabled = false;
  assert.deepEqual(video.inputs(f.sequence, 0, sampler).map(sample => sample.item), [f.items[1]]);
  assert.equal(video.inputs(f.sequence, 10, sampler).length, 0, "exclusive clip end");
  assert.equal(video.inputs(f.sequence, 49, sampler).length, 0, "padding does not create a visible dependency");
});

test("exact video preparation rejects a missing item among multiple visible items", async () => {
  const f = fixture(), policy = video.job(() => true);
  try {
    await assert.rejects(video.prepare(f.snapshot, 0, policy, {}, {
      ...sampler, getFrameSamplerRuntime: () => ({}),
      prepareLowerSchedules: async () => [{ item: f.items[0], texture: {} }],
    }, async () => {}), /Required preview cache video sample/);
  } finally { policy.dispose(); }
});

test("video preparation forwards the cancellation policy to every visible object's preparation", async () => {
  const f = fixture(), policy = video.job(() => true), prepared = [];
  f.clips.forEach((clip, index) => { clip.object.prepare = async (frame, context) => {
    assert.equal(context.exportPolicy, policy);
    prepared.push([index, frame]);
  }; });
  try {
    await video.prepare(f.snapshot, 2, policy, {}, {
      ...sampler, getFrameSamplerRuntime: () => ({}),
      prepareLowerSchedules: async () => f.items.slice(0, 2).map(item => ({ item, texture: {} })),
    }, async () => {});
    assert.deepEqual(prepared, [[0, 2], [1, 2]]);
  } finally { policy.dispose(); }
});

test("a seek cancels an outstanding decode before it can finish", async () => {
  let valid = true;
  const policy = video.job(() => valid);
  const cancelled = new Promise(resolve => policy.signal.addEventListener("abort", resolve, { once: true }));
  valid = false;
  await cancelled;
  assert.throws(policy.check, /cancelled/);
  policy.dispose();
});

test("temporal and multisample projects retain their existing preparation contract", () => {
  const sequence = { properties: { motionBlur: { get: () => 0 } } };
  assert.equal(video.eligible(sequence, { usesSingleEvaluation: () => true }), false);
  assert.equal(video.eligible(sequence, { usesSingleEvaluation: () => undefined }), false);
  assert.equal(video.eligible(sequence, { usesSingleEvaluation: () => false }), true);
  sequence.properties.motionBlur.get = () => 1;
  assert.equal(video.eligible(sequence, { usesSingleEvaluation: () => false }), false);
});
