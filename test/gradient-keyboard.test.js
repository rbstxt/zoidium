"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const { FakeElement } = require("./fake-dom.js");

function setup() {
  const doc = new FakeElement("document"), win = new FakeElement("window"), finishes = [];
  class Element extends FakeElement {
    constructor(tag) { super(tag); this.ownerDocument = doc; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    getContext() { return { createImageData: () => ({ data: new Uint8ClampedArray(1024) }), putImageData() {} }; }
  }
  doc.defaultView = win; win.AbortController = AbortController;
  doc.createElement = tag => new Element(tag); doc.createTextNode = text => { const node = new Element("span"); node.textContent = text; return node; };
  win.document = doc; win.ZoidiumGradientModel = require("../zoidium/gradient-model.js");
  win.ZoidiumGradientColorPanel = { create: ({ node }) => ({ element: node("div"), update() {}, setDisabled() {} }) };
  vm.runInNewContext(fs.readFileSync("zoidium/gradient-editor.js", "utf8"), { window: win });
  const editor = win.ZoidiumGradientEditor.create({ document: doc, onFinish: cancel => finishes.push(cancel) });
  return { editor, doc, finishes };
}

test("gradient stop keys and active drags ignore composing events", () => {
  const { editor, doc, finishes } = setup(), marker = editor.element.querySelector(".zge-stop");
  const before = JSON.stringify(editor.get());
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    marker.onkeydown({ key: "Delete", ...extra, preventDefault() {} });
    assert.equal(JSON.stringify(editor.get()), before);
  }
  marker.dispatch("pointerdown", { button: 0 });
  assert.equal(editor.editing, true);
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: () => ({}) } }]) {
    doc.dispatch("keydown", { key: "Escape", ...extra });
    assert.equal(editor.editing, true);
  }
  doc.dispatch("keydown", { key: "Escape" });
  assert.equal(editor.editing, false); assert.deepEqual(finishes, [true]);
  editor.dispose();
});
