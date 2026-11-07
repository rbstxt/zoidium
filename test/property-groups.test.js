"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { install } = require("../plugins/core/property-groups");
function host() {
  const native = nativeHost(), { PZ, context } = native;
  try { vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const api = install(PZ), root = new PZ.object(), owner = new PZ.object();
  root.children = [owner]; owner.parent = root;
  const list = new PZ.objectList(owner, PZ.property); owner.customProperties = list; owner.children = [list];
  for (const name of ["Amount", "Size", "Mix"]) {
    const p = PZ.property.create({ custom: true, dynamic: true, type: 0, value: 0.25 }); list.push(p); p.load(); p.properties.name.set(name);
  }
  const editor = { project: { addressLookup: address => address.reduce((node, key) => node.children ? node.children[key] : node[key], root), ui: { onChanged: { update() {} } } }, onProjectChanged: new PZ.observable() };
  editor.history = new PZ.ui.history(editor); editor.history.projectChanged();
  return { ...native, api, root, owner, list, editor };
}
const copy = value => JSON.parse(JSON.stringify(value));
test("custom-property groups are one undo step and round-trip without changing names, values, or native order", () => {
  const { PZ, api, list, editor, owner } = host();
  const before = JSON.stringify(list), names = Array.from(list, p => p.properties.name.get());
  assert.equal(api.blocks(list).filter(block => block.name).length, 0);
  assert.equal(api.setGroup(editor, list[0], "Controls"), true);
  assert.equal(editor.history.undoStack.length, 1);
  editor.history.undo(); assert.equal(JSON.stringify(list), before);
  editor.history.redo(); assert.equal(api.name(list[0]), "Controls");
  api.setGroup(editor, list[2], "Controls");
  assert.deepEqual(api.blocks(list).map(block => block.items.map(p => p.properties.name.get())), [["Amount", "Mix"], ["Size"]]);
  const count = editor.history.undoStack.length;
  api.settings(editor, list, "Controls", { name: "Look", locked: true });
  assert.equal(editor.history.undoStack.length, count + 1);
  assert.equal(api.name(list[0]), "Look"); assert.equal(api.locked(list, "Look"), true);
  editor.history.undo(); assert.equal(api.name(list[0]), "Controls"); assert.equal(api.locked(list, "Controls"), false);
  editor.history.redo(); assert.equal(api.locked(list, "Look"), true);
  assert.equal(api.setGroup(editor, list[0], "Other"), false);
  assert.equal(api.setGroup(editor, list[1], "Look"), false);
  assert.equal(api.move(editor, list, "Look", list[1]), false);
  assert.equal(api.move(editor, list, list[0], list[1]), false);
  const serialized = copy(list);
  const restored = new PZ.objectList(owner, PZ.property);
  for (const data of serialized) { const p = PZ.property.create(data.type); restored.push(p); p.load(data); }
  assert.equal(api.locked(restored, "Look"), true); assert.equal(JSON.stringify(restored), JSON.stringify(list));
  const duplicate = PZ.property.create(serialized[0].type); duplicate.load(serialized[0]);
  assert.equal(api.name(duplicate), "Look"); assert.equal(api.meta(duplicate).locked, true);
  assert.deepEqual(Array.from(list, p => p.properties.name.get()), names);
  assert.deepEqual(Array.from(list, p => p.get(12)), [.25, .25, .25]);
});
test("legacy Shader+ groups share settings, collapse and display-only drag order", () => {
  const { api, editor, list } = host();
  list[0].definition.zoidiumShader = { group: "Existing", help: "Keep this" };
  assert.equal(api.name(list[0]), "Existing");
  api.setGroup(editor, list[2], "Other");
  const native = Array.from(list);
  api.move(editor, list, "Other", "Existing");
  assert.deepEqual(api.blocks(list).map(block => block.name), ["Other", "Existing", ""]);
  assert.deepEqual(Array.from(list), native);
  editor.history.undo(); assert.deepEqual(api.blocks(list).map(block => block.name), ["Existing", "", "Other"]);
  editor.history.redo(); api.collapse(editor, list, "Existing");
  assert.equal(api.meta(list[0]).collapsed, true);
  editor.history.undo(); assert.equal(api.meta(list[0]).collapsed, undefined);
  api.move(editor, list, list[1], "Existing", true);
  assert.equal(api.name(list[1]), "Existing");
  api.settings(editor, list, "Existing", { name: "Renamed", locked: false });
  assert.equal(list[0].definition.zoidiumShader.group, "Renamed"); assert.equal(list[0].definition.zoidiumShader.help, "Keep this");
});
test("a vanilla native loader ignores group metadata and preserves shader bindings", () => {
  const { api, editor, list } = host(); api.setGroup(editor, list[0], "Controls");
  api.settings(editor, list, "Controls", { name: "Controls", locked: true });
  const saved = copy(list), vanilla = nativeHost().PZ;
  for (const data of saved) {
    const p = vanilla.property.create(data.type); p.load(data);
    assert.equal(p.properties.name.get(), data.properties.name); assert.equal(p.get(24), .25);
  }
});
test("native group lock is additive and survives undo, reopen and native duplication", () => {
  const { PZ, api, editor, root } = host();
  const list = new PZ.objectList(root, PZ.object3d); root.children.push(list);
  const group = new PZ.object3d.group(); list.push(group); group.parentChanged = () => {}; group.load();
  assert.equal(Object.hasOwn(group.toJSON(), "zoidiumGroupLocked"), false);
  assert.equal(api.setNativeLock(editor, group, true), true);
  assert.equal(api.nativeLocked(group.objects), true);
  assert.equal(editor.history.undoStack.length, 1);
  editor.history.undo(); assert.equal(api.nativeLocked(group), false);
  editor.history.redo(); assert.equal(api.nativeLocked(group), true);
  const saved = copy(group), restored = new PZ.object3d.group(); restored.parentChanged = () => {}; restored.load(saved);
  assert.equal(api.nativeOwnLock(restored), true); assert.equal(JSON.stringify(restored), JSON.stringify(group));
  const Vanilla = nativeHost().PZ, old = new Vanilla.object3d.group(); old.parentChanged = () => {}; old.load(saved);
  assert.equal(old.properties.enabled.get(0), group.properties.enabled.get(0));
  const state = copy(group.properties); group.update(10); assert.deepEqual(copy(group.properties), state);
});
