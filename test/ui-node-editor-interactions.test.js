"use strict";

// Node editor interactions without a browser: gestures, menus, clipboard and
// keyboard run against the fake DOM. Every path must resolve its shared
// state and helpers across the split part files without throwing, and each
// gesture must commit exactly once through onChange.

// Loose deepEqual: arrays built inside the vm context have another realm's prototypes.
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

function graph() {
  return {
    nodes: [
      { id: "n1", type: "noise", x: 10, y: 20, params: {} },
      { id: "n2", type: "mix", x: 150, y: 40, params: {} },
    ],
    links: [{ id: "l1", from: { node: "n1", port: "value" }, to: { node: "n2", port: "a" } }],
  };
}

function loadEditor() {
  const context = {
    console: { error() {} },
    document: makeDocument(),
    requestAnimationFrame() { return 0; },
    cancelAnimationFrame() {},
  };
  context.window = context;
  vm.createContext(context);
  for (const file of nodeEditorScripts()) vm.runInContext(readScript(file), context, { filename: file });
  return context.ZoidiumUIModules[0].install({}).nodeEditor;
}

function setup() {
  const nodeEditor = loadEditor();
  const changes = [];
  const selections = [];
  const editor = nodeEditor({
    nodeTypes: nodeTypes,
    graph: graph(),
    onChange: (next, info) => changes.push(info.kind),
    onSelect: (ids) => selections.push(ids),
  });
  const viewport = editor.element.querySelector(".zoidium-node-editor-viewport");
  return { editor, viewport, changes, selections };
}

function pointer(target, type, detail) {
  return target.dispatch(type, Object.assign({
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
  }, detail));
}

function socketOf(editor, nodeId, dir, port) {
  return editor.element.querySelectorAll(".zoidium-node-editor-socket").find(
    (entry) => entry.dataset.nodeId === nodeId && entry.dataset.dir === dir && entry.dataset.port === port
  );
}

test("marquee selection then Delete commits once", () => {
  const { editor, viewport, changes, selections } = setup();
  pointer(viewport, "pointerdown", { clientX: 5, clientY: 15 });
  pointer(viewport, "pointermove", { clientX: 20, clientY: 30 });
  pointer(viewport, "pointerup", { clientX: 20, clientY: 30 });
  looseAssert.deepEqual(selections, [["n1"]]);
  editor.element.dispatch("keydown", { key: "Delete" });
  assert.deepEqual(changes, ["delete"]);
  looseAssert.deepEqual(editor.getGraph().nodes.map((node) => node.id), ["n2"]);
  editor.destroy();
});

test("header drag moves every selected node and commits a move", () => {
  const { editor, viewport, changes } = setup();
  editor.element.dispatch("keydown", { key: "a", ctrlKey: true });
  const head = editor.element.querySelector(".zoidium-node-editor-head");
  pointer(viewport, "pointerdown", { clientX: 10, clientY: 20, target: head });
  pointer(viewport, "pointermove", { clientX: 40, clientY: 20 });
  pointer(viewport, "pointerup", { clientX: 40, clientY: 20 });
  assert.deepEqual(changes, ["move"]);
  const moved = editor.getGraph().nodes.find((node) => node.id === "n1");
  assert.equal(moved.x, 40, "dragged 30 world units right");
  editor.destroy();
});

test("copy and paste duplicates the selection with fresh ids", () => {
  const { editor, changes } = setup();
  editor.element.dispatch("keydown", { key: "a", ctrlKey: true });
  editor.element.dispatch("keydown", { key: "c", ctrlKey: true });
  pointer(editor.element.querySelector(".zoidium-node-editor-viewport"), "pointermove", { clientX: 200, clientY: 200 });
  editor.element.dispatch("keydown", { key: "v", ctrlKey: true });
  assert.deepEqual(changes, ["paste"]);
  assert.equal(editor.getGraph().nodes.length, 4);
  assert.equal(editor.getGraph().links.length, 2, "the internal link is remapped to the copies");
  editor.destroy();
});

test("dragging output to input connects a link", () => {
  const { editor, viewport, changes } = setup();
  const out = socketOf(editor, "n1", "out", "value");
  pointer(viewport, "pointerdown", { clientX: 10, clientY: 20, target: out });
  pointer(viewport, "pointermove", { clientX: 150, clientY: 40 });
  pointer(viewport, "pointerup", { clientX: 150, clientY: 40 });
  assert.deepEqual(changes, ["connect"]);
  // Zero-size fake sockets share their node's anchor, so the drop ties and
  // the last compatible port wins; the point is the gesture connects.
  assert.equal(editor.getGraph().links.length, 2);
  editor.destroy();
});

test("dragging to empty canvas connects a new node", () => {
  const { editor, viewport, changes } = setup();
  const out = socketOf(editor, "n1", "out", "value");
  pointer(viewport, "pointerdown", { clientX: 10, clientY: 20, target: out });
  pointer(viewport, "pointermove", { clientX: 400, clientY: 400 });
  pointer(viewport, "pointerup", { clientX: 400, clientY: 400 });
  assert.ok(editor.element.querySelector(".zoidium-node-editor-menu"), "connect menu opened");
  editor.element.querySelector(".zoidium-node-editor-search").dispatch("keydown", { key: "Enter" });
  assert.equal(editor.getGraph().nodes.length, 3);
  assert.equal(editor.getGraph().links.length, 2, "the new node is wired to the drag source");
  assert.deepEqual(changes, ["add"]);
  editor.destroy();
});

test("dropping a picked link on empty canvas disconnects it", () => {
  const { editor, viewport, changes } = setup();
  const input = socketOf(editor, "n2", "in", "a");
  pointer(viewport, "pointerdown", { clientX: 150, clientY: 40, target: input });
  pointer(viewport, "pointermove", { clientX: 400, clientY: 400 });
  pointer(viewport, "pointerup", { clientX: 400, clientY: 400 });
  assert.deepEqual(changes, ["disconnect"]);
  assert.equal(editor.getGraph().links.length, 0);
  editor.destroy();
});

test("Escape during a node drag restores positions", () => {
  const { editor, viewport, changes } = setup();
  editor.element.dispatch("keydown", { key: "a", ctrlKey: true });
  const head = editor.element.querySelector(".zoidium-node-editor-head");
  pointer(viewport, "pointerdown", { clientX: 10, clientY: 20, target: head });
  pointer(viewport, "pointermove", { clientX: 90, clientY: 20 });
  editor.element.dispatch("keydown", { key: "Escape" });
  const kept = editor.getGraph().nodes.find((node) => node.id === "n1");
  assert.equal(kept.x, 10, "the drag was undone");
  assert.deepEqual(changes, [], "a cancelled drag never commits");
  editor.destroy();
});

test("Tab opens the add menu and Enter adds the first node", () => {
  const { editor, changes } = setup();
  const before = editor.getGraph().nodes.length;
  editor.element.dispatch("keydown", { key: "Tab" });
  assert.ok(editor.element.querySelector(".zoidium-node-editor-menu"), "menu opened");
  editor.element.querySelector(".zoidium-node-editor-search").dispatch("keydown", { key: "Enter" });
  assert.equal(editor.getGraph().nodes.length, before + 1);
  assert.deepEqual(changes, ["add"]);
  assert.equal(editor.element.querySelector(".zoidium-node-editor-menu"), null, "menu closed after activation");
  editor.destroy();
});

test("context menu opens on the grid and Escape closes it", () => {
  const { editor, viewport } = setup();
  pointer(viewport, "contextmenu", { clientX: 60, clientY: 60 });
  assert.ok(editor.element.querySelector(".zoidium-node-editor-menu"), "menu opened");
  editor.element.dispatch("keydown", { key: "Escape" });
  assert.equal(editor.element.querySelector(".zoidium-node-editor-menu"), null, "menu closed");
  editor.destroy();
});

test("Home, F, wheel and pan resolve without throwing", () => {
  const { editor, viewport, changes } = setup();
  editor.element.dispatch("keydown", { key: "Home" });
  editor.element.dispatch("keydown", { key: "f" });
  pointer(viewport, "wheel", { deltaX: 0, deltaY: -100, deltaMode: 0 });
  pointer(viewport, "pointerdown", { button: 1, clientX: 50, clientY: 50 });
  pointer(viewport, "pointermove", { button: 1, clientX: 70, clientY: 60 });
  pointer(viewport, "pointerup", { button: 1, clientX: 70, clientY: 60 });
  pointer(viewport, "pointerdown", { clientX: 400, clientY: 400, ctrlKey: true });
  pointer(viewport, "pointermove", { clientX: 450, clientY: 450, ctrlKey: true });
  pointer(viewport, "pointerup", { clientX: 450, clientY: 450, ctrlKey: true });
  assert.deepEqual(changes, [], "view gestures never commit");
  editor.destroy();
});
