"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function host(count = 1) {
  let sequence, updates = 0, afterDraw = () => {};
  class Layer {
    constructor() { this.effects = []; }
    getParentOfType() { return sequence; }
    tryGetParentOfType() { return this.clip; }
    update(frame) { this.frame = frame; updates++; }
  }
  Layer.scene = class extends Layer {};
  Layer.composite = class extends Layer {};
  Layer.adjustment = class extends Layer {};
  class Compositor {
    renderSequence(frame) {
      for (const track of sequence.videoTracks) {
        track.layer.update(frame - track.layer.clip.start);
        this.renderLayer(track.layer);
      }
      afterDraw();
    }
    renderLayer() {}
    unload() {}
  }
  sequence = { properties: { rate: { get: () => 30 } }, update() {}, videoTracks: [] };
  for (let i = 0; i < count; i++) {
    const layer = new Layer(), clip = { start: 2, length: 100, object: layer };
    layer.clip = clip;
    sequence.videoTracks.push({ layer, clips: [clip], getCurrentClip: () => clip });
  }
  const sandbox = { console, PZ: { layer: Layer, compositor: Compositor, schedule: class {}, sequence: class {}, clip: class {} } };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const part of ["math", "layers", "sampler", "render"]) {
    vm.runInContext(fs.readFileSync(`plugins/core/temporal-${part}.js`, "utf8"), sandbox);
  }
  const compositor = new Compositor(); compositor._sequence = sequence;
  const viewport = { compositor, editor: { playback: { currentFrame: 12 } } };
  return { viewport, sequence, state: sandbox.ZOIDIUM_TEMPORAL, layer: sequence.videoTracks[0].layer,
    sampler: sandbox.__zoidiumTemporalParts.sampler, updates: () => updates,
    afterDraw(fn) { afterDraw = fn; }, render(frame = 12) { sandbox.__zoidiumTemporalParts.sampler.renderPreparedPreview(viewport, {}, frame); } };
}

test("a prepared editing-frame preview updates 100 layers once", () => {
  const h = host(100);
  h.render();
  assert.equal(h.updates(), 100);
});

for (const name of ["sub-frame sample", "mapped clock", "sampler scope", "playhead change", "same playhead after a different update", "failed update"]) {
  test("prepared preview restores editing state after " + name, () => {
    const h = host();
    h.afterDraw(() => {
      if (name === "playhead change") return;
      const context = name === "sampler scope" ? { frameSamplerScope: {} } :
        name === "mapped clock" ? { renderingSequence: true, singleEvaluation: true } : {};
      h.state.contexts.push(context);
      try {
        h.layer.update(name === "sub-frame sample" ? 10.25 : 10);
        if (name === "same playhead after a different update") h.layer.update(8);
        if (name === "failed update") {
          const original = h.state.originalLayerUpdate;
          h.state.originalLayerUpdate = () => { h.layer.frame = 8; throw Error("failed"); };
          try { h.layer.update(10); } catch (_) { /* restoration follows */ }
          h.state.originalLayerUpdate = original;
        }
      } finally { h.state.contexts.pop(); }
    });
    h.render(name === "playhead change" ? 11 : 12);
    assert.equal(h.layer.frame, 10);
    assert.equal(h.updates(), name === "playhead change" ? 2 : name === "same playhead after a different update" ? 4 : 3);
  });
}

test("a stale playhead number alone never proves the layer state", () => {
  const h = host();
  h.viewport.compositor.renderSequence = () => { h.layer.update(7); };
  h.layer.__zoidiumTemporalLastUpdateFrame = 10;
  h.render();
  assert.equal(h.layer.frame, 10);
  assert.equal(h.updates(), 2);
});

test("a subclass failure after the base update clears its successful stamp", () => {
  const h = host();
  const original = h.layer.update;
  let fail = false;
  h.layer.update = function (frame) {
    original.call(this, frame);
    if (fail) { this.frame = 8; fail = false; throw Error("subclass failed"); }
  };
  h.afterDraw(() => {
    fail = true;
    try { h.layer.update(10); } catch (_) { /* restore after drawing */ }
  });
  h.render();
  assert.equal(h.layer.frame, 10);
  assert.equal(h.updates(), 3);
});

test("an intervening scoped child evaluation invalidates earlier layer stamps", () => {
  const h = host(2);
  h.afterDraw(() => {
    h.state.contexts.push({ frameSamplerScope: {} });
    try { h.sequence.videoTracks[1].layer.update(10); }
    finally { h.state.contexts.pop(); }
  });
  h.render();
  assert.equal(h.updates(), 5);
});
