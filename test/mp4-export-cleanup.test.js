"use strict";

// MP4 export cleanup must never replace the export result: a dispose failure
// after a successful write still resolves with the file, every cleanup step
// still runs, and an export failure still throws the original error.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

const params = { width: 640, height: 360, rate: 30, quality: 2, bitrateScale: 1, start: 0, length: 2 };
const profiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));

function supports(predicate) {
  return { async isConfigSupported(config) { return { supported: predicate(config), config }; } };
}

function loadRender(hooks = {}) {
  const calls = { audioDispose: 0, storageDispose: 0 };
  const source = fs.readFileSync(path.join(projectRoot, "plugins/mp4-export/render.js"), "utf8");
  const module = { exports: {} };
  function fakeRequire(id) {
    if (id === "./export-math.js") return require("../plugins/mp4-export/export-math.js");
    if (id === "./audio-mix.js") return require("../plugins/mp4-export/audio-mix.js");
    if (id === "./audio-encode.js") {
      const audioEncode = require("../plugins/mp4-export/audio-encode.js");
      return {
        ...audioEncode,
        createAudioEncoding: async (...args) => {
          const audio = await audioEncode.createAudioEncoding(...args);
          const dispose = audio.dispose.bind(audio);
          audio.dispose = (...disposeArgs) => {
            calls.audioDispose += 1;
            return dispose(...disposeArgs);
          };
          return audio;
        },
      };
    }
    if (id === "./stream-target.js") {
      const streamTarget = require("../plugins/mp4-export/stream-target.js");
      return {
        ...streamTarget,
        createStorage: async (...args) => {
          const storage = await streamTarget.createStorage(...args);
          const dispose = storage.dispose.bind(storage);
          storage.dispose = async (...disposeArgs) => {
            calls.storageDispose += 1;
            if (hooks.storageDispose === "reject") throw new Error("storage cleanup failed");
            return dispose(...disposeArgs);
          };
          return storage;
        },
      };
    }
    throw new Error("unexpected require: " + id);
  }
  new Function("require", "module", "exports", source)(fakeRequire, module, module.exports);
  return { createJob: module.exports.createJob, calls };
}

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

function audioExporter() {
  const media = { file: { async arrayBuffer() { return new ArrayBuffer(8); } } };
  const decoded = { duration: 3 };
  return {
    params,
    sequence: { audioSchedules: [{ items: [1] }], properties: { rate: { get: () => 30 } } },
    renderer: { domElement: { width: 640, height: 360 } },
    framesRendered: 0,
    analyzeSegment() { return [{ media, offset: 0, playbackRate: 1, volume: {}, pan: {} }]; },
    renderAudioSegment(_segments, _offset, count) { return { getChannelData() { return new Float32Array(count); } }; },
    async renderVideoFrame() { this.framesRendered += 1; },
    decoded,
  };
}

function audioScope(close) {
  return {
    VideoEncoder: supports(() => true),
    navigator: {},
    AudioData: class { constructor(init) { Object.assign(this, init); } close() {} },
    AudioEncoder: class {
      static async isConfigSupported(config) { return { supported: config.codec === "opus" }; }
      constructor(callbacks) { this.callbacks = callbacks; }
      configure() {}
      encode(sample) {
        this.callbacks.output({ timestamp: sample.timestamp / 1000000, duration: sample.numberOfFrames / 48000 });
      }
      async flush() {}
      close() {}
    },
    AudioContext: class {
      async decodeAudioData() { return { duration: 3 }; }
      async close() { return close(); }
    },
  };
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.join(" ")); };
  return { warnings, restore() { console.warn = original; } };
}

test("a mixer dispose failure after success still resolves with the file", async () => {
  const { createJob, calls } = loadRender();
  const events = [];
  const exporter = audioExporter();
  const scope = audioScope(async () => { throw new Error("mixer cleanup failed"); });
  const { warnings, restore } = captureWarnings();
  try {
    const file = await createJob(scope, { av: { profiles } }, exporter, () => fakeBunny(events)).run();
    assert.equal(file.type, "video/mp4", "the written file is the result");
    assert.equal(exporter.framesRendered, 2);
  } finally {
    restore();
  }
  assert.equal(warnings.length, 1, "the cleanup failure is reported once");
  assert.match(warnings[0], /MP4 export cleanup failed \(mixer\)/);
  assert.equal(calls.audioDispose, 1, "audio cleanup still runs");
  assert.equal(calls.storageDispose, 1, "storage cleanup still runs");
});

test("a storage dispose failure after success still resolves with the file", async () => {
  const { createJob, calls } = loadRender({ storageDispose: "reject" });
  const events = [];
  const exporter = audioExporter();
  const scope = audioScope(async () => {});
  const { warnings, restore } = captureWarnings();
  try {
    const file = await createJob(scope, { av: { profiles } }, exporter, () => fakeBunny(events)).run();
    assert.equal(file.type, "video/mp4", "the written file is the result");
  } finally {
    restore();
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /MP4 export cleanup failed \(storage\)/);
  assert.equal(calls.audioDispose, 1);
  assert.equal(calls.storageDispose, 1);
});

test("an export failure still throws the original error when cleanup fails", async () => {
  const { createJob, calls } = loadRender({ storageDispose: "reject" });
  const events = [];
  const failure = new DOMException("H.264 encoding failed.", "EncodingError");
  const bunny = fakeBunny(events);
  bunny.CanvasSource = class { async add() { throw failure; } };
  const exporter = audioExporter();
  const scope = audioScope(async () => { throw new Error("mixer cleanup failed"); });
  const { warnings, restore } = captureWarnings();
  try {
    await assert.rejects(
      createJob(scope, { av: { profiles } }, exporter, () => bunny).run(),
      (value) => value === failure,
      "the original export error wins",
    );
  } finally {
    restore();
  }
  assert.equal(warnings.length, 2, "both cleanup failures are reported");
  assert.ok(warnings.every((warning) => /MP4 export cleanup failed/.test(warning)));
  assert.equal(calls.audioDispose, 1, "audio cleanup still runs on failure");
  assert.equal(calls.storageDispose, 1, "storage cleanup still runs on failure");
  assert.deepEqual(events, ["cancel"]);
});
