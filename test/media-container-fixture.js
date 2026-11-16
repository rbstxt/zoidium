"use strict";

// Synthetic ISO BMFF and EBML headers for the container audio probe tests.
// Nothing here is real media: every fixture is a valid box or element tree
// with empty payloads, so no external file has to be stored.

function box(type, ...payloads) {
  const body = Buffer.concat(payloads.map((payload) => Buffer.from(payload)));
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 4, "latin1");
  return Buffer.concat([header, body]);
}

function fullBox(type, ...payloads) {
  return box(type, Buffer.from([0, 0, 0, 0]), ...payloads);
}

function hdlr(handler) {
  return fullBox("hdlr", Buffer.alloc(4), Buffer.from(handler, "latin1"), Buffer.alloc(12), Buffer.from([0]));
}

function trak(handler) {
  return box("trak", fullBox("tkhd"), box("mdia", hdlr(handler)));
}

function ftyp() {
  return box("ftyp", Buffer.from("isom", "latin1"), Buffer.alloc(4), Buffer.from("isomiso2mp41", "latin1"));
}

// trackHandlers: "vide", "soun". With moovAfterMedia the moov box follows a
// media box larger than the probe's header window.
function mp4(trackHandlers, { moovAfterMedia = false, mediaBytes = 0 } = {}) {
  const moov = box("moov", ...trackHandlers.map(trak));
  if (!moovAfterMedia) return Buffer.concat([ftyp(), moov]);
  return Buffer.concat([ftyp(), box("mdat", Buffer.alloc(mediaBytes)), moov]);
}

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3];
const EBML_SEGMENT = [0x18, 0x53, 0x80, 0x67];
const EBML_TRACKS = [0x16, 0x54, 0xae, 0x6b];
const EBML_CLUSTER = [0x1f, 0x43, 0xb6, 0x75];

function sizeVint(value) {
  const out = Buffer.alloc(8);
  out[0] = 0x01;
  let rest = value;
  for (let i = 7; i > 0; i--) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function ebml(id, ...payloads) {
  const body = Buffer.concat(payloads.map((payload) => Buffer.from(payload)));
  return Buffer.concat([Buffer.from(id), sizeVint(body.length), body]);
}

function trackEntry(type) {
  return ebml([0xae], ebml([0x83], Buffer.from([type])), ebml([0x86], Buffer.from("V_VP9", "latin1")));
}

// trackTypes: 1 video, 2 audio (EBML TrackType).
function webm(trackTypes, { includeTracks = true } = {}) {
  const header = ebml(EBML_HEADER, ebml([0x42, 0x86], Buffer.from("webm", "latin1")));
  const children = [];
  if (includeTracks) children.push(ebml(EBML_TRACKS, ...trackTypes.map(trackEntry)));
  children.push(ebml(EBML_CLUSTER, Buffer.alloc(4)));
  return Buffer.concat([header, ebml(EBML_SEGMENT, ...children)]);
}

// A File-shaped object with a synchronous slice(), like the browser File.
function fakeFile(bytes) {
  const buffer = Buffer.from(bytes);
  return {
    name: "media.bin",
    type: "",
    size: buffer.length,
    async arrayBuffer() {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
    },
    slice(start, end) {
      const part = buffer.subarray(start, end === undefined ? buffer.length : end);
      return {
        async arrayBuffer() {
          return part.buffer.slice(part.byteOffset, part.byteOffset + part.length);
        },
      };
    },
  };
}

module.exports = { box, fakeFile, mp4, webm };
