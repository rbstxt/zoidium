"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync(require("node:path").join(__dirname, "../plugins/core/tree-drop-target.js"), "utf8");

function setup(names, selected, targetName, operation = 1, accepts = true) {
  class Item {}
  class List extends Array {}
  class Singleton extends List {}
  const order = List.from(names, name => Object.assign(new Item(), { name }));
  order.forEach(item => { item.parent = order; });
  const items = selected.map(name => order.find(item => item.name === name));
  const destination = new List();
  destination.type = accepts ? Item : class Other {};
  const target = { pz_object: order.find(item => item.name === targetName), offsetHeight: 24,
    parentElement: { pz_object: order, insertBefore() {} }, nextElementSibling: { pz_object: destination } };
  destination.parent = target.pz_object;
  const prototype = {
    itemDrag() {},
    itemDragUpdate() { this.operation = operation; this.indicatorEl.style.height = "3px"; },
    itemDragEnd() { return this.operation; },
  };
  const PZ = { objectList: List, objectSingleton: Singleton, ui: { edit: { prototype } } };
  vm.runInNewContext(source, { PZ });
  const drag = { item: { pz_object: items[0] }, target, indicatorEl: { style: {} },
    ctx: { list: { querySelectorAll: () => items.map(pz_object => ({ pz_object })) } } };
  return { prototype, drag, destination, order, items, PZ };
}

for (const [names, selected, target, operation, expected] of [
  [["A", "G"], ["A"], "G", 1, 3],
  [["G", "A"], ["A"], "G", 2, 3],
  [["A", "S", "G"], ["A"], "G", 1, 1],
  [["G", "S", "A"], ["A"], "G", 2, 2],
  [["A", "B", "G"], ["A", "B"], "G", 1, 3],
  [["G", "A", "B"], ["A", "B"], "G", 2, 3],
  [["A", "S", "B", "G"], ["A", "B"], "G", 1, 1],
  [["A", "G"], ["A", "G"], "G", 1, 1],
]) test(`selected ${selected} in ${names}, operation ${operation} becomes ${expected}`, () => {
  const { prototype, drag } = setup(names, selected, target, operation);
  prototype.itemDragUpdate.call(drag);
  assert.equal(drag.operation, expected);
  assert.equal(drag.indicatorEl.style.height, expected === 3 ? "24px" : "3px");
  assert.equal(prototype.itemDragEnd.call(drag, {}), expected);
});

test("incompatible types, occupied singletons, copy gestures and descendants retain native operation", () => {
  for (const mode of ["type", "singleton", "copy", "descendant", "mixed"]) {
    const { prototype, drag, destination, items, PZ } = setup(["A", "B", "G"], ["A", "B"], "G", 1, mode !== "type");
    if (mode === "singleton") Object.setPrototypeOf(destination, PZ.objectSingleton.prototype);
    if (mode === "copy") drag.zoidiumCopy = true;
    if (mode === "descendant") destination.parent = items[0];
    if (mode === "mixed") items[1].parent = [];
    prototype.itemDragUpdate.call(drag);
    assert.equal(drag.operation, 1, mode);
  }
});

test("installation is idempotent", () => {
  const { prototype, PZ } = setup(["A", "G"], ["A"], "G");
  const wrapped = prototype.itemDragUpdate;
  vm.runInNewContext(source, { PZ });
  assert.equal(prototype.itemDragUpdate, wrapped);
});
