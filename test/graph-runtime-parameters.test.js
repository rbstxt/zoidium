"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const rt = new Function(fs.readFileSync("plugins/material-plus/graph-runtime.js", "utf8"))()({}, null);
const link = (from, to, toPort) => ({ from, fromPort: "out", to, toPort });
const graph = (nodes, links) => rt.parse({ nodes: [...nodes, rt.createNode("output", "output")], links: [...links, link(nodes.at(-1).id, "output", "color")] });
test("every numeric/color parameter accepts a link; options remain plain", () => {
  for (const [type, def] of Object.entries(rt.types)) for (const p of def.params) {
    if (["number", "color"].includes(p.type)) {
      assert.ok(def.inputs.some(i => i.key === p.key), type + "." + p.key);
      const g = graph([rt.createNode("float", "f"), rt.createNode(type, "n")], [link("f", "n", p.key)]);
      assert.ok(g.links.some(l => l.to === "n" && l.toPort === p.key), type + "." + p.key);
    } else assert.ok(!def.inputs.some(i => i.key === p.key), type + "." + p.key);
  }
});
test("Float 2 divided by .25 drives Gradient Scale X as 8 and disconnect restores 1", () => {
  const f = rt.createNode("float", "f"), m = rt.createNode("math", "m"), g = rt.createNode("gradient", "g");
  f.params.value = 2; m.params.op = 3; m.params.b = .25;
  const driven = graph([f, m, g], [link("f", "m", "a"), link("m", "g", "scaleX")]);
  assert.equal(rt.evaluate(driven, 8, 0, {}, "m").scalar, 8);
  const expected = graph([{ ...g, params: { ...g.params, scaleX: 8 } }], []);
  assert.deepEqual(rt.evaluate(driven, 16, 0, {}).color, rt.evaluate(expected, 16, 0, {}).color);
  driven.links = driven.links.filter(l => l.toPort !== "scaleX");
  assert.deepEqual(rt.evaluate(driven, 16, 0, {}).color, rt.evaluate(graph([g], []), 16, 0, {}).color);
  assert.equal(rt.parse({ nodes: [{ ...f, params: { value: -1e12 } }], links: [] }).nodes[0].params.value, -1e12);
});
test("Math handles every operation and invalid arithmetic without non-finite results", () => {
  const expected = [5, -1, 6, 2/3, 2, 3, 8, 2, 2, -1, 1, 0, Math.sin(2), 2];
  for (let op = 0; op < expected.length; op++) {
    const n = rt.createNode("math", "m"); Object.assign(n.params, { a: 2, b: 3, op });
    assert.equal(rt.evaluate(graph([n], []), 2, 0, {}, "m").scalar, expected[op]);
  }
  for (const [op,a,b] of [[3,2,0],[7,2,0],[6,-1,.5],[6,1e30,1e30]]) {
    const n = rt.createNode("math", "m"); Object.assign(n.params, { a, b, op });
    assert.equal(rt.evaluate(graph([n], []), 2, 0, {}, "m").scalar, 0);
  }
});
test("texture Math and Gradient parameters evaluate per pixel", () => {
  const c = rt.createNode("checker", "c"), m = rt.createNode("math", "m"), g = rt.createNode("gradient", "g");
  m.params.op = 0; m.params.b = 2;
  const gr = graph([c, m, g], [link("c", "m", "a"), link("m", "g", "scaleX")]);
  const math = rt.evaluate(gr, 16, 0, {}, "m");
  assert.equal(Math.min(...math.filter((_,i) => i%4 === 0)), 510);
  assert.equal(Math.max(...math.filter((_,i) => i%4 === 0)), 765);
  const low = rt.evaluate(graph([{ ...g, params: { ...g.params, scaleX: 2 } }], []), 16, 0, {}).color;
  const high = rt.evaluate(graph([{ ...g, params: { ...g.params, scaleX: 3 } }], []), 16, 0, {}).color;
  const expected = new Uint8ClampedArray(low.length);
  for (let i = 0; i < expected.length; i += 4) expected.set((math[i] < 600 ? low : high).subarray(i, i + 4), i);
  assert.deepEqual(rt.evaluate(gr, 16, 0, {}).color, expected);
  const noise = rt.createNode("noise", "noise");
  const uniform = graph([c, m, noise], [link("c", "m", "a"), link("m", "noise", "scale")]);
  const mean = graph([{ ...noise, params: { ...noise.params, scale: 2.5 } }], []);
  assert.deepEqual(rt.evaluate(uniform, 16, 0, {}).color, rt.evaluate(mean, 16, 0, {}).color);
});
test("historical Math migrates to the hidden byte evaluator and stays stable", () => {
  const c = rt.createNode("checker", "c");
  const m = { id: "m", type: "math", params: { op: 2, value: .4 } };
  const gr = graph([c, m], [link("c", "m", "a")]);
  assert.equal(gr.nodes.find(n => n.id === "m").type, "legacyMath");
  assert.deepEqual(rt.parse(gr), gr);
  const expected = rt.types.legacyMath.evaluate(16, { a: rt.types.checker.evaluate(16, {}, c.params) }, { op: 2, value: .4 });
  assert.deepEqual(rt.evaluate(gr, 16, 0, {}).color, expected);
  for (const id of ["invert", "clampTexture", "multiply", "add", "subtract", "compare", "legacyMath"]) assert.equal(rt.types[id].hidden, true);
});
test("connected spectrum and Blackbody controls visibly change pixels", () => {
  for (const [type,key,value] of [["rgbSpectrum","wavelength",650],["gaussianSpectrum","center",650],["blackbody","temperature",15000]]) {
    const f=rt.createNode("float","f"), n=rt.createNode(type,"n"); f.params.value=.3;
    const gr=graph([f,n],[link("f","n","t")]); const before=rt.evaluate(gr,8,0,{}).color;
    gr.nodes.find(n=>n.id==='n').params[key]=value;
    assert.notDeepEqual(rt.evaluate(gr,8,0,{}).color,before,type);
  }
});
test("planar projection rotation changes mapping", () => {
  const n=rt.createNode("projection","p"); const gr=graph([n],[]);
  const before=rt.evaluate(gr,16,0,{}).color; gr.nodes[0].params.rotation=45;
  assert.notDeepEqual(rt.evaluate(gr,16,0,{}).color,before);
});
test("2048 bake retains the full chosen resolution and repeatable seeded noise", () => {
  const n=rt.createNode("noise","n"); n.params.octaves=1;
  const gr=graph([n],[]); const first=rt.evaluate(gr,2048,.25,{}).color;
  assert.equal(first.length,2048*2048*4);
  assert.deepEqual(rt.evaluate(gr,2048,.25,{}).color, first);
});
test("Fresnel shader parameters resolve unclipped numeric connections", () => {
  const f=rt.createNode("float","f"), n=rt.createNode("fresnel","n"); f.params.value=6;
  const gr=graph([f,n],[link("f","n","power"),link("n","output","fresnel")]);
  assert.equal(rt.fresnelSettings(gr).power,6);
});

test("Fresnel texture parameters use the chosen bake resolution and decoded pixels", () => {
  const image = rt.createNode("image", "image"), n = rt.createNode("fresnel", "n"); image.params.asset = "pixel";
  const gr = graph([image, n], [link("image", "n", "color"), link("n", "output", "fresnel")]);
  const pixels = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([255, 0, 0, 255], i);
  assert.deepEqual(rt.evaluate(gr, 16, 0, { images: { pixel: pixels } }).__fresnel.color, [1, 0, 0]);
});

test("color and local brightness fields preserve their per-pixel variation", () => {
  const c = rt.createNode("checker", "c"), color = rt.createNode("color", "color"), correction = rt.createNode("colorCorrection", "correction");
  const first = graph([c, color], [link("c", "color", "color")]);
  assert.deepEqual(rt.evaluate(first, 16, 0, {}).color, rt.evaluate(graph([c], []), 16, 0, {}).color);
  const second = graph([c, correction], [link("c", "correction", "brightness")]);
  assert.deepEqual(rt.evaluate(second, 16, 0, {}).color, rt.evaluate(graph([c], []), 16, 0, {}).color);
});
