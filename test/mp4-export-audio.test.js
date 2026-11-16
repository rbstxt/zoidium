"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { measureAacDelay } = require("../plugins/mp4-export/audio-encode.js");
const { decodeAudio, decodeWithWorker } = require("../plugins/mp4-export/audio-decode.js");

test("AAC calibration measures the selected encoder instead of assuming a platform delay", async () => {
  const closed = [];
  const scope = {
    AudioData: class { constructor(init) { Object.assign(this, init); } close() { closed.push("sample"); } },
    AudioEncoder: class {
      constructor(callbacks) { this.callbacks = callbacks; this.state = "unconfigured"; }
      configure(config) { assert.equal(config.codec, "mp4a.40.2"); }
      encode(sample) {
        assert.equal(sample.numberOfChannels, 2);
        assert.equal(sample.sampleRate, 48000);
        assert.ok(sample.data[8192] > 0.8);
      }
      async flush() { this.callbacks.output({}, { decoderConfig: { codec: "mp4a.40.2" } }); }
      close() { this.state = "closed"; closed.push("encoder"); }
    },
    AudioDecoder: class {
      constructor(callbacks) { this.callbacks = callbacks; this.state = "unconfigured"; }
      configure() {}
      decode() {}
      async flush() {
        this.callbacks.output({
          timestamp: 0, numberOfFrames: 24576,
          copyTo(pcm) { pcm[8192 + 2112] = 0.8; },
          close() { closed.push("decoded frame"); },
        });
      }
      close() { this.state = "closed"; closed.push("decoder"); }
    },
  };
  assert.equal(await measureAacDelay(scope, { codec: "mp4a.40.2" }, new AbortController().signal), 2112);
  assert.deepEqual(closed, ["sample", "decoded frame", "encoder", "decoder"]);
});

test("cancel during AAC calibration closes the pending encoder", async () => {
  const controller = new AbortController();
  let rejectFlush;
  let closed = 0;
  const scope = {
    AudioData: class { close() {} },
    AudioEncoder: class {
      configure() {}
      encode() {}
      flush() { return new Promise((_resolve, reject) => { rejectFlush = reject; }); }
      close() { this.state = "closed"; closed++; rejectFlush(new DOMException("Cancelled", "AbortError")); }
    },
  };
  const pending = measureAacDelay(scope, {}, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(closed, 1);
});

test("native libav fallback decodes both channels and terminates its private worker", async () => {
  let terminated = 0, reads = 0;
  const channels = [];
  const scope = { Worker: class {
    constructor(url) {
      assert.equal(url, "worker/av.js");
      queueMicrotask(() => this.onmessage({ data: { type: "ready" } }));
    }
    postMessage(message) {
      assert.equal(message.options.decode, true);
      queueMicrotask(() => this.onmessage({ data: {
        type: "done", data: [{ data: Float32Array.of(0.25, -0.5).buffer }, { data: Float32Array.of(-0.25, 0.5).buffer }],
      } }));
    }
    terminate() { terminated++; }
  } };
  const context = {
    async decodeAudioData() { throw new Error("Unsupported source"); },
    createBuffer(count, length, rate) {
      assert.equal(count, 2); assert.equal(length, 2); assert.equal(rate, 48000);
      return { copyToChannel(pcm, index) { channels[index] = [...pcm]; } };
    },
  };
  await decodeAudio(scope, context, { async arrayBuffer() { reads++; return new ArrayBuffer(8); } }, new AbortController().signal);
  assert.equal(reads, 2);
  assert.deepEqual(channels, [[0.25, -0.5], [-0.25, 0.5]]);
  assert.equal(terminated, 1);
});

test("worker decoding stops on cancel and releases listeners", async () => {
  const controller = new AbortController();
  let terminated = 0;
  const scope = { Worker: class { terminate() { terminated++; } } };
  const result = decodeWithWorker(scope, {}, { async arrayBuffer() { return new ArrayBuffer(1); } }, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(terminated, 1);
});

test("audio allocation failures retain their identity for the single export error page", async () => {
  const error = new RangeError("Allocation failed");
  await assert.rejects(decodeAudio({}, { async decodeAudioData() { throw error; } }, {
    async arrayBuffer() { return new ArrayBuffer(0); },
  }, new AbortController().signal), (value) => value === error);
});

// ---------------------------------------------------------------- audio plan
// A project can hold audio clips for video-only files, because an audio
// element accepts such a container and stays silent. The export must skip
// those clips instead of failing to decode them.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { fakeFile, mp4, webm } = require("./media-container-fixture.js");
const { planAudio, scheduledMedias } = require("../plugins/mp4-export/audio-mix.js");

function loadProbe() {
  const sandbox = { module: { exports: {} }, console };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../plugins/core/video-seek-policy.js"), "utf8"),
    sandbox,
  );
  return sandbox.module.exports.probeAudioTrack;
}

function clip(media, start = 0) {
  return { start, properties: { media: { get: () => media } } };
}

function sequence(items) {
  return { audioSchedules: items.length ? [{ items }] : [] };
}

test("a file with no audio stream is planned as silent", async () => {
  const media = { file: fakeFile(mp4(["vide"])) };
  const plan = await planAudio(sequence([clip(media)]), loadProbe());
  assert.equal(plan.present, false);
  assert.ok(plan.silent.has(media));
});

test("a video-only WebM clip is planned as silent", async () => {
  const media = { file: fakeFile(webm([1])) };
  const plan = await planAudio(sequence([clip(media)]), loadProbe());
  assert.equal(plan.present, false);
  assert.ok(plan.silent.has(media));
});

test("one audible source keeps the audio track and skips only the silent clip", async () => {
  const videoOnly = { file: fakeFile(mp4(["vide"])) };
  const withSound = { file: fakeFile(mp4(["vide", "soun"])) };
  const plan = await planAudio(sequence([clip(videoOnly), clip(withSound)]), loadProbe());
  assert.equal(plan.present, true);
  assert.deepEqual([...plan.silent], [videoOnly]);
});

test("an unknown container keeps today's audio track", async () => {
  const media = { file: fakeFile(Buffer.from("RIFF0000WAVEfmt ")) };
  const plan = await planAudio(sequence([clip(media)]), loadProbe());
  assert.equal(plan.present, true);
  assert.equal(plan.silent.size, 0);
});

test("a clip without a readable media value keeps today's audio track", async () => {
  const plan = await planAudio(sequence([{ start: 0 }]), loadProbe());
  assert.equal(plan.present, true);
  assert.equal(plan.silent.size, 0);
  assert.equal(scheduledMedias(sequence([{ start: 0 }])).undecided, true);
});

test("a probe failure keeps today's audio track", async () => {
  const media = { file: fakeFile(mp4(["vide"])) };
  const plan = await planAudio(sequence([clip(media)]), async () => { throw new Error("read failed"); });
  assert.equal(plan.present, true);
  assert.equal(plan.silent.size, 0);
});

test("without a probe the plan matches the native audio decision", async () => {
  assert.equal((await planAudio(sequence([clip({})]), undefined)).present, true);
  assert.equal((await planAudio(sequence([]), undefined)).present, false);
});

function supports(predicate) {
  return { async isConfigSupported(config) { return { supported: predicate(config), config }; } };
}

function fakeBunny(events) {
  return {
    StreamTarget: class { constructor(stream) { this.stream = stream; } },
    Output: class {
      constructor(options) { this.target = options.target; this.state = "pending"; }
      addVideoTrack() { events.push("video-track"); }
      addAudioTrack() { events.push("audio-track"); }
      async start() { this.state = "started"; }
      async finalize() {
        const writer = this.target.stream.getWriter();
        await writer.write({ position: 0, data: Uint8Array.of(1) });
        await writer.close();
        this.state = "finalized";
      }
      async cancel() { this.state = "canceled"; }
    },
    Mp4OutputFormat: class {}, Quality: class {},
    CanvasSource: class { async add() {} },
    EncodedAudioPacketSource: class { async add() {} close() {} },
    EncodedPacket: { fromEncodedChunk(chunk) { return { ...chunk, clone(timing) { return { ...this, ...timing }; } }; } },
  };
}

function exportScope(options = {}) {
  return {
    VideoEncoder: supports(() => true),
    AudioEncoder: class {
      // Opus avoids the AAC timing calibration, so the decode failure below is
      // the failure this test reports.
      static async isConfigSupported(config) { return { supported: config.codec === "opus" }; }
      constructor(callbacks) { this.callbacks = callbacks; }
      configure() {}
      encode() {}
      async flush() {}
      close() {}
    },
    AudioContext: class {
      async decodeAudioData() {
        if (options.decode !== "ok") throw new Error("Unable to decode audio data");
        return { duration: 3, length: 48000, sampleRate: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(48000) };
      }
      async close() {}
    },
    Worker: class { constructor() { throw new Error("worker unavailable"); } },
    AudioData: class {},
    navigator: {},
    ZoidiumVideoSeekPolicy: { probeAudioTrack: loadProbe() },
  };
}

function exporterWith(items, medias) {
  return {
    params: { width: 640, height: 360, rate: 30, quality: 2, bitrateScale: 1, start: 0, length: 2 },
    sequence: { audioSchedules: items.length ? [{ items }] : [], properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 640, height: 360 } },
    framesRendered: 0,
    analyzeSegment() {
      return medias.map((media) => ({ media, offset: 0, playbackRate: 1, volume: {}, pan: {} }));
    },
    renderAudioSegment(_segments, _offset, count) {
      return { getChannelData() { return new Float32Array(count); } };
    },
    async renderVideoFrame() { this.framesRendered += 1; },
  };
}

function renderModule() {
  return require("../plugins/mp4-export/render.js");
}

test("a re-opened project whose only audio clip is video-only exports without an audio track", async () => {
  // The clip survives in the saved project; the asset it references is a
  // video-only MP4, so no audio track is created and no decode is attempted.
  const media = { file: fakeFile(mp4(["vide"])) };
  const events = [];
  const exporter = exporterWith([clip(media)], [media]);
  const file = await renderModule().createJob(exportScope(), { av: { profiles: Array.from({ length: 5 }, () => ({ bitrate: 1 })) } },
    exporter, () => fakeBunny(events)).run();
  assert.equal(file.type, "video/mp4");
  assert.equal(exporter.framesRendered, 2);
  assert.deepEqual(events, ["video-track"], "no audio track is added");
  assert.equal(exporter.totalFrames, 2);
});

test("a real audio asset that cannot be decoded still fails with the current message", async () => {
  const media = { file: fakeFile(Buffer.from("RIFF0000WAVEfmt ")) };
  const events = [];
  const exporter = exporterWith([clip(media)], [media]);
  await assert.rejects(
    renderModule().createJob(exportScope(), { av: { profiles: Array.from({ length: 5 }, () => ({ bitrate: 1 })) } },
      exporter, () => fakeBunny(events)).run(),
    (error) => {
      assert.match(error.message, /^MP4 could not decode an audio asset\. Convert the asset to WAV and try again, or use MKV\/WebM\.$/);
      return true;
    },
  );
  assert.ok(events.includes("audio-track"), "an unknown container keeps the audio track");
});

test("an audio read failure never surfaces the browser's raw fetch text", async () => {
  // A media read can fail for reasons outside the export (a revoked Blob URL or
  // a changed file). Both decode attempts then fail, and the export must keep
  // its own explanation instead of the browser's "Failed to fetch".
  const response = { async arrayBuffer() { throw new TypeError("Failed to fetch"); } };
  const context = { async decodeAudioData() { throw new Error("Unsupported source"); } };
  await assert.rejects(
    decodeAudio({ Worker: class { constructor() { throw new Error("no worker"); } } }, context, response, new AbortController().signal),
    (error) => {
      assert.match(error.message, /^MP4 could not decode an audio asset\./);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    },
  );
});
