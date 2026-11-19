"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { installActions } = require("../plugins/shape-plus/editor-actions.js");

test("shape commands do not interrupt composition or editable descendants", () => {
  const root = new FakeElement("div"), canvas = new FakeElement("canvas"), calls = [];
  const win = { navigator: {}, addEventListener() {}, removeEventListener() {} };
  const s = { canvas, document: { defaultView: win }, window: win, context: { ui: {} },
    treeAction(action) { calls.push(action); }, pointer: {}, gesture: {}, selection: new Set(), treeSelection: new Set() };
  const actions = installActions(s, root);
  const keydown = canvas.listeners.keydown[0];
  const event = extra => ({ key: "d", ctrlKey: true, target: { closest: () => null }, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: selector => selector.includes("[contenteditable]:not") ? {} : null } }]) {
    keydown(event(extra));
    assert.deepEqual(calls, []);
  }
  keydown(event({}));
  assert.deepEqual(calls, ["duplicate"]);
  const keyup = canvas.listeners.keyup[0];
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { target: { closest: () => ({}) } }]) {
    let consumed = false; s.space = true;
    keyup({ key: " ", code: "Space", preventDefault() { consumed = true; }, stopImmediatePropagation() { consumed = true; }, ...extra });
    assert.equal(s.space, false);
    assert.equal(consumed, false);
  }
  actions.dispose();
});
