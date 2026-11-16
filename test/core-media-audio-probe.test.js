"use strict";

// The shared container probe answers whether a media file carries an audio
// stream at all. It must answer "absent" only for a completely parsed
// container, and "unknown" for anything else, so an import or an export never
// drops real audio. The fixtures are synthetic headers from
// test/media-container-fixture.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { box, fakeFile, mp4, webm } = require("./media-container-fixture.js");

const source = fs.readFileSync(path.join(__dirname, "../plugins/core/video-seek-policy.js"), "utf8");

function loadProbe() {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports.probeAudioTrack;
}

function ftyp() {
  return box("ftyp", Buffer.from("isom", "latin1"), Buffer.alloc(4), Buffer.from("isomiso2mp41", "latin1"));
}

const probe = loadProbe();

test("a video-only MP4 has no audio track", async () => {
  assert.equal(await probe(fakeFile(mp4(["vide"]))), false);
});

test("an MP4 with an AAC track has audio", async () => {
  assert.equal(await probe(fakeFile(mp4(["vide", "soun"]))), true);
});

test("an MP4 keeps the video track ahead of the audio track", async () => {
  assert.equal(await probe(fakeFile(mp4(["soun", "vide"]))), true);
});

test("an audio-only M4A has audio", async () => {
  assert.equal(await probe(fakeFile(mp4(["soun"]))), true);
});

test("moov after the media data is found through box headers only", async () => {
  // The media box alone is larger than the header window the probe reads.
  const bytes = mp4(["vide"], { moovAfterMedia: true, mediaBytes: 1024 * 1024 + 4096 });
  assert.equal(await probe(fakeFile(bytes)), false);
  assert.equal(await probe(fakeFile(mp4(["vide", "soun"], {
    moovAfterMedia: true, mediaBytes: 1024 * 1024 + 4096,
  }))), true);
});

test("a video-only WebM has no audio track", async () => {
  assert.equal(await probe(fakeFile(webm([1]))), false);
});

test("a WebM with an Opus track has audio", async () => {
  assert.equal(await probe(fakeFile(webm([1, 2]))), true);
});

test("a video-only MKV uses the same TrackEntry answer", async () => {
  assert.equal(await probe(fakeFile(webm([1]))), false);
});

test("a WebM without a Tracks element stays unknown", async () => {
  assert.equal(await probe(fakeFile(webm([], { includeTracks: false }))), null);
});

test("a truncated WebM Tracks element stays unknown", async () => {
  const bytes = webm([1]);
  assert.equal(await probe(fakeFile(bytes.subarray(0, bytes.length - 8))), null);
});

test("a truncated MP4 header stays unknown", async () => {
  const bytes = mp4(["vide"]);
  assert.equal(await probe(fakeFile(bytes.subarray(0, 10))), null);
});

test("an MP4 without any track stays unknown", async () => {
  assert.equal(await probe(fakeFile(Buffer.concat([ftyp(), box("moov")]))), null);
});

test("an unknown container, an empty file and a non-file stay unknown", async () => {
  assert.equal(await probe(fakeFile(Buffer.from("RIFF0000WAVEfmt "))), null);
  assert.equal(await probe(fakeFile(Buffer.alloc(0))), null);
  assert.equal(await probe(null), null);
  assert.equal(await probe({ size: 4 }), null);
});

test("an unreadable file stays unknown instead of rejecting", async () => {
  const file = {
    size: 64,
    async arrayBuffer() { return new ArrayBuffer(0); },
    slice() { throw new Error("read failed"); },
  };
  assert.equal(await probe(file), null);
});

test("a repeated probe reuses one read of the same file", async () => {
  let reads = 0;
  const file = fakeFile(mp4(["vide"]));
  const slice = file.slice;
  file.slice = function (...args) {
    reads += 1;
    return slice.apply(this, args);
  };
  assert.equal(await probe(file), false);
  assert.equal(await probe(file), false);
  assert.equal(reads, 1);
});
