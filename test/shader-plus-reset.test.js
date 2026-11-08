"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { KINDS, ORDER } = require("../plugins/shader-plus/kinds");
const { installReset } = require("../plugins/shader-plus/reset");
const copy = value => JSON.parse(JSON.stringify(value));
function host() {
  const native = nativeHost(), { PZ, context } = native;
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), context); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const root = new PZ.object(), effect = Object.create(PZ.effect.shader.prototype);
  root.children = [effect]; effect.parent = root;
  effect.customProperties = new PZ.objectList(effect, PZ.property); effect.children = [effect.customProperties];
  const editor = { project: { addressLookup: address => address.reduce((node, key) => node.children ? node.children[key] : node[key], root), ui: { onChanged: { update() {} } } }, onProjectChanged: new PZ.observable() };
  editor.history = new PZ.ui.history(editor); editor.history.projectChanged();
  const api = installReset({ context: { PZ, editor }, patch: native.patch });
  return { PZ, effect, editor, api };
}
for (const kind of ORDER) test(kind + " resets defaults and clears animation and expressions in one reversible operation", () => {
  const { PZ, effect, editor, api } = host(), definition = KINDS[kind].create();
  const p = PZ.property.create(definition); effect.customProperties.push(p); p.load();
  function change(q) {
    if (q.objects) return q.objects.forEach(change);
    if (q.keyframes) {
      q.animated = true; q.keyframes[0].value = 9; q.keyframes[0].frame = 3;
      q.addKeyframe(new PZ.keyframe(13, 12)); q.expression = new PZ.expression("17");
    } else q.set("changed");
  }
  change(p);
  const expected = p.objects ? Array.from(p.objects, q => q.definition.value) : definition.value;
  const before = JSON.stringify(p);
  assert.equal(api.resetCustom(effect), true);
  assert.equal(editor.history.undoStack.length, 1);
  assert.deepEqual(copy(p.get(23)), copy(kind === "staticDropdown" ? String(expected) : expected));
  function cleared(q) { assert.equal(!!q.expression, false); if (q.objects) q.objects.forEach(cleared); else if (q.keyframes) { assert.equal(q.animated, false); assert.equal(q.keyframes.length, 1); assert.equal(q.keyframes[0].frame, 0); } }
  cleared(p);
  const after = JSON.stringify(p);
  editor.history.undo(); assert.equal(JSON.stringify(p), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  const saved = copy(p), reopened = PZ.property.create(saved.type); reopened.load(saved);
  assert.equal(JSON.stringify(reopened), after);
  const duplicate = PZ.property.create(saved.type); duplicate.load(saved); assert.equal(JSON.stringify(duplicate), after);
});
test("an explicit Shader+ Default overrides the definition value, including zero and vectors", () => {
  const { PZ, effect, editor, api } = host();
  for (const kind of ["slider", "checkbox", "point", "color4", "gradient", "text", "staticDropdown"]) {
    const definition = KINDS[kind].create();
    definition.zoidiumShader.default = definition.group ? [0, 0, 0, 0].slice(0, definition.objects.length) : definition.type === 7 ? "saved default" : 0;
    const p = PZ.property.create(definition); effect.customProperties.push(p); p.load();
  }
  const before = JSON.stringify(effect.customProperties);
  api.resetCustom(effect);
  for (const p of effect.customProperties) assert.deepEqual(copy(p.get(30)), copy(p.definition.type === 6 ? String(p.definition.zoidiumShader.default) : p.definition.zoidiumShader.default));
  editor.history.undo(); assert.equal(JSON.stringify(effect.customProperties), before);
});
test("only the Shader Properties list excludes fragment source from native resetAll", () => {
  const { PZ, editor } = host();
  const shader = Object.create(PZ.effect.shader.prototype);
  shader.properties = new PZ.propertyList({ name: { type: 7, value: "Shader" }, fragShader: { type: 11, value: "default" }, enabled: { type: 0, value: 1 } }, shader);
  shader.properties.load();
  const ops = new PZ.ui.properties(editor), reset = []; ops.reset = p => reset.push(p);
  ops.resetAll(shader.properties);
  assert.deepEqual(reset, [shader.properties.name, shader.properties.enabled]);
  reset.length = 0;
  const other = new PZ.propertyList({ fragShader: { type: 11, value: "other" } }, new PZ.object()); other.load();
  ops.resetAll(other); assert.deepEqual(reset, [other.fragShader]);
});
