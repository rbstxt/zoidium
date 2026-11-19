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

test("composing Enter does not activate the selected asset", () => {
  class Element extends FakeElement { append(...nodes) { nodes.forEach(node => this.appendChild(node)); } }
  const previous = global.Node; global.Node = Element;
  try {
    const doc = { createElement: tag => new Element(tag) }, calls = [];
    const table = createTable(doc, () => new Element("span"), { sort: { column: "name", direction: "asc" } },
      { selectedId: () => "item", activate: row => calls.push(row.id) });
    table.render({ items: [{ id: "item", name: "Item", kind: "file", status: "ready" }] });
    for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
      table.wrap.dispatch("keydown", { key: "Enter", ...composition });
      assert.deepEqual(calls, []);
    }
    table.wrap.dispatch("keydown", { key: "Enter" });
    assert.deepEqual(calls, ["item"]);
  } finally { global.Node = previous; }
});

test("asset table disposal releases document drag listeners across repeated opens", () => {
  class Element extends FakeElement { append(...nodes) { nodes.forEach(node => this.appendChild(node)); } }
  const previous = global.Node; global.Node = Element;
  try {
    const doc = new Element("document"); doc.createElement = tag => new Element(tag);
    for (let i = 0; i < 15; i++) {
      const table = createTable(doc, () => new Element("span"), { sort: { column: "name", direction: "asc" } },
        { selectedId: () => "item", registry: () => null });
      table.render({ items: [{ id: "item", name: "Item", kind: "file", status: "ready" }] });
      table.body.children[0].dispatch("dragstart", { dataTransfer: { setData() {} } });
      assert.equal(doc.listeners.dragover.length, 1); assert.equal(doc.listeners.drop.length, 1);
      table.dispose();
      assert.equal(doc.listeners.dragover.length, 0); assert.equal(doc.listeners.drop.length, 0);
    }
  } finally { global.Node = previous; }
});
