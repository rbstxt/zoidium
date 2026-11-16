"use strict";

// The MP4 path must hand the requested bitrate, rate factor and Bitrate
// scale to the encoder for every setting combination. Drives the real
// vendored mediabunny Quality/CanvasSource classes with a fake VideoEncoder
// that records isConfigSupported/configure arguments.
const test = require("node:test");
const assert = require("node:assert/strict");
const { chooseCodecs, videoBitrate } = require("../plugins/mp4-export/export-math.js");

globalThis.HTMLCanvasElement = globalThis.HTMLCanvasElement || class HTMLCanvasElement {};
const records = { supported: [], configured: [] };
globalThis.VideoEncoder = globalThis.VideoEncoder || class FakeVideoEncoder {
  static async isConfigSupported(config) {
    records.supported.push(JSON.parse(JSON.stringify(config)));
    return { supported: true, config };
  }
  constructor() { this.state = "unconfigured"; }
  configure(config) {
    records.configured.push(JSON.parse(JSON.stringify(config)));
    this.state = "configured";
  }
  encode() {}
  async flush() {}
  close() { this.state = "closed"; }
  get encodeQueueSize() { return 0; }
  addEventListener() {}
};
const bunny = require("../plugins/mp4-export/vendor/mediabunny-1.62.0.cjs");

const profiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));

async function encoderConfig(params) {
  records.supported.length = 0;
  records.configured.length = 0;
  const codecs = await chooseCodecs({ VideoEncoder: globalThis.VideoEncoder }, params, profiles, false);
  const video = new bunny.CanvasSource(new globalThis.HTMLCanvasElement(), {
    codec: "avc",
    fullCodecString: codecs.video.codec,
    quality: new bunny.Quality({ bitrate: codecs.video.bitrate }),
    latencyMode: "quality",
    keyFrameInterval: 2,
  });
  video._connectedTrack = { metadata: { frameRate: params.rate }, output: { _muxer: {} } };
  await video._encoder.ensureEncoder({
    codedWidth: codecs.video.width,
    codedHeight: codecs.video.height,
    squarePixelWidth: codecs.video.width,
    squarePixelHeight: codecs.video.height,
  });
  return { codecs, configured: records.configured.at(-1), probed: records.supported[0] };
}

test("the requested bitrate, scale, rate and profile reach VideoEncoder.configure", async () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    for (const rate of [30, 60]) {
      for (const bitrateScale of [1, 8]) {
        const params = { width, height, rate, quality: 2, bitrateScale, start: 0, length: 30 };
        const { codecs, configured, probed } = await encoderConfig(params);
        const expected = videoBitrate(params, profiles);
        assert.equal(codecs.video.bitrate, expected);
        assert.equal(probed.bitrate, expected, `${width}x${height}@${rate} scale ${bitrateScale}x probe`);
        assert.equal(configured.bitrate, expected, `${width}x${height}@${rate} scale ${bitrateScale}x configure`);
        assert.equal(configured.bitrateMode, "variable");
        assert.equal(configured.latencyMode, "quality");
        assert.equal(configured.framerate, rate);
        assert.equal(configured.width, width + (width % 2));
        assert.equal(configured.height, height + (height % 2));
        assert.match(configured.codec, /^avc1\./);
      }
    }
  }
});

test("quality presets do not change the MP4 encoder bitrate", async () => {
  const seen = new Set();
  for (const quality of [0, 1, 2, 3, 4]) {
    const params = { width: 1920, height: 1080, rate: 30, quality, bitrateScale: 2, start: 0, length: 30 };
    const { configured } = await encoderConfig(params);
    seen.add(configured.bitrate);
    assert.equal(configured.bitrate, 18000000);
  }
  assert.equal(seen.size, 1);
});
