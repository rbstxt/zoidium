"use strict";
// Mask API frame mapping and reference evaluation (Node-testable seams).
const test = require("node:test"),
  assert = require("node:assert/strict");
const { toSourceFrame, coverageSize, MAX_SHADER_SIDE } = require("../plugins/shape-plus/mask-api.js");
const { parseReference, formatReference } = require("../plugins/shape-plus/mask-model.js");

test("source frames map through both clips", () => {
  const shaderClip = { start: 10, offset: 2 }, sourceClip = { start: 30, offset: 5 };
  // Project frame = 0 + 10 - 2 = 8; source local = 8 - 30 + 5 = -17.
  assert.equal(toSourceFrame(0, shaderClip, sourceClip), -17);
  // Same clip: identity.
  const clip = { start: 10, offset: 5 };
  assert.equal(toSourceFrame(7, clip, clip), 7);
  // Missing clips default to zero offsets.
  assert.equal(toSourceFrame(7, null, null), 7);
});

test("coverage size keeps aspect and caps the long side", () => {
  assert.deepEqual(coverageSize([640, 360]), { width: 640, height: 360, scale: 1 });
  assert.deepEqual(coverageSize([0, 5]), { width: 1, height: 5, scale: 1 });
  const hd = coverageSize([1920, 1080]);
  assert.equal(Math.max(hd.width, hd.height), MAX_SHADER_SIDE);
  assert.ok(Math.abs(hd.width / hd.height - 16 / 9) < 0.01);
  const big = coverageSize([8192, 4096]);
  assert.equal(Math.max(big.width, big.height), MAX_SHADER_SIDE);
  assert.ok(Math.abs(big.width / big.height - 2) < 0.01);
});

test("references survive format and parse", () => {
  const value = formatReference({ source: "mask", track: "track:id:abc", clip: [0, 1, 0, 0, 0], mask: "m1" });
  assert.deepEqual(parseReference(value), { source: "mask", track: "track:id:abc", clip: [0, 1, 0, 0, 0], mask: "m1" });
  const shape = formatReference({ source: "shape", track: "track:id:abc", clip: [0, 1, 0, 0, 0], path: "p9" });
  assert.deepEqual(parseReference(shape), { source: "shape", track: "track:id:abc", clip: [0, 1, 0, 0, 0], path: "p9" });
  // The clip address is optional; the track token alone still parses.
  assert.deepEqual(parseReference(formatReference({ source: "mask", track: "t", mask: "m" })), { source: "mask", track: "t", mask: "m" });
  assert.equal(parseReference("not json"), null);
  assert.equal(parseReference(JSON.stringify({ version: 1, source: "mask", track: "t" })), null);
});
