"use strict";

// Characterization net for the graph-runtime split: pins evaluation output
// (hashes), the type registry, and parser normalization. The loader tries
// plain require first (split CommonJS entry) and falls back to direct
// evaluation (original single-file factory body), so this file passes both
// before and after the split without changes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");

const entryPath = "../plugins/material-plus/graph-runtime.js";
let create;
try {
  create = require(entryPath);
  if (typeof create !== "function") throw new Error("not a factory");
} catch (_error) {
  const source = fs.readFileSync(require.resolve(entryPath), "utf8");
  create = new Function(source)();
}

const nodes = create({}, null);
const hash = (pixels) => pixels ? crypto.createHash("sha256").update(Buffer.from(pixels)).digest("hex") : null;

test("split entry exposes the full node runtime", () => {
  assert.equal(typeof create, "function");
  assert.equal(Object.keys(nodes.types).length, 32);
  for (const key of ["parse", "evaluate", "cacheKey", "createNode", "defaultGraph", "findLink", "fresnelSettings", "isAnimated"]) {
    assert.equal(typeof nodes[key], "function", key);
  }
});

test("default graph bakes pinned pixels", () => {
  const outputs = nodes.evaluate(nodes.defaultGraph(), 16, 0.25, {});
  assert.equal(hash(outputs.color), "789a77bcd4f067b76b55a1672dc406321d8e595a9351e8641cfb2516473521fc");
  assert.equal(hash(outputs.bump), "ee4b3fd9b7545ad39d561e4e22b3a48059e95cb2048f9b8d12a9a486b562f0d0");
});

test("marble into gradient bakes pinned pixels", () => {
  const marble = nodes.createNode("marble", "m");
  marble.params.seed = 3;
  const gradient = nodes.createNode("gradient", "gr");
  const graph = nodes.parse({
    nodes: [marble, gradient, nodes.createNode("output", "o")],
    links: [
      { from: "m", fromPort: "out", to: "gr", toPort: "t" },
      { from: "gr", fromPort: "out", to: "o", toPort: "color" },
    ],
  });
  assert.equal(hash(nodes.evaluate(graph, 16, 0.5, {}).color), "725ca428c9f4dca6eb3bd88fb66ec1c6f96b7ecab04124543923bfd12ff0e5dc");
});

test("parser output is stable for identical input", () => {
  const source = JSON.stringify(nodes.defaultGraph());
  assert.deepEqual(nodes.parse(source), nodes.parse(source));
  assert.deepEqual(nodes.parse(nodes.parse(source)), nodes.parse(source));
});
