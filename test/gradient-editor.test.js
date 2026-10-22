"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const current = require("../plugins/shader-plus/bake.js");
// Frozen Zoidium-owned fba4870 implementation, independent of the new bake.
const legacy = require("./fixtures/shader-plus-legacy-bake.cjs");
const M = require("../zoidium/gradient-model.js");
const curves = require("../plugins/material-plus/graph-curves.js");
let seed = 576;
const random = () => { seed = (Math.imul(seed, 1664525)+1013904223) >>> 0; return seed/4294967296; };
test("3000 legacy gradients retain every baked byte across modes and spaces", () => {
  for (let i = 0; i < 3000; i++) {
    const stops = Array.from({ length: 1+Math.floor(random()*9) }, () => ({ position: random(), color: Array.from({ length: 4 }, random) }));
    if (i%9 === 0) stops.push({ position: stops[0].position, color: "rgba(50.12, 90, 244, 0.35)" });
    const options = { cyclic: random() > .5, interpolation: ["linear", "constant", "ease", "cardinal"][i%4], space: ["srgb", "linear", "oklab"][i%3] };
    assert.deepEqual(current.bakeGradient(stops, options), legacy.bakeGradient(stops, options), String(i));
  }
});
test("1000 legacy curves retain integer and floating point bake bytes", () => {
  for (let i = 0; i < 1000; i++) {
    const points = () => Array.from({ length: 2+Math.floor(random()*12) }, () => [random(), random()]);
    const raw = JSON.stringify({ points: points(), ...(i%2 ? { composite: points() } : {}), red: points(), green: points(), blue: points(), alpha: points(), channels: i%3 ? "single" : "rgba", range: [-3, 90] });
    for (const half of [false, true]) assert.deepEqual(current.bakeCurve(raw, curves, half), legacy.bakeCurve(raw, curves, half));
  }
});
test("midpoints remap color and independent opacity without premultiplying", () => {
  const stops = [{ position: 0, color: [0, 0, 0, 1], midpoint: .25 }, { position: 1, color: [1, 1, 1, 1] }];
  const data = current.bakeGradient(stops, { opacityStops: [{ position: 0, alpha: 0, midpoint: .25 }, { position: 1, alpha: 1 }] });
  assert.ok(Math.abs(data[64*4]-128) <= 1); assert.equal(data[64*4], data[64*4+3]);
  const zeroAlpha = current.bakeGradient(stops, { opacityStops: [{ position: 0, alpha: 0 }] });
  assert.equal(zeroAlpha[255*4], 255); assert.equal(zeroAlpha[255*4+3], 0);
  assert.deepEqual(current.bakeGradient(stops.map(s => ({ ...s, midpoint: .5 }))), legacy.bakeGradient(stops));
});
test("reversing twice preserves stop ownership and native fractional colors", () => {
  const stops = [{ position: 0, color: "rgba(12.3456, 2, 3, 0.125)", midpoint: .2 }, { position: .4, color: [1, 0, 0, 1], midpoint: .75 }, { position: 1, color: "rgba(1, 2, 3, 1)" }];
  const result = M.reverse(M.reverse(stops));
  result.forEach((s, i) => { assert.equal(s.color.toString(), stops[i].color.toString()); assert.ok(Math.abs(s.position-stops[i].position) < 1e-12); if (i<2) assert.ok(Math.abs(s.midpoint-stops[i].midpoint) < 1e-12); });
  assert.equal(stops[0].color, "rgba(12.3456, 2, 3, 0.125)");
});
test("cycle repetitions bind only known samplers and retain explicit arguments", () => {
  const { bindGradientCycles } = require("../plugins/shader-plus/glsl-library.js");
  const src = "precision highp float;\n// zGradientCycle(Ramp,t)\nvec4 f(){return zGradientCycle(Ramp,max(a,b))+zGradientCycle(Other,t)+zGradientCycle(Ramp,t,3.);}";
  const bound = bindGradientCycles(src, new Set(["Ramp"]));
  assert.match(bound, /uniform float Ramp_repetitions;/);
  assert.match(bound, /max\(a,b\), Ramp_repetitions/);
  assert.match(bound, /zGradientCycle\(Other,t\)/); assert.match(bound, /zGradientCycle\(Ramp,t,3\.\)/);
  assert.equal(bindGradientCycles(src, new Set()), src);
  assert.equal(bindGradientCycles(bound, new Set(["Ramp"])), bound);
});
test("explicit curve handles alter only their segment and preserve range and storage", () => {
  const { createGraphSampler, pointsWithHandles } = require("../plugins/shader-plus/curve-math.js");
  const points = [[0, 0], [.5, .5, null, { in: [.45, .1] }], [1, 1]], input = JSON.stringify(points);
  const sample = createGraphSampler(points, curves), old = curves.createSampler(points);
  assert.notEqual(sample(.25), old(.25)); assert.equal(sample(.75), old(.75));
  assert.equal(sample(0), 0); assert.equal(sample(.5), .5); assert.equal(sample(1), 1);
  const value = JSON.stringify({ points, range: [0, 100] });
  assert.deepEqual(current.parseCurve(value, curves).composite, pointsWithHandles(points, curves));
  assert.notDeepEqual(current.bakeCurve(value, curves), legacy.bakeCurve(value, curves));
  assert.equal(JSON.stringify(points), input);
  for (let i = 0; i < 1000; i++) { const y = sample(i/999); assert.ok(Number.isFinite(y) && y >= 0 && y <= 1); }
});
test("crossing and invalid curve handles produce bounded deterministic samples", () => {
  const { createGraphSampler } = require("../plugins/shader-plus/curve-math.js");
  for (const handles of [{ out: [1, 1] }, { out: [Infinity, 0] }, { out: [-20, -2] }]) {
    const points = [[0, 0, null, handles], [1, 1, null, { in: [0, 1] }]], sample = createGraphSampler(points, curves);
    for (let i = 0; i <= 100; i++) { const y = sample(i/100); assert.ok(Number.isFinite(y) && y >= 0 && y <= 1); assert.equal(sample(i/100), y); }
  }
});
test("native additions retain classic byte arithmetic and exact RGBA text", () => {
  const stops = [{ position: 0, color: "rgba(12.3456, 32.1, 250.2, 0.125)" }, { position: 1, color: "rgba(1.2, 200.3, 50.9, 0.9)" }];
  for (const t of [.01, .125, .3, .5, .9]) {
    const a = [12.3456, 32.1, 250.2, .125], b = [1.2, 200.3, 50.9, .9];
    const expected = "rgba("+a.map((x, i) => x+t*(b[i]-x)).join(", ")+")";
    assert.equal(M.nativeSample(stops, t), expected);
  }
  assert.equal(M.nativeSample(stops, 0), stops[0].color);
});
test("Shape+ facade snapshots isolate held keys and follow the current local frame", () => {
  const { gradientFacade } = require("../plugins/shape-plus/runtime.js");
  const held = [{ position: 0, color: "rgba(20,220,80,1)" }, { position: 1, color: "rgba(120,40,220,1)" }];
  let frame = 45, write;
  class Property {
    constructor() { this.definition = { type: 5, zoidiumControl: "shape-plus/gradient" }; }
    get() { return held; }
    set(value, local) { write = { value, local }; }
    getAddress() { assert.ok(this instanceof Property); return [2, 4]; }
  }
  const property = new Property(), facade = gradientFacade(property, () => frame);
  const value = facade.get(); value[0].position = .3;
  assert.equal(held[0].position, 0, "the classic picker cannot mutate a preceding held key");
  facade.set(value); assert.equal(write.local, 45); assert.equal(write.value[0].position, .3);
  frame = 60; facade.set(value); assert.equal(write.local, 60);
  assert.deepEqual(facade.getAddress(), [2, 4]); assert.equal(facade.definition.zoidiumControl, undefined); assert.equal(property.definition.zoidiumControl, "shape-plus/gradient");
});
test("cyclic reversal retains the wrap midpoint and independent alpha wraps with one color", () => {
  const stops = [{ position: .2, color: [1, 0, 0, 1], midpoint: .25 }, { position: .7, color: [0, 1, 0, 1], midpoint: .8 }];
  const twice = M.reverse(M.reverse(stops, true), true);
  twice.forEach((s, i) => { assert.ok(Math.abs(s.midpoint-stops[i].midpoint) < 1e-12); });
  const alpha = [{ position: .2, alpha: 0 }, { position: .8, alpha: 1 }];
  const data = current.bakeGradient([{ position: 0, color: [1, 0, 0, 1] }], { cyclic: true, opacityStops: alpha });
  assert.equal(data[3], data[data.length-1]); assert.ok(data[3] > 0 && data[3] < 255);
});
test("native stop addition also samples normalized preset colors", () => {
  assert.equal(M.nativeSample([{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }], .5), "rgba(127.5, 127.5, 127.5, 1)");
});
