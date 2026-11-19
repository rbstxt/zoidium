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
