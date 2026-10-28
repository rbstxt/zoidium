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
