"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WAV, wavHeader, wavSamples, createAudioJob } = require("../plugins/mp4-export/audio-only.js");
const { addAudioOptions } = require("../plugins/mp4-export/audio-options.js");

function buffer(left, right = left) { return { numberOfChannels: 2, getChannelData: i => i ? right : left }; }
test("WAV header and interleaved signed samples", () => {
  const header = new DataView(wavHeader(3));
  assert.equal(header.getUint32(4, true), 48);
  assert.equal(header.getUint16(20, true), 1);
  assert.equal(header.getUint16(22, true), 2);
  assert.equal(header.getUint32(24, true), 48000);
  assert.equal(header.getUint32(40, true), 12);
  const data = new DataView(wavSamples(buffer([0, -1, 1], [0.5, 1, -0.5])));
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => data.getInt16(i * 2, true)), [0, 16384, -32768, 32767, 32767, -16384]);
});
test("WAV duplicates mono samples into both output channels", () => {
  const data = new DataView(wavSamples({
    numberOfChannels: 1,
    getChannelData(index) { assert.equal(index, 0); return [0.5]; },
  }));
  assert.equal(data.getInt16(0, true), 16384);
  assert.equal(data.getInt16(2, true), 16384);
});
for (const rate of [24, 25, 29.97, 30]) test(`WAV uses video export sample length at ${rate} fps`, async () => {
  const calls = [];
  const exporter = {
    params: { format: WAV, start: 12, length: 31, rate },
    sequence: { audioSchedules: [], properties: { rate: { get: () => 24 } } },
    analyzeSegment(start, count) { calls.push([start, count]); return []; },
    renderAudioSegment(_segments, _start, count) { return buffer(new Float32Array(count)); },
    renderVideoFrame() { throw new Error("video frame rendered"); },
  };
  const blob = await createAudioJob({}, exporter, () => { throw new Error("encoder loaded"); }).run();
  const bytes = await blob.arrayBuffer(), samples = Math.floor(31 / rate * 48000);
  assert.equal(bytes.byteLength, 44 + samples * 4);
  assert.equal(new DataView(bytes).getUint32(40, true), samples * 4);
  assert.equal(calls[0][0], 24000);
  assert.ok(new Uint8Array(bytes, 44).every(value => value === 0));
});
test("audio selector hides video rows and restores their prior display", () => {
  const old = global.document;
  global.document = { createElement: () => ({ remove() { select.options.splice(select.options.indexOf(this), 1); } }) };
  const select = { options: [], selectedIndex: 0, appendChild(option) { this.options.push(option); } };
  const rows = ["Resolution", "Frame rate", "Quality", "True datamosh", "Format"].map(label => ({ style: { display: label === "Quality" ? "grid" : "" }, querySelector: () => ({ textContent: label }) }));
  let videoSizeRequired = true;
  const owner = { params: {}, __zoidiumResolutionControls: { setVideoSizeRequired(value) { videoSizeRequired = value; } } };
  try {
    const control = addAudioOptions({ querySelectorAll: () => rows }, select, owner);
    assert.equal(control.select(), true);
    assert.deepEqual(rows.map(row => row.style.display), ["none", "none", "none", "none", ""]);
    assert.equal(videoSizeRequired, false);
    owner.params.format = "mkv"; control.update();
    assert.deepEqual(rows.map(row => row.style.display), ["", "", "grid", "", ""]);
    assert.equal(videoSizeRequired, true);
    control.select();
    control.dispose(); assert.equal(select.options.length, 0);
    assert.equal(videoSizeRequired, true);
  } finally { global.document = old; }
});
test("M4A reports AAC unavailability and offers WAV", async () => {
  const exporter = { params: { format: "audio_m4a", start: 0, length: 30, rate: 30 },
    sequence: { audioSchedules: [], properties: { rate: { get: () => 30 } } } };
  await assert.rejects(createAudioJob({}, exporter, () => { throw new Error("unexpected encoder"); }).run(), /AAC encoding is unavailable.*\.wav/);
});

test("M4A offers WAV if a reported AAC encoder fails timing calibration", async () => {
  const exporter = { params: { format: "audio_m4a", start: 0, length: 30, rate: 30 },
    sequence: { audioSchedules: [] } };
  const scope = {
    AudioEncoder: class {
      static async isConfigSupported() { return { supported: true }; }
      constructor() { throw new Error("Encoder unavailable"); }
    },
  };
  const bunny = {
    StreamTarget: class {},
    Mp4OutputFormat: class {},
    Output: class { async cancel() {} },
  };
  await assert.rejects(createAudioJob(scope, exporter, () => bunny).run(), {
    message: "AAC encoding could not be started in this browser. Select .wav instead.",
  });
});

test("WAV decodes the scheduled source and writes the native mix for a nonzero in point", async () => {
  const bytes = new ArrayBuffer(8);
  const decoded = buffer([1], [-1]);
  const media = { file: { arrayBuffer: async () => bytes } };
  const segment = { media, offset: 1.25, playbackRate: 2 };
  let decoderClosed = false;
  const scope = {
    AudioContext: class {
      constructor(options) { assert.equal(options.sampleRate, 48000); }
      async decodeAudioData(input) { assert.equal(input, bytes); return decoded; }
      close() { decoderClosed = true; }
    },
  };
  const exporter = {
    params: { format: WAV, start: 15, length: 1, rate: 48000 },
    sequence: { audioSchedules: [{ items: [{ media }] }], properties: { rate: { get: () => 30 } } },
    analyzeSegment(start, count) {
      assert.equal(start, 24000);
      assert.equal(count, 1);
      return [segment];
    },
    renderAudioSegment(segments, start, count) {
      assert.deepEqual(segments, [{ media, offset: 1.25, playbackRate: 2, buffer: decoded, startOffset: 2.5 }]);
      assert.equal(start, 24000);
      assert.equal(count, 1);
      return buffer([0.5], [-1]);
    },
  };
  const wav = new DataView(await (await createAudioJob(scope, exporter).run()).arrayBuffer());
  assert.equal(wav.getInt16(44, true), 16384);
  assert.equal(wav.getInt16(46, true), -32768);
  assert.equal(decoderClosed, true);
});
