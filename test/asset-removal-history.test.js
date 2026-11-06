"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness");

function fixture() {
  const { PZ, context } = nativeHost();
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { PZ, addEventListener() {} }, navigator: {} });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/object-history.js"), "utf8"), context);
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  const first = new PZ.project(), next = new PZ.project();
  editor.project = first;
  // Native editors retain this callback on an old asset list after a swap.
  first.assets.onAssetRemoved.watch(PZ.ui.editor.prototype.assetRemoved.bind(editor));
  const asset = first.assets.load("/assets/texture.png");
  return { PZ, editor, first, next, asset };
}

test("active asset removal keeps its native undo inverse", { skip: !fs.existsSync(core) }, () => {
  const { editor, first, asset } = fixture();
  editor.history.startOperation(); first.assets.unload(asset); editor.history.finishOperation();
  assert.equal(first.assets.list[asset.key], undefined);
  assert.equal(editor.history.undoStack.length, 1);
  editor.history.undo();
  assert.equal(first.assets.list[asset.key], asset);
});

test("resource cleanup outside an edit does not append to a null history operation", { skip: !fs.existsSync(core) }, () => {
  const { editor, first, asset } = fixture();
  assert.doesNotThrow(() => first.assets.unload(asset));
  assert.equal(first.assets.list[asset.key], undefined);
  assert.equal(editor.history.operation, null);
  assert.equal(editor.history.undoStack.length, 0);
});

test("retired resource cleanup cannot insert old assets into current history", { skip: !fs.existsSync(core) }, () => {
  const { editor, first, next, asset } = fixture();
  editor.project = next;
  const current = next.assets.load(asset.key);
  editor.history.startOperation();
  assert.doesNotThrow(() => first.assets.unload(asset));
  assert.equal(editor.history.operation.length, 0);
  editor.history.finishOperation();
  assert.equal(editor.history.undoStack.length, 0);
  assert.equal(next.assets.list[asset.key], current);
  assert.notEqual(current, asset);
  assert.equal(current.references, 1);
});
