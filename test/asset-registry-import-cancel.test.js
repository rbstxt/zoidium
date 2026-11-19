"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function fixture() {
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  const hash = deferred(), decode = deferred(), loading = deferred();
  const history = { operation: null, finished: [],
    startOperation() { this.operation = []; },
    finishOperation() { this.finished.push(this.operation); this.operation = null; },
    pushCommand(command) { this.operation?.push(command); } };
  const project = { media: [], assets: { list: {}, async createFromFile(_type, file, key) {
    const asset = { key, filename: file.name }; this.list[key] = asset; return asset;
  } } };
  const editor = { project, history };
  function Media() {}
  Media.prototype.importFile = () => decode.promise;
  Media.prototype.createMedia = function ({ data }) {
    project.media.push({ assets: [data.key], loading: loading.promise });
    history.pushCommand("create-media");
  };
  const PZ = { asset: { type: { IMAGE: 1 }, hash: () => hash.promise }, ui: { media: Media } };
  const global = { CM: editor, setTimeout, clearTimeout, ZoidiumAssetRegistryParts: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/core/asset-registry-edits.js"), "utf8"),
    { globalThis: global, PZ });
  const edits = global.ZoidiumAssetRegistryParts.createEdits({ PZ, snapshot: () => ({}), refresh() {},
    adapters: new Map(), usageRecords: new WeakMap(), retention: { attach() {}, retain() {} } });
  return { editor, project, history, edits, hash, decode, loading };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const input = { name: "image.png", type: "image/png" };

test("a timed-out hash cannot add an asset to a later history operation", async () => {
  const h = fixture(), controller = new AbortController();
  h.history.startOperation();
  const pending = h.edits.importFiles([input], { signal: controller.signal });
  controller.abort(); h.history.finishOperation(); h.history.startOperation();
  h.hash.resolve("image-key"); await pending;
  assert.deepEqual(Object.keys(h.project.assets.list), []);
  assert.deepEqual(h.history.operation, []);
  assert.equal(h.project.media.length, 0);
});

test("a decoder that finishes after timeout cannot create media in a later operation", async () => {
  const h = fixture(), controller = new AbortController();
  h.history.startOperation();
  const pending = h.edits.importFiles([input], { signal: controller.signal });
  h.hash.resolve("image-key"); await tick();
  assert.equal(h.history.operation.length, 1, "the created asset has an undo command");
  controller.abort(); h.history.finishOperation(); h.history.startOperation();
  h.decode.resolve({ key: "image-key" }); await pending;
  assert.deepEqual(h.history.operation, []);
  assert.equal(h.project.media.length, 0);
});

test("late media loading cannot finish a later history operation", async () => {
  const h = fixture(), controller = new AbortController();
  h.history.startOperation();
  const pending = h.edits.importFiles([input], { signal: controller.signal });
  h.hash.resolve("image-key"); h.decode.resolve({ key: "image-key" }); await tick();
  assert.equal(h.project.media.length, 1);
  controller.abort(); h.history.finishOperation(); h.history.startOperation();
  const next = h.history.operation;
  h.loading.resolve(); await pending;
  assert.equal(h.history.operation, next);
  assert.deepEqual(next, []);
});
