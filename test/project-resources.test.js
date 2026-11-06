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
  const context = { PZ: { project: Project, schedule: Schedule, observable: Signal }, console, WeakRef, ArrayBuffer, Promise };
  context.window = context;
  vm.runInNewContext(source, context);
  const api = context.PZ.zoidium.projectResources;
  const editor = { project: null, onProjectChanged: new Signal() };
  api.observeEditor(editor);
  function open(project) { editor.project = project; editor.onProjectChanged.update(); }
  function project(...children) { const p = new Project(); p.load(children); return p; }
  const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  return { context, api, editor, open, project, tick, Schedule };
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
