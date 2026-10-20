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
  await writer.close();
  const blob = await storage.finish();
  assert.equal(blob.type, "video/mp4");
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3]);
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
