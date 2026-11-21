"use strict";

// Node graph project images: a load that rejects must not stay in the
// per-material cache. The next prepareImages has to load the image again,
// while a rejection that arrives after the entry was removed or replaced must
// not delete or release the entry that now owns the cache slot.

const assert = require("node:assert/strict");
const test = require("node:test");

const attachGraphImages = require("../plugins/material-plus/graph-images.js");

function imageGraph(...keys) {
  return { nodes: keys.map(key => ({ params: { asset: key } })) };
}

// The first image load for a key stays pending until the test settles it;
// every later load for that key resolves with its own canvas.
function imageWorld() {
  const calls = { loads: [], unloads: [] };
  const attempts = new Map();
  const pending = [];
  const assets = {
    load(key) {
      const asset = { key };
      calls.loads.push(asset);
      return asset;
    },
    unload(asset) { calls.unloads.push(asset); },
  };
  const PZ = {
    asset: {
      image: class {
        constructor(asset) {
          this.asset = asset;
          const attempt = (attempts.get(asset.key) || 0) + 1;
          attempts.set(asset.key, attempt);
          this.image = { key: asset.key, attempt };
          if (attempt > 1) { this.loading = Promise.resolve(); return; }
          this.loading = new Promise((resolve, reject) => pending.push({ resolve, reject }));
        }
        getImage() { return this.image; }
      },
    },
  };
  const nodes = {};
  attachGraphImages(nodes, { PZ, document: {}, newBuffer: size => new Uint8Array(size) });
  const material = { parentProject: { assets } };
  return { nodes, material, calls, pending };
}

test("a rejected graph image load is retried by the next prepareImages", async () => {
  const { nodes, material, calls, pending } = imageWorld();
  const graph = imageGraph("image");
  const first = nodes.prepareImages(graph, material);
  assert.equal(calls.loads.length, 1);
  const firstAsset = calls.loads[0];

  pending[0].reject(new Error("synthetic decode failure"));
  await assert.rejects(first, /synthetic decode failure/);
  assert.equal(nodes.getImageCache(material).image, undefined);
  assert.deepEqual(calls.unloads, [firstAsset]);

  await nodes.prepareImages(graph, material);
  const entry = nodes.getImageCache(material).image;
  assert.equal(calls.loads.length, 2, "the second prepareImages loads the asset again");
  assert.equal(entry.asset, calls.loads[1]);
  assert.notEqual(entry.asset, firstAsset);
  assert.deepEqual(entry.canvas, { key: "image", attempt: 2 });
  assert.equal(entry.revision, 1);
  assert.equal(entry.disposed, false);
  assert.equal(calls.unloads.length, 1, "only the failed attempt was released");

  nodes.releaseImages(material);
  assert.equal(calls.unloads.length, 2);
  assert.equal(calls.unloads.length, calls.loads.length, "every loaded asset is released once");
});

test("a rejection after the entry was replaced leaves the replacement alone", async () => {
  const { nodes, material, calls, pending } = imageWorld();
  const graph = imageGraph("image");
  const first = nodes.prepareImages(graph, material);
  const stale = pending[0];
  const firstAsset = calls.loads[0];

  // The graph no longer references the image: the pending entry is removed and
  // its asset released before the load settles.
  await nodes.prepareImages(imageGraph(), material);
  assert.equal(nodes.getImageCache(material).image, undefined);
  assert.equal(calls.unloads.length, 1);

  // The image is referenced again and a replacement entry starts its own load.
  const second = nodes.prepareImages(graph, material);
  const replacement = nodes.getImageCache(material).image;
  assert.equal(calls.loads.length, 2);
  assert.notEqual(replacement.asset, firstAsset);

  stale.reject(new Error("late decode failure"));
  await assert.rejects(first, /late decode failure/);
  await second;

  assert.equal(nodes.getImageCache(material).image, replacement, "the replacement stays cached");
  assert.equal(replacement.disposed, false);
  assert.equal(replacement.revision, 1);
  assert.equal(calls.unloads.length, 1, "the replaced entry is not released a second time");
  assert.deepEqual(calls.unloads, [firstAsset]);

  await nodes.prepareImages(graph, material);
  assert.equal(calls.loads.length, 2, "the cached replacement is reused");
});

test("a rejection after releaseImages does not release the asset twice", async () => {
  const { nodes, material, calls, pending } = imageWorld();
  const first = nodes.prepareImages(imageGraph("image"), material);

  nodes.releaseImages(material);
  assert.equal(calls.unloads.length, 1);

  pending[0].reject(new Error("late decode failure"));
  await assert.rejects(first, /late decode failure/);
  assert.equal(calls.unloads.length, 1, "the released entry is not unloaded again");
});

// The asset reloader replaces the decode promise on the loaded wrapper before
// it calls reloadImages. The returned promise stays pending until the test
// settles it, so the rejection arrives while the entry is in a known state.
function deferredLoading(entry) {
  const pending = {};
  entry.loaded.loading = new Promise((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;
  });
  return pending;
}

test("a rejected graph image reload is retried by the next prepareImages", async () => {
  const { nodes, material, calls, pending } = imageWorld();
  const graph = imageGraph("image");
  const first = nodes.prepareImages(graph, material);
  pending[0].resolve();
  await first;
  const entry = nodes.getImageCache(material).image;
  assert.equal(entry.revision, 1);
  const asset = entry.asset;

  const reload = deferredLoading(entry);
  const reloaded = nodes.reloadImages(material, "image", asset);
  reload.reject(new Error("synthetic reload failure"));
  await assert.rejects(reloaded, /synthetic reload failure/);

  assert.equal(nodes.getImageCache(material).image, undefined);
  assert.deepEqual(calls.unloads, [asset]);

  await nodes.prepareImages(graph, material);
  const replacement = nodes.getImageCache(material).image;
  assert.equal(calls.loads.length, 2, "the next prepareImages loads the asset again");
  assert.notEqual(replacement.asset, asset);
  assert.deepEqual(replacement.canvas, { key: "image", attempt: 2 });
  assert.equal(replacement.revision, 1);
  assert.equal(calls.unloads.length, 1, "only the failed reload was released");

  nodes.releaseImages(material);
  assert.equal(calls.unloads.length, 2);
  assert.equal(calls.unloads.length, calls.loads.length, "every loaded asset is released once");
});

test("a rejected reload leaves a replacement entry alone", async () => {
  const { nodes, material, calls, pending } = imageWorld();
  const graph = imageGraph("image");
  const first = nodes.prepareImages(graph, material);
  pending[0].resolve();
  await first;
  const entry = nodes.getImageCache(material).image;
  const firstAsset = entry.asset;

  const reload = deferredLoading(entry);
  const reloaded = nodes.reloadImages(material, "image", entry.asset);

  // The graph drops the image while the reload is pending, and a later edit
  // adds it back with a replacement entry.
  await nodes.prepareImages(imageGraph(), material);
  assert.equal(calls.unloads.length, 1);
  const second = nodes.prepareImages(graph, material);
  const replacement = nodes.getImageCache(material).image;
  assert.equal(calls.loads.length, 2);

  reload.reject(new Error("late reload failure"));
  await assert.rejects(reloaded, /late reload failure/);
  await second;

  assert.equal(nodes.getImageCache(material).image, replacement, "the replacement stays cached");
  assert.equal(replacement.disposed, false);
  assert.equal(replacement.revision, 1);
  assert.equal(calls.unloads.length, 1, "the replaced entry is not released a second time");
  assert.deepEqual(calls.unloads, [firstAsset]);

  await nodes.prepareImages(graph, material);
  assert.equal(calls.loads.length, 2, "the cached replacement is reused");
});
