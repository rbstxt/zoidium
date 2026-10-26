"use strict";

// Detach guards: releaseSourceImage and loadSourceImage must not throw when
// the consumer's clip was deleted (parentProject getter throws). Attached
// calls keep their previous asset load/unload behavior.

const assert = require("node:assert/strict");
const test = require("node:test");

const shared = require("../plugins/layer-input/layer-input-state.js");
const createRender = require("../plugins/layer-input/layer-input-render.js");

globalThis.THREE = globalThis.THREE || {};
globalThis.THREE.LinearFilter = globalThis.THREE.LinearFilter || "linear";

function installPZ() {
  const calls = { unloaded: [], loaded: [] };
  const PZ = {
    asset: {
      image: class {
        constructor(asset) { this.asset = asset; }
        getTexture() { return { minFilter: null, magFilter: null, generateMipmaps: true }; }
      },
    },
  };
  const assets = {
    load(value) { calls.loaded.push(value); return { url: value }; },
    unload(asset) { calls.unloaded.push(asset); },
  };
  shared.state.PZ = PZ;
  return { calls, assets };
}

function detachedParentProject() {
  return {
    get parentProject() {
      throw new TypeError("Cannot read properties of null (reading 'parentObject')");
    },
  };
}

test("releaseSourceImage unloads the retained image for an attached consumer", () => {
  const { calls, assets } = installPZ();
  const render = createRender(shared.state, {});
  const image = { url: "kept" };
  let disposed = 0;
  const consumer = {
    parentProject: { assets },
    _zoidiumSourceImage: image,
    _zoidiumSourceImageTexture: { dispose() { disposed += 1; } },
  };
  render.releaseSourceImage(consumer);
  assert.deepEqual(calls.unloaded, [image]);
  assert.equal(disposed, 1);
  assert.equal(consumer._zoidiumSourceImage, null);
  assert.equal(consumer._zoidiumSourceImageTexture, null);
});

test("releaseSourceImage does not throw for a detached consumer", () => {
  installPZ();
  const render = createRender(shared.state, {});
  let disposed = 0;
  const consumer = Object.assign(detachedParentProject(), {
    _zoidiumSourceImage: { url: "kept" },
    _zoidiumSourceImageTexture: { dispose() { disposed += 1; } },
  });
  assert.doesNotThrow(() => render.releaseSourceImage(consumer));
  assert.equal(disposed, 1);
  assert.equal(consumer._zoidiumSourceImage, null);
  assert.equal(consumer._zoidiumSourceImageTexture, null);
});

test("loadSourceImage loads through the project assets for an attached consumer", () => {
  const { calls, assets } = installPZ();
  const render = createRender(shared.state, {});
  const consumer = { parentProject: { assets } };
  render.loadSourceImage(consumer, "clip-url");
  assert.deepEqual(calls.loaded, ["clip-url"]);
  assert.ok(consumer._zoidiumSourceImage);
  assert.ok(consumer._zoidiumSourceImageTexture);
});

test("loadSourceImage does not throw for a detached consumer", () => {
  installPZ();
  const render = createRender(shared.state, {});
  const consumer = Object.assign(detachedParentProject(), {
    _zoidiumSourceImage: null,
    _zoidiumSourceImageTexture: null,
  });
  assert.doesNotThrow(() => render.loadSourceImage(consumer, "clip-url"));
  assert.equal(consumer._zoidiumSourceImage, null);
  assert.equal(consumer._zoidiumSourceImageTexture, null);
});
