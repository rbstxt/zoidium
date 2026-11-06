"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness");
const source = fs.readFileSync(path.join(__dirname, "../plugins/core/object-history.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const native = nativeHost(), { PZ, THREE, context } = native;
  let clipboard;
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { PZ, addEventListener() {} },
    navigator: { clipboard: { writeText(value) { clipboard = JSON.parse(value); } } } });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  vm.runInContext(source, context);
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  const project = new PZ.project();
  project.ui = { onChanged: new PZ.observable() };
  project.threeObj = new THREE.Object3D();
  project.objects = new PZ.objectList(project, PZ.object3d);
  project.children.push(project.objects);
  editor.project = project;
  function group(list, name) {
    const object = PZ.object3d.create(5);
    list.push(object); object.load({ properties: { name }, objects: [] });
    return object;
  }
  const parent = group(project.objects, "Parent");
  const child = group(parent.objects, "Child");
  const grandchild = group(child.objects, "Grandchild");
  const sibling = group(project.objects, "Sibling");
  const rows = [parent, child, grandchild, sibling].map(pz_object => {
    let selected = true;
    return { pz_object, get selected() { return selected; }, classList: {
      remove() { selected = false; }, add() { selected = true; },
    } };
  });
  const selectedRows = () => rows.filter(row => row.selected);
  const edit = Object.create(PZ.ui.edit.prototype);
  Object.assign(edit, { editor, selection: new PZ.objectList(),
    el: { querySelectorAll: selectedRows }, list: { getElementsByClassName: selectedRows } });
  edit.selectItems();
  return { PZ, editor, project, edit, rows, parent, child, grandchild, sibling,
    clipboard: () => clipboard, key(key, ctrlKey = false, tagName = "DIV") {
      return edit.keydown({ key, ctrlKey, target: { tagName }, stopPropagation() {} });
    } };
}

for (const key of ["Delete", "Backspace", "Del", "x"]) {
  test(`nested selection ${key} completes one undoable operation`, { skip: !fs.existsSync(core) }, async () => {
    const state = fixture(), { editor, project } = state;
    const before = plain(project.objects);
    await state.key(key, key === "x");
    assert.equal(project.objects.length, 0);
    assert.equal(editor.history.operation, null);
    assert.equal(editor.history.undoStack.length, 1);
    if (key === "x") assert.equal(state.clipboard()[0].data.length, 2);
    editor.history.undo();
    assert.deepEqual(plain(project.objects), before);
    editor.history.redo();
    assert.equal(project.objects.length, 0);
    assert.equal(editor.history.operation, null);
  });
}

test("copy includes each selected subtree once and preserves unrelated siblings", { skip: !fs.existsSync(core) }, async () => {
  const state = fixture();
  const before = plain(state.project.objects);
  await state.key("c", true);
  assert.deepEqual(state.clipboard()[0].data.map(object => object.properties.name), ["Parent", "Sibling"]);
  assert.equal(state.clipboard()[0].data[0].objects[0].objects[0].properties.name, "Grandchild");
  assert.deepEqual(plain(state.project.objects), before);
  assert.equal(state.editor.history.undoStack.length, 0);
});

test("selecting only descendants keeps the highest selected descendant", { skip: !fs.existsSync(core) }, async () => {
  const state = fixture();
  state.rows[0].classList.remove(); state.rows[3].classList.remove(); state.edit.selectItems();
  await state.key("Delete");
  assert.equal(state.project.objects.length, 2);
  assert.equal(state.parent.objects.length, 0);
  state.editor.history.undo();
  assert.equal(state.parent.objects[0].properties.name.get(), "Child");
  assert.equal(state.parent.objects[0].objects[0].properties.name.get(), "Grandchild");
});

test("copy in a text input leaves the tree selection alone", { skip: !fs.existsSync(core) }, async () => {
  const state = fixture();
  await state.key("c", true, "INPUT");
  assert.equal(state.edit.selection.length, 4);
  assert.equal(state.clipboard(), undefined);
});
