"use strict";
// Time sample and the other numeric kinds expose Minimum, Maximum, Step, and
// Decimals in Property settings. Converted properties start unbounded with
// the units step (a stale slider range must not clamp the offset); explicit
// values, including min/max/step added by hand to the saved JSON, survive
// Apply, reopen, save/load, Undo/Redo, and a JSON copy round trip.
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
  const editor = { project: { forEachItemOfType() {}, ui: { onChanged: { update() {} } } },
    history: { operation: null, startOperation() {}, pushCommand() {}, finishOperation() {}, discardOperation() {} } };
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
  // Apply closes the settings; reopen keeps working on the fresh panel while
  // the detached panel above stays readable for the error assertion.
  const reopen = () => { api.settings(row, p); panel = parent.lastElementChild; };
  const switchKind = kind => { find("Kind").value = kind; find("Kind").onchange(); };
  return { PZ, p, api, editor, effect, find, apply, submit, error, reopen, switchKind };
}
// A JSON copy round trip, as when a user copies the property JSON by hand.
function pasteCopiedJSON(PZ, p) {
  const data = JSON.parse(JSON.stringify(p));
  const q = PZ.property.create(data.type); q.load(data);
  assert.equal(JSON.stringify(q), JSON.stringify(p));
  return q;
}

test("Time sample settings show Minimum, Maximum, Step, Decimals, and Offset units", () => {
  const { find } = setup(KINDS.timeSample.create());
  assert.equal(find("Minimum").value, ""); assert.equal(find("Maximum").value, "");
  assert.equal(find("Step").value, "1"); assert.equal(find("Decimals").value, "3");
  assert.equal(find("Offset units").value, "frames");
});

test("Slider, Seed, and Angle settings show Decimals; Toggle and Dropdown do not", () => {
  for (const kind of ["slider", "seed"]) {
    const { find } = setup(KINDS[kind].create());
    assert.ok(find("Minimum")); assert.ok(find("Maximum")); assert.ok(find("Step")); assert.ok(find("Decimals"));
  }
  const angle = setup(KINDS.angle.create());
  assert.ok(angle.find("Decimals")); assert.equal(angle.find("Decimals").value, "1");
  assert.equal(angle.find("Minimum"), undefined);
  for (const kind of ["checkbox", "dropdown"]) {
    const { find } = setup(KINDS[kind].create());
    assert.equal(find("Minimum"), undefined); assert.equal(find("Decimals"), undefined);
  }
});

test("converting a Slider to Time sample drops the stale range and uses the units step", () => {
  const { p, find, apply, editor, switchKind } = setup(KINDS.slider.create());
  const before = JSON.stringify(p);
  switchKind("timeSample");
  assert.equal(find("Minimum").value, ""); assert.equal(find("Maximum").value, "");
  assert.equal(find("Step").value, ""); assert.equal(find("Decimals").value, "3");
  apply();
  assert.equal(p.definition.min, undefined); assert.equal(p.definition.max, undefined);
  assert.equal(p.definition.step, 1); assert.equal(p.definition.decimals, 3);
  assert.equal(p.definition.zoidiumShader.units, "frames");
  const after = JSON.stringify(p); editor.history.undo(); assert.equal(JSON.stringify(p), before);
  editor.history.redo(); assert.equal(JSON.stringify(p), after);
});

test("converting to seconds Time sample keeps explicit min, max, step, and decimals", () => {
  const { PZ, p, find, apply, editor, switchKind } = setup(KINDS.slider.create());
  switchKind("timeSample");
  find("Offset units").value = "seconds";
  find("Minimum").value = "-5"; find("Maximum").value = "10"; find("Step").value = "0.5"; find("Decimals").value = "1";
  apply();
  assert.equal(p.definition.min, -5); assert.equal(p.definition.max, 10);
  assert.equal(p.definition.step, 0.5); assert.equal(p.definition.decimals, 1);
  assert.equal(p.definition.zoidiumShader.units, "seconds");
  const after = JSON.stringify(p); editor.history.undo(); editor.history.redo();
  assert.equal(JSON.stringify(p), after);
  pasteCopiedJSON(PZ, p);
});

test("hand-added Time sample min, max, and step survive Apply, reopen, save/load, and copy", () => {
  const definition = KINDS.timeSample.create();
  definition.min = -5; definition.max = 10; definition.step = 0.5;
  const { PZ, p, find, apply, editor, reopen } = setup(definition);
  const value = p.get(0);
  assert.equal(find("Minimum").value, "-5"); assert.equal(find("Maximum").value, "10");
  assert.equal(find("Step").value, "0.5"); assert.equal(find("Decimals").value, "3");
  const before = JSON.stringify(p);
  apply(); assert.equal(JSON.stringify(p), before); assert.equal(p.get(0), value);
  reopen();
  assert.equal(find("Minimum").value, "-5"); assert.equal(find("Maximum").value, "10");
  assert.equal(find("Step").value, "0.5"); assert.equal(find("Decimals").value, "3");
  apply(); assert.equal(JSON.stringify(p), before);
  const after = JSON.stringify(p); editor.history.undo(); editor.history.redo();
  assert.equal(JSON.stringify(p), after);
  const data = JSON.parse(after), q = PZ.property.create(data.type); q.load(data);
  assert.equal(JSON.stringify(q), after);
  pasteCopiedJSON(PZ, p);
});

test("untouched Apply preserves projects saved before the new fields existed", () => {
  const legacy = { custom: true, dynamic: true, type: 0, value: -2, step: 1, decimals: 3, zoidiumShader: { kind: "timeSample", units: "frames" } };
  const { p, apply } = setup(legacy);
  const before = JSON.stringify(p), value = p.get(0);
  apply(); assert.equal(JSON.stringify(p), before); assert.equal(p.get(0), value);
  const legacySlider = { custom: true, dynamic: true, type: 0, value: .375, min: 0, max: 1, step: .01, decimals: 5 };
  const slider = setup(legacySlider);
  const sliderBefore = JSON.stringify(slider.p);
  slider.apply(); assert.equal(JSON.stringify(slider.p), sliderBefore);
  assert.equal(slider.p.definition.decimals, 5);
});

test("a bad decimals value leaves the settings open and writes no history", () => {
  const { p, find, submit, error, editor } = setup(KINDS.timeSample.create()), before = JSON.stringify(p);
  find("Decimals").value = "2.5"; submit();
  assert.match(error(), /decimals/); assert.equal(JSON.stringify(p), before); assert.equal(editor.history.undoStack.length, 0);
  find("Decimals").value = "-1"; submit();
  assert.match(error(), /decimals/); assert.equal(JSON.stringify(p), before); assert.equal(editor.history.undoStack.length, 0);
});

test("an unordered Time sample range is rejected like Slider ranges", () => {
  const { p, find, submit, error, editor } = setup(KINDS.timeSample.create()), before = JSON.stringify(p);
  find("Minimum").value = "4"; find("Maximum").value = "2"; submit();
  assert.match(error(), /ordered range/); assert.equal(JSON.stringify(p), before); assert.equal(editor.history.undoStack.length, 0);
});
