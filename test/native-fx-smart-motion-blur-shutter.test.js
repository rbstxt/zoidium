"use strict";
const test = require("node:test");
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
