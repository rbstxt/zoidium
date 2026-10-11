"use strict";

// Characterization of the node graph editor: the pure geometry helpers and
// the DOM render output for a fixed graph. The scripts load in
// zoidium/runtime-config.js order, so these pins hold before and after the
// ui-node-editor.js split without changes. The fake DOM reports zero sizes,
// so every socket anchors at its node's top-left and the link paths are
// exactly what the pure linkPathD helper returns for the node positions.

// Loose deepEqual: objects built inside the vm context have another realm's prototypes.
const looseAssert = require("node:assert");
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { nodeEditorScripts, readScript } = require("./uikit-files");
const { makeDocument } = require("./fake-dom");

const nodeTypes = {
  noise: {
    title: "Noise",
    category: "Texture",
    inputs: [
      { id: "uv", label: "UV", type: "vector" },
      { id: "scale", label: "Scale", type: "float", default: 4 },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
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
    params: [],
  },
};

const graph = {
  nodes: [
    { id: "n1", type: "noise", x: 10, y: 20, params: {} },
    { id: "n2", type: "mix", x: 150, y: 40, params: {} },
  ],
  links: [{ id: "l1", from: { node: "n1", port: "value" }, to: { node: "n2", port: "a" } }],
};

function loadEditor() {
  const files = nodeEditorScripts();
  assert.ok(files.includes("zoidium/ui-node-editor.js"), "runtime-config still loads ui-node-editor.js, got: " + files.join(","));
  const context = { console: { error() {} }, document: makeDocument() };
  context.window = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(readScript(file), context, { filename: file });
  const queued = context.ZoidiumUIModules;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].name, "node-editor");
  return queued[0].install({});
}

test("graphTools keeps its exact member set", () => {
  const { nodeEditor } = loadEditor();
  assert.deepEqual(Object.keys(nodeEditor.graphTools).sort(), [
    "addNode",
    "bezierPoints",
    "canConnect",
    "colorFor",
    "connectLinks",
    "connectionError",
    "copyFragment",
    "createIdMaker",
    "insertFragment",
    "linkPathD",
    "normalizeGraph",
    "normalizeTypes",
    "polylinesCross",
    "rectFromPoints",
    "rectsIntersect",
    "removeLinks",
    "removeNodes",
    "tintForCategory",
    "wouldCreateCycle",
  ]);
});

test("link geometry helpers return exact paths and crossings", () => {
  const { nodeEditor } = loadEditor();
  const tools = nodeEditor.graphTools;
  assert.equal(tools.linkPathD(0, 0, 100, 0), "M0 0 C50 0 50 0 100 0");
  assert.equal(tools.linkPathD(10, 20, 150, 40), "M10 20 C80 20 80 40 150 40");
  const curve = tools.bezierPoints(0, 0, 100, 0, 4);
  assert.equal(curve.length, 5);
  looseAssert.deepEqual(curve[0], { x: 0, y: 0 });
  looseAssert.deepEqual(curve[4], { x: 100, y: 0 });
  assert.equal(tools.polylinesCross([{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 0, y: 10 }, { x: 10, y: 0 }]), true);
  assert.equal(tools.polylinesCross([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 10 }, { x: 10, y: 10 }]), false);
  looseAssert.deepEqual(tools.rectFromPoints({ x: 5, y: 8 }, { x: 1, y: 2 }), { x: 1, y: 2, w: 4, h: 6 });
  assert.equal(tools.rectsIntersect({ x: 0, y: 0, w: 4, h: 4 }, { x: 2, y: 2, w: 4, h: 4 }), true);
  assert.equal(tools.rectsIntersect({ x: 0, y: 0, w: 4, h: 4 }, { x: 5, y: 5, w: 4, h: 4 }), false);
  assert.equal(tools.colorFor("float"), "#a0a0a0");
  assert.equal(tools.colorFor("unknown-type"), "#7d8ba3");
  assert.equal(tools.tintForCategory("Texture"), tools.tintForCategory("Texture"), "tints are deterministic");
});

test("render builds one element per node with exact link paths", () => {
  const { nodeEditor } = loadEditor();
  const tools = nodeEditor.graphTools;
  const editor = nodeEditor({ nodeTypes: nodeTypes, graph: graph });
  const root = editor.element;
  assert.ok(root.classList.contains("zoidium-node-editor"));
  assert.equal(root.querySelectorAll(".zoidium-node-editor-node").length, 2);
  assert.equal(root.querySelectorAll(".zoidium-node-editor-socket").length, 6, "2 in + 1 out per node across both nodes");
  const links = root.querySelectorAll(".zoidium-node-editor-link");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("d"), tools.linkPathD(10, 20, 150, 40), "zero-size sockets anchor at the node origin");
  assert.equal(links[0].getAttribute("stroke"), tools.colorFor("float"));
  const scaleField = root.querySelector(".zoidium-node-editor-number");
  assert.equal(scaleField.value, "4", "the unlinked float input shows its default inline");
  looseAssert.deepEqual(editor.getGraph(), graph, "getGraph round-trips the normalized graph");
  editor.frameAll();
  editor.destroy();
  assert.equal(root.removed, true);
  editor.destroy();
});

test("setGraph replaces nodes and links", () => {
  const { nodeEditor } = loadEditor();
  const editor = nodeEditor({ nodeTypes: nodeTypes, graph: graph });
  editor.setGraph({ nodes: [{ id: "solo", type: "mix", x: 0, y: 0, params: {} }], links: [] });
  assert.equal(editor.element.querySelectorAll(".zoidium-node-editor-node").length, 1);
  assert.equal(editor.element.querySelectorAll(".zoidium-node-editor-link").length, 0);
  editor.destroy();
});
