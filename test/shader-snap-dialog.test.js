"use strict";
// Snap in Property settings (B35): the Snap field sits next to Step for
// Slider, Seed, Time sample, and Angle. Blank or 0 removes the field, so
// untouched projects keep byte-identical definitions.
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom");
const fs = require("node:fs"), vm = require("node:vm");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { installEditor } = require("../plugins/shader-plus/editor");
const { KINDS } = require("../plugins/shader-plus/kinds");
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
  const { PZ, context: realm } = nativeHost();
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), realm); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  const History = PZ.ui.history;
  PZ.ui = { ...PZ.ui, objectTypes: new Map([[PZ.property, []]]), edit: class {}, properties: class {} };
  const editor = { project: { forEachItemOfType() {}, ui: { onChanged: { update() {} } } }, history: { operation: null, startOperation() {}, pushCommand() {}, finishOperation() {}, discardOperation() {} } };
  const context = { PZ, editor, document: { createElement: tag => new Element(tag) }, window: { setInterval() {}, clearInterval() {} }, lifecycle: { onDispose() {} } };
  editor.onProjectChanged = new PZ.observable();
  editor.history = new History(editor); editor.history.projectChanged();
  const api = installEditor({ context, patch() {}, presetFont: () => null });
  const effect = Object.create(PZ.effect.shader.prototype); effect.customProperties = new PZ.objectList(effect, PZ.property);
  const p = PZ.property.create(definition); effect.customProperties.push(p); p.load(); p.properties.name.set("Value"); p.getAddress = () => [0];
  editor.project.addressLookup = () => p;
  const parent = new Element("ul"), row = new Element("li"); row.append(new Element("div")); parent.append(row);
  api.settings(row, p);
  let panel = parent.lastElementChild;
  function all(node) { return [node, ...node.children.flatMap(all)]; }
  const find = label => all(panel).find(node => node.getAttribute("aria-label") === label);
  const submit = () => all(panel).find(node => node.textContent === "Apply").onclick();
  const error = () => all(panel).find(node => node.classList.contains("zsp-settings-error")).textContent;
  const apply = () => { submit(); assert.equal(error(), ""); };
  const reopen = () => { api.settings(row, p); panel = parent.lastElementChild; };
  const switchKind = kind => { find("Kind").value = kind; find("Kind").onchange(); };
  return { PZ, p, api, editor, find, apply, submit, error, reopen, switchKind };
}
function pasteCopiedJSON(PZ, p) {
  const data = JSON.parse(JSON.stringify(p));
  const q = PZ.property.create(data.type); q.load(data);
  assert.equal(JSON.stringify(q), JSON.stringify(p));
  return q;
}

test("Slider, Seed, Time sample, and Angle settings show Snap next to Step", () => {
  for (const kind of ["slider", "seed", "timeSample", "angle"]) {
    const { find } = setup(KINDS[kind].create());
    assert.ok(find("Snap"), kind + " shows Snap");
    assert.equal(find("Snap").value, "", kind + " starts blank");
  }
  for (const kind of ["checkbox", "dropdown"]) {
    const { find } = setup(KINDS[kind].create());
    assert.equal(find("Snap"), undefined, kind + " shows no Snap field");
  }
});

test("Snap applies, reopens, and survives save/load, copy, undo, and redo", () => {
  const { PZ, p, find, apply, editor, reopen } = setup(KINDS.slider.create());
  find("Snap").value = "0.5"; apply();
  assert.equal(p.definition.snap, 0.5);
  const after = JSON.stringify(p);
  reopen(); assert.equal(find("Snap").value, "0.5");
  apply(); assert.equal(JSON.stringify(p), after);
  editor.history.undo(); assert.equal(p.definition.snap, undefined);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
  const q = pasteCopiedJSON(PZ, p);
  assert.equal(q.definition.snap, 0.5);
  const data = JSON.parse(after), r = PZ.property.create(data.type); r.load(data);
  assert.equal(JSON.stringify(r), after);
});

test("blank and zero Snap remove the field; a negative Snap is rejected without history", () => {
  const first = setup({ ...KINDS.slider.create(), snap: 0.5 });
  first.find("Snap").value = ""; first.apply();
  assert.equal(first.p.definition.snap, undefined);
  const second = setup({ ...KINDS.slider.create(), snap: 0.5 });
  second.find("Snap").value = "0"; second.apply();
  assert.equal(second.p.definition.snap, undefined);
  const { p, find, submit, error, editor } = setup(KINDS.slider.create()), before = JSON.stringify(p);
  find("Snap").value = "-1"; submit();
  assert.match(error(), /positive snap/); assert.equal(JSON.stringify(p), before);
  assert.equal(editor.history.undoStack.length, 0);
});

test("converting to Time sample clears Snap like Step; other kinds drop it on conversion", () => {
  const slider = setup({ ...KINDS.slider.create(), snap: 0.5 });
  slider.switchKind("timeSample");
  assert.equal(slider.find("Snap").value, "");
  slider.apply();
  assert.equal(slider.p.definition.snap, undefined, "conversion drops the stale grid with the stale step");
  const angled = setup({ ...KINDS.slider.create(), snap: 0.25 });
  angled.switchKind("angle");
  assert.equal(angled.find("Snap").value, "");
  angled.apply();
  assert.equal(angled.p.definition.snap, undefined);
  const toggled = setup({ ...KINDS.slider.create(), snap: 0.25 });
  toggled.switchKind("checkbox");
  toggled.apply();
  assert.equal(toggled.p.definition.snap, undefined, "a grid is meaningless on Toggle");
});

test("untouched Apply preserves a hand-added snap on projects saved before this change", () => {
  const legacy = { ...KINDS.timeSample.create(), snap: 2 };
  const { p, apply } = setup(legacy);
  const before = JSON.stringify(p), value = p.get(0);
  apply(); assert.equal(JSON.stringify(p), before); assert.equal(p.get(0), value);
});
