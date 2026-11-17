"use strict";

// Every MP4 export must be tagged limited-range BT.709 with the sRGB transfer
// in the avcC SPS and in any in-band SPS. The fixtures are SPS NAL units from
// real encoders, pasted as hex: a Main-profile SPS with VUI timing, a
// High-profile SPS without a VUI, and a High-profile SPS with scaling lists.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  avcCLengthSize, createPacketTagger, parseSps, rewriteAvcC, rewriteInBandSps, rewriteSps,
} = require("../plugins/mp4-export/avc-vui.js");

function hex(value) {
  return Uint8Array.from(value.match(/../g).map((byte) => parseInt(byte, 16)));
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Main profile (77), level 41, pic_order_cnt_type 2, crop, VUI with timing.
const MAIN_SPS = "674d402995a01e0089f9701100000303e80000ea6084";
// High profile (100), level 40, no VUI at all.
const HIGH_SPS = "67640028ac16dc0f0044fca8";
// High profile (100), level 13, scaling lists of 16 everywhere (flat).
const SCALING_SPS = "6764000dad843fffc21fffe10ffff087fff843fffc21fffe10ffffffffffffffff087fffffffffffffffd94141fb0110000003001000000303c0f1429960";
const MAIN_AVCC = "014d4029ffe10016674d402995a01e0089f9701100000303e80000ea6084" + "01000468ee3c80";
const HIGH_AVCC = "01640028ffe1000c67640028ac16dc0f0044fca8" + "01000468ee3cb0" + "fdf8f800";
const SPS_PPS = "68ee3c80";
const HIGH_PPS = "68ee3cb0";

test("a Main-profile SPS with VUI timing keeps every field and gains the signal", () => {
  const before = parseSps(hex(MAIN_SPS));
  assert.equal(before.profileIdc, 77);
  assert.equal(before.levelIdc, 41);
  assert.equal(before.picOrderCntType, 2);
  assert.equal(before.maxNumRefFrames, 1);
  assert.equal(before.frameCroppingFlag, 1);
  assert.equal(before.frameCropBottom, 4);
  assert.equal(before.vuiParametersPresent, 1);
  assert.equal(before.videoSignalTypePresent, 0);
  assert.equal(before.numUnitsInTick, 1000);
  assert.equal(before.timeScale, 60000);

  const after = parseSps(rewriteSps(hex(MAIN_SPS)));
  for (const field of [
    "constraintFlags", "levelIdc", "profileIdc", "seqParameterSetId", "log2MaxFrameNumMinus4",
    "picOrderCntType", "maxNumRefFrames", "gapsInFrameNumValueAllowedFlag", "picWidthInMbsMinus1",
    "picHeightInMapUnitsMinus1", "frameMbsOnlyFlag", "direct8x8InferenceFlag", "frameCroppingFlag",
    "frameCropLeft", "frameCropRight", "frameCropTop", "frameCropBottom", "numUnitsInTick", "timeScale",
  ]) {
    assert.deepEqual(after[field], before[field], field + " must not change");
  }
  assert.equal(after.vuiParametersPresent, 1);
  assert.equal(after.videoSignalTypePresent, 1);
  assert.equal(after.videoFormat, 5);
  assert.equal(after.videoFullRangeFlag, 0);
  assert.equal(after.colourDescriptionPresent, 1);
  assert.equal(after.colourPrimaries, 1);
  assert.equal(after.transferCharacteristics, 13);
  assert.equal(after.matrixCoefficients, 1);
});

test("a High-profile SPS without a VUI gets one appended", () => {
  const before = parseSps(hex(HIGH_SPS));
  assert.equal(before.profileIdc, 100);
  assert.equal(before.levelIdc, 40);
  assert.equal(before.chromaFormatIdc, 1);
  assert.equal(before.vuiParametersPresent, 0);

  const after = parseSps(rewriteSps(hex(HIGH_SPS)));
  assert.equal(after.profileIdc, 100);
  assert.equal(after.levelIdc, 40);
  assert.equal(after.chromaFormatIdc, 1);
  assert.equal(after.bitDepthLumaMinus8, 0);
  assert.equal(after.bitDepthChromaMinus8, 0);
  assert.equal(after.qpprimeYZeroTransformBypassFlag, 0);
  assert.equal(after.seqScalingMatrixPresent, 0);
  assert.equal(after.picOrderCntType, before.picOrderCntType);
  assert.equal(after.vuiParametersPresent, 1);
  assert.equal(after.videoSignalTypePresent, 1);
  assert.equal(after.videoFormat, 5);
  assert.equal(after.videoFullRangeFlag, 0);
  assert.equal(after.colourPrimaries, 1);
  assert.equal(after.transferCharacteristics, 13);
  assert.equal(after.matrixCoefficients, 1);
});

test("a High-profile SPS with scaling lists keeps them bit-exactly", () => {
  const before = parseSps(hex(SCALING_SPS));
  assert.equal(before.profileIdc, 100);
  assert.equal(before.seqScalingMatrixPresent, 1);
  assert.equal(before.scalingLists.length, 8);
  assert.equal(before.scalingLists[0].length, 16);
  assert.equal(before.scalingLists[6].length, 64);
  assert.deepEqual(before.scalingLists[0], Array(16).fill(16));
  assert.deepEqual(before.scalingLists[7], Array(64).fill(16));

  const after = parseSps(rewriteSps(hex(SCALING_SPS)));
  assert.deepEqual(after.scalingLists, before.scalingLists);
  assert.equal(after.vuiParametersPresent, 1);
  assert.equal(after.videoSignalTypePresent, 1);
  assert.equal(after.videoFullRangeFlag, 0);
  assert.equal(after.colourPrimaries, 1);
  assert.equal(after.transferCharacteristics, 13);
  assert.equal(after.matrixCoefficients, 1);
  assert.equal(after.numUnitsInTick, before.numUnitsInTick);
  assert.equal(after.timeScale, before.timeScale);
});

test("rewriting is idempotent for every fixture", () => {
  for (const fixture of [MAIN_SPS, HIGH_SPS, SCALING_SPS]) {
    const once = rewriteSps(hex(fixture));
    const twice = rewriteSps(once);
    assert.equal(toHex(twice), toHex(once));
  }
});

test("the rewritten SPS keeps the emulation-prevention bytes legal", () => {
  for (const fixture of [MAIN_SPS, HIGH_SPS, SCALING_SPS]) {
    const bytes = rewriteSps(hex(fixture));
    // The one-byte NAL header is not part of the RBSP, so start at the first
    // payload byte that can complete a zero pair.
    for (let index = 3; index < bytes.length; index++) {
      if (bytes[index - 2] === 0 && bytes[index - 1] === 0) {
        // A payload byte after two zeros must be the 0x03 escape or larger.
        assert.ok(bytes[index] >= 3, "a zero pair must be escaped at " + index);
      }
    }
  }
});

test("parsing rejects truncated or non-SPS input", () => {
  assert.throws(() => parseSps(hex("67")), /too short/);
  assert.throws(() => parseSps(hex("68ee3c80")), /not an SPS/);
  assert.throws(() => parseSps(hex(MAIN_SPS).subarray(0, 12)), /ended early|trailing|data after/i);
  assert.throws(() => rewriteSps(hex("67ffffffffffffffff")), /SPS|invalid|unsupported/i);
});

test("an avcC record keeps its profile, PPS and trailing bytes", () => {
  const record = rewriteAvcC(hex(MAIN_AVCC));
  assert.equal(record[0], 1);
  assert.equal(record[1], 0x4d);
  assert.equal(record[2], 0x40);
  assert.equal(record[3], 0x29);
  assert.equal(record[4], 0xff);
  assert.equal(record[5], 0xe1);
  const spsLength = (record[6] << 8) | record[7];
  assert.equal(spsLength, record.length - 15);
  const sps = parseSps(record.subarray(8, 8 + spsLength));
  assert.equal(sps.videoSignalTypePresent, 1);
  assert.equal(sps.transferCharacteristics, 13);
  const pps = record.subarray(8 + spsLength);
  assert.equal(pps[0], 1);
  assert.equal(toHex(pps.subarray(3)), SPS_PPS);
  assert.equal(avcCLengthSize(hex(MAIN_AVCC)), 4);
});

test("the High-profile avcC trailing extension bytes survive", () => {
  const original = hex(HIGH_AVCC);
  const record = rewriteAvcC(original);
  assert.equal(record[1], 0x64);
  assert.equal(record[3], 0x28);
  assert.equal(toHex(record.subarray(record.length - 4)), "fdf8f800");
  const spsLength = (record[6] << 8) | record[7];
  const pps = record.subarray(8 + spsLength);
  assert.equal(pps[0], 1);
  assert.equal(toHex(pps.subarray(3, 7)), HIGH_PPS);
  // Only the SPS moved: the PPS never changes and the record only grows by
  // the bytes the added VUI needs.
  assert.ok(record.length > original.length);
});

test("in-band SPS NAL units in a key packet are rewritten with their length", () => {
  const sps = hex(HIGH_SPS);
  const pps = hex(HIGH_PPS);
  const idr = hex("6588840015ff");
  const packet = Uint8Array.from([
    0, 0, 0, sps.length, ...sps,
    0, 0, 0, pps.length, ...pps,
    0, 0, 0, idr.length, ...idr,
  ]);
  const patched = rewriteInBandSps(packet, 4);
  assert.ok(patched);
  let offset = 0;
  const lengths = [];
  const units = [];
  while (offset < patched.length) {
    const length = (patched[offset] << 24) | (patched[offset + 1] << 16) |
      (patched[offset + 2] << 8) | patched[offset + 3];
    offset += 4;
    lengths.push(length);
    units.push(patched.subarray(offset, offset + length));
    offset += length;
  }
  assert.equal(offset, patched.length);
  assert.equal(lengths.length, 3);
  assert.equal(lengths[0], units[0].length);
  assert.equal(parseSps(units[0]).videoSignalTypePresent, 1);
  assert.equal(toHex(units[1]), HIGH_PPS);
  assert.equal(toHex(units[2]), toHex(idr));
});

test("a packet without a SPS is left alone", () => {
  const idr = hex("6588840015ff");
  const packet = Uint8Array.from([0, 0, 0, idr.length, ...idr]);
  assert.equal(rewriteInBandSps(packet, 4), null);
  assert.equal(rewriteInBandSps(new Uint8Array(0), 4), null);
  assert.equal(rewriteInBandSps(Uint8Array.of(0, 0, 0, 9, 1), 4), null);
});

test("every four-byte length size is honoured", () => {
  const sps = hex(HIGH_SPS);
  const packet = Uint8Array.from([sps.length, ...sps]);
  const patched = rewriteInBandSps(packet, 1);
  assert.ok(patched);
  assert.equal(patched[0], patched.length - 1);
  assert.equal(parseSps(patched.subarray(1)).videoSignalTypePresent, 1);
});

test("the packet tagger rewrites the decoder config the muxer receives", () => {
  const tagger = createPacketTagger(() => {});
  const description = hex(HIGH_AVCC).buffer;
  const meta = {
    decoderConfig: {
      codec: "avc1.640028",
      description,
      colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: true },
      codedWidth: 1920,
      codedHeight: 1080,
    },
  };
  tagger.handle({ type: "key", data: hex("6588840015ff") }, meta);
  assert.deepEqual(meta.decoderConfig.colorSpace, {
    primaries: "bt709", transfer: "iec61966-2-1", matrix: "bt709", fullRange: false,
  });
  const patched = meta.decoderConfig.description;
  assert.ok(patched instanceof Uint8Array);
  assert.equal(avcCLengthSize(patched), 4);
  const spsLength = (patched[6] << 8) | patched[7];
  const sps = parseSps(patched.subarray(8, 8 + spsLength));
  assert.equal(sps.videoFullRangeFlag, 0);
  assert.equal(sps.transferCharacteristics, 13);
  assert.equal(sps.colourPrimaries, 1);
  assert.equal(sps.matrixCoefficients, 1);
});

test("a tagger failure keeps the stream and warns once", () => {
  const warnings = [];
  const tagger = createPacketTagger((message) => warnings.push(message));
  const broken = hex("01ffffffffffffffff");
  const meta = { decoderConfig: { description: broken.buffer, colorSpace: { fullRange: true } } };
  tagger.handle({ type: "key", data: hex("6588840015ff") }, meta);
  tagger.handle({ type: "key", data: hex("6588840015ff") }, meta);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not tag the H.264 colour description/);
  assert.equal(meta.decoderConfig.description, broken.buffer, "the original description stays");
  assert.deepEqual(meta.decoderConfig.colorSpace, { fullRange: true });
});

test("packets without a decoder config are not tagged", () => {
  const tagger = createPacketTagger(() => {});
  const data = hex("6588840015ff");
  tagger.handle({ type: "delta", data }, undefined);
  assert.equal(toHex(data), "6588840015ff");
});
