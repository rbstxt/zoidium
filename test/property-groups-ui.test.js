"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host, document } = require("./property-groups-ui-harness");
const headings = view => view.el.querySelectorAll(".zpg-toggle").map(el => el.textContent);
test("Group menu assigns selected rows from the same list in one reversible edit", () => {
  const { PZ, api, editor, list, panel, flush, window } = host(), view = panel(); flush();
  let menu;
  window.ZoidiumUI = { openMenu: options => { menu = options; } };
  const rows = view.el.querySelectorAll("li").filter(row => row.pz_object instanceof PZ.property);
  rows[0].classList.add("selected"); rows[1].classList.add("selected");
  // A selected row from another custom-property list must stay untouched.
  const other = new PZ.objectList(list.parent, PZ.property), foreign = PZ.property.create({ custom: true, type: 0, value: 3 });
  other.push(foreign); foreign.load();
  const foreignRow = view.generateListItem(view.list, foreign); foreignRow.classList.add("selected");
  const before = JSON.stringify(list);
  rows[0].oncontextmenu({ preventDefault() {}, stopPropagation() {} });
  menu.items.find(item => item.label === "Group…").action();
  const form = view.el.querySelector(".zpg-settings");
  form.querySelector("input").value = "Controls";
  form.querySelectorAll("button").find(button => button.textContent === "Apply").onclick(); flush();
  assert.equal(api.name(list[0]), "Controls"); assert.equal(api.name(list[1]), "Controls");
  assert.equal(api.name(list[2]), ""); assert.equal(api.name(foreign), "");
  assert.equal(editor.history.undoStack.length, 1);
  editor.history.undo(); flush(); assert.equal(JSON.stringify(list), before);
  editor.history.redo(); flush(); assert.equal(api.members(list, "Controls").length, 2);
  // Right-clicking an unselected row retains the single-row action.
  rows[2].oncontextmenu({ preventDefault() {}, stopPropagation() {} });
  menu.items.find(item => item.label === "Group…").action();
  const single = view.el.querySelector(".zpg-settings"); single.querySelector("input").value = "Other";
  single.querySelectorAll("button").find(button => button.textContent === "Apply").onclick();
  assert.equal(api.name(list[2]), "Other"); assert.equal(api.members(list, "Controls").length, 2);
});
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
test("Shader+ definition history preserves current collapse and ignores a fold-only settings change", () => {
  const { PZ, api, editor, list, doc } = host();
  Object.setPrototypeOf(list.parent, PZ.effect.shader.prototype);
  const { installEditor } = require("../plugins/shader-plus/editor");
  const controller = installEditor({ context: { PZ, editor, document: doc, window: { setInterval() {}, clearInterval() {} },
    lifecycle: { onDispose() {} } }, patch(prototype, key, wrap) { prototype[key] = wrap(prototype[key]); }, presetFont() {} });
  api.setGroup(editor, list[0], "Controls");
  const state = () => ({ definition: JSON.parse(JSON.stringify(list[0].definition)), name: list[0].properties.name.get() });
  const next = state(); next.definition.zoidiumShader = { help: "Updated tooltip" };
  controller.edit(list[0], next);
  api.collapse(editor, list, "Controls"); editor.history.undo();
  assert.equal(api.meta(list[0]).collapsed, true);
  api.collapse(editor, list, "Controls"); editor.history.redo();
  assert.equal(api.meta(list[0]).collapsed, false);
  const before = editor.history.undoStack.length;
  const unchanged = state(); unchanged.definition.zoidiumPropertyGroup.collapsed = true;
  controller.edit(list[0], unchanged);
  assert.equal(editor.history.undoStack.length, before);
  assert.equal(api.meta(list[0]).collapsed, false);
});
