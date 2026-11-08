"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { install } = require("../plugins/core/property-groups");
const { matches } = require("../plugins/shader-plus/visibility");
const copy = value => JSON.parse(JSON.stringify(value));
function host() {
  const h = nativeHost(), { PZ, context } = h;
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), context); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const nativeCreate = PZ.property.create, api = install(PZ), root = new PZ.object(), owner = new PZ.object();
  root.children = [owner]; owner.parent = root;
  const list = new PZ.objectList(owner, PZ.property); owner.customProperties = list; owner.children = [list];
  const editor = { project: { addressLookup: address => address.reduce((node, key) => node.children ? node.children[key] : node[key], root), ui: { onChanged: { update() {} } } }, onProjectChanged: new PZ.observable() };
  editor.history = new PZ.ui.history(editor); editor.history.projectChanged();
  const add = (definition, data) => { const p = PZ.property.create(definition); list.push(p); p.load(data); return p; };
  return { ...h, nativeCreate, api, root, owner, list, editor, add };
}
function sharedNumbers(h) {
  const template = { custom: true, dynamic: true, type: 0, value: .375 };
  const a = h.add(template), b = h.add(template);
  return { template, a, b };
}
test("custom factory isolates native templates while leaving native built-in definitions unchanged", () => {
  const h = host(), { template, a, b } = sharedNumbers(h);
  assert.notEqual(a.definition, b.definition); assert.notEqual(a.definition, template);
  assert.equal(a.type, a.definition); assert.equal(b.type, b.definition);
  const builtin = { name: "Built-in", dynamic: true, type: 0, value: .25 };
  assert.equal(h.PZ.property.create(builtin).definition, builtin, "non-custom definitions keep native behavior");
});
test("grouping shared-template Numbers affects only the selected row and survives history and round trips", () => {
  const h = host(), { api, list, editor, add, PZ } = h, { template, a, b } = sharedNumbers(h);
  const before = JSON.stringify(list), originalTemplate = JSON.stringify(template);
  api.setGroup(editor, a, "Controls");
  assert.deepEqual(Array.from(list, p => api.name(p)), ["Controls", ""]);
  assert.equal(editor.history.undoStack.length, 1); const grouped = JSON.stringify(list);
  editor.history.undo(); assert.equal(JSON.stringify(list), before);
  editor.history.redo(); assert.equal(JSON.stringify(list), grouped);
  api.collapse(editor, list, "Controls");
  assert.equal(api.meta(a).collapsed, true); assert.equal(api.meta(b).collapsed, undefined);
  assert.equal(editor.history.undoStack.length, 1, "collapse stays outside history");
  api.settings(editor, list, "Controls", { name: "Renamed", locked: true });
  assert.equal(api.name(a), "Renamed"); assert.equal(api.name(b), "");
  editor.history.undo(); assert.equal(api.name(a), "Controls"); assert.equal(api.meta(a).collapsed, true);
  editor.history.redo(); assert.equal(api.name(a), "Renamed"); assert.equal(api.meta(a).collapsed, true);
  const saved = copy(list), reopened = saved.map(data => { const p = PZ.property.create(data.type); p.load(data); return p; });
  assert.equal(JSON.stringify(reopened), JSON.stringify(list));
  const duplicate = PZ.property.create(a.type); duplicate.load(a);
  assert.equal(JSON.stringify(duplicate), JSON.stringify(a)); assert.notEqual(duplicate.definition, a.definition);
  duplicate.definition.zoidiumPropertyGroup.name = "Duplicate only";
  assert.equal(api.name(a), "Renamed"); assert.equal(api.name(b), "");
  assert.equal(api.name(add(template)), ""); assert.equal(JSON.stringify(template), originalTemplate);
  assert.deepEqual(Array.from(list, p => p.get(0)), [.375, .375, .375]);
});
test("grouping the last Number and deleting a grouped list never contaminate the template", () => {
  const h = host(), { api, list, editor, add, owner, PZ } = h, { template, a, b } = sharedNumbers(h);
  api.setGroup(editor, b, "Last");
  assert.equal(api.name(a), ""); assert.equal(api.name(b), "Last");
  editor.history.undo(); editor.history.redo();
  list.splice(0, list.length);
  const fresh = new PZ.objectList(owner, PZ.property); owner.customProperties = fresh;
  const p = PZ.property.create(template); fresh.push(p); p.load();
  assert.equal(api.name(p), ""); assert.equal(api.name(add(template)), "");
});
test("nested Shader metadata and vector component definitions are owned before any settings edit", () => {
  const h = host(), { add, PZ } = h;
  const template = { custom: true, dynamic: true, group: true, type: 1, objects: [0, 1].map((value, i) => ({ dynamic: true, type: 0, name: ["X", "Y"][i], value })),
    zoidiumShader: { visibleWhen: { property: "Mode", values: [1] }, default: [0, 1] }, zoidiumPropertyGroup: { name: "Keep" } };
  const savedTemplate = JSON.stringify(template), a = add(template), b = add(template);
  a.definition.zoidiumShader.visibleWhen.values.push(2); a.definition.zoidiumShader.default[0] = 5;
  a.objects[0].definition.value = 4; a.definition.zoidiumPropertyGroup.collapsed = true;
  assert.equal(JSON.stringify(template), savedTemplate);
  assert.equal(matches(b.definition.zoidiumShader.visibleWhen, 2), false);
  assert.equal(b.objects[0].getDefaultValue(), 0); assert.equal(b.definition.zoidiumPropertyGroup.collapsed, undefined);
  const saved = copy(b), c = PZ.property.create(saved.type), d = PZ.property.create(saved.type); c.load(saved); d.load(saved);
  assert.equal(JSON.stringify(c), JSON.stringify(b)); assert.equal(JSON.stringify(d), JSON.stringify(b));
  c.definition.zoidiumShader.visibleWhen.values.push(3);
  assert.equal(matches(d.definition.zoidiumShader.visibleWhen, 3), false);
  assert.equal(JSON.stringify(saved), JSON.stringify(b));
});
test("creation and repeated loads preserve native JSON, default callbacks and evaluated values", () => {
  const { PZ, nativeCreate, add } = host();
  for (const definition of [
    { custom: true, dynamic: true, type: 0, value: .375 },
    { custom: true, dynamic: true, group: true, type: 1, objects: [0, 1].map(value => ({ dynamic: true, type: 0, name: String(value), value })) },
    { custom: true, type: 7, value: "Saved text", zoidiumShader: { help: "Keep", visibleWhen: { property: "Mode", values: [2] } } },
  ]) {
    const original = nativeCreate.call(PZ.property, definition); original.load(); const saved = copy(original);
    const a = add(definition), b = add(saved.type, saved), c = add(saved.type, saved);
    for (const p of [a, b, c]) { assert.equal(JSON.stringify(p), JSON.stringify(original)); assert.equal(JSON.stringify(p.get(7)), JSON.stringify(original.get(7))); assert.equal(p.type, p.definition); }
    assert.notEqual(b.definition, c.definition); assert.equal(JSON.stringify(saved), JSON.stringify(original));
  }
  const changed = () => {}, value = () => {}, definition = { custom: true, dynamic: true, type: 0, changed, value };
  const p = PZ.property.create(definition);
  assert.equal(p.definition.changed, changed); assert.equal(p.getDefaultValue(), value);
  assert.notEqual(p.definition, definition);
});
