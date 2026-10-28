"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const state = require("../plugins/scene-plus/scene-state.js");
const { createDeformationSupport } = require("../plugins/scene-plus/scene-deform.js");

test("preview holds its first image while source assets prepare before any mesh job exists", async t => {
  let ready, prepares = 0, draws = 0;
  const gate = new Promise(resolve => { ready = resolve; });
  class Scene {
    update() {}
    prepare() { prepares++; return gate; }
  }
  const scene = new Scene();
  scene.objects = [{ deformPositions() {}, objects: [] }];
  class Viewport {
    constructor() { this.enabled = true; this.lastFrame = 20; }
    _render() { scene.update(30); draws++; this.lastFrame = 30; }
  }
  const viewport = new Viewport(), editor = { mainViewport: viewport };
  const THREE = {}, saved = { ...state };
  Object.assign(state, { meshJobs: {}, meshDeformerThree: THREE, library: { core: {} },
    meshDeformerCache: { pending: () => [], restoreMesh() {}, restoreTree() {}, dispose() {} } });
  const support = createDeformationSupport({ layer: { scene: Scene }, ui: { viewport: Viewport } }, THREE, editor);
  t.after(() => { support.deactivate(); Object.assign(state, saved); });
  viewport._render();
  viewport._render();
  assert.equal(draws, 0, "no pristine or empty source frame reaches the canvas");
  assert.equal(viewport.lastFrame, 20);
  await Promise.resolve();
  assert.equal(prepares, 1, "repeat draw requests share the initial preparation");
  ready();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(draws, 1, "the exact first image is presented when preparation completes");
  assert.equal(viewport.lastFrame, 30);
});

function failingStartup(t, prepare, pending = () => []) {
  const badges = new Set(), watchers = new Set();
  let frame = 30, draws = 0, prepares = 0;
  class Scene {
    update() {}
    prepare() { prepares++; return prepare(); }
  }
  const scene = new Scene(); scene.objects = [{ deformPositions() {}, objects: [] }];
  const document = { body: { appendChild: badge => badges.add(badge) }, createElement: () => ({
    style: {}, setAttribute() {}, remove() { badges.delete(this); },
  }) };
  class Viewport {
    constructor() { this.enabled = true; this.lastFrame = 20; this.canvas = {
      ownerDocument: document, getBoundingClientRect: () => ({ left: 0, top: 0 }),
    }; }
    _render() { this.lastFrame = NaN; scene.update(frame); draws++; this.lastFrame = frame; }
  }
  const viewport = new Viewport(), editor = { mainViewport: viewport, project: {},
    onProjectChanged: { watch(fn) { watchers.add(fn); }, unwatch(fn) { watchers.delete(fn); } } };
  const THREE = {}, saved = { ...state };
  Object.assign(state, { meshJobs: {}, meshDeformerThree: THREE, library: { core: {} },
    meshDeformerCache: { pending, restoreMesh() {}, restoreTree() {}, dispose() {} } });
  const support = createDeformationSupport({ layer: { scene: Scene }, ui: { viewport: Viewport } }, THREE, editor);
  t.after(() => { support.deactivate(); Object.assign(state, saved); });
  return { viewport, scene, badges, prepares: () => prepares, draws: () => draws,
    frame(value) { frame = value; }, project() { editor.project = {}; for (const fn of watchers) fn(); } };
}

test("rejected startup preparation releases the next draw and retries only after frame or project changes", async t => {
  const h = failingStartup(t, () => Promise.reject(new Error("source prepare failed")));
  h.viewport._render();
  assert.equal(h.viewport.lastFrame, 20);
  assert.equal(h.badges.size, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.draws(), 1);
  assert.equal(h.badges.size, 0);
  h.viewport._render(); h.viewport._render();
  assert.equal(h.draws(), 3);
  assert.equal(h.prepares(), 1);
  h.frame(31); h.viewport._render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.prepares(), 2);
  assert.equal(h.viewport.lastFrame, 31);
  h.project(); h.viewport._render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.prepares(), 3);
  assert.equal(h.badges.size, 0);
  await assert.rejects(h.scene.prepare(31), /source prepare failed/, "export retains the source-resource failure");
});

test("hung startup preparation has a bounded hold even if mesh jobs remain pending", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const never = new Promise(() => {});
  const h = failingStartup(t, () => never, () => [never]);
  const { PREVIEW_PREPARE_TIMEOUT_MS } = require("../plugins/scene-plus/scene-deform.js");
  h.viewport._render();
  await Promise.resolve();
  t.mock.timers.tick(PREVIEW_PREPARE_TIMEOUT_MS - 1);
  assert.equal(h.draws(), 0);
  assert.equal(h.badges.size, 1);
  t.mock.timers.tick(1);
  assert.equal(h.draws(), 1, "timeout presents whatever content is ready");
  assert.equal(h.viewport.lastFrame, 30);
  assert.equal(h.badges.size, 0);
  h.viewport._render();
  assert.equal(h.draws(), 2);
  assert.equal(h.prepares(), 1, "the same failed frame cannot restart the hold");
});

for (const phase of ["queued", "pending"]) {
  test(`unloading a scene drops its ${phase} startup preparation and preview hold`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let ready;
    const gate = new Promise(resolve => { ready = resolve; });
    const h = failingStartup(t, () => gate);
    h.viewport._render();
    assert.equal(h.badges.size, 1);
    if (phase === "pending") await Promise.resolve();
    h.scene.unload(); h.scene.objects = [];
    h.viewport._render();
    assert.equal(h.badges.size, 0, "the next draw releases the unloaded scene's hold");
    assert.equal(h.draws(), 1);
    ready(); await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(20000);
    assert.equal(h.prepares(), phase === "queued" ? 0 : 1);
    assert.equal(h.draws(), 1, "unloaded preparation never redraws or times out");
  });
}
