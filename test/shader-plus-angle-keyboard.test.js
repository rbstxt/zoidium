"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { registerAngle } = require("../plugins/shader-plus/angle-control.js");

test("angle dial stays open while composing", () => {
  const doc = new FakeElement("document"), win = new FakeElement("window");
  class Element extends FakeElement {
    constructor(tag) { super(tag); this.ownerDocument = doc; this.isConnected = true; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    setAttributeNS(_ns, key, value) { this.setAttribute(key, value); }
  }
  doc.createElement = tag => new Element(tag); doc.createElementNS = (_ns, tag) => new Element(tag);
  doc.body = new Element("body"); doc.defaultView = win; win.innerWidth = win.innerHeight = 1000;
  const box = new Element("div"); box.pz_update = () => {};
  const PZ = { property: { type: { NUMBER: 0 } }, ui: { controls: { generateInput: () => box } } };
  let create;
  const handle = registerAngle({ PZ, doc, register(_id, _type, fn) { create = fn; }, commit() {} });
  create({ definition: {}, get: () => 0 });
  const button = box.children[0];
  button.onclick({ stopPropagation() {} });
  const panel = doc.body.children[0], dial = panel.children[0];
  for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    dial.dispatch("keydown", { key: "Escape", ...composition });
    assert.ok(panel.parentElement);
  }
  dial.dispatch("keydown", { key: "Escape" });
  assert.equal(panel.parentElement, null);
  assert.equal(doc.listeners.pointerdown.length, 0);
  for (let i = 0; i < 15; i++) {
    button.onclick({ stopPropagation() {} });
    assert.equal(doc.listeners.pointerdown.length, 1);
    handle.close();
    assert.equal(doc.listeners.pointerdown.length, 0);
    assert.equal(doc.body.children.length, 0);
  }
  handle.close();
});

test("disabling Shader+ closes an open angle dial", () => {
  const doc = new FakeElement("document"), win = new FakeElement("window");
  class Element extends FakeElement {
    constructor(tag) { super(tag); this.ownerDocument = doc; this.isConnected = true; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  }
  doc.createElement = tag => new Element(tag); doc.createElementNS = (_ns, tag) => new Element(tag);
  doc.body = new Element("body"); doc.head = new Element("head"); doc.defaultView = win; win.innerWidth = win.innerHeight = 1000;
  const box = new Element("div"); box.pz_update = () => {};
  const PZ = { property: { type: { NUMBER: 0 } }, ui: { controls: { generateInput: () => box } } };
  const registered = new Map(), disposers = [];
  const modules = { "./controls.js": { installControls: () => ({ commit() {} }) }, "./angle-control.js": { registerAngle },
    "./snap.js": { isSnapActive: () => false }, "./texture-controls.js": { installTextureControls() {} }, "./runtime.js": { installRuntime: () => ({ disposeAll() {} }) },
    "./font-assets.js": { registerFontAssets() {} }, "./code-window.js": { installCodeWindows: () => ({}) }, "./editor.js": { installEditor: () => ({}) } };
  const context = { PZ, window: win, document: doc, editor: {}, getAsset: () => "", lifecycle: { onDispose: fn => disposers.push(fn) },
    apis: { modules: { createRequire: () => path => modules[path] || {} }, propertyControls: { register(id, spec) { registered.set(id, spec); return () => registered.delete(id); } } } };
  require("../plugins/shader-plus/shader-plus.js").activate(context);
  registered.get("shader-plus/angle").create({ definition: {}, get: () => 0 });
  box.children[0].onclick({ stopPropagation() {} });
  assert.equal(doc.listeners.pointerdown.length, 1);
  try { disposers[0](); assert.equal(doc.listeners.pointerdown.length, 0); assert.equal(doc.body.children.length, 0); }
  finally { if (doc.body.children.length) doc.dispatch("pointerdown", { target: null }); }
});
