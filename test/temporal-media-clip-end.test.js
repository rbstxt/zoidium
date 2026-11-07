"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { holdLastMediaFrame, EPSILON } = require("../plugins/core/temporal-math.js");
const { host } = require("./helpers/temporal-sampler-host.cjs");

const offset = offsetFrames => ({ update() {},
  _zoidiumTemporal: { getOperator: () => ({ kind: "time-offset", enabled: true, offsetFrames }) } });

test("the clamped clip end holds the last frame the clip shows", () => {
  assert.equal(holdLastMediaFrame(60 - EPSILON, 60), 59);
  assert.equal(holdLastMediaFrame(59.5 - EPSILON, 59.5), 59, "a fractional length keeps its last drawn frame");
  assert.equal(holdLastMediaFrame(0.5 - EPSILON, 0.5), 0);
});

test("frames before the clamp keep their exact clock", () => {
  for (const frame of [0, 12.5, 58, 59, 59.5, 59.999]) assert.equal(holdLastMediaFrame(frame, 60), frame);
});

test("an offset past a trimmed video's end never reaches the frame after its out point", () => {
  const h = host(false);
  h.source.clip.media = { url: "video" };
  h.source.effects.unshift(offset(1000));
  const mapped = h.state.mapLayerFrame(h.source, 20);
  assert.equal(mapped.sourceFrame, 99);
  assert.equal(mapped.projectFrame, 109);
});

test("content without media keeps its existing clamped clock", () => {
  const h = host(false);
  h.source.effects.unshift(offset(1000));
  assert.equal(h.state.mapLayerFrame(h.source, 20).sourceFrame, 100 - EPSILON);
});

test("a sampler tap past a trimmed video's end decodes the clip's last frame", async () => {
  const h = host(false);
  h.effect._zoidiumFrameSampler.getRequest = () => ({ count: 1, offsetFrames: 1000, startOpacity: 1, decay: 1 });
  await h.state.prepareFrameSamples(h.effect, 20, {});
  assert.equal(Math.round(h.decoded.at(-1) * 1e6) / 1e6, 99);
});
