"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function host() {
  class Observable { update() {} }
  const list = items => Object.assign(items, { onListChanged: new Observable() });
  class Layer {
    constructor() { this.effects = list([]); }
    tryGetParentOfType() { return this.clip; }
  }
  Layer.composite = class extends Layer {
    constructor() { super(); this.objects = list([]); }
  };
  Layer.adjustment = class extends Layer {};
  const sequence = {
    properties: { rate: { get: () => 30 } },
    parentProject: { ui: { onChanged: new Observable() } },
  };
  function track(layer = new Layer(), start = 0) {
    const clip = { start, length: 100, object: layer };
    layer.clip = clip;
    return { layer, enabled: true, clips: list([clip]) };
  }
  const tracks = list([track()]);
  sequence.videoTracks = tracks;
  const sandbox = {
    console,
    PZ: { observable: Observable, layer: Layer },
    document: { addEventListener() {} },
  };
  vm.createContext(sandbox);
  for (const part of ["math", "layers"]) {
    vm.runInContext(fs.readFileSync(`plugins/core/temporal-${part}.js`, "utf8"), sandbox);
  }
  return { api: sandbox.__zoidiumTemporalParts.layers, PZ: sandbox.PZ, sequence, tracks, Layer };
}

test("bypassed nested samplers are invisible to scheduling", () => {
  const nested = host();
  nested.PZ.zoidium = { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } };
  const parent = new nested.Layer.composite();
  const child = new nested.Layer();
  parent.objects.push(child);
  const sampler = { _zoidiumFrameSampler: {}, zoidiumBypassed: true };
  child.effects.push(sampler);
  assert.equal(nested.api.hasNestedFrameSampler(parent), false);
  sampler.zoidiumBypassed = false;
  assert.equal(nested.api.hasNestedFrameSampler(parent), true);

  const bypassed = host();
  bypassed.PZ.zoidium = { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } };
  bypassed.tracks[0].layer.effects.push({
    _zoidiumTemporal: {},
    _zoidiumFrameSampler: {},
    zoidiumBypassed: true,
  });
  bypassed.tracks[0].layer.effects.onListChanged.update();
  assert.equal(bypassed.api.usesSingleEvaluation(bypassed.sequence), false);
  assert.equal(bypassed.api.usesSingleEvaluation(bypassed.sequence, true), false);

  const active = host();
  active.PZ.zoidium = { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } };
  active.tracks[0].layer.effects.push({ _zoidiumTemporal: {}, _zoidiumFrameSampler: {} });
  active.tracks[0].layer.effects.onListChanged.update();
  assert.equal(active.api.usesSingleEvaluation(active.sequence), true);
  assert.equal(active.api.usesSingleEvaluation(active.sequence, true), false);
});
