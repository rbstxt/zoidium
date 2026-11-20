"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host } = require("./helpers/temporal-sampler-host.cjs");

test("preview sampler collection ignores bypassed samplers", () => {
  const h = host();
  h.effect._zoidiumFrameSampler.getRequest = () => ({ lockCurrentFrame: true, frames: [-1, 0] });
  h.PZ.zoidium ||= {};
  h.PZ.zoidium.effectBypass = { bypassed: effect => effect.zoidiumBypassed === true };
  assert.equal(h.state.ownsExactPreview(h.viewport, 30), true);
  h.effect.zoidiumBypassed = true;
  assert.equal(h.state.ownsExactPreview(h.viewport, 30), false);
});

test("export detects active samplers and skips bypassed preparation", async () => {
  const h = host();
  h.PZ.zoidium ||= {};
  h.PZ.zoidium.effectBypass = { bypassed: effect => effect.zoidiumBypassed === true };
  let calls = 0;
  h.sequence.properties.motionBlur = { get: () => 1 };
  h.sequence.properties.motionBlurSamples = { get: () => 2 };
  h.sequence.properties.motionBlurShutter = { get: () => 1 };
  h.owner.effects = [h.effect, { zoidiumBypassed: true, prepare: () => { throw Error("bypassed preparation"); } }];
  h.effect.prepare = async () => { calls++; };
  let checks = 0;
  const exporter = { sequence: h.sequence, exportPolicy: { check() { checks++; } } };
  await h.parts.exportPreparation.prepare(h.state, exporter, 30);
  assert.equal(calls, 2);
  h.effect.zoidiumBypassed = true;
  checks = 0;
  await h.parts.exportPreparation.prepare(h.state, exporter, 30);
  assert.equal(calls, 2);
  assert.equal(checks, 0);
});

test("asynchronous effect loading retains bypass serialization", async () => {
  class Effect {
    toJSON() { return { type: "initial" }; }
    async load() { await Promise.resolve(); this.toJSON = () => ({ type: "loaded" }); }
  }
  Effect.create = () => new Effect();
  class Edit {}
  const window = { PZ: { effect: Effect, ui: { edit: Edit } }, WeakRef };
  if (fs.existsSync("plugins/core/effect-bypass.js")) {
    vm.runInNewContext(fs.readFileSync("plugins/core/effect-bypass.js", "utf8"), { window });
  }
  const effect = Effect.create();
  await effect.load({ zoidiumBypassed: true });
  assert.equal(effect.toJSON().type, "loaded");
  assert.equal(effect.toJSON().zoidiumBypassed, true);
});

