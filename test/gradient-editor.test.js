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
