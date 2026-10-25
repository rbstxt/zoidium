"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MP4_FORMAT, chooseCodecs, evenDimension, firstSupported, frameCount,
  frameTiming, isMp4, projectFrame, videoBitrate,
} = require("../plugins/mp4-export/export-math.js");
const { createAudioMixer, hasAudio } = require("../plugins/mp4-export/audio-mix.js");
const { createStorage } = require("../plugins/mp4-export/stream-target.js");
const { createJob } = require("../plugins/mp4-export/render.js");
const { packetTiming } = require("../plugins/mp4-export/audio-encode.js");

const params = { width: 640, height: 360, rate: 30, quality: 2, bitrateScale: 1, start: 0, length: 30 };
const profiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));
function supports(predicate) {
  return { async isConfigSupported(config) { return { supported: predicate(config), config }; } };
}

test("only the MP4 format enters the new exporter", () => {
  for (const format of ["mkv_vp8_opus", "webm_vp8_opus", "mp4", "png", undefined]) {
    assert.equal(isMp4({ format }), false);
  }
  assert.equal(isMp4({ format: MP4_FORMAT }), true);
});

test("fractional and 60 fps clocks have adjacent durations without cumulative drift", () => {
  for (const rate of [24, 30, 60, 24000 / 1001, 60000 / 1001, 240]) {
    let accumulated = 0;
    for (let frame = 0; frame < 10000; frame++) {
      const timing = frameTiming(frame, rate);
      assert.equal(timing.timestamp, accumulated);
      accumulated += timing.duration;
    }
    assert.equal(accumulated, Math.round(10000 / rate * 1000000));
  }
});

test("rate conversion keeps fractional source frames and the native inclusive frame count", () => {
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => projectFrame(i, 4, 30, 60)), [4, 4.5, 5, 5.5, 6]);
  assert.equal(projectFrame(60, 0, 24, 60), 24);
  assert.equal(frameCount(30.1), 31);
  assert.equal(frameCount(60), 60);
  assert.throws(() => frameCount(0), /no frames/);
});

test("odd dimensions pad by one pixel; invalid sizes fail before encoding", () => {
  assert.equal(evenDimension(853), 854);
  assert.equal(evenDimension(480), 480);
  for (const size of [0, -1, NaN, 1.5]) assert.throws(() => evenDimension(size), /output size/);
});

test("MP4 bitrate follows the native resolution, rate, profile and multiplier formula", () => {
  assert.equal(videoBitrate(params, profiles), 1000000);
  assert.equal(videoBitrate({ ...params, rate: 60, bitrateScale: 4 }, profiles), 6000000);
  assert.equal(videoBitrate({ ...params, bitrateScale: 3 }, profiles), 1000000);
  assert.equal(videoBitrate({ ...params, width: 1280, height: 720 }, profiles), 4000000);
});

test("H.264 high and AAC-LC are preferred, with exact output config probes", async () => {
  const chosen = await chooseCodecs({ VideoEncoder: supports(() => true), AudioEncoder: supports(() => true) },
    { ...params, width: 641, rate: 60, bitrateScale: 2 }, profiles, true);
  assert.equal(chosen.video.codec, "avc1.640034");
  assert.equal(chosen.video.width, 642);
  assert.equal(chosen.video.framerate, 60);
  assert.equal(chosen.video.bitrate, 3004687);
  assert.equal(chosen.audio.codec, "mp4a.40.2");
  assert.equal(chosen.audio.sampleRate, 48000);
  assert.equal(chosen.audio.numberOfChannels, 2);
});

test("config fallback tries baseline and Opus; video-only does not require AudioEncoder", async () => {
  const VideoEncoder = supports((config) => config.codec === "avc1.42002a");
  const AudioEncoder = supports((config) => config.codec === "opus");
  const chosen = await chooseCodecs({ VideoEncoder, AudioEncoder }, params, profiles, true);
  assert.equal(chosen.video.codec, "avc1.42002a");
  assert.equal(chosen.audio.codec, "opus");
  assert.equal((await chooseCodecs({ VideoEncoder }, params, profiles, false)).audio, null);
  assert.equal(await firstSupported({ isConfigSupported() { throw new Error("unsupported"); } }, [{}]), null);
});

test("missing encoders and rejected audio support produce clear errors", async () => {
  await assert.rejects(chooseCodecs({}, params, profiles, false), /cannot encode H.264/);
  await assert.rejects(chooseCodecs({ VideoEncoder: supports(() => true) }, params, profiles, true), /cannot encode AAC or Opus/);
});

test("capability probes preserve allocation failures for the memory error page", async () => {
  const error = new RangeError("Allocation failed");
  await assert.rejects(firstSupported({ isConfigSupported() { throw error; } }, [{}]), (value) => value === error);
});

test("audio passes native segment timing, source offset, gain and pan through the mixer", async () => {
  const media = { file: { async arrayBuffer() { return new ArrayBuffer(8); } } };
  const decoded = { duration: 3 };
  let closed = false;
  let decodeCount = 0;
  const segments = [{ media, offset: 0.5, segmentOffset: 0.1, playbackRate: 2, volume: {}, pan: {} }];
  const exporter = {
    params: { start: 30 }, sequence: { properties: { rate: { get: () => 30 } } },
    analyzeSegment(start, count) { assert.equal(start, 48000); assert.equal(count, 480); return segments; },
    renderAudioSegment(items, start, count) {
      assert.equal(items[0].startOffset, 1);
      assert.equal(items[0].buffer, decoded);
      assert.equal(items[0].playbackRate, 2);
      assert.equal(start, 48000); assert.equal(count, 480);
      return "mixed";
    },
  };
  const scope = { AudioContext: class {
    async decodeAudioData() { decodeCount++; return decoded; }
    async close() { closed = true; }
  } };
  const mixer = createAudioMixer(scope, exporter, () => {});
  assert.equal(await mixer.render(0, 480), "mixed");
  await mixer.render(0, 480);
  assert.equal(decodeCount, 1);
  await mixer.dispose();
  assert.equal(closed, true);
  assert.equal(hasAudio({ audioSchedules: [{ items: [1] }] }), true);
  assert.equal(hasAudio({ audioSchedules: [{ items: [] }] }), false);
});

test("streaming fallback produces one Blob from sequential chunks and rejects corrupt offsets", async () => {
  class StreamTarget { constructor(stream) { this.stream = stream; } }
  const storage = await createStorage({ navigator: {} }, { StreamTarget });
  const writer = storage.target.stream.getWriter();
  await writer.write({ position: 0, data: Uint8Array.of(1, 2) });
  await writer.write({ position: 2, data: Uint8Array.of(3) });
  await writer.write({ position: 1, data: Uint8Array.of(9) });
  await writer.close();
  const blob = await storage.finish();
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 9, 3]);
  await storage.dispose();
  const invalid = await createStorage({ navigator: {} }, { StreamTarget });
  await assert.rejects(invalid.target.stream.getWriter().write({ position: 1, data: Uint8Array.of(0) }), /offset/);
  await invalid.dispose();
});

test("cancel during capability probing never allocates a writer or encoder", async () => {
  let resume;
  const scope = { VideoEncoder: { isConfigSupported() { return new Promise((resolve) => { resume = resolve; }); } } };
  const job = createJob(scope, { av: { profiles } }, { params, sequence: {} }, () => { throw new Error("must not load"); });
  const result = job.run();
  job.cancel(); resume({ supported: true });
  await assert.rejects(result, { name: "AbortError" });
});

function fakeBunny(events) {
  return {
    StreamTarget: class { constructor(stream) { this.stream = stream; } },
    Output: class {
      constructor(options) { this.target = options.target; this.state = "pending"; }
      addVideoTrack() {}
      addAudioTrack() {}
      async start() { this.state = "started"; }
      async finalize() {
        const writer = this.target.stream.getWriter();
        await writer.write({ position: 0, data: Uint8Array.of(1) });
        await writer.close();
        this.state = "finalized";
      }
      async cancel() { events.push("cancel"); this.state = "canceled"; }
    },
    Mp4OutputFormat: class {}, Quality: class {},
    CanvasSource: class { async add() {} },
    AudioSampleSource: class { async add(sample) { events.push(sample.length); } },
    AudioSample: { fromAudioBuffer(buffer) { return [{ length: buffer.length, close() {} }]; } },
    EncodedAudioPacketSource: class { async add() {} close() {} },
    EncodedPacket: { fromEncodedChunk(chunk) { return { ...chunk, clone(timing) { return { ...this, ...timing }; } }; } },
  };
}

test("a fractional final second retains every mixed audio sample", async () => {
  const events = [];
  const settings = { ...params, length: 31, rate: 30 };
  const exporter = {
    params: settings, sequence: { audioSchedules: [{ items: [1] }], properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 640, height: 360 } }, framesRendered: 0,
    analyzeSegment() { return []; },
    async renderAudioSegment(_segments, _offset, count) { return { getChannelData() { return new Float32Array(count); } }; },
    async renderVideoFrame() { this.framesRendered++; },
    getVideoFrame() { return this.renderVideoFrame(); },
  };
  const scope = {
    VideoEncoder: supports(() => true), navigator: {},
    AudioData: class { constructor(init) { Object.assign(this, init); } close() {} },
    AudioEncoder: class {
      static async isConfigSupported(config) { return { supported: config.codec === "opus" }; }
      constructor(callbacks) { this.callbacks = callbacks; this.state = "configured"; }
      configure() {}
      encode(sample) {
        events.push(sample.numberOfFrames);
        this.callbacks.output({ timestamp: sample.timestamp / 1000000, duration: sample.numberOfFrames / 48000 });
      }
      async flush() {}
      close() { this.state = "closed"; }
    },
  };
  const job = createJob(scope, { av: { profiles } }, exporter, () => fakeBunny(events));
  await job.run();
  assert.deepEqual(events, [48000, 1600]);
  assert.equal(exporter.framesRendered, 31);
});

test("audio packets retain negative priming for the MP4 edit list and trim tail padding", () => {
  assert.deepEqual(packetTiming(0, 1024 / 48000, 2112 / 48000, 2), {
    timestamp: -2112 / 48000, duration: 1024 / 48000,
  });
  assert.equal(packetTiming(3, 0.02, 0.04, 2), null);
  assert.deepEqual(packetTiming(2.04, 0.02, 0.05, 2), { timestamp: 1.99, duration: 2 - 1.99 });
});

test("cancel closes the encoder while a native frame is still preparing", async () => {
  const events = [];
  let finishFrame, frameStarted;
  const waiting = new Promise((resolve) => { frameStarted = resolve; });
  const exporter = {
    params, sequence: { properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 640, height: 360 } }, framesRendered: 0,
    renderVideoFrame() { frameStarted(); return new Promise((resolve) => { finishFrame = resolve; }); },
    getVideoFrame() { return this.renderVideoFrame(); },
  };
  const scope = { VideoEncoder: supports(() => true), navigator: {} };
  const job = createJob(scope, { av: { profiles } }, exporter, () => fakeBunny(events));
  const result = job.run();
  await waiting;
  job.cancel();
  assert.deepEqual(events, ["cancel"]);
  finishFrame();
  await assert.rejects(result, { name: "AbortError" });
  assert.deepEqual(events, ["cancel"]);
});

test("an encoder failure cancels the output and reaches the caller once", async () => {
  const events = [];
  const error = new DOMException("H.264 encoding failed.", "EncodingError");
  const bunny = fakeBunny(events);
  bunny.CanvasSource = class { async add() { throw error; } };
  const exporter = {
    params, sequence: { properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 640, height: 360 } }, framesRendered: 0,
    async renderVideoFrame() { this.framesRendered++; },
    getVideoFrame() { return this.renderVideoFrame(); },
  };
  const job = createJob({ VideoEncoder: supports(() => true), navigator: {} },
    { av: { profiles } }, exporter, () => bunny);
  await assert.rejects(job.run(), (value) => value === error);
  assert.deepEqual(events, ["cancel"]);
});

test("MKV and WebM UI methods forward the original receiver, arguments and result", () => {
  const plugin = require("../plugins/mp4-export/mp4-export.js");
  const disposers = [];
  const result = {};
  const calls = [];
  const prototype = {};
  for (const key of ["createOptionsPage", "createProgressPage", "createFinishedPage"]) {
    prototype[key] = function () { calls.push({ key, receiver: this, args: [...arguments] }); return result; };
  }
  const originals = { ...prototype };
  const context = {
    PZ: { ui: { export: { device: { prototype } } } },
    apis: { modules: { createRequire() { return (name) => require("../plugins/mp4-export/" + name); } } },
    lifecycle: { onDispose(dispose) { disposers.push(dispose); } },
  };
  plugin.activate(context);
  for (const format of ["mkv_vp8_opus", "webm_vp8_opus"]) {
    const owner = { params: { format } };
    for (const key of ["createProgressPage", "createFinishedPage"]) {
      assert.equal(prototype[key].call(owner, 4, "unchanged"), result);
      assert.deepEqual(calls.at(-1), { key, receiver: owner, args: [4, "unchanged"] });
    }
  }
  for (const dispose of disposers.reverse()) dispose();
  assert.deepEqual(prototype, originals);
});

test("MP4 submits the prepared canvas directly and pads only after rendering", async () => {
  const events = [], canvas = { width: 641, height: 361 }, padded = {};
  let readbacks = 0;
  const settings = { ...params, width: 641, height: 361, length: 3 };
  const exporter = {
    params: settings, sequence: { properties: { rate: { get: () => 30 } } }, renderer: { domElement: canvas },
    async renderVideoFrame() { await Promise.resolve(); canvas.frame = this.frame; events.push("render " + this.frame); },
    getVideoFrame() { readbacks++; return this.renderVideoFrame(); },
  };
  const bunny = fakeBunny(events);
  bunny.CanvasSource = class {
    constructor(input) { assert.equal(input, padded); }
    async add() { events.push("encode " + padded.frame); }
  };
  const scope = { VideoEncoder: supports(() => true), navigator: {}, document: {
    createElement() { return Object.assign(padded, { getContext() { return {
      fillRect() { events.push("clear"); }, drawImage(input) { assert.equal(input, canvas); padded.frame = input.frame; },
    }; } }); },
  } };
  await createJob(scope, { av: { profiles } }, exporter, () => bunny).run();
  assert.equal(readbacks, 0, "MP4 must not extract CPU pixels");
  assert.deepEqual(events, ["render 0", "clear", "encode 0", "render 1", "clear", "encode 1", "render 2", "clear", "encode 2"]);
  assert.equal(padded.width, 642); assert.equal(padded.height, 362);
});

test("context loss after padding rejects before encoder submission and releases the output", async () => {
  const events = [], bunny = fakeBunny(events);
  let lost = false, submitted = 0, disposed = 0;
  bunny.CanvasSource = class { async add() { submitted++; } };
  const exporter = {
    params: { ...params, width: 641, length: 1 }, framesRendered: 0,
    sequence: { properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 641, height: 360 } },
    checkExportContext() { if (lost) throw new Error("WebGL context lost at output index 0, project frame 0, time 0s"); },
    async renderVideoFrame() { this.framesRendered++; },
    failExportFrame() { this.framesRendered = 0; disposed++; },
  };
  const scope = { VideoEncoder: supports(() => true), navigator: {}, document: {
    createElement() { return { getContext() { return { fillRect() {}, drawImage() { lost = true; } }; } }; },
  } };
  await assert.rejects(createJob(scope, { av: { profiles } }, exporter, () => bunny).run(), /WebGL context lost/);
  assert.equal(submitted, 0); assert.equal(exporter.framesRendered, 0); assert.equal(disposed, 1);
  assert.deepEqual(events, ["cancel"]);
});
