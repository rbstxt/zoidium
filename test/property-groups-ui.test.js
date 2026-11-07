"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host, document } = require("./property-groups-ui-harness");
const headings = view => view.el.querySelectorAll(".zpg-toggle").map(el => el.textContent);
test("panel generation batches grouped work and leaves ungrouped DOM untouched", () => {
  const { api, editor, list, panel, flush, tasks } = host();
  // Display-order remnants must not activate the organized drag or render path.
  list[0].definition.zoidiumPropertyGroup = { order: 10 };
  const view = panel(), rows = [...view.el.querySelectorAll("li")];
  assert.equal(tasks.length, 1); flush();
  assert.equal(api.uiStats(editor).domMoves, 0); assert.equal(api.uiStats(editor).renders, 0);
  assert.deepEqual(view.el.querySelectorAll("li"), rows);
  for (const p of list) api.setGroup(editor, p, "Controls");
  assert.equal(tasks.length, 1); flush();
  assert.equal(api.uiStats(editor).renders, 1); assert.equal(api.uiStats(editor).domMoves, 65);
  const before = api.uiStats(editor).renders;
  view.objectsChanged(); assert.equal(tasks.length, 1); flush();
  assert.equal(api.uiStats(editor).renders - before, 1);
  assert.deepEqual(headings(view), ["Controls"]);
});
test("mutation, undo, redo, project replacement and rebuild refresh without timers", () => {
  const { PZ, api, editor, list, root, panel, flush } = host();
  const view = panel(); flush();
  api.setGroup(editor, list[0], "Controls"); flush(); assert.deepEqual(headings(view), ["Controls"]);
  editor.history.undo(); flush(); assert.deepEqual(headings(view), []);
  editor.history.redo(); flush(); assert.deepEqual(headings(view), ["Controls"]);
  const objects = new PZ.objectList(root, PZ.object3d); root.children.push(objects);
  const group = new PZ.object3d.group(); objects.push(group); group.parentChanged = () => {}; group.load();
  const native = panel(objects), button = () => native.el.querySelector(".zpg-native-lock");
  assert.equal(button().textContent, "Lock");
  api.setNativeLock(editor, group, true); assert.equal(button().textContent, "Locked");
  editor.history.undo(); assert.equal(button().textContent, "Lock");
  editor.history.redo(); assert.equal(button().textContent, "Locked");
  native.objectsChanged(); assert.equal(button().textContent, "Locked");
  view.objectsChanged(); flush(); assert.deepEqual(headings(view), ["Controls"]);
  editor.project = { ...editor.project }; editor.onProjectChanged.update();
  assert.equal(api.uiStats(editor).lists, 0); assert.equal(api.uiStats(editor).nativeRows, 0);
  view.objectsChanged(); native.objectsChanged(); flush();
  assert.deepEqual(headings(view), ["Controls"]); assert.equal(button().textContent, "Locked");
});
test("disabled, detached, rebuilt and unloaded panels release every retained entry", () => {
  const { api, editor, list, panel, flush } = host();
  for (let i = 0; i < 30; i++) {
    const view = panel(); view.enabled = false; flush();
    assert.equal(api.uiStats(editor).panels, 0); assert.equal(api.uiStats(editor).lists, 0);
    view.enabled = true; flush(); assert.equal(api.uiStats(editor).lists, 1);
    view.objectsChanged(); flush(); assert.equal(api.uiStats(editor).lists, 1);
    view.unload(); flush(); assert.equal(api.uiStats(editor).panels, 0);
  }
  const view = panel(); api.setGroup(editor, list[0], "Controls"); flush();
  view.enabled = false; api.setGroup(editor, list[0], "");
  view.enabled = true; flush(); assert.deepEqual(headings(view), []);
  view.unload(); flush(); assert.equal(api.uiStats(editor).lists, 0);
});
test("panels generated in another document receive one stylesheet", () => {
  const { api, editor, panel, flush } = host(), view = panel(), other = document();
  view.el.ownerDocument = other;
  api.refresh(editor); api.refresh(editor); flush();
  assert.equal(other.head.querySelectorAll("style").length, 1);
  assert.equal(other.head.firstChild.id, "zoidium-property-groups-style");
});
