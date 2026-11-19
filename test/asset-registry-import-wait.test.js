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
  const timers = new Map();
  let timerId = 0;
  const global = { CM: editor, ZoidiumAssetRegistryParts: {},
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/core/asset-registry-edits.js"), "utf8"),
    { globalThis: global, PZ });
  const edits = global.ZoidiumAssetRegistryParts.createEdits({ PZ, snapshot: () => ({}), refresh() {},
    adapters: new Map(), usageRecords: new WeakMap(), retention: { attach() {}, retain() {} } });
  return { editor, project, history, edits, hash, decode, loading, timers };
}

const tick = () => new Promise(resolve => setImmediate(resolve));
const input = { name: "image.png", type: "image/png" };

test("a drop waits for a slow decoder and retains its media", async () => {
  const h = fixture();
  const pending = h.edits.importFiles([input], { waitForMedia: true });
  h.hash.resolve("image-key"); await tick();
  assert.equal(h.timers.size, 0, "the drop path does not time out the decoder");
  h.decode.resolve({ key: "image-key" }); await tick();
  assert.equal(h.project.media.length, 1);
  h.loading.resolve();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(h.history.finished.length, 1);
});

test("other asset imports keep their existing decoder timeout", async () => {
  const h = fixture();
  const pending = h.edits.importFiles([input]);
  h.hash.resolve("image-key"); await tick();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.delay, 30000);
  timer.callback();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /timed out/);
  assert.equal(h.timers.size, 0);
});

test("a project change while decoding does not add media to the old project", async () => {
  const h = fixture();
  const pending = h.edits.importFiles([input], { waitForMedia: true });
  h.hash.resolve("image-key"); await tick();
  h.editor.project = { media: [] };
  h.history.operation = null;
  h.decode.resolve({ key: "image-key" });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /project changed/);
  assert.equal(h.project.media.length, 0);
});
