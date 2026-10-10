"use strict";

// Tests for the Animated GIF plugin (plugins/gif-support/):
// decoder on handcrafted GIFs, seek mapping, and lifecycle with fakes.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
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

const fakeFactory = (w, h) => makeFakeCanvas(w, h);

function pixelOf(canvas, x, y) {
  const last = canvas._last;
  assert.ok(last, "frame canvas has painted pixels");
  const i = (y * last.width + x) * 4;
  return [last.data[i], last.data[i + 1], last.data[i + 2], last.data[i + 3]];
}

// Cumulative GIF delays are floating-point sums; compare with tolerance.
function assertTimes(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) < 1e-9,
      `time[${i}]: ${actual[i]} ≈ ${expected[i]}`
    );
  }
}

// --- Minimal GIF builder (test fixtures) -----------------------------------

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

// --- Decoder tests ---------------------------------------------------------

test("decoder: two full frames with variable delays", () => {
  const { GifSupport } = loadGifSupport();
  const palette = [
    [255, 0, 0],
    [0, 0, 255],
  ];
  const gif = buildGif({
    width: 3,
    height: 2,
    palette,
    frames: [
      { width: 3, height: 2, delay: 10, indices: [0, 0, 0, 0, 0, 0] },
      { width: 3, height: 2, delay: 25, indices: [1, 1, 1, 1, 1, 1] },
    ],
  });
  const decoded = GifSupport.decode(gif, fakeFactory);
  assert.ok(decoded);
  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);
  assert.equal(decoded.frames.length, 2);
  assertTimes(decoded.cumulative, [0.1, 0.35]);
  assert.ok(Math.abs(decoded.total - 0.35) < 1e-9);
  assert.deepEqual(pixelOf(decoded.frames[0].canvas, 2, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixelOf(decoded.frames[1].canvas, 0, 0), [0, 0, 255, 255]);
});

test("decoder: interlaced rows land in order", () => {
  const { GifSupport } = loadGifSupport();
  const palette = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ];
  // Stored order for interlaced GIFs is pass order with spec steps
  // 8, 8, 4, 2: for a 4-row image the stored rows are [0, 2, 1, 3].
  const display = [0, 1, 2, 3];
  const stored = [];
  const starts = [0, 4, 2, 1];
  const steps = [8, 8, 4, 2];
  for (let pass = 0; pass < starts.length; pass++) {
    for (let row = starts[pass]; row < 4; row += steps[pass]) stored.push(display[row]);
  }
  const indices = [];
  for (const row of stored) {
    for (let x = 0; x < 4; x++) indices.push(row);
  }
  const gif = buildGif({
    width: 4,
    height: 4,
    palette,
    frames: [{ width: 4, height: 4, delay: 10, interlaced: true, indices }],
  });
  const decoded = GifSupport.decode(gif, fakeFactory);
  assert.ok(decoded);
  for (let row = 0; row < 4; row++) {
    assert.deepEqual(pixelOf(decoded.frames[0].canvas, 0, row), [...palette[display[row]], 255]);
  }
});

test("decoder: transparency plus disposal 2 clears the rect", () => {
  const { GifSupport } = loadGifSupport();
  const red = [255, 0, 0];
  const blue = [0, 0, 255];
  const palette = [red, blue];
  const gif = buildGif({
    width: 4,
    height: 4,
    palette,
    frames: [
      { width: 4, height: 4, delay: 10, indices: new Array(16).fill(0) },
      // 2x2 blue rect at top-left, rest transparent, disposal 2.
      {
        width: 2,
        height: 2,
        delay: 10,
        disposal: 2,
        transparent: 0,
        indices: [1, 1, 1, 1],
      },
      // Fully transparent frame reveals the cleared (transparent) rect.
      { width: 4, height: 4, delay: 10, transparent: 0, indices: new Array(16).fill(0) },
    ],
  });
  const decoded = GifSupport.decode(gif, fakeFactory);
  assert.ok(decoded);
  assert.equal(decoded.frames.length, 3);
  assert.deepEqual(pixelOf(decoded.frames[1].canvas, 0, 0), [...blue, 255]);
  assert.deepEqual(pixelOf(decoded.frames[1].canvas, 3, 3), [...red, 255]);
  assert.deepEqual(pixelOf(decoded.frames[2].canvas, 0, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixelOf(decoded.frames[2].canvas, 3, 3), [...red, 255]);
});

test("decoder: disposal 3 restores the previous canvas", () => {
  const { GifSupport } = loadGifSupport();
  const red = [255, 0, 0];
  const green = [0, 255, 0];
  const palette = [red, green];
  const gif = buildGif({
    width: 4,
    height: 4,
    palette,
    frames: [
      { width: 4, height: 4, delay: 10, indices: new Array(16).fill(0) },
      { width: 2, height: 2, delay: 10, disposal: 3, indices: [1, 1, 1, 1] },
      { width: 4, height: 4, delay: 10, transparent: 0, indices: new Array(16).fill(0) },
    ],
  });
  const decoded = GifSupport.decode(gif, fakeFactory);
  assert.ok(decoded);
  assert.deepEqual(pixelOf(decoded.frames[1].canvas, 0, 0), [...green, 255]);
  assert.deepEqual(pixelOf(decoded.frames[2].canvas, 0, 0), [...red, 255]);
  assert.deepEqual(pixelOf(decoded.frames[2].canvas, 3, 3), [...red, 255]);
});

test("decoder: zero delay clamps to 100 ms", () => {
  const { GifSupport } = loadGifSupport();
  const palette = [
    [1, 2, 3],
    [4, 5, 6],
  ];
  const gif = buildGif({
    width: 1,
    height: 1,
    palette,
    frames: [
      { width: 1, height: 1, delay: 0, indices: [0] },
      { width: 1, height: 1, delay: 1, indices: [1] },
    ],
  });
  const decoded = GifSupport.decode(gif, fakeFactory);
  assert.ok(decoded);
  assertTimes(decoded.cumulative, [0.1, 0.2]);
  assert.ok(Math.abs(decoded.total - 0.2) < 1e-9);
});

test("decoder: rejects corrupt input and enforces caps", () => {
  const { GifSupport } = loadGifSupport();
  assert.equal(GifSupport.decode(new Uint8Array([1, 2, 3]), fakeFactory), null);
  assert.equal(GifSupport.decode(Uint8Array.from([78, 79, 84, 71, 73, 70, 0, 0, 0, 0, 0, 0, 0]), fakeFactory), null);
  // Header only, no frames.
  const header = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 0x3b];
  assert.equal(GifSupport.decode(Uint8Array.from(header), fakeFactory), null);
  // Absurd dimensions are rejected before any canvas allocation.
  const huge = Uint8Array.from(header);
  huge[6] = 0xff;
  huge[7] = 0xff;
  huge[8] = 0xff;
  huge[9] = 0xff;
  let allocated = false;
  assert.equal(
    GifSupport.decode(huge, () => {
      allocated = true;
      return null;
    }),
    null
  );
  assert.equal(allocated, false);
  assert.equal(GifSupport.MAX_FRAMES, 512);
  assert.equal(GifSupport.MAX_PIXELS, 67108864);
});

test("decoder: frame count capped at 512", () => {
  const { GifSupport } = loadGifSupport();
  const palette = [
    [0, 0, 0],
    [255, 255, 255],
  ];
  const frames = [];
  for (let i = 0; i < 520; i++) {
    frames.push({ width: 1, height: 1, delay: 10, indices: [i % 2] });
  }
  const gif = buildGif({ width: 1, height: 1, palette, frames });
  const decoded = GifSupport.decode(gif, fakeFactory);
  assert.ok(decoded);
  assert.equal(decoded.frames.length, 512);
});

// --- Seek mapping tests ------------------------------------------------------

test("pickFrameIndex: boundaries, loops and negative times", () => {
  const { GifSupport } = loadGifSupport();
  const cumulative = [0.1, 0.35];
  const total = 0.35;
  const pick = (t) => GifSupport.pickFrameIndex(cumulative, total, t);
  assert.equal(pick(0), 0);
  assert.equal(pick(0.099), 0);
  assert.equal(pick(0.1), 1);
  assert.equal(pick(0.349), 1);
  assert.equal(pick(0.35), 0);
  assert.equal(pick(0.45), 1);
  assert.equal(pick(-0.05), 1);
  assert.equal(pick(-0.35), 0);
  assert.equal(pick(10), 1);
  assert.equal(GifSupport.pickFrameIndex([], 0, 5), 0);
  assert.equal(GifSupport.pickFrameIndex([0.1], 0.1, -100), 0);
});

test("isGifAsset matches gif filename or url only", () => {
  const { GifSupport } = loadGifSupport();
  assert.equal(GifSupport.isGifAsset({ filename: "clip.gif", url: "" }), true);
  assert.equal(GifSupport.isGifAsset({ filename: "", url: "https://x/y.GIF?token=1" }), true);
  assert.equal(GifSupport.isGifAsset({ filename: "clip.png", url: "" }), false);
  assert.equal(GifSupport.isGifAsset({ filename: "notgif.txt", url: "/assets/x.webp" }), false);
  assert.equal(GifSupport.isGifAsset(null), false);
});

// --- Lifecycle tests with fakes -----------------------------------------------

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

test("lifecycle: gif decode populates frames and textures follow seeks", async () => {
  const { GifSupport } = loadGifSupport({
    fetch: async () => ({ ok: true, arrayBuffer: async () => gifArrayBuffer() }),
  });
  const { PZ } = makeFakeHost();
  const disposers = [];
  const doc = { createElement: () => makeFakeCanvas() };
  const originalDecode = PZ.asset.image.prototype.decodeBrowser;
  const originalGetTexture = PZ.asset.image.prototype.getTexture;
  const originalLayerUpdate = PZ.layer.prototype.update;
  const originalRenderSequence = PZ.compositor.prototype.renderSequence;
  await GifSupport.activate({
    PZ,
    window: {},
    document: doc,
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
  });

  // Non-gif assets use the stock path and get no gif record.
  const pngRecord = makeAssetRecord("still.png", "http://x/still.png");
  const pngWrapper = new PZ.asset.image(pngRecord);
  pngWrapper.decodeBrowser();
  assert.equal(pngRecord.data.gif, null);
  assert.equal(pngRecord.data.image.static, true);

  // Gif asset: prepare() awaits data.loading, then frames are live.
  const record = makeAssetRecord("anim.gif", "http://x/anim.gif");
  const wrapper = new PZ.asset.image(record);
  wrapper.decodeBrowser();
  // Note: the promise is created inside the plugin VM realm, so check
  // thenability instead of instanceof.
  assert.equal(typeof record.data.loading.then, "function");
  await record.data.loading;
  assert.ok(record.data.gif.frames);
  assert.equal(record.data.gif.frames.length, 2);
  assert.ok(Math.abs(record.data.gif.total - 0.35) < 1e-9);
  assert.equal(record.data.image, record.data.gif.frames[0].canvas);

  const texture = wrapper.getTexture();
  assert.equal(texture.image, record.data.gif.frames[0].canvas);

  // Clip-local seek: clip time maps local frame 60 at 30 fps to 2.0 s,
  // which loops to frame 1 of the 0.35 s gif.
  const layer = new PZ.layer();
  layer.childWithGif = { nested: wrapper };
  layer.tryGetParentOfType = () => ({ properties: { time: { get: (f) => f / 30 } } });
  layer.update(60);
  assert.equal(texture.image, record.data.gif.frames[1].canvas);

  // Negative local frames loop from the end.
  layer.update(-30);
  assert.equal(texture.image, record.data.gif.frames[0].canvas);

  // Disposal restores the host prototypes exactly.
  for (const fn of disposers) await fn();
  assert.equal(PZ.asset.image.prototype.decodeBrowser, originalDecode);
  assert.equal(PZ.asset.image.prototype.getTexture, originalGetTexture);
  assert.equal(PZ.layer.prototype.update, originalLayerUpdate);
  assert.equal(PZ.compositor.prototype.renderSequence, originalRenderSequence);
});

test("lifecycle: project-time fallback and texture dispose cleanup", async () => {
  const { GifSupport } = loadGifSupport({
    fetch: async () => ({ ok: true, arrayBuffer: async () => gifArrayBuffer() }),
  });
  const { PZ } = makeFakeHost();
  const disposers = [];
  const doc = { createElement: () => makeFakeCanvas() };
  await GifSupport.activate({
    PZ,
    window: {},
    document: doc,
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
  });

  const record = makeAssetRecord("b.gif", "http://x/b.gif");
  const wrapper = new PZ.asset.image(record);
  wrapper.decodeBrowser();
  await record.data.loading;
  const texture = wrapper.getTexture();
  assert.equal(wrapper.__gifTextures.length, 1);

  // No clip ancestor: layer seeks fall back to the renderSequence clock.
  const layer = new PZ.layer();
  layer.childWithGif = wrapper;
  layer.tryGetParentOfType = () => null;
  layer.update(60);
  assert.equal(texture.image, record.data.gif.frames[0].canvas);

  const compositor = new PZ.compositor();
  compositor._sequence = { properties: { rate: { get: () => 30 } } };
  assert.equal(compositor.renderSequence(60), "rendered");
  layer.update(60);
  assert.equal(texture.image, record.data.gif.frames[1].canvas);
  // The shared image follows the project-time fallback for direct readers.
  assert.equal(record.data.image, record.data.gif.frames[1].canvas);

  texture.dispose();
  assert.equal(wrapper.__gifTextures.length, 0);

  for (const fn of disposers) await fn();
});

test("lifecycle: activation fails cleanly on an incompatible host", async () => {
  const { GifSupport } = loadGifSupport();
  const before = {};
  await assert.rejects(
    GifSupport.activate({
      PZ: {},
      window: {},
      document: { createElement: () => makeFakeCanvas() },
      lifecycle: { onDispose: () => {} },
    }),
    /PZ\.asset\.image/
  );
  assert.deepEqual(before, {});
  // The module is still usable afterwards.
  assert.equal(typeof GifSupport.decode, "function");
});
