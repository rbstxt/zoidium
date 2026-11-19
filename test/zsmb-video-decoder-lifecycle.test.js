"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { create } = require("../plugins/smart-motion-blur-lite/video-decoder.js");

test("disposing while a video track opens releases its input", async () => {
  let resolveTrack, releaseCount = 0, started;
  const opening = new Promise(resolve => { started = resolve; });
  const track = new Promise(resolve => { resolveTrack = resolve; });
  const previous = { VideoDecoder: global.VideoDecoder, bunny: global.__testBunny };
  global.VideoDecoder = class {};
  global.__testBunny = {
    ALL_FORMATS: [], BlobSource: class {},
    Input: class {
      getPrimaryVideoTrack() { started(); return track; }
      dispose() { releaseCount++; }
    },
    VideoSampleSink: class {},
  };
  const decoder = create({ _zoidiumGetAsset: () => "module.exports=globalThis.__testBunny;" }, {}, "/");
  try {
    const pending = decoder.decode({ item: { media: { url: "test", file: new Blob() } }, renderer: {} });
    await opening;
    decoder.dispose();
    resolveTrack({ canDecode: async () => true });
    await pending;
    assert.equal(releaseCount, 1);
  } finally {
    global.VideoDecoder = previous.VideoDecoder;
    global.__testBunny = previous.bunny;
  }
});

test("disposing while video decode support is checked releases its input", async () => {
  let resolveCanDecode, releaseCount = 0, started;
  const checking = new Promise(resolve => { started = resolve; });
  const canDecode = new Promise(resolve => { resolveCanDecode = resolve; });
  const previous = { VideoDecoder: global.VideoDecoder, bunny: global.__testBunny };
  global.VideoDecoder = class {};
  global.__testBunny = {
    ALL_FORMATS: [], BlobSource: class {},
    Input: class {
      async getPrimaryVideoTrack() { return { canDecode() { started(); return canDecode; } }; }
      dispose() { releaseCount++; }
    },
    VideoSampleSink: class {},
  };
  const decoder = create({ _zoidiumGetAsset: () => "module.exports=globalThis.__testBunny;" }, {}, "/");
  try {
    const pending = decoder.decode({ item: { media: { url: "test", file: new Blob() } }, renderer: {} });
    await checking;
    decoder.dispose();
    resolveCanDecode(true);
    assert.equal(await pending, null);
    assert.equal(releaseCount, 1);
  } finally {
    global.VideoDecoder = previous.VideoDecoder;
    global.__testBunny = previous.bunny;
  }
});
