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

function harness({ prefetch = false, stale = false } = {}) {
  const events = new Map(), docEvents = new Map(), timers = new Map();
  let nextTimer = 0;
  const notices = [], canvasEvents = new Map();
  const canvas = { addEventListener: (n, f) => canvasEvents.set(n, f), removeEventListener: n => canvasEvents.delete(n) };
  const counts = { allocated: 0, live: 0, display: 0, disposed: 0, serialized: 0, pick: 0, prepared: 0 };
  const clock = { now: 0 };
  class Sequence {
    constructor() {
      this.length = 100; this.audioTracks = []; this.videoSchedules = []; this.audioSchedules = [];
      this.properties = { resolution: { onChanged: observable() } };
      this.object = { objects: [], effects: [], loading: Promise.resolve() };
      this.clip = { start: 0, length: 100, object: this.object };
      this.videoTracks = [{ enabled: true, clips: [], getCurrentClip: () => this.clip }];
    }
    toJSON() {
      counts.serialized += 1;
      return { length: this.length, value: this.value,
        ...(prefetch ? { schedules: this.videoSchedules.map(({ padding, items }) => ({ padding, items })) } : {}) };
    }
    load(data) {
      this.length = data.length; this.value = data.value;
      this.videoSchedules = data.schedules.map(schedule => ({ ...schedule,
        prepare(frame) {
          if (schedule.items.some(item => frame >= item.start - schedule.padding && frame < item.start + item.length)) {
            counts.privateDecodes = (counts.privateDecodes || 0) + 1;
          }
        },
        unload() {},
      }));
    }
    update() {}
  }
  class Project {
    constructor() { this.media = []; this.assets = { list: {} }; this.sequence = new Sequence(); this.ui = { onChanged: observable() }; }
    toJSON() { return { sequence: this.sequence, plugins: this.plugins }; }
  }
  class Compositor {
    constructor(renderer) { this.renderer = renderer; }
    renderSequence(frame) { (counts.privateFrames ||= []).push(frame); }
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
    project: Project, asset: class {},
    zoidium: { getDebugPlugins: () => [], temporal: { frameSamplerRuntimes: temporalRuntimes,
      usesSingleEvaluation: () => false, registerExportCompositor() {} } } };
  const context = { drawingBufferWidth: 4, drawingBufferHeight: 4, getContextAttributes: () => ({ alpha: false }),
    canvas, lost: false, error: 0, copyError: 0,
    copyTexSubImage2D(...args) {
      counts.copies = (counts.copies || 0) + 1;
      counts.copySize = args.slice(-2);
      this.error = this.copyError; this.copyError = 0;
    },
    getError() { const error = this.error; this.error = 0; return error; },
    isContextLost() { return this.lost; }, NO_ERROR: 0, OUT_OF_MEMORY: 1285 };
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
    WebGLRenderTarget: class { constructor() { this.texture = {}; counts.allocated += 1; } dispose() { counts.disposed += 1; } },
  };
  const document = { fonts: { status: "loaded", ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} },
    addEventListener: (n, f) => docEvents.set(n, f), removeEventListener: n => docEvents.delete(n) };
  const window = { document, PZ, THREE, CM: { mainViewport: viewport }, ZoidiumOutputFrameStore: model,
    ZoidiumOutputFrameApprovals: { ...require("../plugins/core/output-frame-approvals.js"), stale },
    ZoidiumUI: { notify(message) { notices.push(message); } },
    localStorage: { getItem: () => null }, performance: { now: () => clock.now },
    addEventListener: (n, f) => events.set(n, f), removeEventListener: n => events.delete(n) };
  window.__zoidiumTemporalParts = { sampler: { getFrameSamplerRuntime: () => ({ schedules: new Map() }) } };
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
    Viewport, Compositor, History, PZ, document, canvasEvents, notices };
}

test("stale approvals keep every preview live and explain why", async () => {
  const h = harness({ stale: true });
  await h.warm();
  h.viewport._render();
  assert.equal(h.counts.live, 7);
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.counts.allocated, 0);
  assert.equal(h.api.usage().reason, "Preview cache approvals are stale for this build");
  h.api.dispose();
});

test("a miss draws live exactly once; a complete draw is stored and then replayed", async () => {
  const h = harness();
  h.viewport._render();
  assert.equal(h.counts.live, 1);
  assert.equal(h.api.debug.entries, 0, "readiness has not settled yet");
  assert.match(h.api.usage().reason, /scene resources/);
  await h.warm();
  assert.equal(h.api.debug.entries, 1);
  const live = h.counts.live;
  h.viewport._render();
  assert.equal(h.counts.live, live, "a hit skips the live draw");
  assert.equal(h.counts.display, 1);
  assert.equal(h.viewport.lastFrame, 0);
  assert.equal(h.api.usage().reason, null);
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
  assert.match(h.api.usage().reason, /unverified.*not verified/);
  h.api.dispose();
});

test("an older Native FX version cannot use the current approval", async () => {
  const h = harness();
  h.project.plugins = [{ id: "native-fx" }];
  h.PZ.zoidium.getDebugPlugins = () => [{ id: "native-fx", version: "34", enabled: true, phase: "enabled" }];
  h.PZ.zoidium.temporal.usesSingleEvaluation = (_sequence, excludeSamplers) => !excludeSamplers;
  await h.warm();
  assert.equal(h.api.debug.entries, 0);
  assert.match(h.api.usage().reason, /native-fx.*34.*not verified/);
  assert.equal(h.counts.allocated, 0);
  h.api.dispose();
});

for (const [id, record] of Object.entries(require("../plugins/core/output-frame-approvals.js").plugins)) {
  test("oracle-approved " + id + " retains completed sampler output", async () => {
    const h = harness();
    h.project.plugins = [{ id }];
    h.PZ.zoidium.getDebugPlugins = () => [{ id, version: record.version, enabled: true, phase: "enabled" }];
    h.PZ.zoidium.temporal.usesSingleEvaluation = (_sequence, excludeSamplers) => !excludeSamplers;
    await h.warm();
    assert.equal(h.api.debug.entries, 1);
    const live = h.counts.live;
    h.viewport._render();
    assert.equal(h.counts.live, live);
    assert.equal(h.api.debug.hits, 1);
    h.api.dispose();
  });
}

test("an unrelated bundle failure before activation permits cache hits", async () => {
  const h = harness();
  h.PZ.zoidium.getDebugPlugins = () => [{ id: "unused", enabled: false, phase: "error",
    activationStarted: false, lastError: { operation: "enable", message: "bundle unavailable" } }];
  await h.warm();
  assert.equal(h.api.debug.entries, 1);
  const live = h.counts.live;
  h.viewport._render();
  assert.equal(h.counts.live, live);
  assert.equal(h.api.debug.hits, 1);
  h.api.dispose();
});

test("a retry that starts loading without an event drops retained frames", async () => {
  const h = harness();
  const plugin = { id: "unused", enabled: false, phase: "error", activationStarted: false,
    lastError: { message: "bundle unavailable" } };
  h.PZ.zoidium.getDebugPlugins = () => [plugin];
  await h.warm(); h.cool(); h.viewport._render();
  assert.equal(h.api.debug.entries, 1);
  plugin.phase = "loading";
  h.viewport._render();
  assert.equal(h.api.debug.entries, 0);
  assert.match(h.api.usage().reason, /Plugins are loading/);
  plugin.phase = "error"; plugin.activationStarted = true;
  await h.warm();
  assert.equal(h.api.debug.entries, 0);
  h.api.dispose();
});

for (const [name, plugin, required] of [
  ["required bundle failure", { activationStarted: false }, true],
  ["failed activation", { activationStarted: true }, false],
  ["unknown activation history", {}, false],
  ["core failure", { activationStarted: false, kind: "core" }, false],
  ["core bundle failure", { id: "core", activationStarted: false }, false],
  ["enabled plugin error", { activationStarted: false, enabled: true }, false],
]) test(name + " still blocks finished frames", async () => {
  const h = harness();
  h.PZ.zoidium.getDebugPlugins = () => [{ id: "unused", enabled: false, phase: "error",
    lastError: { message: "failed" }, ...plugin }];
  if (required) h.project.plugins = [{ id: "unused" }];
  await h.warm();
  assert.equal(h.api.debug.entries, 0);
  assert.match(h.api.usage().reason, /Plugins are loading or have errors/);
  h.api.dispose();
});

for (const [name, setup, expected] of [
  ["unrelated plugin error", h => { h.PZ.zoidium.getDebugPlugins = () => [{ id: "unused", enabled: false, phase: "disabled", lastError: { message: "failed" } }]; }, /Plugins are loading or have errors/],
  ["loading plugins", h => { h.PZ.zoidium.getDebugPlugins = () => [{ phase: "loading" }]; }, /Plugins are loading/],
  ["loading fonts", h => { h.document.fonts.status = "loading"; }, /Fonts are loading/],
  ["invalid serialization", h => { h.project.toJSON = () => { throw new Error("invalid"); }; }, /could not be validated/],
]) {
  test("usage explains " + name + " while preserving live draws", async () => {
    const h = harness(); setup(h);
    await h.warm();
    assert.equal(h.api.debug.entries, 0);
    assert.equal(h.counts.live, 6);
    assert.match(h.api.usage().reason, expected);
    h.api.dispose();
  });
}

test("usage explains community rejection and clears the reason after an eligible draw", async () => {
  const h = harness();
  h.project.sequence.value = { type: "community-example-fx" };
  await h.warm();
  assert.match(h.api.usage().reason, /Community/);
  h.project.sequence.value = null;
  h.project.ui.onChanged.update();
  await h.warm();
  assert.equal(h.api.debug.entries, 1);
  assert.equal(h.api.usage().reason, null);
  h.api.dispose();
});

test("usage explains disabled, undersized and paused caches without serializing", async () => {
  const h = harness();
  h.api.setSizeMiB(0);
  assert.match(h.api.usage().reason, /disabled/);
  h.api.setSizeMiB(1);
  h.viewport.renderer.context.drawingBufferWidth = 1024;
  h.viewport.renderer.context.drawingBufferHeight = 1024;
  await h.warm();
  assert.match(h.api.usage().reason, /frame exceeds/);
  h.viewport.__zoidiumPlayerPlusPaused = true;
  assert.match(h.api.usage().reason, /drawing is paused/);
  assert.match(h.api.usage().reason, /frame exceeds/, "paused drawing does not hide the capture rejection");
  const before = h.counts.serialized;
  for (let i = 0; i < 10; i++) h.api.usage();
  assert.equal(h.counts.serialized, before);
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
  assert.match(h.api.usage().reason, /validation is deferred/);

  h.project.sequence.value = 2; // An edit only the serialization sees.
  h.viewport.editor.playback.speed = 0;
  h.cool(); h.viewport._render();
  assert.equal(h.counts.serialized, serialized + 1, "validated once when paused and quiet");
  assert.equal(h.counts.live, live + 11, "the changed project renders live");
  h.api.dispose();
});

test("plain time operators draw once without serializing or scheduling prefetch", () => {
  const h = harness();
  h.PZ.zoidium.temporal.usesSingleEvaluation = () => true;
  for (let frame = 0; frame < 4; frame++) {
    h.viewport.editor.playback.currentFrame = frame;
    h.viewport._render();
  }
  assert.equal(h.counts.live, 4);
  assert.equal(h.counts.serialized, 0);
  assert.equal(h.api.debug.validations, 0);
  assert.equal(h.api.debug.prefetched, 0);
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.timers.size, 0);
  assert.match(h.api.usage().reason, /Time operators/);
});


test("GPU memory failures lower the ceiling, evict frames and notify only once", async () => {
  const h = harness(), gl = h.viewport.renderer.context;
  await h.warm();
  h.viewport.editor.playback.speed = 1;
  h.api.capturePreview(h.viewport, 1); h.api.capturePreview(h.viewport, 2);
  assert.equal(h.api.debug.bytes, 192);
  gl.copyError = gl.OUT_OF_MEMORY;
  h.api.capturePreview(h.viewport, 3);
  assert.equal(h.api.debug.entries, 2);
  assert.equal(h.api.debug.effectiveLimit, 172);
  assert.match(h.notices[0].message, /The GPU ran out of memory at 0 MiB/);
  assert.match(h.notices[0].message, /for this session/);
  for (let frame = 4; frame < 7; frame++) {
    gl.copyError = gl.OUT_OF_MEMORY;
    h.api.capturePreview(h.viewport, frame);
  }
  assert.equal(h.notices.length, 1);
  assert.equal(h.api.debug.entries, 0);
  h.api.clear(); h.api.setSizeMiB(16384);
  const allocations = h.counts.allocated;
  h.api.capturePreview(h.viewport, 10);
  assert.equal(h.counts.allocated, allocations, "the preference cannot bypass the session ceiling");
  h.api.dispose();
});

test("unrelated GL errors drop a capture without claiming memory exhaustion", async () => {
  const h = harness(); await h.warm();
  h.viewport.editor.playback.speed = 1;
  h.viewport.renderer.context.copyError = 1282;
  h.api.capturePreview(h.viewport, 1);
  assert.equal(h.api.debug.entries, 1);
  assert.equal(h.api.debug.effectiveLimit, 512 * 1048576);
  assert.equal(h.notices.length, 0);
  h.api.dispose();
});

test("context loss forgets dead textures and a second loss disables captures", async () => {
  const h = harness(), gl = h.viewport.renderer.context;
  await h.warm();
  h.viewport.editor.playback.speed = 1;
  h.api.capturePreview(h.viewport, 1); h.api.capturePreview(h.viewport, 2);
  const disposals = h.counts.disposed;
  gl.lost = true; h.canvasEvents.get("webglcontextlost")();
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.counts.disposed, disposals);
  assert.equal(h.api.debug.contextLosses, 1);
  h.viewport._render();
  gl.lost = false; h.canvasEvents.get("webglcontextrestored")();
  assert.equal(h.api.debug.effectiveLimit, 96);
  await h.warm();
  assert.equal(h.api.debug.entries, 1);
  gl.lost = true; h.canvasEvents.get("webglcontextlost")();
  gl.lost = false; h.canvasEvents.get("webglcontextrestored")();
  assert.equal(h.api.debug.effectiveLimit, 0);
  assert.equal(h.notices.length, 1);
  h.api.dispose();
  assert.equal(h.canvasEvents.size, 0);
});

test("synchronous context loss during capture is handled before the event arrives", async () => {
  const h = harness(), gl = h.viewport.renderer.context;
  await h.warm(); h.viewport.editor.playback.speed = 1;
  const disposals = h.counts.disposed;
  gl.copyTexSubImage2D = () => { gl.lost = true; };
  h.api.capturePreview(h.viewport, 1);
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.counts.disposed, disposals);
  h.canvasEvents.get("webglcontextlost")();
  assert.equal(h.api.debug.contextLosses, 1);
  h.api.dispose();
});

test("live usage reports the drawing buffer, retained bytes and effective limit", async () => {
  const h = harness(); await h.warm();
  const usage = h.api.usage();
  assert.equal(usage.width, 4); assert.equal(usage.height, 4);
  assert.equal(usage.bytes, 64); assert.equal(usage.entries, 1);
  h.api.dispose();
});

test("five new frames with a two-target budget recycle fully overwritten targets", async () => {
  const h = harness();
  // Each test frame is 512 KiB. A 1 MiB budget holds two targets.
  h.viewport.renderer.context.drawingBufferWidth = 512;
  h.viewport.renderer.context.drawingBufferHeight = 256;
  h.api.setSizeMiB(1);
  await h.warm(); h.cool();
  for (let frame = 1; frame < 5; frame++) {
    h.viewport.editor.playback.currentFrame = frame;
    for (let attempt = 0; attempt < 6 && h.viewport.lastFrame !== frame; attempt++) {
      h.viewport._render(); await flush();
    }
    // The frame readiness promise needs one subsequent complete live draw.
    h.viewport._render(); await flush(); h.viewport._render();
  }
  assert.equal(h.api.debug.entries, 2);
  assert.equal(h.counts.allocated, 2);
  assert.equal(h.counts.disposed, 0);
  assert.equal(h.counts.copies, 5);
  assert.deepEqual(h.counts.copySize, [512, 256]);
  h.api.dispose();
  assert.equal(h.counts.disposed, 2);
});

test("a failed copy into a recycled target never publishes its old pixels", async () => {
  const h = harness();
  h.viewport.renderer.context.drawingBufferWidth = 512;
  h.viewport.renderer.context.drawingBufferHeight = 512;
  h.api.setSizeMiB(1);
  await h.warm(); h.cool();
  const allocated = h.counts.allocated;
  h.viewport.editor.playback.currentFrame = 1;
  h.viewport._render(); await flush();
  h.viewport.renderer.context.copyError = 1280;
  h.viewport._render();
  assert.equal(h.counts.allocated, allocated);
  assert.equal(h.api.debug.entries, 0);
  assert.equal(h.counts.disposed, 1);
  h.api.dispose();
});


for (const [name, start, padding, expected] of [
  ["distant video", 300, 60, 1],
  ["video preload and active frames", 2, 1, 4],
]) test("idle prefetch skips " + name + " without starting a private decoder", async () => {
  const h = harness({ prefetch: true });
  h.project.sequence.length = 360;
  h.project.sequence.videoSchedules.push({ padding, items: [{ start, length: 2, media: {} }] });
  await h.warm(); h.cool(); h.viewport._render();
  const timer = h.timers.values().next().value;
  assert.equal(typeof timer, "function");
  timer();
  for (let i = 0; i < 10; i++) await flush();
  assert.equal(h.api.debug.prefetched, 1);
  assert.deepEqual(h.counts.privateFrames, [expected]);
  assert.equal(h.counts.privateDecodes || 0, 0);
  assert.equal(h.api.debug.entries, 2);
  h.viewport.editor.playback.currentFrame = expected;
  const live = h.counts.live;
  h.viewport._render();
  assert.equal(h.counts.live, live, "the privately rendered candidate is a cache hit");
  h.api.dispose();
});
