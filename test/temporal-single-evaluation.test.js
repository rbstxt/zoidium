"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function host({ composite = false, adjustment = false, operator = "offset" } = {}) {
  let sequence;
  class Layer {
    constructor() { this.effects = []; this.updates = []; }
    getParentOfType() { return sequence; }
    tryGetParentOfType() { return this.clip; }
    update(frame) { this.frame = frame; this.effects.forEach(effect => effect.update?.(frame)); }
  }
  // CM3 Scene evaluates content BEFORE super; Composite evaluates it AFTER.
  Layer.scene = class extends Layer {
    update(frame) { this.updates.push(frame); super.update(frame); }
  };
  Layer.composite = class extends Layer {
    constructor() { super(); this.objects = [new Layer.scene()]; }
    update(frame) { super.update(frame); this.objects.forEach(object => object.update(frame)); }
  };
  Layer.adjustment = class extends Layer {};
  class Schedule { prepare() {} }
  class Compositor {
    renderSequence(frame) {
      for (const track of sequence.videoTracks) {
        track.layer.update(frame - track.layer.clip.start);
        this.renderLayer(track.layer);
      }
    }
    renderLayer(layer) {
      if (layer.objects) layer.objects.forEach(child => this.renderLayer(child));
      else if (layer instanceof Layer.scene) this.draws.push(layer.frame);
    }
    unload() {}
  }
  const content = composite ? new Layer.composite() : new Layer.scene();
  const lower = new Layer.scene();
  const owner = adjustment ? new Layer.adjustment() : content;
  owner.effects.push({ _zoidiumTemporal: { getOperator: () => operator === "offset"
    ? { kind: "time-offset", offsetFrames: 5 } : { kind: "posterize-time", fps: 12 } } });
  const active = adjustment ? [lower, content, owner] : [content];
  sequence = { properties: { rate: { get: () => 30 } }, videoTracks: active.map(layer => {
    const clip = { start: 0, length: 100, object: layer };
    layer.clip = clip;
    if (layer.objects) layer.objects.forEach(child => { child.clip = clip; });
    return { layer, clips: [clip], enabled: true, getCurrentClip: () => clip };
  }) };
  sequence.videoTracks.forEach(track => { track.clips[0].parentProject = { sequence }; });
  const sandbox = { console, PZ: { layer: Layer, compositor: Compositor, schedule: Schedule,
    clip: class {}, sequence: class {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const part of ["math", "layers", "sampler", "render"]) {
    vm.runInContext(fs.readFileSync(`plugins/core/temporal-${part}.js`, "utf8"), sandbox);
  }
  const root = new Compositor();
  root._sequence = sequence;
  root.draws = [];
  return { root, content, lower, owner, sequence, Schedule, state: sandbox.ZOIDIUM_TEMPORAL };
}

for (const operator of ["offset", "posterize"]) {
  for (const composite of [false, true]) {
    for (const adjustment of [false, true]) {
      test(`${operator}, composite=${composite}, adjustment=${adjustment}: evaluate content once at input time`, () => {
        const h = host({ operator, composite, adjustment });
        h.root.renderSequence(13);
        const expected = operator === "offset" ? 18 : 12.5;
        const content = composite ? h.content.objects[0] : h.content;
        assert.deepEqual(content.updates, [expected]);
        assert.equal(h.root.draws.at(-1), expected);
        if (adjustment) assert.deepEqual(h.lower.updates, [expected]);
        assert.equal(h.state.frameSamplerRuntimes.get(h.root), undefined);
      });
    }
  }
}

test("input clocks are independent of earlier renders, including identity mappings", () => {
  const h = host({ composite: true, adjustment: true, operator: "posterize" });
  for (const frame of [13, 5, 29, 13]) h.root.renderSequence(frame);
  assert.deepEqual(h.content.objects[0].updates, [12.5, 5, 27.5, 12.5]);
});


test("procedural prepare settles the mapped resources without evaluating content again", async () => {
  const h = host({ adjustment: true });
  const clip = h.sequence.videoTracks[1].clips[0];
  const prepared = [];
  clip.update = frame => clip.object.update(frame - clip.start);
  clip.prepare = async frame => prepared.push(frame);
  const schedule = new h.Schedule();
  schedule.items = [{ start: 0, length: 100, clip }];
  await schedule.prepare(13, {});
  assert.deepEqual(h.content.updates, []);
  assert.deepEqual(prepared, [18]);
  h.root.renderSequence(13);
  assert.deepEqual(h.content.updates, [18]);
});

test("an editor update reads the playhead on demand and never changes a later rendered frame", () => {
  const h = host();
  h.root.renderSequence(13);
  h.content.update(13);
  assert.equal(h.content.frame, 13);
  h.root.renderSequence(13);
  assert.deepEqual(h.content.updates, [18, 13, 18]);
  assert.deepEqual(h.root.draws, [18, 18]);
});

test("samplers retain the existing evaluation and restoration path", () => {
  const h = host();
  h.owner.effects.push({ _zoidiumFrameSampler: {} });
  h.root.renderSequence(13);
  assert.deepEqual(h.content.updates, [13, 18, 13]);
});

test("an exception cannot leave the next draw in a mapping context", () => {
  const h = host({ composite: true });
  const renderLayer = h.root.renderLayer;
  h.root.renderLayer = () => { throw new Error("draw failed"); };
  assert.throws(() => h.root.renderSequence(13), /draw failed/);
  assert.equal(h.state.contexts.length, 0);
  h.root.renderLayer = renderLayer;
  h.root.renderSequence(13);
  assert.deepEqual(h.content.objects[0].updates, [18, 18]);
});


test("Precomp-style children inherit the mapped clock once with their own clip origin", () => {
  const h = host({ composite: true, adjustment: true });
  const child = h.content.objects[0];
  child.clip = { start: 3, length: 100, object: child };
  const base = Object.getPrototypeOf(Object.getPrototypeOf(h.content)).update;
  h.content.update = function precompUpdate(frame) {
    base.call(this, frame);
    this.objects[0].update(frame + 7 - child.clip.start);
  };
  h.root.renderSequence(13);
  assert.deepEqual(child.updates, [22]);
  h.root.renderSequence(5);
  h.root.renderSequence(13);
  assert.deepEqual(child.updates, [22, 14, 22]);
});
