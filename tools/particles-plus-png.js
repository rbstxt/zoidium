"use strict";

// Super-sampled sprite rasterization plus the minimal PNG codec used by
// the Particles+ sprite builder (8-bit RGBA only).
const zlib = require("zlib");
const { clamp01, opticalTone, smoothstep } = require("./particles-plus-math");

const WIDTH = 128;
const HEIGHT = 128;
const SUPER_SAMPLE = 32;

function renderSprite(field, optical = false) {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  const samples = SUPER_SAMPLE * SUPER_SAMPLE;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let alpha = 0;
      for (let sy = 0; sy < SUPER_SAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPER_SAMPLE; sx += 1) {
          const normalizedX = ((x + (sx + 0.5) / SUPER_SAMPLE) / WIDTH) * 2 - 1;
          const normalizedY = ((y + (sy + 0.5) / SUPER_SAMPLE) / HEIGHT) * 2 - 1;
          const edge = Math.max(Math.abs(normalizedX), Math.abs(normalizedY));
          // Keep the outer 5% of the square transparent without imposing a
          // visible circular mask on the broad optical halos. The previous
          // optical start at 0.78 clipped the low-energy falloff into a hard
          // disk when the sprite was viewed on black.
          const safetyFade = 1 - smoothstep(optical ? 0.86 : 0.875, 0.94, edge);
          const coverage = clamp01(field(normalizedX, normalizedY)) * safetyFade;
          alpha += optical ? opticalTone(coverage) : coverage;
        }
      }
      const offset = (y * WIDTH + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round((alpha / samples) * 255);
    }
  }
  return data;
}

const CRC_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, payload]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  return Buffer.concat([length, body, checksum]);
}

function encodePng(rgba) {
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * (WIDTH * 4 + 1);
    raw[rowOffset] = 0;
    rgba.copy(raw, rowOffset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(buffer) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
    } else if (type === "IDAT") {
      idat.push(payload);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error("PNG is not 8-bit RGBA");
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let rawOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const current = raw[rawOffset++];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x] || 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
      if (filter === 0) row[x] = current;
      else if (filter === 1) row[x] = (current + left) & 0xff;
      else if (filter === 2) row[x] = (current + above) & 0xff;
      else if (filter === 3) row[x] = (current + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        row[x] = (current + predictor) & 0xff;
      } else throw new Error(`unsupported PNG filter ${filter}`);
    }
    row.copy(rgba, outputOffset);
    outputOffset += rowBytes;
    previous = row;
  }
  return { width, height, rgba };
}

module.exports = {
  HEIGHT, SUPER_SAMPLE, WIDTH,
  crc32, decodePng, encodePng, pngChunk, renderSprite,
};
