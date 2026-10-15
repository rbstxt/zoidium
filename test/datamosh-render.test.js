"use strict";

// Unit coverage for the bundled true-mosh renderer
// (plugins/openzoid-legacy/datamosh-render.js, ported byte-identical from the
// donor). A minimal synthetic WebM is built by hand: EBML + Segment carrying
// Info, one VP8 video track and two clusters with timestamped SimpleBlocks.
// The tests check keyframe probing, full-video and ranged moshes (the first
// keyframe is always kept), the finished-note stats, and the cut helpers.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRenderer() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "plugins", "openzoid-legacy", "datamosh-render.js"),
    "utf8",
  );
  const sandbox = { PZ: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "datamosh-render.js" });
  assert.ok(sandbox.PZ.datamoshRender, "renderer installs PZ.datamoshRender");
  return sandbox.PZ.datamoshRender;
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

function vint(value) {
  let len = 1;
  while (len < 8 && value >= Math.pow(2, 7 * len) - 1) len += 1;
  const out = new Uint8Array(len);
  let v = value;
  for (let i = len - 1; i >= 0; i -= 1) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function el(id, payload) {
  return concat([id, vint(payload.length), payload]);
}

const ID = {
  ebml: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
  segment: new Uint8Array([0x18, 0x53, 0x80, 0x67]),
  info: new Uint8Array([0x15, 0x49, 0xa9, 0x66]),
  scale: new Uint8Array([0x2a, 0xd7, 0xb1]),
  tracks: new Uint8Array([0x16, 0x54, 0xae, 0x6b]),
  entry: new Uint8Array([0xae]),
  trackNum: new Uint8Array([0xd7]),
  codec: new Uint8Array([0x86]),
  cluster: new Uint8Array([0x1f, 0x43, 0xb6, 0x75]),
  timecode: new Uint8Array([0xe7]),
  simpleBlock: new Uint8Array([0xa3]),
};

function strBytes(s) {
  return Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));
}

// VP8 payloads: an even first byte verifies as a keyframe, an odd one as a
// predicted frame. Flags 0x80 marks the container keyframe bit.
function simpleBlock(rel, keyframe) {
  const header = new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, keyframe ? 0x80 : 0x00]);
  const payload = keyframe
    ? new Uint8Array([0x9c, 0x01, 0x2a, 0x10, 0x20])
    : new Uint8Array([0x85, 0x01, 0x2a, 0x10, 0x20]);
  return el(ID.simpleBlock, concat([header, payload]));
}

function cluster(base, rels) {
  const kids = [el(ID.timecode, new Uint8Array(base < 256 ? [base] : [(base >> 8) & 0xff, base & 0xff]))];
  for (const [rel, key] of rels) kids.push(simpleBlock(rel, key));
  return el(ID.cluster, concat(kids));
}

function syntheticWebm() {
  const info = el(ID.info, el(ID.scale, new Uint8Array([0x00, 0x0f, 0x42, 0x40])));
  const entry = el(ID.entry, concat([
    el(ID.trackNum, new Uint8Array([0x01])),
    el(ID.codec, strBytes("V_VP8")),
  ]));
  const tracks = el(ID.tracks, entry);
  return concat([
    el(ID.ebml, new Uint8Array(0)),
    el(ID.segment, concat([
      info,
      tracks,
      cluster(0, [[0, true], [33, false], [66, false]]),
      cluster(1000, [[0, true], [33, false]]),
    ])),
  ]);
}

test("probe finds the video track, frames and keyframes", () => {
  const render = loadRenderer();
  const probe = render.probe(syntheticWebm());
  assert.equal(probe.tracks.length, 1);
  assert.equal(probe.tracks[0].codec, "V_VP8");
  assert.equal(probe.videoFrames, 5);
  assert.equal(probe.clusters, 2);
  assert.deepEqual(Array.from(probe.keyframes.map((k) => k.ts)), [0, 1000]);
});

test("a full-video mosh keeps the first keyframe and drops the rest", () => {
  const render = loadRenderer();
  const out = render.mosh(syntheticWebm(), {});
  assert.equal(out.stats.keyframes, 2);
  assert.equal(out.stats.dropped, 1);
  assert.equal(out.stats.keptKeyframes, 1);
  assert.ok(out.bytes.length > 0 && out.bytes.length < syntheticWebm().length);
  const after = render.probe(out.bytes);
  assert.deepEqual(Array.from(after.keyframes.map((k) => k.ts)), [0], "only the first keyframe survives");
  assert.equal(after.videoFrames, 4, "the dropped block is gone");
});

test("a ranged mosh drops only in-range keyframes after the first", () => {
  const render = loadRenderer();
  const inRange = render.mosh(syntheticWebm(), { rangesMs: [[900, 1100]] });
  assert.equal(inRange.stats.dropped, 1);
  assert.deepEqual(Array.from(render.probe(inRange.bytes).keyframes.map((k) => k.ts)), [0]);
  // The first keyframe is kept even when it sits inside the ranges.
  const firstKept = render.mosh(syntheticWebm(), { rangesMs: [[0, 500]] });
  assert.equal(firstKept.stats.dropped, 0);
  assert.deepEqual(Array.from(render.probe(firstKept.bytes).keyframes.map((k) => k.ts)), [0, 1000]);
});

test("cut helpers map sequence clips to mosh windows", () => {
  const render = loadRenderer();
  const sequence = {
    properties: { rate: { get: () => 30 } },
    videoTracks: [{ clips: [{ start: 0, length: 60 }, { start: 60, length: 60 }] }],
  };
  assert.deepEqual(Array.from(render.cutTimesMs(sequence)), [0, 2000, 4000]);
  assert.deepEqual(Array.from(render.rangesAroundCuts([2000], 300), (r) => Array.from(r)), [[1700, 2300]]);
  assert.deepEqual(Array.from(render.rangesAroundCuts([100]), (r) => Array.from(r)), [[0, 400]], "default 300 ms window clamps at zero");
  assert.deepEqual(Array.from(render.cutTimesMs(null)), []);
});

test("moshing garbage throws so the caller can fall back to the clean render", () => {
  const render = loadRenderer();
  assert.throws(() => render.mosh(new Uint8Array([1, 2, 3]), {}), /Segment/);
});
