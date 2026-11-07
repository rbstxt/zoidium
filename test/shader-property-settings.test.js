"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom");
const { nativeHost } = require("./expressions-plus-harness");
const { installEditor } = require("../plugins/shader-plus/editor");
class Element extends FakeElement {
  get value() { return this._value || ""; }
  set value(value) { this._value = String(value ?? ""); }
  get lastElementChild() { return this.children.at(-1); }
  get selectedIndex() { return this.children.findIndex(c => c.value === this.value); }
  set selectedIndex(index) { this.value = this.children[index]?.value || ""; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  insertBefore(child, ref) { child.parentElement?.removeChild(child); return super.insertBefore(child, ref); }
  after(node) { this.parentElement.insertBefore(node, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]); }
}
function setup(definition) {
  const { PZ } = nativeHost();
  PZ.ui = { objectTypes: new Map([[PZ.property, []]]), edit: class {}, properties: class {} };
  let edits = 0;
  const editor = { project: { forEachItemOfType() {}, ui: { onChanged: { update() {} } } },
    history: { operation: null, startOperation() { edits++; }, pushCommand() {}, finishOperation() {}, discardOperation() {} } };
  const context = { PZ, editor, document: { createElement: tag => new Element(tag) }, window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } };
  const api = installEditor({ context, patch() {}, presetFont: () => null });
  const effect = Object.create(PZ.effect.shader.prototype); effect.customProperties = new PZ.objectList(effect, PZ.property);
  const p = PZ.property.create(definition); effect.customProperties.push(p); p.load(); p.properties.name.set("Value"); p.getAddress = () => [0];
  const parent = new Element("ul"), row = new Element("li"); row.append(new Element("div")); parent.append(row);
  api.settings(row, p);
  const panel = parent.lastElementChild;
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const find = label => all(panel).find(node => node.getAttribute("aria-label") === label);
  const apply = () => { all(panel).find(node => node.textContent === "Apply").onclick(); assert.equal(all(panel).find(node => node.className === "zsp-settings-error").textContent, ""); };
  return { PZ, p, api, find, apply, edits: () => edits };
}
test("native numeric settings show Slider ranges and untouched Apply preserves the exact definition", () => {
  const { p, find, apply, edits } = setup({ custom: true, dynamic: true, type: 0, value: .375, decimals: 5 });
  const before = JSON.stringify(p);
  assert.equal(find("Kind").value, "slider"); assert.ok(find("Minimum")); assert.ok(find("Maximum"));
  apply(); assert.equal(JSON.stringify(p), before); assert.equal(edits(), 0);
});
test("native numeric range edits retain the control, keys, expression, and current value", () => {
  const { PZ, p, find, apply, edits } = setup({ custom: true, dynamic: true, type: 0, value: .375, decimals: 5 });
  p.expression = new PZ.expression("0.375"); p.expression.evaluate = () => .375;
  const expression = p.expression;
  const keys = JSON.stringify(p.keyframes);
  find("Minimum").value = "-2"; find("Maximum").value = "3"; apply();
  assert.equal(p.expression, expression); assert.equal(p.definition.min, -2); assert.equal(p.definition.max, 3);
  assert.equal(p.definition.zoidiumControl, undefined); assert.equal(p.definition.zoidiumShader.kind, undefined);
  assert.equal(p.definition.decimals, 5); assert.equal(p.get(0), .375); assert.equal(JSON.stringify(p.keyframes), keys); assert.equal(edits(), 1);
});
for (const definition of [
  { type: 0, value: 4 }, { type: 1, dynamic: true, group: true, objects: [{ dynamic: true, type: 0, value: 1 }, { dynamic: true, type: 0, value: 2 }] },
  { type: 2, dynamic: true, group: true, objects: [0, 1, 2].map(value => ({ dynamic: true, type: 0, value })) },
  { type: 3, dynamic: true, group: true, objects: [0, 1, 2, 3].map(value => ({ dynamic: true, type: 0, value })) },
  { type: 4, value: null }, { type: 5, value: [] },
  { type: 8, value: null }, { type: 9, value: null }, { type: 10, value: [] }, { type: 11, value: "void main() {}" }, { type: 6, value: "0", items: "First;Second" }, { type: 7, value: "literal text" },
]) test("kind-less native type " + definition.type + " retains its definition on Apply and metadata edits", () => {
  const { p, find, apply } = setup({ custom: true, ...definition });
  const before = JSON.stringify(p.definition), value = JSON.stringify(p.get(0));
  assert.equal(find("Kind").value, "native"); apply(); assert.equal(JSON.stringify(p.definition), before);
  const edited = setup({ custom: true, ...definition });
  edited.find("Tooltip").value = "Help text"; edited.apply();
  assert.equal(edited.p.definition.zoidiumShader.help, "Help text");
  assert.equal(edited.p.definition.zoidiumShader.kind, undefined);
  assert.equal(edited.p.definition.zoidiumControl, undefined);
  assert.equal(JSON.stringify(edited.p.get(0)), value);
});
