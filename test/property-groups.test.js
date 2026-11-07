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
  const { PZ, api, editor, list, owner } = host();
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
  api.collapse(editor, list, "Renamed");
  const reopened = new PZ.objectList(owner, PZ.property);
  for (const data of copy(list)) { const p = PZ.property.create(data.type); reopened.push(p); p.load(data); }
  assert.equal(JSON.stringify(reopened), JSON.stringify(list));
  assert.deepEqual(api.blocks(reopened).map(block => block.items.map(p => p.properties.name.get())),
    api.blocks(list).map(block => block.items.map(p => p.properties.name.get())));
  assert.equal(api.meta(reopened[0]).collapsed, true);
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
  group.properties.position.objects[0].load({ animated: true, keyframes: [
    { frame: 0, value: 0, tween: 1 }, { frame: 20, value: 10, tween: 1 },
  ] });
  const state = copy(group.properties); group.update(10); assert.deepEqual(copy(group.properties), state);
  assert.equal(group.threeObj.position.x, 5);
});
test("native drag guard blocks a locked group and its child list without blocking unlocked moves", () => {
  const { PZ, api, context, root, editor } = host();
  const list = new PZ.objectList(root, PZ.object3d); root.children.push(list);
  const group = new PZ.object3d.group(); list.push(group); group.parentChanged = () => {}; group.load();
  PZ.zoidium = { propertyGroups: api };
  let updates = 0, drops = 0;
  PZ.ui.edit.prototype.itemDragUpdate = function () { updates++; this.operation = 3; };
  PZ.ui.edit.prototype.itemDragEnd = function () { if (this.operation) drops++; };
  context.window = { PZ };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/core/property-groups-drag.js"), "utf8"), context);
  const drag = { item: { pz_object: {} }, target: { tagName: "LI", pz_object: group, nextElementSibling: { pz_object: group.objects } }, indicatorEl: { remove() {} } };
  PZ.ui.edit.prototype.itemDragUpdate.call(drag); PZ.ui.edit.prototype.itemDragEnd.call(drag, {});
  assert.equal(drops, 1); assert.equal(updates, 1);
  api.setNativeLock(editor, group, true);
  PZ.ui.edit.prototype.itemDragUpdate.call(drag); PZ.ui.edit.prototype.itemDragEnd.call(drag, {});
  assert.equal(drops, 1); assert.equal(drag.operation, 0);
  drag.item.pz_object = group; drag.target = { tagName: "LI", parentElement: { pz_object: list } };
  PZ.ui.edit.prototype.itemDragUpdate.call(drag); assert.equal(drag.operation, 0);
  api.setNativeLock(editor, group, false);
  PZ.ui.edit.prototype.itemDragUpdate.call(drag); assert.equal(drag.operation, 3);
});
test("group changes leave the native fragment, uniform bindings and animated values byte-identical", () => {
  const { PZ, api, editor, list, owner } = host();
  const fx = Object.create(PZ.effect.shader.prototype);
  Object.defineProperty(fx, "parentLayer", { value: { properties: { resolution: { get: () => [320, 180] } } } });
  fx.customProperties = list;
  fx.properties = { enabled: { get: () => true }, fragShader: { get: () => "uniform float Amount; uniform float Size; uniform float Mix; void main(){gl_FragColor=vec4(Amount,Size,Mix,1.0);}" } };
  fx.textures = new Map(); fx.pass = { uniforms: {}, material: { defines: {} }, enabled: true };
  fx.onShaderError = { update(message) { throw new Error(message); } };
  list[0].load({ properties: { name: "Amount" }, animated: true, keyframes: [{ frame: 0, value: .25, tween: 1 }, { frame: 20, value: .75, tween: 1 }] });
  function capture() {
    fx.fragmentShaderNeedsUpdate = true; fx.update(10);
    return JSON.stringify({ uniforms: fx.pass.uniforms, fragment: fx.pass.material.fragmentShader, defines: fx.pass.material.defines, value: list[0].get(10) });
  }
  // The editor owner supplies addresses. The shader reads the same live list.
  owner.customProperties = list;
  const before = capture();
  assert.equal(fx.pass.uniforms.Amount.value, .5);
  api.setGroup(editor, list[0], "Look"); api.setGroup(editor, list[2], "Look");
  api.move(editor, list, "Look", list[1], true);
  api.settings(editor, list, "Look", { name: "Controls", locked: true }); api.collapse(editor, list, "Controls");
  assert.equal(capture(), before);
});
test("a display group lock also covers nested vector component rows", () => {
  const { PZ, api, editor, list } = host();
  const vector = PZ.property.create({ custom: true, dynamic: true, type: PZ.property.type.VECTOR2, value: [.5, .5] });
  list.push(vector); vector.load(); vector.properties.name.set("Point");
  assert.equal(api.propertyLocked(vector.objects[0]), false);
  api.setGroup(editor, vector, "Position"); api.settings(editor, list, "Position", { name: "Position", locked: true });
  assert.equal(api.propertyLocked(vector.objects[0]), true); assert.equal(api.propertyLocked(vector.objects), true);
  vector.objects[0].set(.75, 0); assert.equal(vector.get(0)[0], .75);
  editor.history.undo(); assert.equal(api.propertyLocked(vector.objects[0]), false);
});
test("Alt duplication in an organized list preserves metadata in one reversible step", () => {
  const { PZ, api, editor, list } = host(), view = Object.create(PZ.ui.edit.prototype); view.editor = editor;
  api.setGroup(editor, list[0], "Look"); api.setGroup(editor, list[2], "Other");
  const before = JSON.stringify(list), count = editor.history.undoStack.length;
  assert.equal(api.duplicate(editor, view, list, list[0], "Other", true), true);
  assert.equal(list.length, 4); assert.equal(api.name(list[3]), "Other");
  assert.equal(list[3].properties.name.get(), "Amount"); assert.equal(list[3].get(12), .25);
  assert.equal(editor.history.undoStack.length, count + 1);
  const after = JSON.stringify(list);
  editor.history.undo(); assert.equal(JSON.stringify(list), before);
  editor.history.redo(); assert.equal(JSON.stringify(list), after);
});
test("an unorganized custom-property list retains native same-list drag indices", () => {
  const { PZ, api, editor, list, context } = host();
  const view = Object.create(PZ.ui.edit.prototype); view.editor = editor; view.selectItems = () => {};
  PZ.zoidium = { propertyGroups: api }; context.window = { PZ };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/core/property-groups-drag.js"), "utf8"), context);
  const parent = { pz_object: list }, rows = Array.from(list, pz_object => ({ pz_object, tagName: "LI", parentElement: parent })); parent.children = rows;
  const drag = { ctx: view, item: rows[0], target: rows[1], operation: 2, moved: true, indicatorEl: { remove() {} } };
  PZ.ui.edit.prototype.itemDragEnd.call(drag, { altKey: false });
  assert.deepEqual(Array.from(list, p => p.properties.name.get()), ["Size", "Amount", "Mix"]);
  editor.history.undo(); assert.deepEqual(Array.from(list, p => p.properties.name.get()), ["Amount", "Size", "Mix"]);
});
