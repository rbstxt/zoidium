"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync(require("node:path").join(__dirname, "../plugins/core/tree-drop-target.js"), "utf8");

function setup(names, grabbed, targetName, operation = 1, accepts = true) {
  class Item {}
  class List extends Array {}
  class Singleton extends List {}
  const order = List.from(names, name => Object.assign(new Item(), { name }));
  order.forEach(item => { item.parent = order; });
  const grabbedItem = order.find(item => item.name === grabbed);
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
  const drag = { item: { pz_object: grabbedItem }, target, indicatorEl: { style: {} } };
  return { prototype, drag, destination, PZ };
}

for (const [names, grabbed, target, operation, expected] of [
  [["A", "G"], "A", "G", 1, 3],
  [["G", "A"], "A", "G", 2, 3],
  [["A", "S", "G"], "A", "G", 1, 1],
  [["G", "S", "A"], "A", "G", 2, 2],
  [["A", "G"], "A", "G", 2, 2],
  [["G", "A"], "A", "G", 1, 1],
  // CM3 moves only the grabbed row, so another selected row in between makes this a real reorder.
  [["A", "B", "G"], "A", "G", 1, 1],
  [["A", "B", "G"], "B", "G", 1, 3],
]) test(`grabbed ${grabbed} in ${names}, operation ${operation} becomes ${expected}`, () => {
  const { prototype, drag } = setup(names, grabbed, target, operation);
  prototype.itemDragUpdate.call(drag);
  assert.equal(drag.operation, expected);
  assert.equal(drag.indicatorEl.style.height, expected === 3 ? "24px" : "3px");
  assert.equal(prototype.itemDragEnd.call(drag, {}), expected);
});

test("incompatible types, occupied singletons and copy gestures retain the native operation", () => {
  for (const mode of ["type", "singleton", "copy"]) {
    const { prototype, drag, destination, PZ } = setup(["A", "G"], "A", "G", 1, mode !== "type");
    if (mode === "singleton") {
      Object.setPrototypeOf(destination, PZ.objectSingleton.prototype);
      destination.push({});
    }
    if (mode === "copy") drag.zoidiumCopy = true;
    prototype.itemDragUpdate.call(drag);
    assert.equal(drag.operation, 1, mode);
  }
});

test("an empty singleton accepts the row", () => {
  const { prototype, drag, destination, PZ } = setup(["A", "G"], "A", "G", 1);
  Object.setPrototypeOf(destination, PZ.objectSingleton.prototype);
  prototype.itemDragUpdate.call(drag);
  assert.equal(drag.operation, 3);
});

test("a row from another list keeps the native operation", () => {
  const { prototype, drag } = setup(["A", "G"], "A", "G", 1);
  drag.item.pz_object = {};
  prototype.itemDragUpdate.call(drag);
  assert.equal(drag.operation, 1);
});

test("Alt held at release restores the native copy position", () => {
  const { prototype, drag } = setup(["A", "G"], "A", "G", 1);
  prototype.itemDragUpdate.call(drag);
  assert.equal(drag.operation, 3);
  assert.equal(prototype.itemDragEnd.call(drag, { altKey: true }), 1);
});

test("installation is idempotent", () => {
  const { prototype, PZ } = setup(["A", "G"], "A", "G");
  const wrapped = prototype.itemDragUpdate;
  vm.runInNewContext(source, { PZ });
  assert.equal(prototype.itemDragUpdate, wrapped);
});

test("the native after indicator between the row and child list does not hide the destination", () => {
  const { prototype, drag } = setup(["G", "A"], "A", "G", 2);
  drag.indicatorEl.nextElementSibling = drag.target.nextElementSibling;
  drag.target.nextElementSibling = drag.indicatorEl;
  prototype.itemDragUpdate.call(drag);
  assert.equal(drag.operation, 3);
});
