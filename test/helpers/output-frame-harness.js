"use strict";
const vm = require("node:vm");
const fs = require("node:fs");
const model = require("../../plugins/core/output-frame-store.js");
function observable() {
  const watchers = new Set();
  return { watch(fn) { watchers.add(fn); }, unwatch(fn) { watchers.delete(fn); },
    update() { for (const fn of Array.from(watchers)) fn(); }, watchers };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function harness({ prefetch = false, stale = false, manualChecks = false } = {}) {
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
        unload() { counts.unloadedSchedules = (counts.unloadedSchedules || 0) + 1; },
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
    unload() { counts.unloadedCompositors = (counts.unloadedCompositors || 0) + 1; }
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
      this.error ||= this.copyError; this.copyError = 0;
    },
    getError() { counts.checks = (counts.checks || 0) + 1; const error = this.error; this.error = 0; return error; },
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
    ShaderPass: class { constructor(m) { this.material = m; this.uniforms = m.uniforms; } render() {
      counts.display += 1; (counts.displayTextures ||= []).push(this.uniforms.tDiffuse.value);
    } },
    WebGLRenderTarget: class { constructor() { this.texture = {}; counts.allocated += 1; } dispose() { counts.disposed += 1; } },
  };
  const document = { fonts: { status: "loaded", ready: Promise.resolve(), addEventListener() {}, removeEventListener() {} },
    addEventListener: (n, f) => docEvents.set(n, f), removeEventListener: n => docEvents.delete(n) };
  const window = { document, PZ, THREE, CM: { mainViewport: viewport }, ZoidiumOutputFrameStore: model,
    ZoidiumOutputFrameVideo: require("../../plugins/core/output-frame-video.js"),
    ZoidiumOutputFrameApprovals: { ...require("../../plugins/core/output-frame-approvals.js"), stale },
    ZoidiumUI: { notify(message) { notices.push(message); } },
    localStorage: { getItem: () => null }, performance: { now: () => clock.now },
    addEventListener: (n, f) => events.set(n, f), removeEventListener: n => events.delete(n) };
  window.__zoidiumTemporalParts = { sampler: { frameSamplerMediaInputs: require("../../plugins/core/temporal-sampler.js").frameSamplerMediaInputs,
    getFrameSamplerRuntime: () => ({ schedules: new Map() }) } };
  const checks = new Map();
  window.requestIdleCallback = fn => { const id = ++nextTimer; checks.set(id, fn);
    if (!manualChecks) setImmediate(() => { if (checks.delete(id)) { clock.now += 101; fn(); } }); return id; };
  window.cancelIdleCallback = id => checks.delete(id);
  const sandbox = {
    window, PZ, THREE, performance: window.performance, console,
    setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; }, clearTimeout: id => timers.delete(id),
  };
  for (const file of ["output-frame-capture", "output-frame-cache"]) {
    vm.runInNewContext(fs.readFileSync(require.resolve("../../plugins/core/" + file + ".js"), "utf8"), sandbox);
  }
  function check() { for (const [id, fn] of Array.from(checks)) { checks.delete(id); fn(); } }
  const api = window.ZoidiumFrameCache;
  // Draw until the frame is stored: resources and per-frame readiness settle
  // asynchronously, then the next complete live draw is captured.
  async function warm() {
    for (let i = 0; i < 6 && api.debug.entries === 0; i++) { viewport._render(); await flush(); }
  }
  // Leave the post-signal window in which every draw serializes the project.
  function cool() { clock.now += 5000; }
  return { api, viewport, project, history, counts, events, docEvents, clock, warm, cool, temporalRuntimes, timers,
    check, checks, Viewport, Compositor, History, PZ, document, canvasEvents, notices, window, sampler: window.__zoidiumTemporalParts.sampler };
}

module.exports = { harness, flush };
