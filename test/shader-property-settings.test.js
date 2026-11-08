"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom");
const fs = require("node:fs"), vm = require("node:vm");
const { nativeHost, cache } = require("./expressions-plus-harness");
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
function setup(definition, controllers = []) {
  const { PZ, context: realm } = nativeHost();
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), realm); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const History = PZ.ui.history;
  PZ.ui = { ...PZ.ui, objectTypes: new Map([[PZ.property, []]]), edit: class {}, properties: class {} };
  let edits = 0;
  const editor = { project: { forEachItemOfType() {}, ui: { onChanged: { update() {} } } },
    history: { operation: null, startOperation() { edits++; }, pushCommand() {}, finishOperation() {}, discardOperation() {} } };
  const context = { PZ, editor, document: { createElement: tag => new Element(tag) }, window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } };
  editor.onProjectChanged = new PZ.observable();
  editor.history = new History(editor); editor.history.projectChanged();
  const start = editor.history.startOperation.bind(editor.history);
  editor.history.startOperation = () => { edits++; start(); };
  const api = installEditor({ context, patch() {}, presetFont: () => null });
  const effect = Object.create(PZ.effect.shader.prototype); effect.customProperties = new PZ.objectList(effect, PZ.property);
  const p = PZ.property.create(definition); effect.customProperties.push(p); p.load(); p.properties.name.set("Value"); p.getAddress = () => [0];
  editor.project.addressLookup = () => p;
  const parent = new Element("ul"), row = new Element("li"); row.append(new Element("div")); parent.append(row);
  for (const record of controllers) { const q = PZ.property.create(record.definition); effect.customProperties.push(q); q.load(); q.properties.name.set(record.name); if (record.expression) q.expression = record.expression; }
  api.settings(row, p);
  const panel = parent.lastElementChild;
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const find = label => all(panel).find(node => node.getAttribute("aria-label") === label);
  const submit = () => all(panel).find(node => node.textContent === "Apply").onclick();
  const error = () => all(panel).find(node => node.classList.contains("zsp-settings-error")).textContent;
  const apply = () => { submit(); assert.equal(error(), ""); };
  return { PZ, p, api, editor, find, apply, submit, error, edits: () => edits };
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

const { KINDS } = require("../plugins/shader-plus/kinds");
const { matches } = require("../plugins/shader-plus/visibility");
test("Toggle display changes only metadata and survives undo, redo, reopen, and duplication", () => {
  const { PZ, p, find, apply, editor } = setup(KINDS.checkbox.create());
  p.keyframes[0].value = .375;
  const keys = JSON.stringify(p.keyframes), before = JSON.stringify(p);
  find("Display").value = "checkbox"; apply();
  assert.equal(p.get(0), .375); assert.equal(JSON.stringify(p.keyframes), keys);
  assert.equal(p.definition.zoidiumShader.display, "checkbox");
  const after = JSON.stringify(p); editor.history.undo(); assert.equal(JSON.stringify(p), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  for (let i = 0; i < 2; i++) { const data = JSON.parse(after), q = PZ.property.create(data.type); q.load(data); assert.equal(JSON.stringify(q), after); }
});
test("Visible when comparisons survive undo, redo, reopen, and duplication without changing values", () => {
  const { PZ, p, find, apply, editor } = setup(KINDS.slider.create());
  const before = JSON.stringify(p), value = p.get(0);
  find("Visible when").value = "Controller"; find("Has value").value = "> 5.5; 1..5; != 3"; apply();
  const when = p.definition.zoidiumShader.visibleWhen;
  assert.equal(matches(when, 6), true); assert.equal(matches(when, 3), true); assert.equal(p.get(0), value);
  const after = JSON.stringify(p); editor.history.undo(); assert.equal(JSON.stringify(p), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  for (let i = 0; i < 2; i++) { const data = JSON.parse(after), q = PZ.property.create(data.type); q.load(data); assert.equal(JSON.stringify(q), after); }
});
test("invalid visibility input leaves the settings open and does not write history", () => {
  const { p, find, submit, error, editor } = setup(KINDS.slider.create()), before = JSON.stringify(p);
  find("Visible when").value = "Controller"; find("Has value").value = "> nope"; submit();
  assert.match(error(), /Use a number/); assert.equal(JSON.stringify(p), before); assert.equal(editor.history.undoStack.length, 0);
});
test("editing unrelated settings retains legacy literal operator strings exactly", () => {
  const definition = KINDS.slider.create(); definition.zoidiumShader.visibleWhen = { property: "Controller", values: ["> 5", "1..5", "3", 3] };
  const { p, find, apply } = setup(definition);
  find("Tooltip").value = "Help"; apply(); assert.deepEqual(p.definition.zoidiumShader.visibleWhen, definition.zoidiumShader.visibleWhen);
  assert.equal(matches(p.definition.zoidiumShader.visibleWhen, "> 5"), true);
  assert.equal(matches(p.definition.zoidiumShader.visibleWhen, 6), false);
});

test("editing one native property leaves its shared template and peers unchanged", () => {
  const template = { custom: true, dynamic: true, type: 0, value: .375 };
  const { PZ, p, find, apply, editor } = setup(template);
  const peer = PZ.property.create(template); peer.load();
  const before = JSON.stringify(template), savedPeer = JSON.stringify(peer);
  find("Visible when").value = "Controller"; find("Has value").value = "1"; apply();
  assert.equal(JSON.stringify(template), before);
  assert.equal(JSON.stringify(peer), savedPeer);
  assert.equal(p.type, p.definition, "native serialization uses the edited owned definition");
  assert.notEqual(p.definition, template);
  const after = JSON.stringify(p);
  editor.history.undo(); assert.equal(JSON.stringify(p.definition), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  const next = PZ.property.create(template); next.load();
  assert.equal(next.definition.zoidiumShader, undefined);
});

test("an unreachable menu condition warns and still saves in one reversible operation", () => {
  const { PZ, p, find, submit, error, editor } = setup(KINDS.slider.create(), [{ name: "Mode", definition: KINDS.dropdown.create() }]);
  const before = JSON.stringify(p), value = p.get(0);
  find("Visible when").value = "Mode"; find("Has value").value = "3"; find("Has value").dispatch("input");
  assert.match(error(), /cannot match/); submit();
  assert.equal(editor.history.undoStack.length, 1); assert.equal(p.get(0), value);
  assert.deepEqual(p.definition.zoidiumShader.visibleWhen, { property: "Mode", values: [3] });
  const after = JSON.stringify(p); editor.history.undo(); assert.equal(JSON.stringify(p), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  for (let i = 0; i < 2; i++) { const data = JSON.parse(after), q = PZ.property.create(data.type); q.load(data); assert.equal(JSON.stringify(q), after); }
});
test("a reachable menu condition saves without an unreachable warning", () => {
  const { find, apply, error } = setup(KINDS.slider.create(), [{ name: "Mode", definition: KINDS.dropdown.create() }]);
  find("Visible when").value = "Mode"; find("Has value").value = "2"; find("Has value").dispatch("input");
  assert.equal(error(), ""); apply();
});
