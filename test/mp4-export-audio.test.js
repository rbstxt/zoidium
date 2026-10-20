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
