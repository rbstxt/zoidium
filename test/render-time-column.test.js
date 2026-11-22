"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const test = require("node:test");

function install(options = {}) {
  const storage = options.storage || new Map();
  const clock = { calls: 0, time: 0 };
  class Layer {}
  class Effect {}
  class Group extends Effect {
    constructor(objects) { super(); this.objects = objects; this.enabled = true; }
  }
  Effect.group = Group;
  const compositor = {
    renderSequence(layer) { return this.renderLayer(layer); },
    renderEffects(effects) {
      for (const effect of effects) {
        if (effect.bypassed) continue;
        if (effect instanceof Group) {
          if (effect.enabled) this.renderEffects(effect.objects);
        } else if (effect.pass?.enabled) effect.pass.render(this.renderer);
      }
    },
    renderLayer(layer) {
      clock.time += layer.cost || 0;
      for (const child of layer.objects || []) this.renderLayer(child);
      this.renderEffects(layer.effects || []);
    },
    renderer: { context: options.gl || { getExtension() { clock.calls++; } } },
  };
  const project = {};
  const sequence = { properties: { rate: { get: () => 25 } } };
  compositor._sequence = sequence;
  const editor = { project, sequence, playback: { frameRate: 25 } };
  const viewport = { compositor, editor };
  editor.mainViewport = viewport;
  const window = {
    PZ: { layer: Layer, effect: Effect,
      zoidium: { effectBypass: { bypassed: effect => !!effect.bypassed } } },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    performance: { now() { clock.calls++; return clock.time; } },
    requestAnimationFrame: options.requestAnimationFrame,
    cancelAnimationFrame: options.cancelAnimationFrame,
  };
  for (const filename of ["render-time-gpu.js", "timeline-render-time.js"]) {
    const code = readFileSync(join(__dirname, "../plugins/core", filename), "utf8");
    runInNewContext(code, { window, WeakRef }, { filename });
  }
  const api = window.ZoidiumRenderTime;
  const draw = (objects, frame = 0, context) => window.ZoidiumRenderTimeActive
    ? window.ZoidiumRenderTimeActive.draw(viewport, frame, compositor.renderSequence, compositor, [objects], context)
    : compositor.renderSequence(objects);
  const makeLayer = data => Object.assign(new Layer(), data);
  const makeEffect = (ms, enabled = true) => Object.assign(new Effect(),
    { pass: { enabled, render() { clock.time += ms; } } });
  const sample = object => api.read(editor, object);
  return { window, api, clock, storage, editor, sequence, viewport, compositor,
    draw, makeLayer, makeEffect, Group, sample };
}

test("Render Time starts hidden, persists the browser preference, and leaves hidden preview uninstrumented", () => {
  const setup = install();
  const { api, clock, draw, compositor, makeLayer, makeEffect, storage, window } = setup;
  const original = compositor.renderEffects;
  const pass = makeEffect(2);
  const render = pass.pass.render;
  const layer = makeLayer({ cost: 3, effects: [pass] });
  assert.equal(api.enabled, false);
  draw(layer);
  assert.equal(clock.calls, 0);
  assert.equal(compositor.renderEffects, original);
  assert.equal(pass.pass.render, render);
  api.setEnabled(true);
  assert.equal(install({ storage }).api.enabled, true);
  draw(layer);
  assert.ok(clock.calls > 0);
  api.setEnabled(false);
  assert.equal(window.ZoidiumRenderTimeActive, null);
  const previous = clock.calls;
  draw(layer);
  assert.equal(clock.calls, previous);
  assert.equal(install({ storage }).api.enabled, false);
});

test("layer and composite timings include their own draws, nested layers, and grouped effects exactly once", () => {
  const { api, draw, makeLayer, makeEffect, Group, sample, compositor } = install();
  api.setEnabled(true);
  const pass = makeEffect(5);
  const disabled = makeEffect(20, false);
  const bypassed = Object.assign(makeEffect(30), { bypassed: true });
  const group = new Group([pass, disabled, bypassed]);
  const child = makeLayer({ cost: 3, effects: [group] });
  const scene = makeLayer({ cost: 2, objects: [child], effects: [makeEffect(4)] });
  const original = compositor.renderLayer;
  draw(scene);
  assert.equal(sample(scene).cpuMs, 14);
  assert.equal(sample(child).cpuMs, 8);
  assert.equal(sample(group).cpuMs, 5);
  assert.equal(sample(pass).cpuMs, 5);
  assert.equal(sample(disabled), null);
  assert.equal(sample(bypassed), null);
  assert.equal(compositor.renderLayer, original);
  assert.equal(sample(scene).gpuStatus, "unavailable");
  assert.equal(sample(scene).gpuMs, null);
});

test("smoothing uses successive rendered samples and resets when a layer stops drawing", () => {
  const { api, draw, makeLayer, sample } = install();
  const layer = makeLayer({ cost: 10 });
  api.setEnabled(true);
  draw(layer, 1);
  assert.equal(sample(layer).cpuMs, 10);
  layer.cost = 30;
  draw(layer, 2);
  assert.equal(sample(layer).cpuMs, 15);
  draw(makeLayer({ cost: 1 }), 3);
  assert.equal(sample(layer), null);
  draw(layer, 4);
  assert.equal(sample(layer).cpuMs, 30);
});

test("temporal sample draws count toward their effect and layer; cached samples and output are identified", () => {
  const { api, clock, draw, compositor, viewport, makeLayer, makeEffect, sample, sequence, editor } = install();
  const effect = makeEffect(3);
  const layer = makeLayer({ cost: 2, effects: [effect] });
  const track = { getCurrentClip: () => ({ object: layer }) };
  sequence.videoTracks = [track];
  api.setEnabled(true);
  const session = api.prepare(viewport, 8);
  session.measureSample(effect, layer, () => { clock.time += 12; });
  session.reuseSample(effect);
  draw(layer, 8, session);
  assert.equal(sample(effect).cpuMs, 15);
  assert.equal(sample(effect).samplesCached, true);
  assert.equal(sample(layer).cpuMs, 17);
  assert.equal(api.readTrack(editor, track).budget, 40);
  api.cached(viewport, 8);
  assert.equal(sample(effect).cached, true);
  assert.equal(api.readTrack(editor, track).cached, true);
  assert.equal(compositor._sequence, sequence);
});

test("preview instrumentation never measures an export or publishes after a failed draw", () => {
  const { api, clock, draw, compositor, viewport, makeLayer, sample } = install();
  const layer = makeLayer({ cost: 5 });
  api.setEnabled(true);
  const calls = clock.calls;
  api.draw({ ...viewport }, 1, compositor.renderLayer, compositor, [layer]);
  assert.equal(clock.calls, calls);
  assert.equal(sample(layer), null);
  assert.throws(() => api.draw(viewport, 1, () => {
    compositor.renderLayer(layer);
    throw new Error("draw failed");
  }), /draw failed/);
  assert.equal(sample(layer), null);
  draw(layer, 2);
  assert.equal(sample(layer).cpuMs, 5);
});

function fakeGpu(options = {}) {
  let active = null;
  let disjoint = false;
  let lost = false;
  let next = 0;
  const ready = !!options.ready;
  const durations = options.durations || null;
  const callbacks = new Set();
  const queries = new Map();
  const extension = {
    createQueryEXT() {
      if (lost) return null;
      const query = { index: next++ };
      queries.set(query, { ready, index: query.index });
      return query;
    },
    getQueryEXT: () => active,
    beginQueryEXT(_target, query) {
      assert.equal(active, null);
      active = query;
    },
    endQueryEXT() {
      assert.ok(active);
      active = null;
    },
    getQueryObjectEXT(query, parameter) {
      const state = queries.get(query);
      if (parameter === "available" || parameter === "availableEXT") return state.ready;
      assert.equal(state.ready, true);
      if (options.invalid) return NaN;
      const ms = durations ? durations[query.index] ?? durations.at(-1) : 2;
      return ms * 1e6;
    },
    deleteQueryEXT(query) { assert.equal(queries.delete(query), true); },
    QUERY_RESULT_AVAILABLE_EXT: "available",
    CURRENT_QUERY_EXT: "current",
  };
  const gl = {
    getExtension: name => name === "EXT_disjoint_timer_query" ? extension : null,
    getParameter: () => disjoint,
    isContextLost: () => lost,
  };
  function flush() {
    const pendingCallbacks = [...callbacks];
    callbacks.clear();
    pendingCallbacks.forEach(callback => callback());
  }
  function setReady(predicate) {
    for (const state of queries.values()) if (predicate(state)) state.ready = true;
  }
  return {
    queries,
    callbacks,
    gl,
    get active() { return active; },
    hold() {
      active = { external: true };
      return () => { active = null; };
    },
    lose() { lost = true; disjoint = true; },
    requestAnimationFrame(callback) { callbacks.add(callback); return callback; },
    cancelAnimationFrame(callback) { callbacks.delete(callback); },
    flush,
    resolve(flags = {}) {
      if (flags === true) flags = { disjoint: true };
      if (flags.lost !== undefined) lost = !!flags.lost;
      if (flags.disjoint !== undefined) disjoint = !!flags.disjoint;
      setReady(() => true);
      flush();
    },
    resolveOnly(indexes, flags = {}) {
      if (flags.disjoint !== undefined) disjoint = !!flags.disjoint;
      setReady(state => indexes.includes(state.index));
      flush();
    },
  };
}

test("GPU query segments add to parent totals without blocking or nesting queries", () => {
  const gpu = fakeGpu();
  const { api, draw, makeLayer, makeEffect, sample } = install(gpu);
  const pass = makeEffect(50);
  const layer = makeLayer({ cost: 70, effects: [pass] });
  api.setEnabled(true);
  draw(layer);
  assert.equal(sample(layer).cpuMs, 120);
  assert.equal(sample(pass).cpuMs, 50);
  assert.equal(sample(layer).gpuMs, null);
  assert.equal(sample(layer).gpuStatus, "pending");
  assert.equal(gpu.queries.size, 3);
  gpu.resolve();
  assert.equal(sample(pass).gpuMs, 2);
  assert.equal(sample(pass).gpuStatus, "available");
  assert.equal(sample(layer).gpuMs, 6);
  assert.equal(sample(layer).cpuMs, 120);
  assert.equal(gpu.queries.size, 0);
});

test("desired contract: CPU and GPU remain available together", () => {
  const gpu = fakeGpu({ ready: true });
  const { api, draw, makeLayer, sample } = install(gpu);
  const layer = makeLayer({ cost: 7 });
  api.setEnabled(true);
  draw(layer);
  assert.equal(sample(layer).cpuMs, 7);
  assert.equal(sample(layer).gpuMs, 2);
  assert.equal(sample(layer).gpuStatus, "available");
  assert.equal(sample(layer).gpuFrame, 0);
  assert.equal(sample(layer).gpuAge, 0);
});

test("desired contract: no GPU timer has an explicit unavailable value", () => {
  const { api, draw, makeLayer, sample } = install();
  const layer = makeLayer({ cost: 7 });
  api.setEnabled(true);
  draw(layer);
  assert.equal(sample(layer).cpuMs, 7);
  assert.equal(sample(layer).gpuMs, null);
  assert.equal(sample(layer).gpuStatus, "unavailable");
  assert.equal(sample(layer).gpuFrame, null);
});

test("desired contract: CPU is published while GPU results are pending", () => {
  const gpu = fakeGpu();
  const { api, draw, makeLayer, sample } = install(gpu);
  const layer = makeLayer({ cost: 7 });
  api.setEnabled(true);
  draw(layer);
  assert.ok(sample(layer), "CPU timing must not wait for GPU availability");
  assert.equal(sample(layer).cpuMs, 7);
  assert.equal(sample(layer).gpuMs, null);
  assert.equal(sample(layer).gpuStatus, "pending");
});

test("siblings keep their own GPU queries: scene 11, adjustment 59, effect 19", () => {
  const gpu = fakeGpu({ durations: [11, 17, 19, 23] });
  const h = install(gpu);
  const pass = h.makeEffect(5);
  const scene = h.makeLayer({ cost: 40 });
  const adjustment = h.makeLayer({ cost: 2, effects: [pass] });
  h.api.setEnabled(true);
  h.api.draw(h.viewport, 0, function () { this.renderLayer(scene); this.renderLayer(adjustment); },
    h.compositor, []);
  assert.equal(h.sample(scene).gpuMs, null);
  gpu.resolve();
  assert.equal(h.sample(scene).gpuMs, 11);
  assert.equal(h.sample(adjustment).gpuMs, 59);
  assert.equal(h.sample(pass).gpuMs, 19);
  assert.equal(h.sample(scene).cpuMs, 40);
  assert.equal(h.sample(adjustment).cpuMs, 7);
  assert.equal(h.sample(pass).cpuMs, 5);
  assert.equal(h.sample(adjustment).gpuStatus, "available");
});

test("a fifth frame publishes CPU and keeps four pending GPU frames useful", () => {
  const gpu = fakeGpu();
  const { api, draw, makeLayer, sample } = install(gpu);
  const layer = makeLayer({ cost: 7 });
  api.setEnabled(true);
  for (let i = 0; i < 4; i++) draw(layer, i);
  assert.equal(gpu.queries.size, 4);
  assert.equal(sample(layer).gpuStatus, "pending");
  draw(layer, 4);
  assert.equal(sample(layer).cpuFrame, 4);
  assert.equal(sample(layer).cpuMs, 7);
  assert.equal(sample(layer).gpuMs, null);
  assert.equal(sample(layer).gpuStatus, "busy");
  assert.equal(gpu.queries.size, 4);
  gpu.resolve();
  assert.equal(sample(layer).cpuFrame, 4);
  assert.equal(sample(layer).gpuMs, 2);
  assert.equal(sample(layer).gpuFrame, 3);
  assert.equal(sample(layer).gpuAge, 1);
  assert.equal(gpu.queries.size, 0);
});

test("older GPU frames resolved late never replace a newer completed sample", () => {
  const gpu = fakeGpu({ durations: [11, 13, 17, 19] });
  const { api, draw, makeLayer, sample } = install(gpu);
  const layer = makeLayer({ cost: 7 });
  api.setEnabled(true);
  for (let i = 0; i < 4; i++) draw(layer, i);
  gpu.resolveOnly([2, 3]);
  assert.equal(sample(layer).gpuFrame, 3);
  assert.equal(sample(layer).gpuMs, 17.5);
  gpu.resolveOnly([0, 1]);
  assert.equal(sample(layer).gpuFrame, 3);
  assert.equal(sample(layer).gpuMs, 17.5);
  assert.equal(sample(layer).cpuFrame, 3);
  assert.equal(gpu.queries.size, 0);
});

test("a looped sequence accepts new GPU samples after the frame number wraps", () => {
  const gpu = fakeGpu();
  const h = install(gpu);
  const layer = h.makeLayer({ cost: 2 });
  h.api.setEnabled(true);
  h.draw(layer, 9);
  gpu.resolve();
  assert.equal(h.sample(layer).gpuFrame, 9);
  h.draw(layer, 0);
  gpu.resolve();
  assert.equal(h.sample(layer).gpuFrame, 0);
  assert.equal(h.sample(layer).gpuMs, 2);
});

test("no metric crosses a project, sequence or active clip boundary", () => {
  const gpu = fakeGpu();
  const h = install(gpu);
  const layer = h.makeLayer({ cost: 7 });
  h.api.setEnabled(true);
  h.draw(layer, 0);
  gpu.resolve();
  assert.equal(h.sample(layer).gpuMs, 2);

  const next = { properties: { rate: { get: () => 25 } }, videoTracks: [] };
  h.compositor._sequence = next;
  h.editor.sequence = next;
  h.draw(layer, 1);
  assert.equal(h.sample(layer).cpuMs, 7);
  assert.equal(h.sample(layer).gpuMs, null);
  assert.equal(h.sample(layer).gpuFrame, null);
  gpu.resolve();
  assert.equal(h.sample(layer).gpuMs, 2);
  assert.equal(h.sample(layer).gpuFrame, 1);

  h.editor.project = {};
  h.draw(layer, 2);
  assert.equal(h.sample(layer).cpuMs, 7);
  assert.equal(h.sample(layer).cpuFrame, 2);
  assert.equal(h.sample(layer).gpuMs, null);
  assert.equal(h.sample(layer).gpuFrame, null);
});

test("a track row pairs CPU and GPU only for the same active layer", () => {
  const gpu = fakeGpu();
  const h = install(gpu);
  const first = h.makeLayer({ cost: 1 });
  const second = h.makeLayer({ cost: 2 });
  let current = first;
  const track = { getCurrentClip: () => ({ object: current }) };
  h.sequence.videoTracks = [track];
  h.api.setEnabled(true);
  h.draw(first, 0);
  gpu.resolve();
  assert.equal(h.api.readTrack(h.editor, track).gpuMs, 2);
  current = second;
  h.draw(second, 1);
  const value = h.api.readTrack(h.editor, track);
  assert.equal(value.cpuMs, 2);
  assert.equal(value.gpuMs, null);
  assert.equal(value.gpuFrame, null);
  assert.equal(value.cpuFrame, 1);
});

test("GPU failures report an explicit reason and never a numeric sample", () => {
  let gpu = fakeGpu();
  const h = install(gpu);
  h.api.setEnabled(true);
  const layer = h.makeLayer({ cost: 5 });
  h.draw(layer);
  gpu.resolve({ disjoint: true });
  assert.equal(h.sample(layer).gpuMs, null);
  assert.equal(h.sample(layer).gpuStatus, "disjoint");
  assert.equal(h.sample(layer).cpuMs, 5);

  const lost = install(gpu = fakeGpu());
  lost.api.setEnabled(true);
  const lostLayer = lost.makeLayer({ cost: 6 });
  lost.draw(lostLayer);
  gpu.lose();
  gpu.resolve();
  assert.equal(lost.sample(lostLayer).gpuMs, null);
  assert.equal(lost.sample(lostLayer).gpuStatus, "disjoint");

  const busy = install(gpu = fakeGpu());
  busy.api.setEnabled(true);
  const release = gpu.hold();
  const busyLayer = busy.makeLayer({ cost: 3 });
  busy.draw(busyLayer);
  release();
  assert.equal(busy.sample(busyLayer).gpuMs, null);
  assert.equal(busy.sample(busyLayer).gpuStatus, "busy");

  const limited = install(gpu = fakeGpu({ ready: true }));
  limited.api.setEnabled(true);
  const effects = Array.from({ length: 200 }, () => limited.makeEffect(0));
  const limitedLayer = limited.makeLayer({ cost: 1, effects });
  limited.draw(limitedLayer);
  assert.equal(limited.sample(limitedLayer).gpuMs, null);
  assert.equal(limited.sample(limitedLayer).gpuStatus, "limit");
  assert.equal(gpu.queries.size, 0);

  const timed = install(gpu = fakeGpu());
  timed.api.setEnabled(true);
  const slowLayer = timed.makeLayer({ cost: 4 });
  timed.draw(slowLayer);
  timed.clock.time = 4000;
  gpu.flush();
  assert.equal(timed.sample(slowLayer).gpuMs, null);
  assert.equal(timed.sample(slowLayer).gpuStatus, "timeout");
  assert.equal(gpu.queries.size, 0);

  const badGpu = fakeGpu({ invalid: true });
  const bad = install(badGpu);
  bad.api.setEnabled(true);
  const badLayer = bad.makeLayer({ cost: 2 });
  bad.draw(badLayer);
  badGpu.resolve();
  assert.equal(bad.sample(badLayer).gpuMs, null);
  assert.equal(bad.sample(badLayer).gpuStatus, "disjoint");
});

test("CPU and GPU smooth independently and reset across cached or incompatible samples", () => {
  const gpu = fakeGpu({ ready: true, durations: [10, 2, 4] });
  const h = install(gpu);
  const layer = h.makeLayer({ cost: 10 });
  h.api.setEnabled(true);
  h.draw(layer, 0);
  assert.equal(h.sample(layer).cpuMs, 10);
  assert.equal(h.sample(layer).gpuMs, 10);
  layer.cost = 30;
  h.draw(layer, 1);
  assert.equal(h.sample(layer).cpuMs, 15);
  assert.equal(h.sample(layer).gpuMs, 8);

  h.api.cached(h.viewport, 1);
  assert.equal(h.sample(layer).cached, true);
  h.draw(layer, 2);
  assert.equal(h.sample(layer).cpuMs, 30);
  assert.equal(h.sample(layer).gpuMs, 4);
});

test("a sequence change restarts CPU smoothing", () => {
  const { api, draw, makeLayer, sample, compositor, editor } = install();
  const layer = makeLayer({ cost: 10 });
  api.setEnabled(true);
  draw(layer, 0);
  assert.equal(sample(layer).cpuMs, 10);
  layer.cost = 30;
  draw(layer, 1);
  assert.equal(sample(layer).cpuMs, 15);
  const next = { properties: { rate: { get: () => 25 } } };
  compositor._sequence = next;
  editor.sequence = next;
  draw(layer, 2);
  assert.equal(sample(layer).cpuMs, 30);
});

test("disjoint GPU results and hiding release their queries", () => {
  const gpu = fakeGpu();
  const { api, draw, makeLayer } = install(gpu);
  api.setEnabled(true);
  draw(makeLayer({ cost: 7 }));
  assert.equal(gpu.queries.size, 1);
  assert.equal(gpu.callbacks.size, 1);
  api.setEnabled(false);
  assert.equal(gpu.queries.size, 0);
  assert.equal(gpu.callbacks.size, 0);
});

test("WebGL2 adapter uses core query objects and converts nanoseconds", () => {
  let active = null;
  let deleted = false;
  const calls = [];
  const ext = { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 };
  const gl = {
    CURRENT_QUERY: 12, QUERY_RESULT_AVAILABLE: 13, QUERY_RESULT: 14,
    getExtension(name) { calls.push(name); return name === "EXT_disjoint_timer_query_webgl2" ? ext : null; },
    getQuery: () => active,
    createQuery: () => ({}),
    beginQuery(target, query) { assert.equal(target, 10); active = query; },
    endQuery(target) { assert.equal(target, 10); active = null; },
    getParameter: () => false,
    getQueryParameter(_query, parameter) { return parameter === 13 ? true : 9e6; },
    deleteQuery() { deleted = true; },
  };
  const h = install({ gl });
  const timer = h.window.ZoidiumRenderTimeGpu.create(gl);
  timer.check();
  const query = timer.begin();
  assert.equal(timer.begin(), null);
  assert.equal(timer.active(), true);
  timer.end();
  assert.equal(timer.ready(query), true);
  assert.equal(timer.milliseconds(query), 9);
  timer.remove(query);
  assert.equal(deleted, true);
  assert.equal(calls[0], "EXT_disjoint_timer_query_webgl2");
});

test("the timeline toggle restores the gutter and displays native layer and effect rows while enabled", () => {
  const { api, window, editor, sequence, makeLayer, makeEffect, draw } = install();
  const document = { createElement: () => new Element(), head: null };
  class Element {
    constructor() {
      this.ownerDocument = document;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value) };
      this.style = { width: "200px", left: "200px", gridTemplateColumns: "1fr auto",
        setProperty: () => {}, removeProperty: () => {} };
    }
    get lastElementChild() { return this.children.at(-1); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener() {}
    querySelector() { return null; }
    appendChild(node) { node.parentNode = this; this.children.push(node); }
    insertBefore(node, before) {
      node.parentNode = this;
      this.children.splice(this.children.indexOf(before), 0, node);
    }
    remove() { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); }
  }
  document.head = new Element();
  window.document = document;
  class Timeline {
    create() {
      this.timestamp = new Element();
      new Element().appendChild(this.timestamp);
      this.timerule = new Element();
      this.scrollBar = new Element();
      this.markermask = new Element();
    }
  }
  Timeline.tracks = class {
    create() {
      for (const key of ["labels", "videoLabels", "audioLabels", "container"]) this[key] = new Element();
    }
    createTrackLabel() {
      const label = new Element();
      label.appendChild(new Element());
      label.appendChild(new Element());
      return label;
    }
  };
  Timeline.keyframes = class {
    createKeyframeTrack() {
      const lane = new Element();
      lane.pz_label = new Element();
      return lane;
    }
  };
  window.PZ.ui = { timeline: Timeline };
  const source = readFileSync(join(__dirname, "../plugins/core/render-time-column.js"), "utf8");
  runInNewContext(source, { window, WeakRef });
  const timeline = new Timeline();
  timeline.editor = editor;
  timeline.create();
  timeline.tracks = new Timeline.tracks();
  timeline.tracks.timeline = timeline;
  timeline.keyframes = new Timeline.keyframes();
  timeline.keyframes.timeline = timeline;
  timeline.keyframes.labels = new Element();
  timeline.keyframes.container = new Element();
  timeline.tracks.create();
  const effect = makeEffect(23);
  const layer = makeLayer({ cost: 4, effects: [effect] });
  const track = { getCurrentClip: () => ({ object: layer }) };
  sequence.videoTracks = [track];
  const trackRow = timeline.tracks.createTrackLabel(track, 0);
  const effectLane = timeline.keyframes.createKeyframeTrack(null, effect);
  effectLane.pz_label.textContent = "Effect";
  const header = timeline.timestamp.parentNode;
  const toggle = header.lastElementChild;
  assert.equal(toggle.attributes.get("aria-pressed"), "false");
  assert.equal(trackRow.children.length, 2);
  toggle.onclick({ stopPropagation() {} });
  assert.equal(api.enabled, true);
  assert.equal(toggle.attributes.get("aria-pressed"), "true");
  assert.equal(header.style.width, "calc(200px + 116px)");
  draw(layer);
  const cell = trackRow.children[1];
  assert.equal(cell.textContent, "CPU 27.0 ms · GPU —");
  assert.equal(cell.dataset.load, "heavy");
  assert.match(cell.title, /CPU 27\.0 ms draw submission/);
  assert.match(cell.title, /GPU not measured/);
  assert.equal(effectLane.pz_label.dataset.renderTime, "CPU 23.0 ms · GPU —");
  assert.equal(effectLane.pz_label.classList.contains("zoidium-render-time-keyframe"), true);
  toggle.onclick({ stopPropagation() {} });
  assert.equal(trackRow.children.length, 2);
  assert.equal(header.style.width, "200px");
  assert.equal(effectLane.pz_label.dataset.renderTime, undefined);
  assert.equal(effectLane.pz_label.classList.contains("zoidium-render-time-keyframe"), false);
  // A width the timeline rewrites while the column is shown survives hiding it.
  toggle.onclick({ stopPropagation() {} });
  timeline.tracks.labels.style.width = "260px";
  toggle.onclick({ stopPropagation() {} });
  assert.equal(timeline.tracks.labels.style.width, "260px");
  assert.equal(header.style.width, "200px");
});

// Chrome re-serializes calc() when it is written, so plain strings cannot stand in for style values.
function serializeLikeChrome(value) {
  const widened = /^calc\((.*) \+ (\d+)px\)$/.exec(value);
  if (!widened) return value;
  let inner = widened[1].trim();
  const extra = Number(widened[2]);
  const nested = /^calc\((.*)\)$/.exec(inner);
  if (nested) inner = nested[1].trim();
  if (!inner) return null;
  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(inner);
  if (pixels) return `calc(${Number(pixels[1]) + extra}px)`;
  const shifted = /^(.*) - (\d+(?:\.\d+)?)px$/.exec(inner);
  if (shifted) return `calc(${shifted[1]} + ${extra - Number(shifted[2])}px)`;
  return `calc(${inner} + ${extra}px)`;
}

test("repeated toggles restore gutter values that the style engine re-serializes", () => {
  const { api, window, editor } = install();
  const document = { createElement: () => new Element(), head: null };
  class Element {
    constructor() {
      this.ownerDocument = document;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value),
        contains: value => classes.has(value) };
      const values = { width: "200px", left: "200px", gridTemplateColumns: "1fr auto" };
      this.style = {
        get width() { return values.width; },
        set width(value) {
          const stored = serializeLikeChrome(value);
          if (stored !== null) values.width = stored;
        },
        get left() { return values.left; },
        set left(value) {
          const stored = serializeLikeChrome(value);
          if (stored !== null) values.left = stored;
        },
        gridTemplateColumns: values.gridTemplateColumns,
        setProperty: (name, value) => { values[name] = value; },
        removeProperty: name => { delete values[name]; },
      };
    }
    get lastElementChild() { return this.children.at(-1); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener() {}
    querySelector() { return null; }
    appendChild(node) { node.parentNode = this; this.children.push(node); }
    insertBefore(node, before) {
      node.parentNode = this;
      this.children.splice(this.children.indexOf(before), 0, node);
    }
    remove() { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); }
  }
  document.head = new Element();
  window.document = document;
  class Timeline {
    create() {
      this.timestamp = new Element();
      new Element().appendChild(this.timestamp);
      this.timerule = new Element();
      this.scrollBar = new Element();
      this.markermask = new Element();
    }
  }
  Timeline.tracks = class {
    create() {
      for (const key of ["labels", "videoLabels", "audioLabels", "container"]) this[key] = new Element();
    }
    createTrackLabel() { return new Element(); }
  };
  Timeline.keyframes = class {
    createKeyframeTrack() { return new Element(); }
  };
  window.PZ.ui = { timeline: Timeline };
  runInNewContext(readFileSync(join(__dirname, "../plugins/core/render-time-column.js"), "utf8"),
    { window, WeakRef });
  const timeline = new Timeline();
  timeline.editor = editor;
  timeline.create();
  timeline.tracks = new Timeline.tracks();
  timeline.tracks.timeline = timeline;
  timeline.keyframes = new Timeline.keyframes();
  timeline.keyframes.timeline = timeline;
  timeline.keyframes.labels = new Element();
  timeline.keyframes.container = new Element();
  timeline.tracks.create();
  const header = timeline.timestamp.parentNode;
  // The real header keeps a calc() width, and this track label keeps no inline width at all.
  header.style.width = "calc(100% - 84px)";
  timeline.tracks.audioLabels.style.width = "";
  const widths = [header, timeline.keyframes.labels, timeline.tracks.labels,
    timeline.tracks.videoLabels, timeline.tracks.audioLabels];
  const lefts = [timeline.timerule, timeline.scrollBar, timeline.markermask,
    timeline.keyframes.container, timeline.tracks.container];
  const snapshot = () => [...widths.map(el => el.style.width), ...lefts.map(el => el.style.left)];
  const before = snapshot();
  assert.deepEqual(before, ["calc(100% - 84px)", "200px", "200px", "200px", "",
    "200px", "200px", "200px", "200px", "200px"]);
  const toggle = header.lastElementChild;
  for (let cycle = 1; cycle <= 4; cycle++) {
    toggle.onclick({ stopPropagation() {} });
    assert.equal(api.enabled, true);
    assert.equal(header.style.width, "calc(100% + 32px)");
    assert.equal(timeline.tracks.labels.style.width, "calc(316px)");
    assert.equal(timeline.timerule.style.left, "calc(316px)");
    assert.equal(timeline.tracks.audioLabels.style.width, "");
    toggle.onclick({ stopPropagation() {} });
    assert.equal(api.enabled, false);
    assert.deepEqual(snapshot(), before, `cycle ${cycle} restores the exact gutter`);
  }
  // A width the timeline rewrites while the column is shown survives hiding it.
  toggle.onclick({ stopPropagation() {} });
  timeline.tracks.videoLabels.style.width = "260px";
  toggle.onclick({ stopPropagation() {} });
  assert.equal(timeline.tracks.videoLabels.style.width, "260px");
  assert.equal(header.style.width, "calc(100% - 84px)");
  // The rewritten width becomes the new baseline for the next cycle.
  toggle.onclick({ stopPropagation() {} });
  assert.equal(timeline.tracks.videoLabels.style.width, "calc(376px)");
  toggle.onclick({ stopPropagation() {} });
  assert.equal(timeline.tracks.videoLabels.style.width, "260px");
});

test("cells show both metrics, frame age and cached output", () => {
  const gpu = fakeGpu();
  const h = install(gpu);
  const document = { createElement: () => new Element(), head: null };
  class Element {
    constructor() {
      this.ownerDocument = document;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.style = { width: "200px", left: "200px", setProperty: () => {}, removeProperty: () => {} };
    }
    get lastElementChild() { return this.children.at(-1); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener() {}
    querySelector() { return null; }
    appendChild(node) { node.parentNode = this; this.children.push(node); }
    insertBefore(node, before) {
      node.parentNode = this;
      this.children.splice(this.children.indexOf(before), 0, node);
    }
    remove() { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); }
  }
  document.head = new Element();
  h.window.document = document;
  class Timeline {
    create() {
      this.timestamp = new Element();
      new Element().appendChild(this.timestamp);
      this.timerule = new Element();
      this.scrollBar = new Element();
      this.markermask = new Element();
    }
  }
  Timeline.tracks = class {
    create() {
      for (const key of ["labels", "videoLabels", "audioLabels", "container"]) this[key] = new Element();
    }
    createTrackLabel() {
      const label = new Element();
      label.appendChild(new Element());
      label.appendChild(new Element());
      return label;
    }
  };
  Timeline.keyframes = class {
    createKeyframeTrack() { return new Element(); }
  };
  h.window.PZ.ui = { timeline: Timeline };
  runInNewContext(readFileSync(join(__dirname, "../plugins/core/render-time-column.js"), "utf8"),
    { window: h.window, WeakRef });
  const timeline = new Timeline();
  timeline.editor = h.editor;
  timeline.create();
  timeline.tracks = new Timeline.tracks();
  timeline.tracks.timeline = timeline;
  timeline.keyframes = new Timeline.keyframes();
  timeline.keyframes.timeline = timeline;
  timeline.keyframes.labels = new Element();
  timeline.keyframes.container = new Element();
  timeline.tracks.create();
  const layer = h.makeLayer({ cost: 7 });
  const track = { getCurrentClip: () => ({ object: layer }) };
  h.sequence.videoTracks = [track];
  const row = timeline.tracks.createTrackLabel(track, 0);
  timeline.timestamp.parentNode.lastElementChild.onclick({ stopPropagation() {} });
  h.draw(layer, 0);
  const cell = row.children[1];
  assert.equal(cell.textContent, "CPU 7.00 ms · GPU —");
  gpu.resolve();
  assert.equal(cell.textContent, "CPU 7.00 · GPU 2.00 ms");
  assert.match(cell.title, /GPU 2\.00 ms timer query/);
  assert.match(cell.title, /GPU frame is current/);
  h.draw(layer, 1);
  assert.equal(cell.textContent, "CPU 7.00 · GPU 2.00 ms");
  assert.match(cell.title, /GPU frame is 1 behind/);
  h.api.cached(h.viewport, 1);
  assert.equal(cell.textContent, "Cached");
});
