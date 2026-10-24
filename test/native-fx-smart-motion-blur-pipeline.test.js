"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const math = require("../plugins/native-fx/smart-motion-blur/math.js");

function probe(statistics) {
  const calls = [], module = { exports: {} };
  const gl = {
    pass: name => ({ name }),
    target: (width, height) => ({ width, height, texture: {} }),
    clearTargets() {}, selectStorage: () => "rgba8", preserve: (_renderer, fn) => fn(),
    draw: (_renderer, pass, target, values) => calls.push({ name: pass.name, target, values }),
  };
  const flow = { size: [4, 4], allocate() {}, buildPyramid() { calls.push({ name: "pyramid" }); },
    solve() { calls.push({ name: "solve" }); return {}; }, analyze: () => ({ texture: {} }) };
  const modules = {
    "./math.js": math, "./gl.js": { create: () => gl }, "./flow.js": { create: () => flow },
    "./global.js": { create: () => ({ allocate() {}, apply: (_r, _g, _s, _src, fields) => fields, accepted: {} }) },
    "./reconstruction.js": { create: () => ({ allocate() {}, render() { calls.push({ name: "blur" }); } }) },
  };
  const source = fs.readFileSync(require.resolve("../plugins/native-fx/smart-motion-blur/pipeline.js"), "utf8");
  vm.runInNewContext(source, { module, require: name => modules[name], Uint8Array });
  const pipeline = module.exports.create({}, {}, () => "");
  let reads = 0;
  const renderer = { readRenderTargetPixels(_t, _x, _y, _w, _h, bytes) { bytes.set(statistics[reads++]); } };
  function render(settings = {}, neighbors = [{ frame: 9, texture: {} }, { frame: 11, texture: {} }]) {
    pipeline.render(renderer, {}, { width: 8, height: 8, texture: {} }, neighbors,
      10, [8, 8], [1, 1], { amount: 0.5, sensitivity: 100, maxDisplacement: 256, quality: 0, ...settings }, true);
  }
  return { calls, pipeline, render, reads: () => reads };
}

test("exactly static input reduces source difference before any optical flow work", () => {
  const p = probe([[0, 0, 0, 0]]);
  p.render();
  assert.deepEqual(p.calls.map(c => c.name), ["difference", "reduce", "reduce", "copy"]);
  assert.equal(p.reads(), 1);
  assert.equal(p.pipeline.diagnostics.static, true);
  assert.equal(p.pipeline.diagnostics.readbacks, 1);
});

test("moving input retains one final statistics reduction plus the early probe", () => {
  const p = probe([[0, 0, 0, 1], [0, 0, 20, 1]]);
  p.render();
  assert.equal(p.reads(), 2);
  assert.equal(p.calls.filter(c => c.name === "solve").length, 4);
  assert.equal(p.calls.filter(c => c.name === "blur").length, 1);
  assert.equal(p.calls.filter(c => c.name === "difference").length, 2);
  assert.equal(p.calls.findIndex(c => c.name === "pyramid"), 3);
  assert.equal(p.pipeline.diagnostics.readbacks, 3, "includes the registration readback owned by global.apply");
});

test("amount zero and duplicate-only boundary taps still copy without a readback", () => {
  for (const [settings, neighbors] of [[{ amount: 0 }, undefined], [{}, [{ frame: 10 }, { frame: 10 }]]]) {
    const p = probe([]);
    p.render(settings, neighbors);
    assert.deepEqual(p.calls.map(c => c.name), ["copy"]);
    assert.equal(p.reads(), 0);
  }
});


test("scene cuts retain flow statistics and skip reconstruction", () => {
  const p = probe([[0, 0, 0, 255], [255, 0, 255, 255]]);
  p.render();
  assert.equal(p.calls.filter(c => c.name === "solve").length, 4);
  assert.equal(p.calls.filter(c => c.name === "blur").length, 0);
  assert.equal(p.calls.at(-1).name, "copy");
  assert.equal(p.pipeline.diagnostics.sceneCut, true);
});

test("one-sided moving boundary taps keep mirrored flow without registration", () => {
  const p = probe([[0, 0, 0, 1], [0, 0, 20, 1]]);
  p.render({}, [{ frame: 11, texture: {} }]);
  assert.equal(p.calls.filter(c => c.name === "solve").length, 2);
  assert.equal(p.calls.filter(c => c.name === "blur").length, 1);
  assert.equal(p.pipeline.diagnostics.readbacks, 2);
});
