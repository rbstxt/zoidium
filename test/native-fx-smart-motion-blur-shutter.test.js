"use strict";
const test = require("node:test");
require("../zoidium/plugin-apis.js");
const { installFrameSamplerContext } = global.ZoidiumPluginApis;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const math = require("../plugins/native-fx/smart-motion-blur/math.js");

test("automatic reconstruction samples scenes, while diagnostics and footage use flow", () => {
  for (const scene of [false, true]) {
    assert.equal(math.usesShutterSamples({}, scene), scene);
    assert.equal(math.usesShutterSamples({ reconstruction: 1 }, scene), false);
    assert.equal(math.usesShutterSamples({ reconstruction: 2 }, scene), true);
    assert.equal(math.usesShutterSamples({ view: 1, reconstruction: 2 }, scene), false);
    assert.equal(math.usesShutterSamples({ view: 2 }, scene), false);
  }
  assert.equal(math.captureCount(0), 32);
  assert.equal(math.captureCount(1), 64);
});

test("constraint rows exclude only candidates outside the project-pixel circle", () => {
  for (const ratio of [0.125, 0.5, 1]) {
    for (const limit of [1, 105.7, 179.2, 256]) {
      const project = [1920, 1080], processing = project.map(value => value * ratio);
      const stages = math.constraintStages(processing, project, limit);
      assert.ok(stages.includes(8));
      for (let stage = 0; stage <= 32; stage++) {
        const reachable = stage > 16 || Math.abs((stage - 8) * 32 / ratio) <= limit;
        assert.equal(stages.includes(stage), reachable);
      }
      assert.deepEqual(stages.filter(stage => stage > 16),
        Array.from({ length: 16 }, (_, index) => index + 17));
    }
  }
});

function shutterProbe() {
  const calls = [], disposed = [], module = { exports: {} };
  let allocations = 0;
  const gl = {
    pass: name => ({ name }),
    target(width, height) { allocations++; return { width, height, texture: {} }; },
    clearTargets() { disposed.push("targets"); },
    dispose() { disposed.push("all"); },
    preserve(_renderer, run) { return run(); },
    draw(_renderer, pass, output, values) {
      for (const value of Object.values(values)) assert.notEqual(value, output.texture);
      const inputs = Object.entries(values).filter(([key]) => key !== "uScale");
      const result = {};
      for (const [, value] of inputs) {
        for (const [key, weight] of Object.entries(value.weights))
          result[key] = (result[key] || 0) + weight / inputs.length;
      }
      output.texture.weights = result;
      calls.push({ pass: pass.name, values });
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve(
    "../plugins/native-fx/smart-motion-blur/shutter.js"), "utf8"), {
    module, require: () => ({ create: () => gl }),
  });
  return { engine: module.exports.create({}, {}, () => ""), calls, disposed,
    allocations: () => allocations };
}

test("shutter reduction preserves all tap weights, including repeated boundary frames", () => {
  for (const count of [32, 64]) {
    const probe = shutterProbe(), output = { texture: {} };
    const input = { width: 960, height: 540, texture: { weights: { current: 1 } } };
    const samples = Array.from({ length: count }, (_, index) => ({
      frame: Math.max(0, index - 16), texture: { weights: { [index]: 1 } },
    }));
    probe.engine.render({}, output, input, samples, [0.5, 0.25]);
    for (let index = 0; index < count; index++) assert.equal(output.texture.weights[index], 1 / count);
    assert.equal(Object.keys(output.texture.weights).length, count);
    assert.equal(probe.calls.length, count / 8 + 1);
    for (const call of probe.calls.slice(0, count / 8))
      assert.deepEqual(Array.from(call.values.uScale), [0.5, 0.25]);
    assert.deepEqual(Array.from(probe.calls.at(-1).values.uScale), [1, 1]);
    const allocations = probe.allocations();
    // A different seek supplies entirely different taps. No previous output is read.
    const replacement = samples.map(sample => ({ ...sample, texture: { weights: { new: 1 } } }));
    probe.engine.render({}, output, input, replacement, [1, 1]);
    assert.deepEqual(output.texture.weights, { new: 1 });
    assert.equal(probe.allocations(), allocations);
    probe.engine.dispose();
    assert.equal(probe.disposed.at(-1), "all");
  }
});

test("missing shutter captures copy the current input without allocating scratch targets", () => {
  const probe = shutterProbe(), output = { texture: {} };
  probe.engine.render({}, output, { texture: { weights: { current: 1 } } }, [], [1, 1]);
  assert.deepEqual(output.texture.weights, { current: 1 });
  assert.equal(probe.allocations(), 0);
});

test("native entry requests fractional scene taps and disposes scratch on mode switches", () => {
  class Scene {}
  const counts = { flow: 0, shutter: 0, flowDisposed: 0, shutterDisposed: 0 };
  let spec, rendered;
  const settings = { amount: 1, sensitivity: 70, smoothness: 100,
    maxDisplacement: 151, analysis: 1, quality: 0, view: 0, reconstruction: 0 };
  const effect = {
    _zoidiumGetAsset() {}, parentLayer: new Scene(),
    _zoidiumFrameSamplerFrame: 7, parentProject: { sequence: {} },
    properties: Object.fromEntries(Object.keys(settings).map(key => [key, { get: () => settings[key] }])),
  };
  effect.properties.load = () => {};
  effect.parentLayer.properties = { resolution: { get: () => [1920, 1080] } };
  effect.parentLayer.tryGetParentOfType = () => ({ start: 40 });
  const factories = Object.fromEntries(["flow", "shutter"].map(mode => [mode, {
    create() {
      counts[mode]++;
      return {
        render(...args) { rendered = { mode, args }; },
        dispose() { counts[mode + "Disposed"]++; },
      };
    },
  }]));
  const PZ = {
    layer: { scene: Scene }, clip: class {}, property: { type: { NUMBER: 0, OPTION: 1 } },
    zoidium: { temporal: { resolveFrameSamples: () => Array.from({ length: 32 },
      (_, index) => ({ frame: 47 + (index + 0.5) / 32 - 0.5, texture: {} })) } },
  };
  const api = {
    gl: {}, modules: { createRequire: () => name => name === "./math.js" ? math
      : factories[name === "./shutter.js" ? "shutter" : "flow"] },
    installFrameSamplerContext,
    defineFrameSampler(value) { spec = value; Object.assign(this, value.lifecycle); },
  };
  const THREE = { Vector2: class { constructor(x, y) { this.x = x; this.y = y; } } };
  new Function("PZ", "THREE", "ZoidiumPluginApis", fs.readFileSync(require.resolve(
    "../plugins/native-fx/effects/smartmotionblur.js"), "utf8")).call(effect, PZ, THREE, api);
  effect.load({});
  assert.deepEqual(spec.getRequest(effect, 7).frames, math.shutterTimes(1, 32));
  effect.pass.uniforms.uvScale.value = { x: 0.5, y: 0.25 };
  effect.pass.render({}, {}, { width: 1024, height: 1024 });
  assert.equal(rendered.mode, "shutter");
  assert.deepEqual(rendered.args[4], [0.5, 0.25]);
  assert.equal(rendered.args[3][0].frame, 47 - 0.5 + 0.5 / 32);
  assert.equal(counts.flowDisposed, 1);
  settings.quality = 1;
  assert.deepEqual(spec.getRequest(effect, 7).frames, math.shutterTimes(1, 64));
  settings.view = 1;
  assert.deepEqual(spec.getRequest(effect, 7).frames, [-1]);
  effect.pass.render({}, {}, { width: 1024, height: 1024 });
  assert.equal(rendered.mode, "flow");
  assert.equal(rendered.args[4], 47);
  assert.equal(counts.flow, 2);
  assert.equal(counts.shutterDisposed, 1);
  settings.sensitivity = 0;
  assert.equal(spec.getRequest(effect, 7).enabled, false);
  effect.unload();
  assert.equal(counts.flowDisposed, 2);
  assert.equal(counts.shutterDisposed, 1);
});
