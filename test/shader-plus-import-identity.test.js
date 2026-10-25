"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host, fixture, editorFor, deferred } = require("./helpers/editor-identity-host.cjs");
const { installControls } = require("../plugins/shader-plus/controls.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
function setup() {
  const c = host(), { PZ } = c;
  function projectWithText(text) {
    const f = fixture(c), effect = new PZ.effect.shader();
    f.layer.effects.push(effect); effect.properties.load();
    const property = PZ.property.create(KINDS.text.create());
    effect.customProperties.push(property); property.load();
    property.set(JSON.stringify({ text, font: null, size: 128 }));
    return { ...f, effect, property };
  }
  const a = projectWithText("Project A"), b = projectWithText("Project B");
  const editor = editorFor(PZ, a.project), elements = [], controls = new Map();
  const ul = { pz_controls: { editor, propertyOps: new PZ.ui.properties(editor) } };
  function element(tag) {
    const node = { tag, style: {}, children: [], setAttribute(k, v) { this[k] = v; },
      append(...nodes) { for (const n of nodes) { n.parentElement = this; this.children.push(n); } },
      addEventListener() {}, closest() { return ul; } };
    elements.push(node); return node;
  }
  const api = installControls({ PZ, doc: { createElement: element }, editor: () => editor,
    register(id, _type, create) { controls.set(id, create); } });
  const box = controls.get("shader-plus/text")(a.property);
  const file = elements.find(el => el.type === "file"), gate = deferred(), released = [];
  file.files = [{ name: "test.ttf" }];
  a.project.assets.createFromFile = () => gate.promise;
  a.project.assets.removeIfUnused = asset => released.push(asset);
  b.project.assets.removeIfUnused = () => assert.fail("Asset cleanup used the replacement project");
  return { a, b, editor, api, anchor: box.children[0], file, gate, released };
}
test("late Shader+ font import cannot write or record undo in a replacement project", async () => {
  const h = setup(), beforeA = h.a.property.get(), beforeB = h.b.property.get();
  const importing = h.file.onchange(); h.editor.project = h.b.project;
  const asset = { key: "font-A" }; h.gate.resolve(asset); await importing;
  assert.equal(h.a.property.get(), beforeA); assert.equal(h.b.property.get(), beforeB);
  assert.equal(h.editor.history.undoStack.length, 0); assert.equal(h.editor.history.operation, null);
  assert.deepEqual(h.released, [asset]);
});
test("font import rejects a replaced property at the same address and releases its asset", async () => {
  const h = setup(), before = h.a.property.get(), importing = h.file.onchange();
  const replacement = h.a.property.constructor.create(KINDS.text.create()); replacement.load();
  h.a.effect.customProperties.splice(0, 1, replacement);
  h.gate.resolve({ key: "font-A" }); await importing;
  assert.equal(h.a.property.get(), before); assert.equal(h.editor.history.undoStack.length, 0);
  assert.equal(h.released.length, 1);
});
test("shared Shader+ commit rejects stale controls before opening native history", () => {
  const h = setup(), beforeA = h.a.property.get(), beforeB = h.b.property.get();
  h.editor.project = h.b.project;
  assert.equal(h.api.commit(h.anchor, h.a.property, "stale"), false);
  assert.equal(h.a.property.get(), beforeA); assert.equal(h.b.property.get(), beforeB);
  assert.equal(h.editor.history.undoStack.length, 0);
  h.editor.project = h.a.project;
  h.a.effect.customProperties.splice(0, 1);
  assert.equal(h.api.commit(h.anchor, h.a.property, "detached"), false);
  assert.equal(h.editor.history.operation, null);
});
test("attached Shader+ font import preserves native undo and redo", async () => {
  const h = setup(), before = h.a.property.get(), importing = h.file.onchange();
  h.gate.resolve({ key: "font-A" }); await importing;
  const after = h.a.property.get();
  assert.deepEqual(JSON.parse(after), { text: "Project A", font: "font-A", size: 128 });
  assert.equal(h.editor.history.undoStack.length, 1); assert.deepEqual(h.released, []);
  h.editor.history.undo(); assert.equal(h.a.property.get(), before);
  h.editor.history.redo(); assert.equal(h.a.property.get(), after);
});
