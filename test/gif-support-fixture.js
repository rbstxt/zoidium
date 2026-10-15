"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "plugins/gif-support/gif-support.js"), "utf8");

function loadGifSupport(overrides = {}) {
  const sandbox = { module: { exports: {} }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const [key, value] of Object.entries(overrides)) sandbox[key] = value;
  vm.runInContext(source, sandbox, { filename: "gif-support.js" });
  return { GifSupport: sandbox.module.exports, sandbox };
}

// --- Fake 2D canvas -------------------------------------------------------

function makeFakeCanvas(width = 0, height = 0) {
  const canvas = {
    width,
    height,
    _last: null,
    getContext() {
      if (!canvas._ctx) {
        canvas._ctx = {
          createImageData(w, h) {
            return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
          },
          putImageData(image, _x, _y) {
            canvas._last = {
              width: image.width,
              height: image.height,
              data: Uint8ClampedArray.from(image.data),
            };
          },
        };
      }
      return canvas._ctx;
    },
  };
  return canvas;
}


function lzwEncode(minCodeSize, indices) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  const dict = new Map();
  for (let i = 0; i < clear; i++) dict.set(String(i), i);
  let next = end + 1;
  const out = [];
  let acc = 0;
  let bits = 0;
  const emit = (code, size) => {
    acc |= code << bits;
    bits += size;
    while (bits >= 8) {
      out.push(acc & 0xff);
      acc >>= 8;
      bits -= 8;
    }
  };
  emit(clear, codeSize);
  let prefix = null;
  const keyOf = (arr) => arr.join(",");
  for (const px of indices) {
    const candidate = prefix === null ? [px] : prefix.concat(px);
    if (dict.has(keyOf(candidate))) {
      prefix = candidate;
    } else {
      emit(dict.get(keyOf(prefix)), codeSize);
      if (next < 4096) {
        dict.set(keyOf(candidate), next);
        next++;
        if (next === 1 << codeSize && codeSize < 12) codeSize++;
      }
      prefix = [px];
    }
  }
  if (prefix !== null) emit(dict.get(keyOf(prefix)), codeSize);
  emit(end, codeSize);
  if (bits > 0) out.push(acc & 0xff);
  return Uint8Array.from(out);
}

function paletteSizeCode(colors) {
  let n = 0;
  while (1 << (n + 1) < colors) n++;
  return n;
}

function buildGif({ width, height, palette, frames }) {
  const bytes = [];
  const pushStr = (s) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };
  const push16 = (v) => bytes.push(v & 0xff, (v >> 8) & 0xff);
  pushStr("GIF89a");
  push16(width);
  push16(height);
  const sizeCode = paletteSizeCode(palette.length);
  bytes.push(0x80 | 0x70 | sizeCode, 0, 0);
  const tableSize = 1 << (sizeCode + 1);
  for (let i = 0; i < tableSize; i++) {
    const color = palette[i] || [0, 0, 0];
    bytes.push(color[0], color[1], color[2]);
  }
  for (const frame of frames) {
    const disposal = frame.disposal || 0;
    const transparent = frame.transparent === undefined ? -1 : frame.transparent;
    bytes.push(0x21, 0xf9, 0x04);
    bytes.push((disposal << 2) | (transparent >= 0 ? 1 : 0));
    push16(frame.delay || 0);
    bytes.push(transparent >= 0 ? transparent : 0, 0x00);
    bytes.push(0x2c);
    push16(frame.left || 0);
    push16(frame.top || 0);
    push16(frame.width);
    push16(frame.height);
    bytes.push(frame.interlaced ? 0x40 : 0x00);
    const minCodeSize = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length))) || 1);
    bytes.push(minCodeSize);
    const data = lzwEncode(minCodeSize, frame.indices);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.subarray(i, Math.min(i + 255, data.length));
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0x00);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}


function makeFakeHost() {
  const calls = { decodeBrowser: 0 };
  class FakeImage {
    constructor(asset) {
      this.asset = asset;
      this.data = asset.data;
    }
    decodeBrowser() {
      calls.decodeBrowser++;
      this.data.image = { static: true };
      this.data.loading = Promise.resolve();
    }
    getImage() {
      if (!this.data.image) this.decodeBrowser();
      return this.data.image;
    }
    getTexture() {
      const image = this.getImage();
      const texture = {
        image,
        needsUpdate: false,
        _listeners: {},
        addEventListener(type, fn) {
          (this._listeners[type] = this._listeners[type] || []).push(fn);
        },
        dispose() {
          for (const fn of this._listeners.dispose || []) fn();
        },
      };
      return texture;
    }
  }
  class FakeLayer {
    update() {
      calls.layerUpdate = (calls.layerUpdate || 0) + 1;
      return "updated";
    }
  }
  class FakeClip {}
  class FakeCompositor {
    renderSequence() {
      calls.renderSequence = (calls.renderSequence || 0) + 1;
      return "rendered";
    }
  }
  return {
    calls,
    PZ: {
      asset: { image: FakeImage },
      layer: FakeLayer,
      clip: FakeClip,
      compositor: FakeCompositor,
    },
  };
}

function makeAssetRecord(filename, url) {
  return { filename, url, sha256: "abc", data: { image: null, loading: null, gif: null } };
}

function twoFrameGifBytes() {
  const palette = [
    [255, 0, 0],
    [0, 0, 255],
  ];
  return buildGif({
    width: 2,
    height: 1,
    palette,
    frames: [
      { width: 2, height: 1, delay: 10, indices: [0, 0] },
      { width: 2, height: 1, delay: 25, indices: [1, 1] },
    ],
  });
}

function gifArrayBuffer() {
  const bytes = twoFrameGifBytes();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

module.exports = { loadGifSupport, makeFakeCanvas, buildGif, makeFakeHost, makeAssetRecord, twoFrameGifBytes, gifArrayBuffer };
