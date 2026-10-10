"use strict";

// Node graph editor: the pure graph operations (normalization, connection
// rules, cycle prevention, id generation, copy/paste remapping, geometry) run
// without a browser, loaded the same way ui-kit.js loads its installers. The
// DOM behavior is verified in a real browser; see the round-2 node editor notes.

const assert = require("node:assert/strict");
// Loose deepEqual: objects built inside the vm context have another realm's prototypes.
const looseAssert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(projectRoot, "zoidium", "ui-node-editor.js");
const cssPath = path.join(projectRoot, "zoidium", "ui-node-editor.css");

function loadModule() {
  const source = fs.readFileSync(scriptPath, "utf8");
  const context = { console };
  context.window = context;
  vm.runInNewContext(source, context);
  const queued = context.ZoidiumUIModules;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].name, "node-editor");
  return queued[0].install({});
}

const { nodeEditor } = loadModule();
const tools = nodeEditor.graphTools;

const nodeTypes = {
  noise: {
    title: "Noise",
    category: "Texture",
    inputs: [
      { id: "uv", label: "UV", type: "vector" },
      { id: "scale", label: "Scale", type: "float", default: 4 },
    ],
    outputs: [
      { id: "value", label: "Value", type: "float" },
      { id: "color", label: "Color", type: "color" },
    ],
    params: [{ id: "octaves", label: "Octaves", control: "number", min: 1, max: 8, step: 1, default: 4 }],
  },
  mix: {
    title: "Mix",
    category: "Color",
    inputs: [
      { id: "a", label: "A", type: "color" },
      { id: "b", label: "B", type: "color" },
    ],
    outputs: [{ id: "out", label: "Out", type: "color" }],
  },
  toVector: {
    title: "To Vector",
    category: "Math",
    inputs: [{ id: "value", label: "Value", type: "float" }],
    outputs: [{ id: "vec", label: "Vector", type: "vector" }],
  },
  output: {
    title: "Output",
    category: "Output",
    maxInstances: 1,
    deletable: false,
    inputs: [{ id: "color", label: "Color", type: "color" }],
    outputs: [],
  },
};

const types = tools.normalizeTypes(nodeTypes);

function link(id, fromNode, fromPort, toNode, toPort) {
  return { id, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

test("module installs a frozen graph toolset and an editor factory", () => {
  assert.equal(typeof nodeEditor, "function");
  assert.ok(Object.isFrozen(tools));
  for (const name of ["normalizeGraph", "connectLinks", "addNode", "insertFragment", "copyFragment"]) {
    assert.equal(typeof tools[name], "function", name);
  }
});

test("normalizeGraph never throws on malformed input", () => {
  for (const raw of [null, undefined, "graph", 42, [1, 2], { nodes: "bad", links: 7 }, { nodes: [null, "x"], links: [{}] }]) {
    const graph = tools.normalizeGraph(raw, types);
    looseAssert.deepEqual(graph.nodes, []);
    looseAssert.deepEqual(graph.links, []);
  }
});

test("normalizeGraph drops links to unknown nodes or ports and keeps the first link per input", () => {
  const graph = tools.normalizeGraph({
    nodes: [
      { id: "n1", type: "noise", x: 0, y: 0 },
      { id: "n2", type: "mix", x: 200, y: 0 },
      { id: "n3", type: "mix", x: 200, y: 100 },
    ],
    links: [
      link("l1", "n1", "color", "n2", "a"),
      link("l2", "n3", "out", "n2", "a"), // second link into the same input
      link("l3", "n1", "missing", "n2", "b"), // unknown output port
      link("l4", "n9", "out", "n2", "b"), // unknown node
      link("l5", "n1", "color", "n1", "uv"), // self link
    ],
  }, types);
  looseAssert.deepEqual(graph.links.map((item) => item.id), ["l1"]);
});

test("normalizeGraph keeps links into and out of unknown node types", () => {
  const graph = tools.normalizeGraph({
    nodes: [
      { id: "n1", type: "noise", x: 0, y: 0 },
      { id: "m1", type: "retired-node", x: 300, y: 0, params: { keep: [1, 2] } },
    ],
    links: [link("l1", "n1", "value", "m1", "anything")],
  }, types);
  assert.equal(graph.links.length, 1);
  const missing = graph.nodes.find((node) => node.id === "m1");
  assert.equal(missing.type, "retired-node");
  looseAssert.deepEqual(missing.params, { keep: [1, 2] });
});

test("normalizeGraph drops links that would close a cycle and assigns unique ids", () => {
  const graph = tools.normalizeGraph({
    nodes: [
      { id: "a", type: "mix", x: 0, y: 0 },
      { id: "a", type: "mix", x: 50, y: 0 },
      { id: "b", type: "mix", x: 100, y: 0 },
    ],
    links: [
      { from: { node: "a", port: "out" }, to: { node: "b", port: "a" } },
      { from: { node: "b", port: "out" }, to: { node: "a", port: "a" } },
    ],
  }, types);
  const ids = graph.nodes.map((node) => node.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(graph.links.length, 1);
  assert.equal(new Set(graph.links.map((item) => item.id)).size, graph.links.length);
});

test("connection rules follow same-type, float-to-any and color/vector compatibility", () => {
  const graph = tools.normalizeGraph({
    nodes: [
      { id: "n1", type: "noise", x: 0, y: 0 },
      { id: "m1", type: "mix", x: 300, y: 0 },
      { id: "v1", type: "toVector", x: 300, y: 200 },
    ],
    links: [],
  }, types);
  // float -> color input is allowed (float converts to any type).
  assert.equal(tools.connectionError(graph, types, { node: "n1", port: "value" }, { node: "m1", port: "a" }), null);
  // color -> vector is allowed.
  assert.equal(tools.connectionError(graph, types, { node: "n1", port: "color" }, { node: "n1", port: "uv" }), "A node cannot connect to itself");
  // vector -> float is refused.
  const refused = tools.connectionError(graph, types, { node: "v1", port: "vec" }, { node: "n1", port: "scale" });
  assert.equal(refused, "Incompatible types");
  // color output -> float input is refused by default.
  assert.equal(tools.connectionError(graph, types, { node: "m1", port: "out" }, { node: "v1", port: "value" }), "Incompatible types");
  // A custom canConnect replaces the default rules.
  assert.equal(tools.connectionError(graph, types, { node: "v1", port: "vec" }, { node: "n1", port: "scale" }, () => true), null);
});

test("connectLinks replaces the link into an input and refuses cycles", () => {
  let graph = tools.normalizeGraph({
    nodes: [
      { id: "n1", type: "noise", x: 0, y: 0 },
      { id: "m1", type: "mix", x: 300, y: 0 },
      { id: "m2", type: "mix", x: 600, y: 0 },
    ],
    links: [link("l1", "m1", "out", "m2", "a")],
  }, types);
  let counter = 0;
  const makeId = (prefix) => `${prefix}x${++counter}`;

  const replaced = tools.connectLinks(graph, types,
    { node: "n1", port: "color" }, { node: "m2", port: "a" }, { makeId });
  assert.equal(replaced.error, undefined);
  assert.equal(replaced.removed.id, "l1");
  looseAssert.deepEqual(replaced.graph.links.map((item) => item.from.node), ["n1"]);

  // m2 feeds m1 after this link, so m1 -> m2 would close a loop only if m2 already reached m1.
  graph = tools.connectLinks(graph, types, { node: "m2", port: "out" }, { node: "m1", port: "a" }, { makeId });
  assert.equal(graph.error, "Would create a cycle");

  const selfLink = tools.connectLinks(replaced.graph, types, { node: "m1", port: "out" }, { node: "m1", port: "b" }, { makeId });
  assert.equal(selfLink.error, "A node cannot connect to itself");
});

test("wouldCreateCycle follows downstream links only", () => {
  const links = [link("l1", "a", "out", "b", "in"), link("l2", "b", "out", "c", "in")];
  assert.equal(tools.wouldCreateCycle(links, "c", "a"), true);
  assert.equal(tools.wouldCreateCycle(links, "a", "c"), false);
  assert.equal(tools.wouldCreateCycle(links, "a", "a"), true);
});

test("id maker never reuses an existing id and keeps counting across calls", () => {
  const counter = { n: 0 };
  const makeId = tools.createIdMaker(["n1", "n2", "l3"], counter);
  assert.equal(makeId("n"), "n3");
  assert.equal(makeId("n"), "n4");
  assert.equal(makeId("l"), "l5");
  assert.equal(counter.n, 5);
});

test("addNode respects maxInstances and seeds parameter and input defaults", () => {
  const makeId = tools.createIdMaker([], { n: 0 });
  const empty = { nodes: [], links: [] };
  const first = tools.addNode(empty, types, "output", 10.4, 20.6, makeId);
  assert.equal(first.error, undefined);
  assert.equal(first.node.x, 10);
  assert.equal(first.node.y, 21);
  const second = tools.addNode(first.graph, types, "output", 0, 0, makeId);
  assert.match(second.error, /Only 1 allowed/);

  const noise = tools.addNode(first.graph, types, "noise", 0, 0, makeId);
  looseAssert.deepEqual(noise.node.params, { octaves: 4, scale: 4 });
  assert.equal(tools.addNode(first.graph, types, "missing", 0, 0, makeId).error, "Unknown node type");
});

test("removeNodes drops links that touch the removed nodes; removeLinks keeps nodes", () => {
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    links: [link("l1", "a", "out", "b", "in"), link("l2", "b", "out", "c", "in")],
  };
  const pruned = tools.removeNodes(graph, new Set(["b"]));
  looseAssert.deepEqual(pruned.nodes.map((node) => node.id), ["a", "c"]);
  looseAssert.deepEqual(pruned.links, []);
  const cut = tools.removeLinks(graph, new Set(["l1"]));
  assert.equal(cut.nodes.length, 3);
  looseAssert.deepEqual(cut.links.map((item) => item.id), ["l2"]);
});

test("copy and paste remap ids, keep internal links, drop external ones and respect maxInstances", () => {
  const graph = tools.normalizeGraph({
    nodes: [
      { id: "n1", type: "noise", x: 0, y: 0, params: { octaves: 2 } },
      { id: "m1", type: "mix", x: 240, y: 0 },
      { id: "o1", type: "output", x: 480, y: 0 },
    ],
    links: [link("l1", "n1", "color", "m1", "a"), link("l2", "m1", "out", "o1", "color")],
  }, types);
  const fragment = tools.copyFragment(graph, new Set(["n1", "m1"]));
  looseAssert.deepEqual(fragment.links.map((item) => item.id), ["l1"]);

  const snapshot = JSON.stringify(fragment);
  const pasted = tools.insertFragment(graph, types, fragment, 20, 20, tools.createIdMaker(
    graph.nodes.map((node) => node.id).concat(graph.links.map((item) => item.id)),
    { n: 0 }));
  assert.equal(JSON.stringify(fragment), snapshot, "the fragment is not mutated");
  assert.equal(pasted.nodeIds.length, 2);
  for (const id of pasted.nodeIds) assert.ok(!["n1", "m1"].includes(id));
  const newLink = pasted.graph.links[pasted.graph.links.length - 1];
  assert.ok(pasted.nodeIds.includes(newLink.from.node));
  assert.ok(pasted.nodeIds.includes(newLink.to.node));
  assert.equal(pasted.graph.nodes.find((node) => node.id === pasted.nodeIds[0]).x, 20);
  assert.equal(pasted.graph.links.length, 3);

  // The output node is already present, so pasting a second one is skipped.
  const withOutput = tools.insertFragment(graph, types,
    tools.copyFragment(graph, new Set(["o1"])), 0, 0, tools.createIdMaker([], { n: 100 }));
  looseAssert.deepEqual(withOutput.nodeIds, []);
});

test("bezier geometry starts and ends on the sockets and knife crossings are detected", () => {
  assert.equal(tools.linkPathD(0, 0, 100, 50), "M0 0 C50 0 50 50 100 50");
  const curve = tools.bezierPoints(0, 0, 100, 50, 8);
  looseAssert.deepEqual(curve[0], { x: 0, y: 0 });
  assert.ok(Math.abs(curve[8].x - 100) < 1e-9 && Math.abs(curve[8].y - 50) < 1e-9);

  const across = [{ x: 50, y: -100 }, { x: 50, y: 100 }];
  assert.equal(tools.polylinesCross(across, curve), true);
  const above = [{ x: 0, y: -100 }, { x: 100, y: -100 }];
  assert.equal(tools.polylinesCross(above, curve), false);

  looseAssert.deepEqual(tools.rectFromPoints({ x: 10, y: 0 }, { x: 0, y: 20 }), { x: 0, y: 0, w: 10, h: 20 });
  assert.equal(tools.rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 }), true);
  assert.equal(tools.rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 5, h: 5 }), false);
});

test("tints are deterministic per category and type colors are fixed", () => {
  assert.equal(tools.tintForCategory("Texture"), tools.tintForCategory("Texture"));
  assert.match(tools.tintForCategory("Texture"), /^hsl\(\d+ 34% 34%\)$/);
  assert.equal(tools.colorFor("float"), "#a0a0a0");
  assert.equal(tools.colorFor("vector"), "#8176dd");
  assert.equal(tools.colorFor("color"), "#dcc44e");
});

test("every stylesheet selector is scoped to the node editor", () => {
  const css = fs.readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [];
  const rule = /([^{}]+)\{/g;
  let match;
  while ((match = rule.exec(css))) {
    for (const part of match[1].split(",")) {
      const selector = part.trim();
      if (selector) selectors.push(selector);
    }
  }
  assert.ok(selectors.length > 20);
  for (const selector of selectors) {
    assert.ok(selector.startsWith(".zoidium-node-editor"), selector);
  }
});

test("the editor listens on its own element, never on the global window", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(source, /(global|window)\.addEventListener\(\s*["'](keydown|keyup|keypress)/);
  assert.doesNotMatch(source, /\bwindow\.open\b/);
});
