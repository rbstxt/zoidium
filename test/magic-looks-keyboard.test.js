"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const { FakeElement } = require("./fake-dom.js");

test("color wheel and curve pad ignore composing navigation keys", () => {
  const doc = {}, view = new FakeElement("window"); doc.defaultView = view;
  const context2d = new Proxy({}, { get(_object, key) { if (key === "createRadialGradient") return () => ({ addColorStop() {} }); return () => {}; }, set() { return true; } });
  doc.createElement = tag => { const node = new FakeElement(tag); node.ownerDocument = doc; node.getContext = () => context2d; return node; };
  const color = { clamp: (value, min, max) => Math.max(min, Math.min(max, value)), hsvToRgb: () => [1, 0, 0], wheelTint: () => [1, 1, 1] };
  const sandbox = { document: doc, Looks: { color }, window: view };
  vm.runInNewContext(fs.readFileSync("plugins/magic-looks/looks-widgets.js", "utf8"), sandbox);
  const container = doc.createElement("div"), wheel = sandbox.Looks.widgets.ColorWheel(container), pad = sandbox.Looks.widgets.CurvesPad(container);
  let commits = 0; wheel.onCommit(() => commits++); pad.onCommit(() => commits++);
  const canvases = [wheel.el.children[0], pad.el.children[0]];
  for (const canvas of canvases) for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    canvas.dispatch("keydown", { key: "ArrowUp", ...composition }); assert.equal(commits, 0);
  }
  canvases[0].dispatch("keydown", { key: "ArrowUp" }); assert.equal(commits, 1);
  wheel.destroy(); pad.destroy();
  assert.equal((view.listeners["zoidium:theme-changed"] || []).length, 0);
  for (let i = 0; i < 15; i++) {
    const nextWheel = sandbox.Looks.widgets.ColorWheel(container), nextPad = sandbox.Looks.widgets.CurvesPad(container);
    assert.equal(view.listeners["zoidium:theme-changed"].length, 2);
    nextWheel.destroy(); nextPad.destroy();
    assert.equal(view.listeners["zoidium:theme-changed"].length, 0);
  }
});

test("tool chain navigation ignores composing arrow keys", () => {
  const previous = global.document, doc = { activeElement: null };
  class Element extends FakeElement {
    constructor(tag) { super(tag); this.ownerDocument = doc; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    querySelector(selector) { if (selector === ".zoidium-section-title span:last-child") return { textContent: "" }; return super.querySelector(selector); }
  }
  doc.createElement = tag => new Element(tag); global.document = doc;
  try {
    const makeControl = () => ({ element: new Element("div"), setDisabled() {} });
    const controls = { button: makeControl, select: makeControl, text() { const x = makeControl(); x.element.querySelector = () => new Element("input"); return x; },
      section() { const element = new Element("section"), title = new Element("div"), body = new Element("div"); title.className = "zoidium-section-title"; element.append(title, body); return { element, body }; } };
    const tools = { GROUPS: [], TOOLS: [], PRESETS: [], byId: () => ({ name: "Tool" }), propMap: () => ({ tool: { enable: "on" } }) };
    const properties = { ml_i1_on: { get: () => 1, frameOffset: 0, definition: {} }, ml_i2_on: { get: () => 1, frameOffset: 0, definition: {} }, enabled: { frameOffset: 0 } };
    const effect = { looksInstances: { version: 1, nextId: 3, order: [{ id: "i1", tool: "tool" }, { id: "i2", tool: "tool" }] }, properties, update() {}, _looksPipeline: { editorStage: () => null } };
    const state = { ui: { controls, properties: () => ({ element: new Element("div"), dispose() {} }) }, editor: { playback: { currentFrame: 0 }, history: { undoStack: [], redoStack: [] } }, Looks: { tools } };
    const view = { selectedTool: "i1", filter: { text: "" } }, body = new Element("div");
    const dispose = require("../plugins/magic-looks/looks-instance-ui.js").mount({ state, body, effect, session: {}, view, custom: { buildWheels() {} } });
    try {
      const button = body.querySelector(".lk-chain-select");
      for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
        button.dispatch("keydown", { key: "ArrowDown", ...composition }); assert.equal(view.selectedTool, "i1");
      }
      button.dispatch("keydown", { key: "ArrowDown" }); assert.equal(view.selectedTool, "i2");
    } finally { dispose(); }
  } finally { global.document = previous; }
});
