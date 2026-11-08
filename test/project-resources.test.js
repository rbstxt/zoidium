"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(require.resolve("../plugins/core/project-resources.js"), "utf8");
const shared = fs.readFileSync(require.resolve("../plugins/core/project-files-shared.js"), "utf8");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  class Signal {
    constructor() { this.watchers = []; }
    watch(fn) { this.watchers.push(fn); }
    update() { for (const fn of this.watchers) fn(); }
  }
  class Project {
    load(children = []) { this.children = children; }
  }
  class Schedule {
    prepare(_frame, context) { return context.work; }
  }
  const urls = { revoked: [], created: 0 };
  const URL = {
    revokeObjectURL(url) { urls.revoked.push(url); },
    createObjectURL() { urls.created += 1; return "blob:new-" + urls.created; },
  };
  const context = { PZ: { project: Project, schedule: Schedule, observable: Signal }, console, WeakRef, ArrayBuffer, Promise, URL };
  context.window = context;
  vm.runInNewContext(source, context);
  const api = context.PZ.zoidium.projectResources;
  const editor = { project: null, onProjectChanged: new Signal(), onEnabledChanged: new Signal() };
  api.observeEditor(editor);
  function open(project) { editor.project = project; editor.onProjectChanged.update(); }
  function project(...children) { const p = new Project(); p.load(children); return p; }
  const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { context, api, editor, open, project, tick, Schedule, urls };
}
function geometry() {
  return { isBufferGeometry: true, disposed: 0, dispose() { this.disposed++; } };
}

test("retirement waits for preparation and preserves model arrays", async () => {
  const h = setup(), work = deferred(), gpu = geometry();
  const objects = [{ geometry: gpu }];
  const layer = { objects, prepare() { return work.promise.then(() => objects.push({})); } };
  const old = h.project(layer);
  h.open(old);
  const pending = layer.prepare();
  h.open(h.project());
  await h.tick();
  assert.equal(gpu.disposed, 0);
  work.resolve();
  await pending;
  await h.tick();
  assert.equal(gpu.disposed, 1);
  assert.equal(layer.objects, objects);
  assert.equal(objects.length, 2);
});

test("native schedule work holds the old project until rejection settles", async () => {
  const h = setup(), work = deferred(), gpu = geometry(), old = h.project({ gpu });
  const sequence = { parentProject: old };
  h.open(old);
  const pending = new h.Schedule().prepare(0, { sequence, work: work.promise });
  assert.equal(pending, work.promise, "native promise identity is preserved");
  h.open(h.project());
  await h.tick();
  assert.equal(gpu.disposed, 0);
  work.reject(new Error("decode failed"));
  await assert.rejects(pending, /decode failed/);
  await h.tick();
  assert.equal(gpu.disposed, 1);
});

test("async factory children and preparation are observed before retiring", async () => {
  const h = setup(), loading = deferred(), work = deferred(), gpu = geometry();
  const layer = { loading: loading.promise };
  const old = h.project(layer);
  h.open(old);
  h.open(h.project());
  layer.children = [{ gpu, prepare() { return work.promise; } }];
  loading.resolve();
  // Another native loading continuation starts work as loading settles.
  loading.promise.then(() => layer.children[0].prepare());
  await h.tick();
  assert.equal(gpu.disposed, 0);
  work.resolve();
  await h.tick();
  assert.equal(gpu.disposed, 1);
});

test("rapid A to B to A does not dispose the active graph or shared resources", async () => {
  const h = setup(), a = geometry(), b = geometry(), shared = geometry();
  const first = h.project({ gpu: a, shared }), second = h.project({ gpu: b, shared });
  h.open(first);
  h.open(second);
  h.open(first);
  await h.tick();
  assert.equal(a.disposed, 0);
  assert.equal(b.disposed, 1);
  assert.equal(shared.disposed, 0);
});

test("a timed-out warm-up keeps its underlying preparation reservation", async () => {
  const h = setup(), work = deferred(), gpu = geometry();
  const old = h.project({ gpu });
  old.sequence = { parentProject: old, videoTracks: [{ clips: [{ object: { prepare: () => work.promise } }] }] };
  const timers = [];
  Object.assign(h.context, { setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, console: { warn() {} } });
  vm.runInNewContext(shared, h.context);
  h.open(old);
  const warm = h.context.PZ.zoidium.projectFilesShared.warmProjectClips(old);
  await h.tick();
  timers[0]();
  await warm;
  h.open(h.project());
  await h.tick();
  assert.equal(gpu.disposed, 0);
  work.resolve();
  await h.tick();
  assert.equal(gpu.disposed, 1);
});

test("retirement skips DOM and getters, and releases render targets once", async () => {
  const h = setup(), texture = { isTexture: true, dispose() { throw Error("owned by target"); } };
  const target = { isWebGLRenderTarget: true, texture, disposed: 0, dispose() { this.disposed++; } };
  const node = { target, texture, get parentProject() { throw Error("do not follow getters"); } };
  const old = h.project(node);
  h.open(old);
  h.open(h.project());
  await h.tick();
  assert.equal(target.disposed, 1);
});

function withAsset(project, url, file = {}) {
  project.assets = { list: { key: { url, file } } };
  return project.assets.list.key;
}

test("a retired project gives up its media object URLs once its work settles", async () => {
  const h = setup(), work = deferred(), old = h.project();
  const asset = withAsset(old, "blob:old");
  h.open(old);
  const pending = h.api.prepare(old, () => work.promise);
  h.open(h.project());
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
  work.resolve();
  await pending;
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old"]);
  assert.equal(asset.url, "blob:old");
});

test("object URLs without a file, and ones the live project shares, stay valid", async () => {
  const h = setup(), old = h.project(), next = h.project();
  old.assets = { list: { preset: { url: "/fonts/a.json", file: null }, remote: { url: "blob:no-file", file: null }, shared: { url: "blob:shared", file: {} } } };
  next.assets = { list: { shared: { url: "blob:shared", file: {} } } };
  h.open(old);
  h.open(next);
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
});

test("a project that returns to the editor gets new object URLs", async () => {
  const h = setup(), old = h.project(), other = h.project();
  const asset = withAsset(old, "blob:old");
  h.open(old);
  h.open(other);
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old"]);
  h.open(old);
  assert.equal(asset.url, "blob:new-1");
  h.open(other);
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old", "blob:new-1"]);
});

test("an export in progress keeps the replaced project's object URLs", async () => {
  const h = setup(), old = h.project();
  withAsset(old, "blob:old");
  h.open(old);
  h.editor.enabled = false;
  h.open(h.project());
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
});


test("deferred object URLs are revoked when the last export releases its editor", async () => {
  const h = setup(), old = h.project();
  withAsset(old, "blob:old");
  h.open(old);
  h.editor.enabled = false;
  h.open(h.project());
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
  const other = { project: h.project(), enabled: false,
    onProjectChanged: new h.context.PZ.observable(), onEnabledChanged: new h.context.PZ.observable() };
  h.api.observeEditor(other);
  h.editor.enabled = true;
  h.editor.onEnabledChanged.update();
  await h.tick();
  assert.deepEqual(h.urls.revoked, [], "a second export still owns its URLs");
  other.enabled = true;
  other.onEnabledChanged.update();
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old"]);
  other.onEnabledChanged.update();
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old"], "completion notifications do not revoke twice");
});

test("a deferred project can return before export completion without losing its URLs", async () => {
  const h = setup(), old = h.project();
  const asset = withAsset(old, "blob:old");
  h.open(old);
  h.editor.enabled = false;
  h.open(h.project());
  await h.tick();
  h.open(old);
  h.editor.enabled = true;
  h.editor.onEnabledChanged.update();
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
  assert.equal(asset.url, "blob:old");
});

test("deferred URL release also waits for preparation that starts during export", async () => {
  const h = setup(), work = deferred(), old = h.project();
  withAsset(old, "blob:old");
  h.open(old);
  h.editor.enabled = false;
  h.open(h.project());
  await h.tick();
  const pending = h.api.prepare(old, () => work.promise);
  h.editor.enabled = true;
  h.editor.onEnabledChanged.update();
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
  work.resolve();
  await pending;
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old"]);
});

test("deferred URLs are released even if the retired graph is collected before export ends", async () => {
  const h = setup(), old = h.project();
  withAsset(old, "blob:old");
  h.open(old);
  h.editor.enabled = false;
  // Simulate collection of the deferred project while the editor remains live.
  h.context.WeakRef = class { deref() { return undefined; } };
  h.open(h.project());
  await h.tick();
  assert.deepEqual(h.urls.revoked, []);
  h.editor.enabled = true;
  h.editor.onEnabledChanged.update();
  await h.tick();
  assert.deepEqual(h.urls.revoked, ["blob:old"]);
});

test("project replacement releases GPU resources owned by parked composition timelines", async () => {
  const h = setup(), active = geometry(), parked = geometry(), old = h.project({ gpu: active });
  old.__zoidiumPrecompTimelines = [{ videoTracks: [{ clips: [{ object: { gpu: parked } }] }] }];
  h.open(old);
  await h.tick();
  assert.equal(parked.disposed, 0, "closed authored timelines remain available to Undo");
  h.open(h.project());
  await h.tick();
  assert.equal(active.disposed, 1);
  assert.equal(parked.disposed, 1);
});
