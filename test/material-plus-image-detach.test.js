"use strict";

// Detach guards: Material+ image release (graph-images releaseImages and
// prepareImages) and surface unload/setImage must not throw when the
// material's clip was deleted (parentProject getter throws). Attached calls
// keep their previous asset load/unload behavior.

const assert = require("node:assert/strict");
const test = require("node:test");

const attachGraphImages = require("../plugins/material-plus/graph-images.js");
const installSurfaceMaterial = require("../plugins/material-plus/surface-material.js");

function detachedParentProject() {
  return {
    get parentProject() {
      throw new TypeError("Cannot read properties of null (reading 'parentObject')");
    },
  };
}

function graphWorld() {
  const calls = { unloaded: [], loaded: [] };
  const assets = {
    load(key) { calls.loaded.push(key); return { url: key }; },
    unload(asset) { calls.unloaded.push(asset); },
  };
  const PZ = {
    asset: {
      image: class {
        constructor(asset) { this.asset = asset; this.data = {}; }
        getImage() { return {}; }
        get loading() { return Promise.resolve(); }
      },
    },
  };
  const nodes = {};
  attachGraphImages(nodes, { PZ, document: {}, newBuffer: (size) => new Uint8Array(size) });
  return { nodes, assets, calls };
}

test("releaseImages unloads cached assets for an attached material", () => {
  const { nodes, assets, calls } = graphWorld();
  const asset = { url: "graph-asset" };
  const material = { parentProject: { assets } };
  nodes.getImageCache(material).one = { asset };
  nodes.releaseImages(material);
  assert.deepEqual(calls.unloaded, [asset]);
  assert.deepEqual(Object.keys(nodes.getImageCache(material)), []);
});

test("releaseImages does not throw for a detached material", () => {
  const { nodes, calls } = graphWorld();
  const material = Object.assign(detachedParentProject(), {});
  nodes.getImageCache(material).one = { asset: { url: "graph-asset" } };
  assert.doesNotThrow(() => nodes.releaseImages(material));
  assert.deepEqual(calls.unloaded, []);
  assert.deepEqual(Object.keys(nodes.getImageCache(material)), []);
});

test("prepareImages drops stale entries without a project for a detached material", async () => {
  const { nodes } = graphWorld();
  const material = Object.assign(detachedParentProject(), {});
  nodes.getImageCache(material).stale = {
    asset: { url: "stale" },
    disposed: false,
    loaded: { loading: Promise.resolve(), getImage: () => ({}) },
    loading: Promise.resolve(),
  };
  await assert.doesNotReject(nodes.prepareImages({ nodes: [{ params: {} }] }, material));
  assert.deepEqual(Object.keys(nodes.getImageCache(material)), []);
});

test("surface unload releases slot assets for an attached material", () => {
  const calls = [];
  const donor = {
    parentProject: { assets: { unload(asset) { calls.push(asset); } } },
    pzImages: { texture: { url: "slot" }, ao: null },
    pzTextures: { texture: { dispose() {} }, ao: null },
    pzGraphTextures: {},
    threeObj: { envMap: null, dispose() {} },
  };
  installSurfaceMaterial(donor, {});
  donor.unload();
  assert.deepEqual(calls, [{ url: "slot" }]);
  assert.equal(donor.pzImages.texture, null);
});

test("surface unload does not throw for a detached material", () => {
  const donor = Object.assign(detachedParentProject(), {
    pzImages: { texture: { url: "slot" }, ao: null },
    pzTextures: { texture: { dispose() {} }, ao: null },
    pzGraphTextures: {},
    threeObj: { envMap: null, dispose() {} },
  });
  installSurfaceMaterial(donor, {});
  assert.doesNotThrow(() => donor.unload());
  assert.equal(donor.pzImages.texture, null);
});

test("surface setImage does not throw for a detached material", () => {
  const donor = Object.assign(detachedParentProject(), {
    pzImages: { texture: { url: "slot" }, ao: null },
    pzTextures: { texture: { dispose() {} }, ao: null },
  });
  installSurfaceMaterial(donor, {});
  let result;
  assert.doesNotThrow(() => { result = donor.setImage("texture", "next-url"); });
  assert.equal(result, null);
  assert.equal(donor.pzImages.texture, null);
});
