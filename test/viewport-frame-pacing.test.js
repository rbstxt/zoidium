"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MODULE_PATH = path.join(__dirname, "..", "plugins", "core", "viewport-frame-pacing.js");
const SOURCE = fs.readFileSync(MODULE_PATH, "utf8");

function createObservable() {
  const listeners = new Set();
  return {
    watch(fn) { listeners.add(fn); },
    unwatch(fn) { listeners.delete(fn); },
    emit() { for (const fn of Array.from(listeners)) fn(); },
  };
}

function createEventTarget() {
  const map = new Map();
  return {
    addEventListener(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      map.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      const type = typeof event === "string" ? event : event.type;
      for (const fn of Array.from(map.get(type) || [])) fn(event);
    },
  };
}

function createEditSignalsStub() {
  let epoch = 0;
  let hot = false;
  let gesture = false;
  const listeners = new Set();
  return {
    get epoch() { return epoch; },
    isHot() { return hot; },
    setHot(value) { hot = Boolean(value); },
    gestureActive() { return gesture; },
    setGesture(value) { gesture = Boolean(value); },
    bumpEpochOnly() { epoch += 1; },
    signal(reason = "input") {
      epoch += 1;
      for (const fn of Array.from(listeners)) fn(reason, epoch);
    },
    subscribe(fn) {
      listeners.add(fn);
      return { unwatch() { listeners.delete(fn); } };
    },
  };
}

function createHarness(options = {}) {
  const rafQueue = [];
  let nextRafId = 0;
  const windowEvents = createEventTarget();
  const documentEvents = createEventTarget();
  const fonts = { status: "loaded" };
  const document = {
    fonts,
    addEventListener: documentEvents.addEventListener,
    removeEventListener: documentEvents.removeEventListener,
    dispatchEvent: documentEvents.dispatchEvent,
  };

  const temporalRuntimes = new Map();
  let assetsReady = true;
  const editSignals = options.withEditSignals === false ? null : createEditSignalsStub();

  class Viewport {
    constructor(editor) {
      this.editor = editor;
      this.enabled = true;
      this.renderMode = 0;
      this.lastFrame = -1;
      this.animFrameReq = null;
      this.compositor = { __zoidiumRenderSettings: null };
      this.canvas = { width: 1280, height: 720 };
      this.renderer = {
        context: { drawingBufferWidth: 1280, drawingBufferHeight: 720 },
        shadowMap: { enabled: true, type: 1 },
        toneMapping: 0,
        toneMappingExposure: 1,
      };
      this.widget2dCalls = [];
      this.widget3dCalls = [];
      this.widget2d = { update: (frame) => { this.widget2dCalls.push(frame); } };
      this.widget3d = { update: (frame) => { this.widget3dCalls.push(frame); } };
      this.drawCalls = [];
      this.gateNextDraw = false;
      this._renderFn = () => this.render();
    }
    render() {
      this.animFrameReq = sandbox.requestAnimationFrame(this._renderFn);
      const frame = this.editor.playback.currentFrame;
      this.widget2d.update(frame);
      this.widget3d.update(frame);
      this._render();
    }
    _render() {
      if (this.gateNextDraw) {
        this.gateNextDraw = false;
        return;
      }
      const frame = this.editor.playback.currentFrame;
      this.drawCalls.push(frame);
      if (this.renderMode) {
        this.lastFrame = -1;
      } else {
        this.lastFrame = frame;
      }
    }
    resize(w, h) {
      if (w) {
        this.canvas.width = w;
        this.renderer.context.drawingBufferWidth = w;
      }
      if (h) {
        this.canvas.height = h;
        this.renderer.context.drawingBufferHeight = h;
      }
    }
  }

  class Playback {
    constructor() {
      this.currentFrame = 0;
      this.speed = 0;
      this.frameRate = 30;
      this.syncSchedule = null;
      this.nativeUpdateCalls = 0;
    }
    updateSchedule(schedule, delta) {
      this.nativeUpdateCalls += 1;
      if (!schedule || !schedule.currentItem) return;
      if (schedule.texture && schedule.el && schedule.el.readyState === 4) {
        schedule.texture.needsUpdate = true;
      }
      if (schedule.el && delta > 0) {
        if (!schedule.playing) {
          schedule.el.play?.();
          schedule.playing = true;
        }
      }
    }
  }

  const PZ = {
    ui: { viewport: Viewport, playback: Playback },
    schedule: { type: { VIDEO: 0, AUDIO: 1 } },
    zoidium: { temporal: { frameSamplerRuntimes: temporalRuntimes } },
  };

  const sandbox = {
    PZ,
    document,
    ZoidiumEditSignals: editSignals || undefined,
    ZoidiumOutputFrameStore: { assetsComplete: () => assetsReady },
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    dispatchEvent: windowEvents.dispatchEvent,
    requestAnimationFrame(fn) {
      const id = ++nextRafId;
      rafQueue.push({ id, fn });
      return id;
    },
    cancelAnimationFrame(id) {
      const idx = rafQueue.findIndex((item) => item.id === id);
      if (idx >= 0) rafQueue.splice(idx, 1);
    },
    console,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(SOURCE, sandbox, { filename: MODULE_PATH });

  const playback = new Playback();
  const project = {
    sequence: {
      videoTracks: [{ enabled: true, zoidiumSolo: false }],
      videoSchedules: [],
    },
  };
  const editor = {
    playback,
    project,
    history: { operation: null },
    onProjectChanged: createObservable(),
  };
  const viewport = new Viewport(editor);

  return {
    sandbox,
    PZ,
    Viewport,
    Playback,
    api: sandbox.ZoidiumFramePacing,
    editSignals,
    temporalRuntimes,
    editor,
    playback,
    project,
    viewport,
    fonts,
    rafQueue,
    setAssetsComplete(value) { assetsReady = value; },
    dispatchWindowEvent(type) { windowEvents.dispatchEvent({ type }); },
    dispatchDocumentEvent(type) { documentEvents.dispatchEvent({ type }); },
  };
}

function makeVideoSchedule(overrides = {}) {
  let playCalls = 0;
  let pauseCalls = 0;
  const el = {
    readyState: 4,
    currentTime: 0,
    paused: true,
    seeking: false,
    play() { playCalls += 1; this.paused = false; },
    pause() { pauseCalls += 1; this.paused = true; },
    ...(overrides.el || {}),
  };
  return {
    type: 0,
    playing: false,
    texture: { needsUpdate: false },
    currentItem: { start: 0, length: 120, clip: overrides.clip || null },
    ...overrides,
    el,
    get playCalls() { return playCalls; },
    get pauseCalls() { return pauseCalls; },
  };
}

test("CommonJS require exports ZoidiumFramePacing API and installs idempotently", () => {
  const api = require(MODULE_PATH);
  assert.equal(typeof api.enabled, "boolean");
  assert.equal(typeof api.invalidate, "function");
  assert.equal(typeof api.markVideoDirty, "function");
  assert.equal(typeof api.install, "function");
  assert.equal(typeof api.stats.renders, "number");
  assert.equal(typeof api.stats.skippedRenders, "number");
  assert.equal(typeof api.stats.videoUploads, "number");
  assert.equal(typeof api.stats.skippedVideoUploads, "number");

  let renderCount = 0;
  let scheduleCount = 0;
  class MockViewport {
    constructor() {
      this.editor = { playback: { currentFrame: 0, speed: 0 }, project: { sequence: { videoTracks: [], videoSchedules: [] } } };
      this.lastFrame = -1;
      this.widget2d = { update() {} };
      this.widget3d = { update() {} };
      this.compositor = {};
      this.renderer = { context: { drawingBufferWidth: 100, drawingBufferHeight: 100 }, shadowMap: {} };
    }
    render() { this._render(); }
    _render() { renderCount += 1; this.lastFrame = this.editor.playback.currentFrame; }
    resize() {}
  }
  class MockPlayback {
    constructor() { this.currentFrame = 0; this.speed = 0; }
    updateSchedule(schedule) { scheduleCount += 1; if (schedule?.texture) schedule.texture.needsUpdate = true; }
  }
  const pz = { ui: { viewport: MockViewport, playback: MockPlayback } };
  assert.equal(api.install(pz), true);
  assert.equal(api.install(pz), true);

  const vp = new MockViewport();
  vp.render();
  vp.render();
  assert.equal(renderCount, 1);

  const pb = new MockPlayback();
  const sched = makeVideoSchedule();
  pb.updateSchedule(sched, 0);
  sched.texture.needsUpdate = false;
  pb.updateSchedule(sched, 0);
  assert.equal(scheduleCount, 2);
  assert.equal(sched.texture.needsUpdate, false);
});

test("skips duplicate playback frames on high-refresh rAF while keeping gizmos and rAF running", () => {
  const h = createHarness();
  h.playback.speed = 1;
  h.playback.currentFrame = 10;

  // 4 rAF ticks at 120 Hz for one 30 fps project frame: draw once, skip 3x.
  for (let i = 0; i < 4; i += 1) h.viewport.render();
  assert.deepEqual(h.viewport.drawCalls, [10]);
  assert.equal(h.api.stats.renders, 1);
  assert.equal(h.api.stats.skippedRenders, 3);
  assert.deepEqual(h.viewport.widget2dCalls, [10, 10, 10, 10]);
  assert.deepEqual(h.viewport.widget3dCalls, [10, 10, 10, 10]);
  assert.equal(h.rafQueue.length, 4);

  // Advancing to the next project frame draws immediately, then skips repeats.
  h.playback.currentFrame = 11;
  h.viewport.render();
  h.viewport.render();
  h.viewport.render();
  assert.deepEqual(h.viewport.drawCalls, [10, 11]);
  assert.equal(h.api.stats.renders, 2);
  assert.equal(h.api.stats.skippedRenders, 5);
});

test("paused idle skips rAF draws, while direct _render() calls are never gated", () => {
  const h = createHarness();
  h.playback.speed = 0;
  h.playback.currentFrame = 4;

  h.viewport.render();
  h.viewport.render();
  h.viewport.render();
  assert.deepEqual(h.viewport.drawCalls, [4]);
  assert.equal(h.api.stats.skippedRenders, 2);

  // Direct _render() (eyedropper pickColor, Player+ Render once, settle redraws) always draws.
  h.viewport._render();
  h.viewport._render();
  assert.deepEqual(h.viewport.drawCalls, [4, 4, 4]);
  assert.equal(h.api.stats.skippedRenders, 2);
});

test("respects api.enabled = false and global.__zoidiumDisableFramePacing = true", () => {
  const h = createHarness();
  h.playback.currentFrame = 2;

  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 1);

  h.api.enabled = false;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);

  h.api.enabled = true;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);

  h.sandbox.__zoidiumDisableFramePacing = true;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 5);

  h.sandbox.__zoidiumDisableFramePacing = false;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 5);
});

test("never skips renderMode, __zoidiumImmediateOutput, or __zoidiumLivePreviewGrid, and redraws cleanly on exit", () => {
  const h = createHarness();
  h.playback.currentFrame = 7;

  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 1);

  // 3D scene camera orbit / isolated layer mode.
  h.viewport.renderMode = 1;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);
  h.viewport.renderMode = 0;
  // Exiting renderMode left lastFrame = -1, so next normal rAF draws cleanly.
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 4);

  // Immediate output bypass (e.g., adaptive quality / eyedropper).
  h.viewport.__zoidiumImmediateOutput = true;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 6);
  h.viewport.__zoidiumImmediateOutput = false;
  // Exiting immediate output forces one clean normal render before skipping resumes.
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 7);

  // Live preview transparency grid.
  h.viewport.__zoidiumLivePreviewGrid = () => {};
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 9);
  h.viewport.__zoidiumLivePreviewGrid = null;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 10);
});

test("never skips when _render() was gated and did not advance lastFrame", () => {
  const h = createHarness();
  h.playback.currentFrame = 15;
  h.viewport.gateNextDraw = true;

  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 0);
  assert.equal(h.viewport.lastFrame, -1);

  // Because lastFrame !== 15, the next rAF must draw instead of skipping.
  h.viewport.render();
  assert.deepEqual(h.viewport.drawCalls, [15]);
  assert.equal(h.viewport.lastFrame, 15);

  // Now subsequent rAF skips.
  h.viewport.render();
  assert.deepEqual(h.viewport.drawCalls, [15]);

  // External reset of lastFrame = -1 forces a redraw.
  h.viewport.lastFrame = -1;
  h.viewport.render();
  assert.deepEqual(h.viewport.drawCalls, [15, 15]);
});

test("invalidate(viewport) targets one viewport and invalidate() targets all viewports", () => {
  const h = createHarness();
  const second = new h.Viewport(h.editor);
  h.playback.currentFrame = 3;

  h.viewport.render();
  second.render();
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 1);
  assert.equal(second.drawCalls.length, 1);

  // Invalidate only the first viewport.
  h.api.invalidate(h.viewport, "test-single");
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 2);
  assert.equal(second.drawCalls.length, 1);

  // Global invalidate marks both viewports dirty.
  h.api.invalidate(null, "test-all");
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 3);
  assert.equal(second.drawCalls.length, 2);
});

test("respects ZoidiumEditSignals hot window, epoch changes, subscriptions, and active history operations", () => {
  const h = createHarness();
  h.playback.currentFrame = 5;

  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 1);

  // Hot window blocks skipping even if epoch didn't change further.
  h.editSignals.setHot(true);
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);
  h.editSignals.setHot(false);
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);

  // Edit signal subscription invalidates immediately.
  h.editSignals.signal("input");
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 4);

  // Epoch mismatch without subscriber callback still forces redraw.
  h.editSignals.bumpEpochOnly();
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 5);

  // Open history operation blocks skipping.
  h.editor.history.operation = { name: "drag" };
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 7);
  h.editor.history.operation = null;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 7);
});

test("cheap visual signature detects project, size, render settings, renderer, fonts, and track switches", () => {
  const h = createHarness();
  h.playback.currentFrame = 1;

  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 1);

  const mutations = [
    () => { h.viewport.renderer.context.drawingBufferWidth = 640; },
    () => { h.viewport.renderer.context.drawingBufferHeight = 360; },
    () => { h.viewport.compositor.__zoidiumRenderSettings = { mode: "contain" }; },
    () => { h.viewport.compositor.__zoidiumRenderSettings.mode = "cover"; },
    () => { h.viewport.renderer.shadowMap.enabled = false; },
    () => { h.viewport.renderer.shadowMap.type = 2; },
    () => { h.viewport.renderer.toneMapping = 4; },
    () => { h.viewport.renderer.toneMappingExposure = 1.5; },
    () => { h.fonts.status = "loading"; },
    () => { h.fonts.status = "loaded"; },
    () => { h.editor.project.sequence.videoTracks[0].enabled = false; },
    () => { h.editor.project.sequence.videoTracks[0].zoidiumSolo = true; },
    () => {
      h.editor.project = {
        sequence: { videoTracks: [{ enabled: true, zoidiumSolo: false }], videoSchedules: [] },
      };
    },
  ];

  let expectedDraws = 1;
  for (const mutate of mutations) {
    mutate();
    h.viewport.render();
    expectedDraws += 1;
    assert.equal(h.viewport.drawCalls.length, expectedDraws);
    // Repeated rAF with the new stable state skips.
    h.viewport.render();
    assert.equal(h.viewport.drawCalls.length, expectedDraws);
  }
});

test("pending async work (temporal preview, assets, video seeks/decodes, readyState, currentItem) blocks skipping", () => {
  const h = createHarness();
  const track = h.project.sequence.videoTracks[0];
  const clip = { parent: track };
  const schedule = makeVideoSchedule({ clip });
  h.project.sequence.videoSchedules.push(schedule);
  const temporalRuntime = { previewPending: false };
  h.temporalRuntimes.set(h.viewport.compositor, temporalRuntime);

  h.playback.currentFrame = 12;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 1);

  // Temporal preview pending.
  temporalRuntime.previewPending = true;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 2);
  temporalRuntime.previewPending = false;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);

  // Assets still loading.
  h.setAssetsComplete(false);
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 4);
  h.setAssetsComplete(true);
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 4);

  // Each pending flag on a visible video schedule blocks skipping.
  const pendingFlags = [
    () => { schedule.__zoidiumPausedSeek = { frame: 12 }; },
    () => { schedule.__zoidiumPausedSeek = null; },
    () => { schedule.el.seeking = true; },
    () => { schedule.el.seeking = false; },
    () => { schedule.__zoidiumExactDecodePending = 1; },
    () => { schedule.__zoidiumExactDecodePending = 0; },
    () => { schedule.__zoidiumWebCodecsPending = true; },
    () => { schedule.__zoidiumWebCodecsPending = false; },
  ];

  let draws = h.viewport.drawCalls.length;
  for (let i = 0; i < pendingFlags.length; i += 2) {
    pendingFlags[i]();
    h.viewport.render();
    draws += 1;
    assert.equal(h.viewport.drawCalls.length, draws);
    pendingFlags[i + 1]();
    // Because the previous draw saw pending work, the settled tick draws once more, then skips.
    h.viewport.render();
    draws += 1;
    assert.equal(h.viewport.drawCalls.length, draws);
    h.viewport.render();
    assert.equal(h.viewport.drawCalls.length, draws);
  }

  // readyState change triggers redraw.
  schedule.el.readyState = 2;
  h.viewport.render();
  draws += 1;
  assert.equal(h.viewport.drawCalls.length, draws);
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, draws);

  // currentItem change triggers redraw.
  schedule.currentItem = { start: 0, length: 120, clip };
  h.viewport.render();
  draws += 1;
  assert.equal(h.viewport.drawCalls.length, draws);
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, draws);
});

test("paused video currentTime change forces redraw for native video, not WebCodecs, and not during playback", () => {
  const h = createHarness();
  const schedule = makeVideoSchedule({ el: { readyState: 4, currentTime: 1.0 } });
  h.project.sequence.videoSchedules.push(schedule);

  h.playback.speed = 0;
  h.playback.currentFrame = 30;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 1);

  // Paused native <video>: currentTime change forces redraw.
  schedule.el.currentTime = 1.033;
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 2);

  // Paused WebCodecs-owned schedule: <video>.currentTime drift does not force redraw,
  // while markVideoDirty(schedule) does.
  schedule.__zoidiumWebCodecsActive = true;
  schedule.el.currentTime = 1.5;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 2);

  h.api.markVideoDirty(schedule);
  h.viewport.render();
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 3);

  // Playing native <video>: advancing <video>.currentTime on the same project frame still skips.
  schedule.__zoidiumWebCodecsActive = false;
  h.playback.speed = 1;
  h.playback.currentFrame = 31;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 4);
  schedule.el.currentTime = 1.55;
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 4);
});

test("resize, onProjectChanged, and asset window/document events invalidate tracked viewports", () => {
  const h = createHarness();
  const second = new h.Viewport(h.editor);
  h.playback.currentFrame = 8;

  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 1);
  assert.equal(second.drawCalls.length, 1);

  // resize() marks only the resized viewport dirty (even when dimensions did not change).
  h.viewport.resize();
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 2);
  assert.equal(second.drawCalls.length, 1);

  // onProjectChanged invalidates all tracked viewports.
  h.editor.onProjectChanged.emit();
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 3);
  assert.equal(second.drawCalls.length, 2);

  // window zoidium:asset-status invalidates all tracked viewports.
  h.dispatchWindowEvent("zoidium:asset-status");
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 4);
  assert.equal(second.drawCalls.length, 3);

  // window zoidium:asset-reloaded invalidates all tracked viewports.
  h.dispatchWindowEvent("zoidium:asset-reloaded");
  h.viewport.render();
  second.render();
  assert.equal(h.viewport.drawCalls.length, 5);
  assert.equal(second.drawCalls.length, 4);

  // document zoidium:asset-reloaded also invalidates.
  h.dispatchDocumentEvent("zoidium:asset-reloaded");
  h.viewport.render();
  assert.equal(h.viewport.drawCalls.length, 6);
});

test("updateSchedule gates native video texture uploads during playback and while paused", () => {
  const h = createHarness();
  const schedule = makeVideoSchedule({ el: { readyState: 4, currentTime: 0.5 } });

  // Playback: first tick for frame 10 allows upload.
  h.playback.speed = 1;
  h.playback.currentFrame = 10;
  h.playback.updateSchedule(schedule, 0.25);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 1);
  assert.equal(h.api.stats.skippedVideoUploads, 0);

  // Simulate Three.js consuming texture upload, then 3 more rAF ticks on frame 10
  // while 60fps <video> advances currentTime: must skip uploads to respect project FPS.
  for (let i = 1; i <= 3; i += 1) {
    schedule.texture.needsUpdate = false;
    schedule.el.currentTime = 0.5 + i * 0.016;
    h.playback.updateSchedule(schedule, 0.25);
    assert.equal(schedule.texture.needsUpdate, false);
  }
  assert.equal(h.api.stats.videoUploads, 1);
  assert.equal(h.api.stats.skippedVideoUploads, 3);

  // If texture.needsUpdate was already true (unconsumed upload), never reset it to false.
  schedule.texture.needsUpdate = true;
  h.playback.updateSchedule(schedule, 0.25);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 2);

  // Advancing currentFrame allows upload.
  schedule.texture.needsUpdate = false;
  h.playback.currentFrame = 11;
  h.playback.updateSchedule(schedule, 0.25);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 3);

  // Changing currentItem on same frame allows upload.
  schedule.texture.needsUpdate = false;
  schedule.currentItem = { start: 0, length: 120, clip: null };
  h.playback.updateSchedule(schedule, 0.25);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 4);

  // markVideoDirty forces upload on next updateSchedule even on same frame.
  schedule.texture.needsUpdate = false;
  h.api.markVideoDirty(schedule);
  // Reset texture.needsUpdate to false to confirm state.forcedDirty itself permits upload.
  schedule.texture.needsUpdate = false;
  h.playback.updateSchedule(schedule, 0.25);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 5);

  // Paused: unchanged state skips upload.
  h.playback.speed = 0;
  schedule.texture.needsUpdate = false;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, false);
  assert.equal(h.api.stats.skippedVideoUploads, 4);

  // Paused: sub-epsilon jitter still skips.
  schedule.el.currentTime += 1e-7;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, false);
  assert.equal(h.api.stats.skippedVideoUploads, 5);

  // Paused: real currentTime seek allows upload.
  schedule.el.currentTime += 0.033;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 6);

  // Paused: readyState dip (4 -> 2 -> 4) forces upload upon recovery.
  schedule.texture.needsUpdate = false;
  schedule.el.readyState = 2;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, false);
  schedule.el.readyState = 4;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(h.api.stats.videoUploads, 7);

  // Subsequent tick at same readyState (4) skips again.
  schedule.texture.needsUpdate = false;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, false);
  assert.equal(h.api.stats.skippedVideoUploads, 6);

  // Bypass allows upload every tick.
  h.api.enabled = false;
  schedule.texture.needsUpdate = false;
  h.playback.updateSchedule(schedule, 0);
  assert.equal(schedule.texture.needsUpdate, true);
});

test("updateSchedule respects WebCodecs ownership and passes audio schedules through", () => {
  const h = createHarness();
  const wcSchedule = makeVideoSchedule({
    __zoidiumWebCodecsActive: true,
    playing: true,
    el: { readyState: 4, paused: false, currentTime: 2.0 },
  });
  h.playback.speed = 1;
  h.playback.currentFrame = 20;
  h.playback.syncSchedule = wcSchedule;

  // WebCodecs owns texture.needsUpdate = false: must stay false, pause <video>, skip native.
  wcSchedule.texture.needsUpdate = false;
  h.playback.updateSchedule(wcSchedule, 1);
  assert.equal(wcSchedule.el.paused, true);
  assert.equal(wcSchedule.pauseCalls, 1);
  assert.equal(wcSchedule.playCalls, 0);
  assert.equal(wcSchedule.playing, false);
  assert.equal(h.playback.syncSchedule, null);
  assert.equal(wcSchedule.texture.needsUpdate, false);
  assert.equal(h.playback.nativeUpdateCalls, 0);

  // WebCodecs owns texture.needsUpdate = true: must stay true without calling native.
  wcSchedule.texture.needsUpdate = true;
  h.playback.updateSchedule(wcSchedule, 1);
  assert.equal(wcSchedule.texture.needsUpdate, true);
  assert.equal(h.playback.nativeUpdateCalls, 0);

  // Audio schedule (type !== 0) passes directly to native updateSchedule.
  const audioSchedule = makeVideoSchedule({ type: 1, texture: null });
  h.playback.updateSchedule(audioSchedule, 1);
  assert.equal(h.playback.nativeUpdateCalls, 1);
  assert.equal(audioSchedule.playing, true);
});

test("works cleanly with main-viewport subclassing both before and after install", () => {
  const h = createHarness();

  // Case 1: subclass created BEFORE install (main-viewport loaded first).
  class BaseViewport {
    constructor(editor) {
      this.editor = editor;
      this.lastFrame = -1;
      this.drawCalls = [];
      this.widget2d = { update() {} };
      this.widget3d = { update() {} };
      this.compositor = {};
      this.renderer = { context: { drawingBufferWidth: 1280, drawingBufferHeight: 720 }, shadowMap: {} };
    }
    render() {
      this.widget2d.update(this.editor.playback.currentFrame);
      this.widget3d.update(this.editor.playback.currentFrame);
      this._render();
    }
    _render() {
      const f = this.editor.playback.currentFrame;
      this.drawCalls.push(f);
      this.lastFrame = f;
    }
    resize() {}
  }
  class TrackedBeforeInstall extends BaseViewport {
    render(...args) {
      if (this.__zoidiumRenderFailed) return;
      return super.render(...args);
    }
    resize(...args) {
      return super.resize(...args);
    }
  }
  assert.equal(h.api.install({ ui: { viewport: TrackedBeforeInstall } }), true);
  const vp1 = new TrackedBeforeInstall(h.editor);
  h.playback.currentFrame = 9;
  vp1.render();
  vp1.render();
  assert.deepEqual(vp1.drawCalls, [9]);
  assert.equal(h.api.stats.renders, 1);
  assert.equal(h.api.stats.skippedRenders, 1);
  vp1.resize();
  vp1.render();
  assert.deepEqual(vp1.drawCalls, [9, 9]);

  // Case 2: subclass created AFTER install, then install called again (must not double-patch).
  class TrackedAfterInstall extends h.Viewport {
    render(...args) { return super.render(...args); }
    resize(...args) { return super.resize(...args); }
  }
  assert.equal(h.api.install({ ui: { viewport: TrackedAfterInstall } }), true);
  const beforeRenders = h.api.stats.renders;
  const vp2 = new TrackedAfterInstall(h.editor);
  vp2.render();
  vp2.render();
  assert.deepEqual(vp2.drawCalls, [9]);
  assert.equal(h.api.stats.renders, beforeRenders + 1);
});
