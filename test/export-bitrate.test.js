"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BITRATE_SCALES,
  installEncode,
  normalizeBitrateScale,
} = require("../plugins/core/export-bitrate");
const {
  createIoSerializer,
  estimateVideoStorageBytes,
} = require("../plugins/core/io-serialization");

// Mirrors the part of CM3's encode that reads the quality profile: the
// profile lookup happens synchronously when encode is called.
function createAv() {
  const calls = [];
  const av = {
    profiles: [
      { bitrate: 1, crf: 12, speed: 8, abr: 1 },
      { bitrate: 1, crf: 4, speed: 0, abr: 1.5 },
    ],
    encode(_job, params) {
      let rate = (params.width / 640) * (params.height / 360);
      rate *= params.rate > 30 ? 1.5 : 1;
      rate *= 1e6;
      const profile = av.profiles[params.quality];
      calls.push({ videoBitrate: rate * profile.bitrate, profile });
      return Promise.resolve("blob");
    },
  };
  return { av, calls };
}

const params720 = (extra) =>
  Object.assign({ width: 1280, height: 720, rate: 30, quality: 1, length: 90 }, extra);

test("only the four offered multipliers are accepted", () => {
  assert.deepEqual(BITRATE_SCALES, [1, 2, 4, 8]);
  assert.equal(normalizeBitrateScale(4), 4);
  assert.equal(normalizeBitrateScale("8"), 8);
  for (const value of [undefined, null, 0, 3, -2, "x", 16]) {
    assert.equal(normalizeBitrateScale(value), 1);
  }
});

test("the multiplier scales the encoder target for that call only", () => {
  const { av, calls } = createAv();
  const PZ = { av };
  assert.equal(installEncode(PZ), true);
  av.encode({}, params720({ bitrateScale: 4 }));
  av.encode({}, params720());
  assert.equal(calls[0].videoBitrate, 16e6);
  assert.equal(calls[1].videoBitrate, 4e6);
  assert.equal(av.profiles[1].bitrate, 1);
});

test("1x passes the native profile object through unchanged", () => {
  const { av, calls } = createAv();
  const native = av.profiles[1];
  installEncode({ av });
  av.encode({}, params720({ bitrateScale: 1 }));
  assert.equal(calls[0].profile, native);
  assert.equal(calls[0].videoBitrate, 4e6);
});

test("the profile is restored when the native encode throws", () => {
  const { av } = createAv();
  const native = av.profiles[1];
  av.encode = () => {
    throw new Error("encoder failed");
  };
  installEncode({ av });
  assert.throws(() => av.encode({}, params720({ bitrateScale: 8 })), /encoder failed/);
  assert.equal(av.profiles[1], native);
});

test("installing twice wraps once", () => {
  const { av } = createAv();
  installEncode({ av });
  const first = av.encode;
  installEncode({ av });
  assert.equal(av.encode, first);
});

test("an already serialized encode is rebuilt around the scaled encode", async () => {
  const { av, calls } = createAv();
  const serializer = createIoSerializer({ ensureQuota: () => Promise.resolve() });
  // The serializer checks the Matroska magic of the encode result.
  const nativeEncode = av.encode;
  av.encode = function () {
    nativeEncode.apply(this, arguments);
    return Promise.resolve(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])]));
  };
  av.encode = serializer.wrapEncode(av.encode, av.profiles);
  const PZ = { av, zoidiumIoSerialization: { _serializer: serializer } };
  assert.equal(installEncode(PZ), true);
  await av.encode({}, params720({ bitrateScale: 2 }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].videoBitrate, 8e6);
  assert.equal(av.profiles[1].bitrate, 1);
});

test("the storage estimate follows the bitrate multiplier", () => {
  const profiles = createAv().av.profiles;
  const long = params720({ length: 30 * 600 });
  const base = estimateVideoStorageBytes(long, profiles);
  const scaled = estimateVideoStorageBytes(Object.assign({}, long, { bitrateScale: 4 }), profiles);
  assert.ok(scaled > base * 3, `4x estimate ${scaled} vs ${base}`);
  assert.equal(estimateVideoStorageBytes(Object.assign({}, long, { bitrateScale: 1 }), profiles), base);
});
