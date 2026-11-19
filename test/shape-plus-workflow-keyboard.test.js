"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { install } = require("../plugins/shape-plus/workflow.js");

test("shape clipboard leaves composing and editable targets alone", async () => {
  const old = { document: global.document, window: global.window, navigator: global.navigator };
  const doc = new FakeElement("document"), body = new FakeElement("body"), canvas = new FakeElement("div");
  body.append = node => body.appendChild(node); doc.body = body; doc.createElement = tag => new FakeElement(tag);
  class Edit { generateItemCommands() {} }
  class Layer {} class Content {}
  const item = Object.assign(new Content(), { id: "a", kind: "path" });
  const layer = Object.assign(new Layer(), { contents: [item] });
  const top = Object.assign(new Edit(), { el: new FakeElement("div"), selection: [item] });
  const bottom = Object.assign(new Edit(), { el: new FakeElement("div"), objects: top.selection });
  const viewport = { el: canvas, options: { helper3dObjects: top.selection }, objects: [{ object: layer }] };
  doc.querySelectorAll = () => [top, bottom].map(pz_panel => ({ pz_panel }));
  let copies = 0, dispose;
  global.document = doc; global.window = { PZ: { ui: { edit: Edit } }, CM: { mainViewport: viewport, project: {} } };
  Object.defineProperty(global, "navigator", { configurable: true, value: { clipboard: { async writeText() { copies++; } } } });
  try {
    install({ ui: { notify() {} }, lifecycle: { onDispose(fn) { dispose = fn; } } }, Layer, Content);
    const onKey = doc.listeners.keydown[0], target = { closest: () => null };
    canvas.contains = () => true;
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: selector => selector.includes("[contenteditable]:not") ? {} : null } }]) {
      await onKey({ key: "c", ctrlKey: true, target, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
      assert.equal(copies, 0);
    }
    await onKey({ key: "c", ctrlKey: true, target, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(copies, 1);
    dispose();
    for (let i = 0; i < 15; i++) {
      install({ ui: { notify() {} }, lifecycle: { onDispose(fn) { dispose = fn; } } }, Layer, Content);
      assert.equal(doc.listeners.keydown.length, 1); assert.equal(doc.listeners.paste.length, 1);
      dispose(); assert.equal(doc.listeners.keydown.length, 0); assert.equal(doc.listeners.paste.length, 0);
      assert.equal(body.children.length, 0);
    }
  } finally { global.document = old.document; global.window = old.window; Object.defineProperty(global, "navigator", { configurable: true, value: old.navigator }); }
});
