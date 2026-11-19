"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { install } = require("../plugins/shape-plus/text-controls.js");

test("source text Escape leaves the field focused while composing", () => {
  const previous = global.document;
  const doc = { createElement: tag => new FakeElement(tag), getElementById: () => null, head: new FakeElement("head") };
  global.document = doc;
  try {
    const registrations = {};
    const PZ = { property: { type: { TEXT: 1, LIST: 2 } }, ui: {} };
    const context = { PZ, editor: { playback: { currentFrame: 0 }, history: { operation: null } }, lifecycle: { onDispose() {} },
      apis: { propertyControls: { register(id, spec) { registrations[id] = spec; return () => {}; } } } };
    install(context);
    const wrap = registrations["shape-plus/source-text"].create({ get: () => "Text" });
    const input = wrap.children[0]; let blurs = 0;
    input.blur = () => { blurs++; };
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      input.onkeydown({ key: "Escape", ...composition, stopPropagation() {}, preventDefault() {} });
      assert.equal(blurs, 0);
    }
    input.onkeydown({ key: "Escape", stopPropagation() {}, preventDefault() {} });
    assert.equal(blurs, 1);
  } finally { global.document = previous; }
});
