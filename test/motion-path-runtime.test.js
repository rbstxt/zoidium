"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness(realOverlay = false) {
  const callbacks = new Map(), cleanups = [], counts = { collect: 0, build: 0, marker: 0, draw: 0 };
  let serial = 0, state, shown = true;
  const rect = { left: 0, top: 0, width: 400, height: 300 };
  const toolbar = { buttons: [], click() {} };
  const ctx = { setTransform() {}, clearRect() {} };
  function element() {
    return { style: {}, setAttribute() {}, append() {}, remove() {}, after() {},
      getBoundingClientRect: () => rect, getContext: () => ctx, isConnected: true };
  }
  const transform = { ...element(), closest: () => ({ pz_panel: toolbar }) };
  const document = { createElement: element, createElementNS: element, querySelector: () => transform };
  const viewport = { el: element(), canvas: element(), enabled: true };
  const editor = { mainViewport: viewport, enabled: true, playback: { currentFrame: 10 } };
  const window = { document, CM: editor, PZ: { tween: { easingList: [] } }, devicePixelRatio: 1,
    localStorage: { getItem() { return "true"; }, setItem() {} },
    requestAnimationFrame(fn) { callbacks.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { callbacks.delete(id); } };
  const curves = require("../plugins/motion-path/curves.js");
  let evaluations = 0;
  const keys = [curves.makeKey(0, 0, 1), curves.makeKey(899, 100, 1)];
  const path = { axes: realOverlay ? Array.from({ length: 3 }, () => ({ keyframes: keys, animated: true,
    get(frame) { evaluations++; return frame; } })) : [], id: {}, kind: "2d", local: 10,
    length: 900, space: { toClient: values => values.slice(0, 2) }, clip: { start: 0, length: 900 } };
  const modules = {
    "./targets.js": { collect() { counts.collect++; return shown ? [path] : []; } },
    "./overlay.js": { build(path, easings, selected) { counts.build++;
      return realOverlay ? require("../plugins/motion-path/overlay.js").build(path, easings, selected) : { path }; },
      updateCurrent() { counts.marker++; }, draw() { counts.draw++; } },
    "./interaction.js": { createInteraction(s) { state = s; return { check() {}, dispose() {}, commit() {} }; } },
    "./invalidation.js": { createInvalidation() { return { sync() {}, dispose() {} }; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/motion-path/runtime.js"), "utf8"),
    { module, require: name => modules[name], window });
  module.exports.install({ lifecycle: { onDispose: fn => cleanups.push(fn) } });
  function tick() { const next = [...callbacks]; callbacks.clear(); for (const [, fn] of next) fn(); }
  return { counts, tick, editor, viewport, rect, state: () => state,
    evaluations: () => evaluations, pending: () => callbacks.size, hide() { shown = false; }, dispose() { cleanups.forEach(fn => fn()); } };
}

test("idle motion paths reuse geometry and projections, and move only the playhead marker", () => {
  const h = harness();
  h.tick();
  for (let i = 0; i < 60; i++) h.tick();
  assert.equal(h.counts.collect, 1);
  assert.equal(h.counts.build, 1);
  assert.equal(h.counts.draw, 1);
  h.editor.playback.currentFrame++;
  h.tick();
  assert.equal(h.counts.marker, 1);
  assert.equal(h.counts.build, 1);
  h.state().requestDraw(); h.tick();
  assert.equal(h.counts.build, 2, "property/selection invalidation rebuilds the projection");
  h.rect.width++; h.tick();
  assert.equal(h.counts.build, 3, "viewport changes invalidate client coordinates");
  h.dispose();
  assert.equal(h.pending(), 0);
});

test("no visible motion paths stop the animation loop and invalidation wakes it", () => {
  const h = harness();
  h.hide(); h.tick();
  assert.equal(h.pending(), 0);
  h.state().requestDraw();
  assert.equal(h.pending(), 1);
  h.tick();
  assert.equal(h.counts.collect, 2);
  assert.equal(h.pending(), 0);
  h.dispose();
});

test("property previews, history, parent/camera edits and selection wake stopped paths", () => {
  const { createInvalidation } = require("../plugins/motion-path/invalidation.js");
  function signal() {
    const listeners = new Set();
    return { watch: fn => listeners.add(fn), unwatch: fn => listeners.delete(fn),
      update: () => [...listeners].forEach(fn => fn()), get size() { return listeners.size; } };
  }
  const target = { addEventListener() {}, removeEventListener() {} };
  let dirties = 0;
  const axis = { onKeyframeChanged: signal(), onAnimatedChanged: signal() };
  const parent = { parent: null, properties: { rotation: { onChanged: signal() } }, objects: [] };
  const camera = { properties: { fov: { onChanged: signal() } } };
  parent.objects.push(camera);
  const owner = { parent: {}, parentObject: parent, properties: { position: { objects: [axis] } } };
  const project = { ui: { onChanged: signal() } };
  const objects = { onListChanged: signal() };
  const viewport = { ...target, el: target, canvas: target, controls: target,
    onObjectsChanged: signal(), options: { helper3dObjects: objects }, _render() {} };
  const editor = { project, onProjectChanged: signal(), playback: { currentFrame: 10 } };
  const s = { window: target, document: target, editor, viewport, models: [], requestDraw() { dirties++; } };
  const invalidation = createInvalidation(s);
  invalidation.sync([{ owner }]);
  for (const change of [axis.onKeyframeChanged, axis.onAnimatedChanged, parent.properties.rotation.onChanged,
    camera.properties.fov.onChanged, project.ui.onChanged, objects.onListChanged, editor.onProjectChanged]) change.update();
  assert.equal(dirties, 7);
  viewport._render();
  assert.equal(dirties, 8, "the host draw wakes a path entering a clip");
  viewport._render();
  assert.equal(dirties, 8, "unchanged host draws never invalidate paths");
  invalidation.sync([]);
  assert.equal(axis.onKeyframeChanged.size, 0);
  const retained = viewport._render;
  invalidation.dispose();
  project.ui.onChanged.update(); retained.call(viewport);
  assert.equal(dirties, 8, "disposal removes observers and disables retained wrappers");
});


test("60 unchanged ticks skip 324540 animated-axis evaluations on an 899-frame three-axis path", () => {
  const h = harness(true);
  h.tick();
  const initial = h.evaluations();
  assert.equal(initial, 5409);
  for (let i = 0; i < 60; i++) h.tick();
  assert.equal(h.evaluations() - initial, 0);
  h.dispose();
});


test("invalidation stops before the CM3 project root's unparented getter", () => {
  const { createInvalidation } = require("../plugins/motion-path/invalidation.js");
  let rootParentReads = 0, notifications = 0;
  const listeners = new Set();
  const changed = { watch: fn => listeners.add(fn), unwatch: fn => listeners.delete(fn) };
  const project = { parent: null, ui: { onChanged: changed },
    get parentObject() { rootParentReads++; throw new TypeError("CM3 root has no parent"); } };
  const owner = { parent: {}, parentObject: project, properties: {} };
  const target = { addEventListener() {}, removeEventListener() {} };
  const viewport = { el: target, canvas: target };
  const invalidation = createInvalidation({ window: target, document: target, viewport,
    editor: { project }, models: [], requestDraw() { notifications++; } });
  assert.doesNotThrow(() => invalidation.sync([{ owner }]));
  assert.equal(rootParentReads, 0, "the root parent getter is never evaluated");
  for (const notify of listeners) notify();
  assert.equal(notifications, 1, "project edits still invalidate the overlay");
  invalidation.dispose();
  assert.equal(listeners.size, 0);
});
