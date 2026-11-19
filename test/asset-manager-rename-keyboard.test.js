"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { createTable } = require("../plugins/asset-manager/assets-table.js");

test("asset rename stays open while Enter or Escape belongs to an IME", () => {
  class Element extends FakeElement {
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    replaceWith(node) { this.replacement = node; }
  }
  const previousCSS = global.CSS;
  global.CSS = { escape: value => value };
  try {
    const doc = { createElement: tag => new Element(tag) };
    const table = createTable(doc, () => {}, { sort: { column: "name", direction: "asc" } }, {});
    const text = new Element("span");
    table.body.querySelector = () => ({ querySelector: () => text });
    const names = [];
    table.startItemRename("item", "Old", name => { names.push(name); return true; });
    const input = text.replacement;
    input.value = "New";
    for (const key of ["Enter", "Escape"]) for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      input.dispatch("keydown", { key, ...composition });
      assert.deepEqual(names, []);
      assert.equal(input.replacement, undefined);
    }
    input.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(names, ["New"]);
  } finally { global.CSS = previousCSS; }
});
