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
  assert.equal(sample(scene).ms, 14);
  assert.equal(sample(child).ms, 8);
  assert.equal(sample(group).ms, 5);
  assert.equal(sample(pass).ms, 5);
  assert.equal(sample(disabled), null);
  assert.equal(sample(bypassed), null);
  assert.equal(compositor.renderLayer, original);
  assert.equal(sample(scene).basis, "CPU");
});

test("smoothing uses successive rendered samples and resets when a layer stops drawing", () => {
  const { api, draw, makeLayer, sample } = install();
  const layer = makeLayer({ cost: 10 });
  api.setEnabled(true);
  draw(layer, 1);
  assert.equal(sample(layer).ms, 10);
  layer.cost = 30;
  draw(layer, 2);
  assert.equal(sample(layer).ms, 15);
  draw(makeLayer({ cost: 1 }), 3);
  assert.equal(sample(layer), null);
  draw(layer, 4);
  assert.equal(sample(layer).ms, 30);
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
  assert.equal(sample(effect).ms, 15);
  assert.equal(sample(effect).samplesCached, true);
  assert.equal(sample(layer).ms, 17);
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
  assert.equal(sample(layer).ms, 5);
});

function fakeGpu() {
  let active = null;
  let ready = false;
  let disjoint = false;
  const callbacks = new Set();
  const queries = new Set();
  const extension = {
    createQueryEXT() {
      const query = {};
      queries.add(query);
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
    getQueryObjectEXT(_query, parameter) {
      if (parameter === "available") return ready;
      assert.equal(ready, true);
      return 2e6;
    },
    deleteQueryEXT(query) { assert.equal(queries.delete(query), true); },
    QUERY_RESULT_AVAILABLE_EXT: "available",
  };
  return {
    queries,
    callbacks,
    gl: {
      getExtension: name => name === "EXT_disjoint_timer_query" ? extension : null,
      getParameter: () => disjoint,
    },
    requestAnimationFrame(callback) { callbacks.add(callback); return callback; },
    cancelAnimationFrame(callback) { callbacks.delete(callback); },
    resolve(lost = false) {
      ready = true;
      disjoint = lost;
      const pending = [...callbacks];
      callbacks.clear();
      pending.forEach(callback => callback());
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
  assert.equal(sample(layer), null);
  assert.equal(gpu.queries.size, 3);
  gpu.resolve();
  assert.equal(sample(pass).basis, "GPU");
  assert.equal(sample(pass).ms, 2);
  assert.equal(sample(layer).ms, 6);
  assert.equal(gpu.queries.size, 0);
});

test("disjoint GPU measurements fall back to CPU; hiding cancels a pending poll", () => {
  const disjoint = fakeGpu();
  const fallback = install(disjoint);
  fallback.api.setEnabled(true);
  const layer = fallback.makeLayer({ cost: 8 });
  fallback.draw(layer);
  disjoint.resolve(true);
  assert.equal(fallback.sample(layer).basis, "CPU");
  assert.equal(fallback.sample(layer).ms, 8);

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
  assert.equal(header.style.width, "calc(200px + 40px)");
  draw(layer);
  const cell = trackRow.children[1];
  assert.equal(cell.textContent, "27.0 ms CPU");
  assert.equal(cell.dataset.load, "heavy");
  assert.equal(effectLane.pz_label.dataset.renderTime, "23.0 ms CPU");
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
