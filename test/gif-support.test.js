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

const { loadGifSupport, makeFakeCanvas, buildGif, makeFakeHost, makeAssetRecord, twoFrameGifBytes, gifArrayBuffer } = require("./gif-support-fixture.js");

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

test("lifecycle: layer updates skip the walk without GIFs and never read geometry", async () => {
  const { GifSupport } = loadGifSupport({
    fetch: async () => ({ ok: true, arrayBuffer: async () => gifArrayBuffer() }),
  });
  const { PZ } = makeFakeHost();
  const disposers = [];
  await GifSupport.activate({
    PZ,
    window: {},
    document: { createElement: () => makeFakeCanvas() },
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
  });
  let reads = 0;
  const layer = new PZ.layer();
  layer.tryGetParentOfType = () => ({ properties: { time: { get: (f) => f / 30 } } });
  Object.defineProperty(layer, "watched", { enumerable: true, get() { reads += 1; return {}; } });
  layer.update(60);
  assert.equal(reads, 0);

  const record = makeAssetRecord("anim.gif", "http://x/anim.gif");
  const wrapper = new PZ.asset.image(record);
  wrapper.decodeBrowser();
  await record.data.loading;
  const texture = wrapper.getTexture();
  let lengthReads = 0;
  layer.geometry = { attribute: { isBufferAttribute: true, get length() { lengthReads += 1; return 0; } } };
  layer.childWithGif = { nested: wrapper };
  layer.update(60);
  assert.ok(reads > 0);
  assert.equal(lengthReads, 0);
  assert.equal(texture.image, record.data.gif.frames[1].canvas);
  for (const fn of disposers) await fn();
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
