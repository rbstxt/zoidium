"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const resample = require("../plugins/core/texture-resample");

// Load the real reload-tracking patch so the cooperation tests exercise the
// actual asset-registry-decode wrapper instead of a copy of its behavior.
globalThis.ZoidiumAssetRegistryParts = { fetch: { changed() {} } };
require("../plugins/core/asset-registry-decode.js");
const { createDecoder } = globalThis.ZoidiumAssetRegistryParts;
delete globalThis.ZoidiumAssetRegistryParts;

function createFakeCanvas(width, height, hooks = {}) {
  const draws = [];
  const canvas = {
    width, height, draws,
    getContext(type) {
      if (type === "2d") {
        if (!canvas.context) {
          canvas.context = {
            imageSmoothingEnabled: false,
            imageSmoothingQuality: "low",
            drawImage(source, dx, dy, dw, dh) {
              draws.push({ source, dx, dy, dw, dh });
            },
          };
        }
        return canvas.context;
      }
      if (type === "webgl" || type === "experimental-webgl") return hooks.webgl || null;
      return null;
    },
  };
  return canvas;
}

function createDocument(spy, hooks = {}) {
  return {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = createFakeCanvas(0, 0, hooks);
      if (spy) spy.canvases.push(canvas);
      return canvas;
    },
  };
}

class FakeTexture {
  constructor(image) {
    this.image = image;
    // Three r91 defaults: clamp wrapping with a mipmap filter.
    this.wrapS = 1001;
    this.wrapT = 1001;
    this.minFilter = 1008;
    this.needsUpdate = false;
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
}

// Mirrors the stock CM3 browser path: getImage decodes once per shared data,
// getTexture builds a THREE texture and flags it after loading finishes.
function createImageAssetClass(THREE, hooks = {}) {
  return class ImageAsset {
    constructor(asset) {
      this.asset = asset;
      let data = asset.data.get(ImageAsset);
      if (!data) {
        data = { image: null, loading: null };
        asset.data.set(ImageAsset, data);
      }
      this.data = data;
    }
    getImage() {
      if (!this.data.image) {
        const nextImage = this.asset.nextImage || hooks.nextImage;
        this.data.image = nextImage ? nextImage(this) : null;
        const nextLoading = this.asset.nextLoading || hooks.nextLoading;
        this.data.loading = nextLoading ? nextLoading(this) : Promise.resolve();
      }
      return this.data.image;
    }
    getTexture() {
      const image = this.getImage();
      const texture = new THREE.Texture(image);
      Promise.resolve(this.data.loading).then(() => {
        if (image.width > 0 && image.height > 0) texture.needsUpdate = true;
      });
      return texture;
    }
  };
}

function createAsset(image, loading) {
  const asset = { data: new Map() };
  asset.nextImage = () => image;
  asset.nextLoading = () => loading || Promise.resolve();
  return asset;
}

function installResampler(ImageAsset, options = {}) {
  const spy = { canvases: [] };
  const host = { document: createDocument(spy, options.gl || {}) };
  const controller = resample.install({ asset: { image: ImageAsset } }, host, {
    maxTextureSize: options.maxTextureSize,
    Image: options.Image || null,
  });
  assert.ok(controller, "install succeeded");
  return { spy, host, controller };
}

test("nearest power of two follows the size rule", () => {
  assert.equal(resample.nearestPowerOfTwo(1080), 1024);
  assert.equal(resample.nearestPowerOfTwo(1920), 2048);
  assert.equal(resample.nearestPowerOfTwo(1500), 2048);
  assert.equal(resample.nearestPowerOfTwo(700), 512);
  assert.equal(resample.nearestPowerOfTwo(1024), 1024);
  assert.equal(resample.nearestPowerOfTwo(1), 1);
  assert.equal(resample.nearestPowerOfTwo(3), 4);
  assert.equal(resample.nearestPowerOfTwo(0), 1);
  // Exact log2 ties round up.
  assert.equal(resample.nearestPowerOfTwo(2 * Math.SQRT2), 4);
});

test("power-of-two detection matches the early-out rule", () => {
  assert.equal(resample.isPowerOfTwo(1), true);
  assert.equal(resample.isPowerOfTwo(1024), true);
  assert.equal(resample.isPowerOfTwo(2048), true);
  assert.equal(resample.isPowerOfTwo(3), false);
  assert.equal(resample.isPowerOfTwo(1080), false);
  assert.equal(resample.isPowerOfTwo(1920), false);
  assert.equal(resample.isPowerOfTwo(0), false);
});

test("target size covers both axes and the device clamp", () => {
  assert.deepEqual(resample.targetSize(1920, 1080, 8192), [2048, 1024]);
  assert.deepEqual(resample.targetSize(1080, 1080, 8192), [1024, 1024]);
  assert.deepEqual(resample.targetSize(512, 512, 8192), [512, 512]);
  assert.deepEqual(resample.targetSize(9000, 9000, 4096), [4096, 4096]);
  assert.deepEqual(resample.targetSize(9000, 700, 4096), [4096, 512]);
  assert.deepEqual(resample.targetSize(1920, 1080, undefined), [2048, 1024]);
});

test("step plan halves large downscales and skips small ones", () => {
  assert.deepEqual(resample.planSteps(4096, 4096, 1024, 1024), [[2048, 2048]]);
  assert.deepEqual(resample.planSteps(3000, 2000, 1024, 1024), [[1500, 2000]]);
  assert.deepEqual(resample.planSteps(4096, 256, 1024, 256), [[2048, 256]]);
  assert.deepEqual(resample.planSteps(1920, 1080, 2048, 1024), []);
  assert.deepEqual(resample.planSteps(1024, 1024, 1024, 1024), []);
});

test("resample draws high-quality steps from source to target", () => {
  const spy = { canvases: [] };
  const source = { width: 4096, height: 4096 };
  const canvas = resample.resampleImage(source, 4096, 4096, 1024, 1024, (width, height) => {
    const created = createFakeCanvas(width, height);
    spy.canvases.push(created);
    return created;
  });
  assert.deepEqual(spy.canvases.map((entry) => [entry.width, entry.height]), [[2048, 2048], [1024, 1024]]);
  const [half, full] = spy.canvases;
  for (const entry of spy.canvases) {
    assert.equal(entry.context.imageSmoothingEnabled, true);
    assert.equal(entry.context.imageSmoothingQuality, "high");
  }
  assert.deepEqual(half.draws, [{ source, dx: 0, dy: 0, dw: 2048, dh: 2048 }]);
  assert.deepEqual(full.draws, [{ source: half, dx: 0, dy: 0, dw: 1024, dh: 1024 }]);
  assert.equal(canvas, full);
});

test("resample returns null without a 2d context", () => {
  const canvas = resample.resampleImage({ width: 1920, height: 1080 }, 1920, 1080, 2048, 1024, () => ({
    width: 2048, height: 1024, getContext: () => null,
  }));
  assert.equal(canvas, null);
});

test("install refuses unsupported hosts and double installs", () => {
  const PZ = { asset: { image: createImageAssetClass({ Texture: FakeTexture }) } };
  assert.equal(resample.install({}, { document: createDocument() }), false);
  assert.equal(resample.install(PZ, { ISNODE: true, document: createDocument() }), false);
  assert.equal(resample.install(PZ, {}, {}), false);
  const host = { document: createDocument() };
  assert.ok(resample.install(PZ, host, { maxTextureSize: 4096 }));
  assert.equal(resample.install(PZ, host, { maxTextureSize: 4096 }), false);
});

test("device limit detection falls back without a context", () => {
  assert.equal(resample.detectMaxTextureSize(createDocument().createElement ? {
    createElement: () => createFakeCanvas(0, 0),
  } : null), 4096);
  assert.equal(resample.detectMaxTextureSize({
    createElement: () => createFakeCanvas(0, 0, { webgl: null }),
  }, 2048), 2048);
  assert.equal(resample.detectMaxTextureSize({
    createElement: () => createFakeCanvas(0, 0, {
      webgl: { MAX_TEXTURE_SIZE: 8192, getParameter() { return 8192; }, getExtension: () => null },
    }),
  }), 8192);
});

test("power-of-two images pass through untouched", () => {
  const ImageAsset = createImageAssetClass({ Texture: FakeTexture });
  const { spy } = installResampler(ImageAsset, { maxTextureSize: 8192 });
  const source = { width: 1024, height: 1024 };
  const texture = new ImageAsset(createAsset(source)).getTexture();
  assert.equal(texture.image, source);
  assert.deepEqual(spy.canvases, []);
});

test("a 1920x1080 image resamples to 2048x1024 once", () => {
  const ImageAsset = createImageAssetClass({ Texture: FakeTexture });
  const { spy } = installResampler(ImageAsset, { maxTextureSize: 8192 });
  const source = { width: 1920, height: 1080 };
  const texture = new ImageAsset(createAsset(source)).getTexture();
  assert.notEqual(texture.image, source);
  assert.equal(texture.image.width, 2048);
  assert.equal(texture.image.height, 1024);
  assert.equal(texture.needsUpdate, true);
  assert.equal(texture.image.context.imageSmoothingQuality, "high");
  assert.deepEqual(spy.canvases.length, 1);
});

test("clamped textures without mipmaps keep the original image", () => {
  const ImageAsset = createImageAssetClass({ Texture: FakeTexture });
  installResampler(ImageAsset, { maxTextureSize: 8192 });
  const source = { width: 1920, height: 1080 };
  const texture = new ImageAsset(createAsset(source)).getTexture();
  texture.minFilter = 1006;
  assert.equal(texture.image, source);
  texture.wrapS = 1000;
  assert.equal(texture.image.width, 2048);
});

test("shared images share one canvas and reloads make a new one", async () => {
  const ImageAsset = createImageAssetClass({ Texture: FakeTexture });
  const { spy } = installResampler(ImageAsset, { maxTextureSize: 8192 });
  const asset = createAsset({ width: 1920, height: 1080 });
  const first = new ImageAsset(asset).getTexture();
  const second = new ImageAsset(asset).getTexture();
  assert.equal(first.image, second.image);
  assert.deepEqual(spy.canvases.length, 1);
  // Mirror the reload mutation in asset-registry-decode: every tracked
  // texture is assigned the freshly decoded image in place.
  const fresh = { width: 1920, height: 1080 };
  asset.data.get(ImageAsset).image = fresh;
  const before = first.image;
  first.image = fresh;
  first.needsUpdate = true;
  second.image = fresh;
  second.needsUpdate = true;
  assert.notEqual(first.image, before);
  assert.equal(first.image, second.image);
  assert.equal(first.image.width, 2048);
  assert.equal(first.image.height, 1024);
  assert.deepEqual(spy.canvases.length, 2);
  await Promise.resolve();
});

test("unloaded images swap after decoding finishes", async () => {
  const ImageAsset = createImageAssetClass({ Texture: FakeTexture });
  installResampler(ImageAsset, { maxTextureSize: 8192 });
  const source = { width: 0, height: 0 };
  let resolveLoading;
  const loading = new Promise((resolve) => { resolveLoading = resolve; });
  const asset = createAsset(source, loading);
  asset.nextImage = () => source;
  asset.nextLoading = () => loading;
  const texture = new ImageAsset(asset).getTexture();
  assert.equal(texture.image, source);
  source.width = 1920;
  source.height = 1080;
  resolveLoading();
  await loading;
  await Promise.resolve();
  assert.notEqual(texture.image, source);
  assert.equal(texture.image.width, 2048);
  assert.equal(texture.image.height, 1024);
  assert.equal(texture.needsUpdate, true);
});

test("animated records, canvases and video stay untouched", () => {
  const ImageAsset = createImageAssetClass({ Texture: FakeTexture });
  installResampler(ImageAsset, { maxTextureSize: 8192 });
  const gifSource = { width: 1920, height: 1080 };
  const gifWrapper = new ImageAsset(createAsset(gifSource));
  gifWrapper.data.gif = { frames: [] };
  assert.equal(gifWrapper.getTexture().image, gifSource);
  const canvasSource = createFakeCanvas(1920, 1080);
  assert.equal(new ImageAsset(createAsset(canvasSource)).getTexture().image, canvasSource);
  const videoSource = { width: 1920, height: 1080, videoWidth: 1920, videoHeight: 1080 };
  assert.equal(new ImageAsset(createAsset(videoSource)).getTexture().image, videoSource);
});

function orderTest(label, resampleFirst) {
  test(label, async () => {
    const THREE = { Texture: FakeTexture };
    const ImageAsset = createImageAssetClass(THREE);
    const PZ = { asset: { image: ImageAsset } };
    const spy = { canvases: [] };
    const host = { document: createDocument(spy) };
    const trackers = [];
    const decoder = (() => {
      if (resampleFirst) {
        const controller = resample.install(PZ, host, { maxTextureSize: 8192 });
        assert.ok(controller);
        const created = createDecoder(PZ, () => {});
        trackers.push(created);
        return created;
      }
      const created = createDecoder(PZ, () => {});
      trackers.push(created);
      const controller = resample.install(PZ, host, { maxTextureSize: 8192 });
      assert.ok(controller);
      return created;
    })();
    assert.ok(decoder);
    const asset = createAsset({ width: 1920, height: 1080 });
    const texture = new ImageAsset(asset).getTexture();
    // The decode wrapper still tracks the texture for reloads.
    assert.ok((texture.listeners.dispose || []).length >= 1);
    assert.notEqual(texture.image, asset.data.get(ImageAsset).image);
    assert.equal(texture.image.width, 2048);
    assert.equal(texture.image.height, 1024);
    const before = texture.image;
    const fresh = { width: 1920, height: 1080 };
    asset.data.get(ImageAsset).image = fresh;
    texture.image = fresh;
    texture.needsUpdate = true;
    assert.notEqual(texture.image, before);
    assert.equal(texture.image.width, 2048);
    assert.deepEqual(spy.canvases.length, 2);
    await Promise.resolve();
  });
}

orderTest("reload tracking cooperates when resample installs first", true);
orderTest("reload tracking cooperates when resample installs last", false);
