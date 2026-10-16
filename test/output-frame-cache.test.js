"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const model = require("../plugins/core/output-frame-store.js");

function observable() {
  const watchers = new Set();
  return { watch(fn) { watchers.add(fn); }, unwatch(fn) { watchers.delete(fn); },
    update() { for (const fn of Array.from(watchers)) fn(); }, watchers };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const events = new Map(), docEvents = new Map(), timers = new Map();
  let nextTimer = 0;
  const counts = { live: 0, display: 0, disposed: 0, serialized: 0, pick: 0, prepared: 0 };
  const clock = { now: 0 };
  class Sequence {
    constructor() {
      this.length = 100; this.videoSchedules = []; this.audioSchedules = [];
      this.properties = { resolution: { onChanged: observable() } };
      this.object = { objects: [], effects: [], loading: Promise.resolve() };
      this.clip = { start: 0, length: 100, object: this.object };
      this.videoTracks = [{ enabled: true, getCurrentClip: () => this.clip }];
    }
    toJSON() { counts.serialized += 1; return { length: this.length, value: this.value }; }
  }
  class Project {
    constructor() { this.assets = { list: {} }; this.sequence = new Sequence(); this.ui = { onChanged: observable() }; }
    toJSON() { return { sequence: this.sequence, plugins: this.plugins }; }
  }
  class Compositor {
    constructor(renderer) { this.renderer = renderer; }
    unload() {}
  }
  class History {
    startOperation() { this.operation = []; }
    pushCommand() {}
    finishOperation() { this.operation = null; }
    discardOperation() { this.operation = null; }
    undo() {}
    redo() {}
  }
  class Viewport {
    _render() {
      counts.live += 1;
      if (this.draws !== false) this.lastFrame = this.editor.playback.currentFrame;
    }
    pickColor() { counts.pick += 1; this._render(); }
  }
  const temporalRuntimes = new Map();
  const PZ = { compositor: Compositor, ui: { viewport: Viewport, history: History },
    zoidium: { getDebugPlugins: () => [], temporal: { frameSamplerRuntimes: temporalRuntimes } } };
  const context = { drawingBufferWidth: 4, drawingBufferHeight: 4, getContextAttributes: () => ({ alpha: false }),
    copyTexSubImage2D() {}, getError: () => 0, NO_ERROR: 0 };
  const renderer = { context, shadowMap: {}, setRenderTarget() {}, setViewport() {}, setTexture2D() {} };
  const project = new Project();
  const history = new History();
  history.operation = null;
  const viewport = new Viewport();
  Object.assign(viewport, { renderer, compositor: new Compositor(renderer), lastFrame: -1,
    editor: { project, history, onProjectChanged: observable(), playback: { currentFrame: 0, speed: 0 } },
    options: { widget2dObjects: [] } });
  const THREE = {
    ShaderMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    ShaderPass: class { constructor(m) { this.material = m; this.uniforms = m.uniforms; } render() { counts.display += 1; } },
    WebGLRenderTarget: class { constructor() { this.texture = {}; } dispose() { counts.disposed += 1; } },
  };
  const document = { fonts: { status: "loaded", ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} },
    addEventListener: (n, f) => docEvents.set(n, f), removeEventListener: n => docEvents.delete(n) };
  const window = { document, PZ, THREE, ZoidiumOutputFrameStore: model,
    localStorage: { getItem: () => null }, performance: { now: () => clock.now },
    addEventListener: (n, f) => events.set(n, f), removeEventListener: n => events.delete(n) };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/core/output-frame-cache.js"), "utf8"), {
    window, PZ, THREE, performance: window.performance, console,
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
  });
  const api = window.ZoidiumFrameCache;
  // Draw until the frame is stored: resources and per-frame readiness settle
  // asynchronously, then the next complete live draw is captured.
  async function warm() {
    for (let i = 0; i < 6 && api.debug.entries === 0; i++) { viewport._render(); await flush(); }
  }
  // Leave the post-signal window in which every draw serializes the project.
  function cool() { clock.now += 5000; }
  return { api, viewport, project, history, counts, events, docEvents, clock, warm, cool, temporalRuntimes, timers,
    Viewport, Compositor, History, PZ };
}

test("a miss draws live exactly once; a complete draw is stored and then replayed", async () => {
  const h = harness();
  h.viewport._render();
  assert.equal(h.counts.live, 1);
  assert.equal(h.api.debug.entries, 0, "readiness has not settled yet");
  await h.warm();
  assert.equal(h.api.debug.entries, 1);
  const live = h.counts.live;
  h.viewport._render();
  assert.equal(h.counts.live, live, "a hit skips the live draw");
  assert.equal(h.counts.display, 1);
  assert.equal(h.viewport.lastFrame, 0);
  h.api.dispose();
});

test("hits outside the post-signal window never serialize the project", async () => {
  const h = harness();
  await h.warm(); h.cool(); h.viewport._render();
  const serialized = h.counts.serialized;
  for (let i = 0; i < 20; i++) h.viewport._render();
  assert.equal(h.counts.serialized, serialized);
  assert.equal(h.api.debug.hits >= 20, true);
  h.api.dispose();
});

for (const [name, signal] of [
  ["an input event", h => h.events.get("pointerdown")({ type: "pointerdown" })],
  ["a history operation", h => { h.history.startOperation(); h.history.finishOperation(); }],
  ["undo", h => h.history.undo()],
  ["project change notifications", h => h.project.ui.onChanged.update()],
]) {
  test(name + " revalidates the full key, and a changed project drops its frames", async () => {
    const h = harness();
    await h.warm(); h.cool(); h.viewport._render();
    h.project.sequence.value = 1; // An edit that only the serialization sees.
    signal(h);
    const live = h.counts.live;
    h.viewport._render();
    assert.equal(h.counts.live, live + 1, "the changed project renders live");
    assert.equal(h.api.debug.entries, 0);
    h.api.dispose();
  });
}

test("pointer movement without a pressed button is not an edit signal", async () => {
  const h = harness();
  await h.warm(); h.cool(); h.viewport._render();
  const serialized = h.counts.serialized;
  h.events.get("pointermove")({ type: "pointermove", buttons: 0 });
  h.viewport._render();
  assert.equal(h.counts.serialized, serialized);
  h.events.get("pointermove")({ type: "pointermove", buttons: 1 });
  h.viewport._render();
  assert.equal(h.counts.serialized > serialized, true);
  h.api.dispose();
});

test("an open native operation keeps revalidating on every draw", async () => {
  const h = harness();
  await h.warm(); h.cool(); h.viewport._render();
  h.history.operation = [];
  const serialized = h.counts.serialized;
  h.viewport._render(); h.viewport._render();
  assert.equal(h.counts.serialized, serialized + 2);
  h.api.dispose();
});

for (const [name, change] of [
  ["asset replacement", h => { h.project.assets.list.a = { url: "blob:new" }; }],
  ["track toggle", h => { h.project.sequence.videoTracks[0].enabled = false; }],
  ["drawing-buffer resize", h => { h.viewport.renderer.context.drawingBufferWidth = 8; }],
  ["render settings", h => { h.viewport.compositor.__zoidiumRenderSettings = { mode: "contain" }; }],
]) {
  test(name + " invalidates without any edit signal", async () => {
    const h = harness();
    await h.warm(); h.cool(); h.viewport._render();
    change(h);
    const live = h.counts.live;
    h.viewport._render();
    assert.equal(h.counts.live, live + 1);
    h.api.dispose();
  });
}

for (const [name, setup] of [
  ["a pending time-effect preview", h => h.temporalRuntimes.set(h.viewport.compositor, { previewPending: true })],
  ["an object still loading frame data", h => { h.project.sequence.object.objects.push({ zoidiumFrameReady: () => false }); }],
  ["a visible video the preview did not decode", h => {
    h.project.sequence.videoSchedules.push({ currentItem: { start: 0, length: 10, media: {} } });
  }],
  ["a draw that showed nothing new", h => { h.viewport.draws = false; }],
]) {
  test(name + " is never stored", async () => {
    const h = harness();
    setup(h);
    for (let i = 0; i < 6; i++) { h.viewport._render(); await flush(); }
    assert.equal(h.api.debug.entries, 0);
    h.api.dispose();
  });
}

test("a video drawn from the preview's exact decoders can be stored", async () => {
  const h = harness();
  const item = { start: 0, length: 10, media: {} };
  h.project.sequence.videoSchedules.push({ currentItem: item });
  h.temporalRuntimes.set(h.viewport.compositor, { previewPending: false, previewKey: "[0,\"key\"]",
    previewMedia: [{ item }] });
  await h.warm();
  assert.equal(h.api.debug.entries, 1);
  h.api.dispose();
});

test("a paused frame waits for its objects' own prepare() before it is stored", async () => {
  const h = harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.project.sequence.object.objects.push({ async prepare(frame) { h.counts.prepared += 1; await gate; } });
  for (let i = 0; i < 6; i++) { h.viewport._render(); await flush(); }
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.counts.prepared >= 1, true);
  release(); await flush(); await flush();
  h.viewport._render();
  assert.equal(h.api.debug.entries, 1);
  h.api.dispose();
});

test("a seek during readiness never stores the old frame's state as the new frame", async () => {
  const h = harness();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.project.sequence.object.objects.push({ prepare: () => gate });
  h.viewport._render(); await flush(); await flush();
  h.viewport.editor.playback.currentFrame = 7;
  release(); await flush(); await flush();
  h.viewport.editor.playback.currentFrame = 0;
  h.viewport._render();
  assert.equal(h.api.debug.entries, 0);
  h.api.dispose();
});

test("an asynchronous preview draw during playback is stored for its own frame", async () => {
  const h = harness();
  await h.warm();
  h.viewport.editor.playback.speed = 1;
  h.api.capturePreview(h.viewport, 5);
  assert.equal(h.api.debug.entries, 2);
  h.viewport.editor.playback.currentFrame = 5;
  const live = h.counts.live;
  h.viewport._render();
  assert.equal(h.counts.live, live);
  h.api.dispose();
});

test("unapproved plugins keep the live preview", async () => {
  const h = harness();
  h.project.plugins = [{ id: "unverified" }];
  for (let i = 0; i < 6; i++) { h.viewport._render(); await flush(); }
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.counts.live, 6);
  h.api.dispose();
});

test("the eyedropper and the 3D editing camera keep the native draw", async () => {
  const h = harness();
  await h.warm();
  const live = h.counts.live;
  h.viewport.pickColor();
  assert.equal(h.counts.pick, 1);
  assert.equal(h.counts.live, live + 1);
  h.viewport.renderMode = true;
  h.viewport._render();
  assert.equal(h.counts.live, live + 2);
  h.api.dispose();
});

for (const reason of ["project", "resolution", "plugin", "size", "compositor", "dispose"]) {
  test("frames are released on " + reason, async () => {
    const h = harness();
    await h.warm();
    assert.equal(h.api.debug.entries, 1);
    if (reason === "project") h.viewport.editor.onProjectChanged.update();
    if (reason === "resolution") h.project.sequence.properties.resolution.onChanged.update();
    if (reason === "plugin") h.docEvents.get("zoidium:plugin-state-change")();
    if (reason === "size") h.api.setSizeMiB(0);
    if (reason === "compositor") h.viewport.compositor.unload();
    if (reason === "dispose") h.api.dispose();
    assert.equal(h.api.debug.entries, 0);
    assert.equal(h.counts.disposed, 1);
    h.api.dispose();
  });
}

test("disposal restores every hook it installed", () => {
  const h = harness();
  const hooked = [h.Viewport.prototype._render, h.Viewport.prototype.pickColor,
    h.Compositor.prototype.unload, h.History.prototype.undo];
  h.api.dispose();
  const restored = [h.Viewport.prototype._render, h.Viewport.prototype.pickColor,
    h.Compositor.prototype.unload, h.History.prototype.undo];
  for (let i = 0; i < hooked.length; i++) assert.notEqual(hooked[i], restored[i]);
  assert.equal(h.events.size, 0);
  assert.equal(h.docEvents.size, 0);
});

test("the core module registers disposal with the plugin lifecycle", () => {
  const extension = require("../plugins/core/output-frame-cache.js");
  let cleanup, disposed = 0;
  extension.activate({ lifecycle: { onDispose(fn) { cleanup = fn; } },
    window: { ZoidiumFrameCache: { dispose() { disposed += 1; } } } });
  cleanup(); assert.equal(disposed, 1);
});

test("a slow-to-serialize project draws live after input and during playback", async () => {
  const h = harness();
  const toJSON = h.project.sequence.toJSON;
  h.project.sequence.toJSON = function () { h.clock.now += 20; return toJSON.call(this); };
  await h.warm(); h.cool(); h.viewport._render();
  h.events.get("pointerdown")({ type: "pointerdown" });
  h.cool(); h.viewport._render(); // Quiet and paused: validates once and measures the cost.
  assert.equal(h.api.debug.entries, 1);
  const serialized = h.counts.serialized;

  h.events.get("pointerdown")({ type: "pointerdown" });
  h.viewport.editor.playback.speed = 1;
  const live = h.counts.live, hits = h.api.debug.hits;
  for (let i = 0; i < 10; i++) h.viewport._render();
  assert.equal(h.counts.serialized, serialized, "no serialization per draw");
  assert.equal(h.counts.live, live + 10, "every draw is the native live draw");
  assert.equal(h.api.debug.hits, hits, "unvalidated frames are never replayed");

  h.project.sequence.value = 2; // An edit only the serialization sees.
  h.viewport.editor.playback.speed = 0;
  h.cool(); h.viewport._render();
  assert.equal(h.counts.serialized, serialized + 1, "validated once when paused and quiet");
  assert.equal(h.counts.live, live + 11, "the changed project renders live");
  h.api.dispose();
});
