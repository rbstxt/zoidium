"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const source = fs.readFileSync(require.resolve("../plugins/material-plus/graph-runtime.js"), "utf8");
const create = new Function(source)();
const nodes = create({}, null);
// Goldens captured independently from the OpenZoid evaluator with connected input buffers.
const golden = require("../plugins/material-plus/node-golden.json");
const hash = pixels => pixels ? crypto.createHash("sha256").update(pixels).digest("hex") : null;
for (const id of Object.keys(nodes.types).filter(id => id !== "math")) test(`OpenZoid ${id} small-resolution golden`, () => {
  const node = nodes.createNode(id, "n");
  const input = new Uint8ClampedArray(8 * 8 * 4);
  for (let i = 0; i < input.length; i += 4) { input[i] = i % 256; input[i + 1] = 255 - i % 256; input[i + 2] = 128; input[i + 3] = 255; }
  const def = nodes.types[id];
  const inputs = Object.fromEntries(def.inputs.map(p => [p.key, input]));
  assert.equal(hash(def.evaluate?.(8, inputs, node.params, .5, { images: {} })), golden[id === "legacyMath" ? "math" : id]);
});
test("all historical types remain available alongside the new Math", () => assert.equal(Object.keys(nodes.types).length, 32));
test("animated noise is independent of seek order", () => {
  for (const type of ["noise", "ridgedFractal", "turbulence", "marble", "dirt"]) {
    const node = nodes.createNode(type, "n"); node.params.speedX = 1;
    const graph = nodes.parse({ nodes: [node, { id: "output", type: "output" }], links: [{ from: "n", fromPort: "out", to: "output", toPort: "color" }] });
    if (nodes.types[type].params.some(p => p.key === "speedX")) assert.ok(nodes.isAnimated(graph), type);
    const cold = hash(nodes.evaluate(graph, 16, .05, {}).color);
    for (const time of [1, 0, .1, -2, .05]) nodes.evaluate(graph, 16, time, {});
    assert.equal(hash(nodes.evaluate(graph, 16, .05, {}).color), cold, type);
  }
});
test("cache key includes graph, resolution, frame and asset revisions", () => {
  const graph = nodes.defaultGraph(); const key = nodes.cacheKey(graph, 128, 1, [["asset", 0]]);
  assert.notEqual(key, nodes.cacheKey(graph, 256, 1, [["asset", 0]]));
  assert.notEqual(key, nodes.cacheKey(graph, 128, 1.5, [["asset", 0]]));
  assert.notEqual(key, nodes.cacheKey(graph, 128, 1, [["asset", 1]]));
  graph.nodes[0].params.seed++;
  assert.notEqual(key, nodes.cacheKey(graph, 128, 1, [["asset", 0]]));
});
test("schema parser bounds graphs, validates ports and refuses cycles", () => {
  assert.equal(nodes.parse("broken").schemaVersion, 1);
  const graph = nodes.parse({ nodes: [{ id: "a", type: "invert" }, { id: "b", type: "invert" }, { id: "a", type: "noise" }, { id: "__proto__", type: "__proto__" }], links: [{ from: "a", fromPort: "out", to: "b", toPort: "a" }, { from: "b", fromPort: "out", to: "a", toPort: "a" }, { from: "a", fromPort: "missing", to: "b", toPort: "a" }] });
  assert.equal(graph.nodes.length, 2); assert.equal(graph.links.length, 1);
  assert.equal(nodes.parse({ nodes: Array.from({ length: 300 }, (_, i) => ({ id: "n" + i, type: "color" })), links: [] }).nodes.length, 200);
  const image = nodes.parse({ nodes: [{ id: "image", type: "image", params: { asset: "https://external/image.png" } }], links: [] });
  assert.equal(image.nodes[0].params.asset, "");
});
test("images await decoding, isolate material state and release references", async () => {
  let finish; const loading = new Promise(resolve => { finish = resolve; }); let unloaded = 0;
  const runtime = create({ asset: { image: class { constructor() { this.loading = loading; } getImage() { return { width: 8, height: 8 }; } } } }, null);
  const project = { assets: { load: key => ({ key }), unload: () => unloaded++ } };
  const first = { parentProject: project }, second = { parentProject: project };
  const graph = runtime.parse({ nodes: [{ id: "image", type: "image", params: { asset: "project-image" } }], links: [] });
  let done = false; const prepare = runtime.prepareImages(graph, first).then(() => { done = true; });
  await Promise.resolve(); assert.equal(done, false);
  finish(); await prepare;
  assert.notEqual(runtime.getImageCache(first), runtime.getImageCache(second));
  assert.deepEqual(runtime.dependencySignature(graph, first), [["project-image", 1]]);
  runtime.releaseImages(first); assert.equal(unloaded, 1);
});
test("decoded GIF frames are selected by requested time without mutating shared GIF state", () => {
  let drawn;
  const runtime = create({}, { createElement() { const canvas = {}; canvas.getContext = () => ({ drawImage(image) { drawn = image; }, getImageData() { return { data: new Uint8ClampedArray(16) }; } }); return canvas; } });
  const material = {};
  const frames = [{ canvas: { index: 0 } }, { canvas: { index: 1 } }];
  const gif = { frames, cumulative: [.1, .3], total: .3, current: 0 };
  runtime.getImageCache(material).asset = { canvas: frames[0].canvas, loaded: { data: { gif } } };
  const graph = runtime.parse({ nodes: [{ id: "image", type: "image", params: { asset: "asset" } }], links: [] });
  for (const [time, index] of [[.2, 1], [0, 0], [-.05, 1], [.2, 1]]) { runtime.imageBuffers(graph, 2, material, time); assert.equal(drawn.index, index); }
  assert.equal(gif.current, 0);
  assert.ok(runtime.isAnimated(graph, material));
});
