"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { runInNewContext } = require("node:vm");
const test = require("node:test");

function install(options = {}) {
  const tracks = new Map();
  const storage = options.storage || new Map();
  const clock = { calls: 0, time: 0 };
  class Layer {}
  class Effect {}
  class Group extends Effect {
    constructor(objects) { super(); this.objects = objects; this.enabled = true; }
  }
  Effect.group = Group;
  const compositor = {
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
    ? window.ZoidiumRenderTimeActive.draw(viewport, frame, compositor.renderLayer, compositor, [objects], context)
    : compositor.renderLayer(objects);
  const makeLayer = data => Object.assign(new Layer(), data);
  const makeEffect = (ms, enabled = true) => Object.assign(new Effect(),
    { pass: { enabled, render() { clock.time += ms; } } });
  const sample = object => api.read(editor, object);
  return { window, api, clock, tracks, storage, editor, sequence, viewport, compositor,
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
