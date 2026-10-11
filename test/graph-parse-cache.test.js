"use strict";

// Fix test for A6: nodes.parse caches by source string so per-frame updates
// parse identical graph JSON once, with identical output.

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

test("identical source strings parse once with identical output", () => {
  const source = JSON.stringify(nodes.defaultGraph());
  const first = nodes.parse(source);
  const second = nodes.parse(source);
  assert.equal(second, first, "same source returns the cached graph");
  assert.deepEqual(second, first);
  assert.equal(hash(nodes.evaluate(first, 16, 0.25, {}).color), hash(nodes.evaluate(second, 16, 0.25, {}).color));
  assert.equal(hash(nodes.evaluate(source, 16, 0.25, {}).color), "789a77bcd4f067b76b55a1672dc406321d8e595a9351e8641cfb2516473521fc");
});

test("object inputs still parse fresh on every call", () => {
  const input = nodes.defaultGraph();
  assert.notEqual(nodes.parse(input), nodes.parse(input));
  assert.deepEqual(nodes.parse(input), nodes.parse(input));
});

test("the parse cache stays bounded without changing output", () => {
  const firstSource = JSON.stringify(nodes.defaultGraph());
  const expected = nodes.parse(firstSource);
  for (let seed = 0; seed < 80; seed++) {
    const graph = nodes.defaultGraph();
    graph.nodes[0].params.seed = seed;
    nodes.parse(JSON.stringify(graph));
  }
  assert.deepEqual(nodes.parse(firstSource), expected);
});
