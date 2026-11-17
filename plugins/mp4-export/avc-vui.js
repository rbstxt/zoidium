"use strict";

// Tags an H.264 stream as limited-range BT.709 with the sRGB transfer, in both
// the avcC record (which becomes the MP4 `colr` and SPS VUI) and any in-band
// SPS that an encoder might emit. Players that ignore `colr` read the SPS VUI;
// players that ignore both assume limited range, which the encoder output now
// matches because `yuv-convert.js` converts the levels itself.
const SPS_NAL_TYPE = 7;
// Profiles that carry the High-profile SPS fields between level_idc and
// log2_max_frame_num_minus4 (ITU-T H.264 7.3.2.1.1).
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
// H.264 colour names for the values the container and the SPS must both carry.
const TARGET_PRIMARIES = 1;
const TARGET_TRANSFER = 13;
const TARGET_MATRIX = 1;
const VIDEO_FORMAT_UNSPECIFIED = 5;

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.bit = 0;
  }

  readBit() {
    if (this.bit >= this.bytes.length * 8) throw new Error("The SPS ended early.");
    const byte = this.bytes[this.bit >> 3];
    const value = (byte >> (7 - (this.bit & 7))) & 1;
    this.bit++;
    return value;
  }

  readBits(count) {
    let value = 0;
    for (let index = 0; index < count; index++) value = value * 2 + this.readBit();
    return value;
  }

  readUE() {
    let zeros = 0;
    while (this.readBit() === 0) {
      zeros++;
      if (zeros > 31) throw new Error("The SPS holds an invalid exp-Golomb code.");
    }
    return 2 ** zeros - 1 + (zeros ? this.readBits(zeros) : 0);
  }

  readSE() {
    const value = this.readUE();
    return value % 2 === 0 ? -value / 2 : (value + 1) / 2;
  }
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.bit = 0;
    this.current = 0;
  }

  writeBit(value) {
    this.current = (this.current << 1) | (value & 1);
    this.bit++;
    if (this.bit === 8) {
      this.bytes.push(this.current);
      this.current = 0;
      this.bit = 0;
    }
  }

  writeBits(value, count) {
    for (let index = count - 1; index >= 0; index--) this.writeBit((value >> index) & 1);
  }

  copyBits(bytes, start, end) {
    for (let bit = start; bit < end; bit++) {
      this.writeBit((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
  }

  alignWithZeros() {
    while (this.bit !== 0) this.writeBit(0);
  }

  toBytes() {
    if (this.bit !== 0) throw new Error("The bit writer is not byte aligned.");
    return Uint8Array.from(this.bytes);
  }
}

function stripEmulationPrevention(bytes) {
  const out = new Uint8Array(bytes.length);
  let length = 0;
  let zeros = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (zeros >= 2 && byte === 3) {
      zeros = 0;
      continue;
    }
    out[length++] = byte;
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return out.slice(0, length);
}

function insertEmulationPrevention(bytes) {
  const out = [];
  let zeros = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index];
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

function readScalingList(reader, size) {
  let last = 8;
  let next = 8;
  const values = [];
  for (let index = 0; index < size; index++) {
    if (next !== 0) next = (last + reader.readSE() + 256) % 256;
    last = next === 0 ? last : next;
    values.push(last);
  }
  return values;
}

function readHrdParameters(reader) {
  const cpbCountMinus1 = reader.readUE();
  reader.readBits(4);
  reader.readBits(4);
  for (let index = 0; index <= cpbCountMinus1; index++) {
    reader.readUE();
    reader.readUE();
    reader.readBit();
  }
  reader.readBits(5);
  reader.readBits(5);
  reader.readBits(5);
  reader.readBits(5);
}

function readVui(reader, sps) {
  if (reader.readBit()) {
    sps.aspectRatioIdc = reader.readBits(8);
    if (sps.aspectRatioIdc === 255) {
      sps.sarWidth = reader.readBits(16);
      sps.sarHeight = reader.readBits(16);
    }
  }
  if (reader.readBit()) sps.overscanAppropriateFlag = reader.readBit();
  const videoSignalFlagBit = reader.bit;
  sps.videoSignalTypePresent = reader.readBit();
  if (sps.videoSignalTypePresent) {
    sps.videoFormat = reader.readBits(3);
    sps.videoFullRangeFlag = reader.readBit();
    sps.colourDescriptionPresent = reader.readBit();
    if (sps.colourDescriptionPresent) {
      sps.colourPrimaries = reader.readBits(8);
      sps.transferCharacteristics = reader.readBits(8);
      sps.matrixCoefficients = reader.readBits(8);
    }
  }
  sps.offsets.videoSignalFlagBit = videoSignalFlagBit;
  sps.offsets.videoSignalEnd = reader.bit;
  if (reader.readBit()) {
    reader.readUE();
    reader.readUE();
  }
  if (reader.readBit()) {
    sps.numUnitsInTick = reader.readBits(32);
    sps.timeScale = reader.readBits(32);
    sps.fixedFrameRateFlag = reader.readBit();
  }
  const nalHrd = reader.readBit();
  if (nalHrd) readHrdParameters(reader);
  const vclHrd = reader.readBit();
  if (vclHrd) readHrdParameters(reader);
  if (nalHrd || vclHrd) sps.lowDelayHrdFlag = reader.readBit();
  sps.picStructPresentFlag = reader.readBit();
  if (reader.readBit()) {
    sps.motionVectorsOverPicBoundariesFlag = reader.readBit();
    sps.maxBytesPerPicDenom = reader.readUE();
    sps.maxBitsPerMbDenom = reader.readUE();
    sps.log2MaxMvLengthHorizontal = reader.readUE();
    sps.log2MaxMvLengthVertical = reader.readUE();
    sps.numReorderFrames = reader.readUE();
    sps.maxDecFrameBuffering = reader.readUE();
  }
  sps.offsets.vuiEnd = reader.bit;
}

// Parses one SPS NAL unit and keeps the bit offsets the rewrite needs.
// Every field is read so that a malformed or unsupported stream fails here,
// before anything is written.
function parseSps(nal) {
  if (!nal || nal.length < 4) throw new Error("The SPS NAL unit is too short.");
  if ((nal[0] & 0x1f) !== SPS_NAL_TYPE) throw new Error("The NAL unit is not an SPS.");
  const rbsp = stripEmulationPrevention(nal.subarray(1));
  const reader = new BitReader(rbsp);
  const sps = { offsets: {} };
  sps.profileIdc = reader.readBits(8);
  sps.constraintFlags = reader.readBits(8);
  sps.levelIdc = reader.readBits(8);
  sps.seqParameterSetId = reader.readUE();
  sps.chromaFormatIdc = 1;
  if (HIGH_PROFILES.has(sps.profileIdc)) {
    sps.chromaFormatIdc = reader.readUE();
    if (sps.chromaFormatIdc === 3) sps.separateColourPlaneFlag = reader.readBit();
    sps.bitDepthLumaMinus8 = reader.readUE();
    sps.bitDepthChromaMinus8 = reader.readUE();
    sps.qpprimeYZeroTransformBypassFlag = reader.readBit();
    sps.seqScalingMatrixPresent = reader.readBit();
    if (sps.seqScalingMatrixPresent) {
      const count = sps.chromaFormatIdc === 3 ? 12 : 8;
      sps.scalingLists = [];
      for (let index = 0; index < count; index++) {
        sps.scalingLists.push(reader.readBit() ? readScalingList(reader, index < 6 ? 16 : 64) : null);
      }
    }
  }
  sps.log2MaxFrameNumMinus4 = reader.readUE();
  sps.picOrderCntType = reader.readUE();
  if (sps.picOrderCntType === 0) {
    sps.log2MaxPicOrderCntLsbMinus4 = reader.readUE();
  } else if (sps.picOrderCntType === 1) {
    sps.deltaPicOrderAlwaysZeroFlag = reader.readBit();
    sps.offsetForNonRefPic = reader.readSE();
    sps.offsetForTopToBottomField = reader.readSE();
    sps.numRefFramesInPicOrderCntCycle = reader.readUE();
    sps.offsetForRefFrame = [];
    for (let index = 0; index < sps.numRefFramesInPicOrderCntCycle; index++) {
      sps.offsetForRefFrame.push(reader.readSE());
    }
  } else if (sps.picOrderCntType > 2) {
    throw new Error("The SPS has an unsupported pic_order_cnt_type.");
  }
  sps.maxNumRefFrames = reader.readUE();
  sps.gapsInFrameNumValueAllowedFlag = reader.readBit();
  sps.picWidthInMbsMinus1 = reader.readUE();
  sps.picHeightInMapUnitsMinus1 = reader.readUE();
  sps.frameMbsOnlyFlag = reader.readBit();
  if (!sps.frameMbsOnlyFlag) sps.mbAdaptiveFrameFieldFlag = reader.readBit();
  sps.direct8x8InferenceFlag = reader.readBit();
  sps.frameCroppingFlag = reader.readBit();
  if (sps.frameCroppingFlag) {
    sps.frameCropLeft = reader.readUE();
    sps.frameCropRight = reader.readUE();
    sps.frameCropTop = reader.readUE();
    sps.frameCropBottom = reader.readUE();
  }
  sps.offsets.vuiFlagBit = reader.bit;
  sps.vuiParametersPresent = reader.readBit();
  sps.offsets.vuiStart = reader.bit;
  if (sps.vuiParametersPresent) readVui(reader, sps);
  else sps.offsets.vuiEnd = sps.offsets.vuiStart;
  sps.offsets.trailingStart = sps.offsets.vuiEnd;
  // rbsp_trailing_bits: a stop bit and zeros up to the byte boundary. Anything
  // else means the parse missed a field, so the rewrite must not happen.
  if (reader.readBit() !== 1) throw new Error("The SPS has data after its VUI.");
  while (reader.bit < rbsp.length * 8) {
    if (reader.readBit() !== 0) throw new Error("The SPS trailing bits are not zero.");
  }
  sps.rbsp = rbsp;
  return sps;
}

function writeTargetVideoSignal(writer) {
  writer.writeBit(1);
  writer.writeBits(VIDEO_FORMAT_UNSPECIFIED, 3);
  writer.writeBit(0);
  writer.writeBit(1);
  writer.writeBits(TARGET_PRIMARIES, 8);
  writer.writeBits(TARGET_TRANSFER, 8);
  writer.writeBits(TARGET_MATRIX, 8);
}

// A VUI always starts with the aspect ratio and overscan flags and always ends
// with the chroma location, timing, HRD, picture structure and bitstream
// restriction flags, so a VUI built from nothing states all of them.
function writeEmptyVuiTail(writer) {
  writer.writeBit(0); // chroma_loc_info_present_flag
  writer.writeBit(0); // timing_info_present_flag
  writer.writeBit(0); // nal_hrd_parameters_present_flag
  writer.writeBit(0); // vcl_hrd_parameters_present_flag
  writer.writeBit(0); // pic_struct_present_flag
  writer.writeBit(0); // bitstream_restriction_flag
}

function writeEmptyVuiHead(writer) {
  writer.writeBit(0); // aspect_ratio_info_present_flag
  writer.writeBit(0); // overscan_info_present_flag
}

// Rebuilds one SPS with the target video signal type. Fields before the VUI
// and every VUI field other than the video signal type are copied bit-exactly.
function rewriteSps(nal) {
  const sps = parseSps(nal);
  const writer = new BitWriter();
  writer.copyBits(sps.rbsp, 0, sps.offsets.vuiFlagBit);
  writer.writeBit(1);
  if (sps.vuiParametersPresent) {
    writer.copyBits(sps.rbsp, sps.offsets.vuiStart, sps.offsets.videoSignalFlagBit);
    writeTargetVideoSignal(writer);
    writer.copyBits(sps.rbsp, sps.offsets.videoSignalEnd, sps.offsets.vuiEnd);
  } else {
    writeEmptyVuiHead(writer);
    writeTargetVideoSignal(writer);
    writeEmptyVuiTail(writer);
  }
  writer.writeBit(1);
  writer.alignWithZeros();
  const body = insertEmulationPrevention(writer.toBytes());
  const out = new Uint8Array(body.length + 1);
  out[0] = nal[0];
  out.set(body, 1);
  return out;
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("The avcC record must be an ArrayBuffer or an ArrayBuffer view.");
}

// Reads lengthSizeMinusOne from an avcC record.
function avcCLengthSize(description) {
  const bytes = toBytes(description);
  if (bytes.length < 5) throw new Error("The avcC record is too short.");
  return (bytes[4] & 3) + 1;
}

// Rewrites every SPS in an avcC record and keeps the profile bytes, the
// length size, every PPS and the High-profile trailing bytes.
function rewriteAvcC(description) {
  const bytes = toBytes(description);
  if (bytes.length < 7) throw new Error("The avcC record is too short.");
  if (bytes[0] !== 1) throw new Error("The avcC record has an unsupported version.");
  // 0: version, 1..3: profile/compatibility/level, 4: lengthSizeMinusOne.
  let offset = 5;
  const spsCount = bytes[offset++] & 0x1f;
  if (!spsCount) throw new Error("The avcC record has no SPS.");
  const spsList = [];
  for (let index = 0; index < spsCount; index++) {
    if (offset + 2 > bytes.length) throw new Error("The avcC record ends inside an SPS length.");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;
    if (offset + length > bytes.length) throw new Error("The avcC record ends inside an SPS.");
    spsList.push(rewriteSps(bytes.subarray(offset, offset + length)));
    offset += length;
  }
  if (offset >= bytes.length) throw new Error("The avcC record has no PPS table.");
  const ppsCount = bytes[offset++];
  const parts = [bytes.subarray(0, 5)];
  const tail = [];
  for (const sps of spsList) {
    tail.push(Uint8Array.of(sps.length >> 8, sps.length & 0xff), sps);
  }
  parts.push(Uint8Array.of((bytes[5] & 0xe0) | spsCount), ...tail);
  const ppsStart = offset;
  for (let index = 0; index < ppsCount; index++) {
    if (offset + 2 > bytes.length) throw new Error("The avcC record ends inside a PPS length.");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2 + length;
    if (offset > bytes.length) throw new Error("The avcC record ends inside a PPS.");
  }
  parts.push(Uint8Array.of(ppsCount), bytes.subarray(ppsStart, offset), bytes.subarray(offset));
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let write = 0;
  for (const part of parts) {
    out.set(part, write);
    write += part.length;
  }
  return out;
}

// Rewrites SPS NAL units inside a length-prefixed AVC sample. Returns null
// when the sample holds no SPS, which is the normal case for avc1 tracks.
function rewriteInBandSps(data, lengthSize) {
  if (!data || data.length === 0) return null;
  const size = lengthSize > 0 && lengthSize <= 4 ? lengthSize : 4;
  const parts = [];
  let patched = false;
  let offset = 0;
  while (offset + size <= data.length) {
    let length = 0;
    for (let index = 0; index < size; index++) length = length * 256 + data[offset + index];
    offset += size;
    if (length <= 0 || offset + length > data.length) return null;
    const nal = data.subarray(offset, offset + length);
    offset += length;
    if ((nal[0] & 0x1f) === SPS_NAL_TYPE) {
      parts.push(rewriteSps(nal));
      patched = true;
    } else {
      parts.push(nal);
    }
  }
  if (offset !== data.length) return null;
  if (!patched) return null;
  let total = 0;
  for (const part of parts) total += size + part.length;
  const out = new Uint8Array(total);
  let write = 0;
  for (const part of parts) {
    let length = part.length;
    for (let index = size - 1; index >= 0; index--) {
      out[write + index] = length & 0xff;
      length = Math.floor(length / 256);
    }
    write += size;
    out.set(part, write);
    write += part.length;
  }
  return out;
}

// Returns the onEncodedPacket callback for VideoSampleSource. It mutates the
// decoder config that mediabunny is about to hand to the muxer, so the MP4
// `colr` box and the avcC SPS VUI always agree with the converted levels.
// Every failure keeps the original stream and warns once.
function createPacketTagger(warn) {
  const logger = typeof warn === "function" ? warn : (message) => console.warn(message);
  let warned = false;
  let lengthSize = 4;
  const state = { inBandSpsPatched: 0 };
  const report = (error) => {
    if (warned) return;
    warned = true;
    logger("[Zoidium] MP4 export could not tag the H.264 colour description: " +
      (error && error.message ? error.message : String(error)));
  };
  state.handle = (packet, meta) => {
    try {
      const config = meta && meta.decoderConfig;
      if (config && config.description) {
        const patched = rewriteAvcC(config.description);
        try {
          lengthSize = avcCLengthSize(config.description);
        } catch (_ignored) {
          lengthSize = 4;
        }
        config.description = patched;
      }
      if (config) {
        config.colorSpace = {
          primaries: "bt709", transfer: "iec61966-2-1", matrix: "bt709", fullRange: false,
        };
      }
      if (packet && packet.type === "key") {
        const patchedData = rewriteInBandSps(packet.data, lengthSize);
        if (patchedData) {
          packet.data = patchedData;
          packet.byteLength = patchedData.byteLength;
          state.inBandSpsPatched++;
        }
      }
    } catch (error) {
      report(error);
    }
  };
  return state;
}

module.exports = {
  TARGET_MATRIX,
  TARGET_PRIMARIES,
  TARGET_TRANSFER,
  avcCLengthSize,
  createPacketTagger,
  parseSps,
  rewriteAvcC,
  rewriteInBandSps,
  rewriteSps,
};
