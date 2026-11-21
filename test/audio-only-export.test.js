"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { WAV, wavHeader, wavSamples, createAudioJob } = require("../plugins/mp4-export/audio-only.js");
const { addAudioOptions } = require("../plugins/mp4-export/audio-options.js");

function buffer(left, right = left) { return { getChannelData: i => i ? right : left }; }
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
  const owner = { params: {} };
  try {
    const control = addAudioOptions({ querySelectorAll: () => rows }, select, owner);
    assert.equal(control.select(), true);
    assert.deepEqual(rows.map(row => row.style.display), ["none", "none", "none", "none", ""]);
    owner.params.format = "mkv"; control.update();
    assert.deepEqual(rows.map(row => row.style.display), ["", "", "grid", "", ""]);
    control.dispose(); assert.equal(select.options.length, 0);
  } finally { global.document = old; }
});
test("M4A reports AAC unavailability and offers WAV", async () => {
  const exporter = { params: { format: "audio_m4a", start: 0, length: 30, rate: 30 },
    sequence: { audioSchedules: [], properties: { rate: { get: () => 30 } } } };
  await assert.rejects(createAudioJob({}, exporter, () => { throw new Error("unexpected encoder"); }).run(), /AAC encoding is unavailable.*\.wav/);
});
