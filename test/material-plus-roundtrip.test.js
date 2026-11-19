"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const create = require("../plugins/material-plus/graph-runtime.js");
const plain = value => JSON.parse(JSON.stringify(value));

test("node graph parameters and connections survive repeated serialization", () => {
  const runtime = create({}, null);
  const graph = { nodes: [], links: [] };
  for (const [type, definition] of Object.entries(runtime.types)) {
    const node = runtime.createNode(type, type);
    node.x = 42.5; node.y = -18.25;
    for (const param of definition.params) {
      if (param.type === "number") {
        const candidate = param.value === 0 ? 0.5 : param.value * 0.75;
        node.params[param.key] = Math.max(param.min ?? -Infinity, Math.min(param.max ?? Infinity, candidate));
      } else if (param.type === "option") node.params[param.key] = (param.value + 1) % param.items.length;
      else if (param.type === "color") node.params[param.key] = [0.13, 0.47, 0.81];
      else if (param.type === "asset") node.params[param.key] = "project-image";
      else if (param.type === "ramp") node.params[param.key] = [[0, 0.2, 0.3, 0.4, 1], [1, 0.8, 0.7, 0.6, 0.5]];
      else if (param.type === "curve") node.params[param.key] = JSON.stringify({ version: 1, composite: [[0, 0], [0.5, 0.7], [1, 1]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] });
    }
    graph.nodes.push(node);
  }
  graph.links.push({ from: "noise", fromPort: "out", to: "gradient", toPort: "t" });
  graph.links.push({ from: "gradient", fromPort: "out", to: "output", toPort: "color" });
  const saved = runtime.parse(graph);
  assert.deepEqual(saved.nodes, graph.nodes);
  assert.deepEqual(saved.links, graph.links);
  const duplicate = runtime.parse(plain(saved));
  assert.deepEqual(duplicate, saved);
  assert.deepEqual(runtime.parse(plain(duplicate)), saved);
  for (const frame of [0, 0.25, 1]) {
    assert.deepEqual(runtime.evaluate(duplicate, 8, frame, { images: {} }), runtime.evaluate(saved, 8, frame, { images: {} }));
  }
  duplicate.nodes.find(node => node.id === "color").params.color[0] = 0.99;
  assert.equal(saved.nodes.find(node => node.id === "color").params.color[0], 0.13);
});
