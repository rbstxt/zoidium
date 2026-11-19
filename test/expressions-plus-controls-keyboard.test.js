"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { installControlsUI } = require("../plugins/expressions-plus/controls-ui.js");

test("control rename stays open during composition", () => {
  class Element extends FakeElement {
    after(node) { this.parentElement.insertBefore(node, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]); }
  }
  const doc = { createElement: tag => new Element(tag) };
  class Dynamic {}
  class Edit { generateListItem(parent, target) { const row = doc.createElement("li"); row.pz_object = target; parent.appendChild(row); return row; } }
  const PZ = { property: { dynamic: Dynamic }, sequence: class {}, ui: { edit: Edit } };
  const property = Object.assign(new Dynamic(), { definition: { zoidiumControlId: "id" } });
  const list = [property], store = { sequenceOfList: () => null, isControl: () => true, sequenceOf: () => ({}), list: () => list, label: () => "Old" };
  let menu;
  const context = { PZ, editor: {}, document: doc, window: {}, ui: { openMenu(options) { menu = options; }, notify() {} }, lifecycle: { onDispose() {} } };
  installControlsUI({ context, store, patch(holder, key, wrap) { holder[key] = wrap(holder[key] || function () {}); } });
  const parent = doc.createElement("ul"), view = new Edit(); view.options = { showPropertyControls: true };
  const row = view.generateListItem(parent, property);
  row.oncontextmenu({ preventDefault() {}, stopPropagation() {} });
  menu.items.find(item => item.label === "Rename…").action();
  const form = parent.children[1];
  for (const key of ["Enter", "Escape"]) for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
    form.dispatch("keydown", { key, ...composition });
    assert.ok(form.parentElement);
  }
  form.dispatch("keydown", { key: "Escape" });
  assert.equal(form.parentElement, null);
});
