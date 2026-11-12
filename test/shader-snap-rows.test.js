"use strict";
// Snap rows (B35): the native number input of a Shader+ row rounds committed
// edits to the snap grid, while rows without an active snap behave exactly
// like the native input. Slider's range bar and Seed's randomize button
// commit through the same grid.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { FakeElement } = require("./fake-dom");
const { nativeHost, cache } = require("./expressions-plus-harness");
const { KINDS } = require("../plugins/shader-plus/kinds");
const snap = require("../plugins/shader-plus/snap");

class Element extends FakeElement {
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value == null ? "" : String(value); }
  get value() { return this._value ?? ""; }
  set value(value) { this._value = String(value ?? ""); }
  get lastElementChild() { return this.children.at(-1); }
  get selectedIndex() { return this.children.findIndex(c => c.value === this.value); }
  set selectedIndex(index) { this.value = this.children[index]?.value || ""; }
  // The native row code walks LI ancestors by tag; FakeElement only matches classes.
  closest(selector) {
    const want = String(selector || "");
    let node = this;
    while (node) {
      if (want.startsWith(".") ? node.classList?.contains(want.slice(1)) : node.tagName === want.toUpperCase()) return node;
      node = node.parentElement;
    }
    return null;
  }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  insertBefore(child, ref) { child.parentElement?.removeChild(child); return super.insertBefore(child, ref); }
  after(node) { this.parentElement.insertBefore(node, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]); }
  setAttributeNS(ns, key, value) { this.setAttribute(key, value); }
}
function document() {
  const doc = {};
  doc.createElement = tag => { const el = new Element(tag); el.ownerDocument = doc; return el; };
  doc.createElementNS = (ns, tag) => doc.createElement(tag);
  doc.head = doc.createElement("head"); doc.body = doc.createElement("body");
  doc.getElementById = () => null;
  doc.addEventListener = () => {};
  return doc;
}
// The native input class reads these globals; the harness realm has none.
function realm() {
  const { PZ, context } = nativeHost();
  context.document = document();
  context.NodeList = class {};
  context.window = { getSelection: () => ({ removeAllRanges() {} }) };
  try { vm.runInContext(fs.readFileSync(cache + "/ui-1.0.72.js", "utf8"), context); }
  catch (error) { if (error.message !== "Image is not defined") throw error; }
  return { PZ, context };
}
function listWith(PZ, definitions) {
  const owner = new PZ.object(), list = new PZ.objectList(owner, PZ.property);
  owner.children = [list];
  const properties = definitions.map(definition => {
    const p = PZ.property.create(definition);
    list.push(p); p.load(); return p;
  });
  return { owner, list, properties };
}
// Same wrapper shader-plus.js installs around PZ.ui.controls.generateInput.
function installWrapper(PZ) {
  const original = PZ.ui.controls.generateInput;
  PZ.ui.controls.generateInput = function (property) {
    if (snap.isSnapActive(property?.definition)) return snap.createWithSnap(PZ, property, () => original.call(this, property));
    return original.call(this, property);
  };
}
function captureInput(PZ, create) {
  const Saved = PZ.ui.input;
  let captured;
  PZ.ui.input = function (options) { captured = new Saved(options); return captured; };
  PZ.ui.input.prototype = Saved.prototype;
  try { const box = create(); return { box, input: captured }; }
  finally { PZ.ui.input = Saved; }
}
function nest(box) {
  const li = box.ownerDocument.createElement("li"), ul = box.ownerDocument.createElement("ul");
  li.appendChild(box); ul.appendChild(li); box.pz_frame = 0;
  return { li, ul };
}

test("a snapped Slider row commits the grid value through the native edit path", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const { properties: [p] } = listWith(PZ, [{ ...KINDS.slider.create(), snap: 0.5 }]);
  const { box, input } = captureInput(PZ, () => PZ.ui.controls.generateInput(p));
  assert.equal(Object.hasOwn(input, "set"), true, "the row instance carries the snap override");
  nest(box);
  input.el.innerText = "0.62";
  input.setValue(parseFloat(input.el.innerText));
  assert.equal(p.get(0), 0.5, "the snapped value is what gets committed");
  box.pz_update(0);
  assert.equal(box.children[0].innerText, "0.50", "the row displays the committed grid value");
});

test("a snapped Time sample row wraps the bare native row Shader+ never builds", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const { properties: [p] } = listWith(PZ, [{ ...KINDS.timeSample.create(), snap: 2 }]);
  assert.equal(p.definition.zoidiumControl, undefined, "Time sample rows stay native");
  const { box, input } = captureInput(PZ, () => PZ.ui.controls.generateInput(p));
  assert.equal(Object.hasOwn(input, "set"), true);
  nest(box);
  input.el.innerText = "5.5";
  input.setValue(parseFloat(input.el.innerText));
  assert.equal(p.get(0), 6, "2.75 grids round half away from zero to 6");
  input.keydown({ key: "ArrowUp" });
  assert.equal(p.get(0), 8, "arrow keys snap too: 6 + step 1 lands on 8");
});

test("a native row without an active snap behaves exactly like the native input", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const { properties: [plain, kindless] } = listWith(PZ, [
    { ...KINDS.slider.create() },
    { custom: true, dynamic: true, type: 0, value: 0, min: 0, max: 1, step: 0.01, decimals: 2, snap: 0.5 },
  ]);
  for (const p of [plain, kindless]) {
    const { box, input } = captureInput(PZ, () => PZ.ui.controls.generateInput(p));
    assert.equal(Object.hasOwn(input, "set"), false, "no override without an active snap");
    nest(box);
    input.el.innerText = "0.62";
    input.setValue(parseFloat(input.el.innerText));
    assert.equal(p.get(0), 0.62);
    input.keydown({ key: "ArrowUp" });
    assert.equal(p.get(0), 0.63, "arrows keep the native step");
  }
  assert.equal(PZ.ui.input.prototype.__zoidiumSnapWrapped, undefined, "the shared prototype is untouched");
});

test("snap applies after clamping and before the native decimals rounding", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const { properties: [p] } = listWith(PZ, [{ ...KINDS.slider.create(), min: 0, max: 1, step: 0.01, decimals: 2, snap: 0.05 }]);
  const { box, input } = captureInput(PZ, () => PZ.ui.controls.generateInput(p));
  nest(box);
  input.setValue(0.125);
  assert.equal(p.get(0), 0.15, "0.125 grids to 0.15 (half away from zero), then decimals keep 0.15");
  input.setValue(1.4);
  assert.equal(p.get(0), 1, "clamping still wins over the grid");
});

test("Slider and Seed rows commit through the same grid outside the number input", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const { installControls } = require("../plugins/shader-plus/controls.js");
  const created = new Map();
  const doc = document();
  const editor = { project: { addressLookup: () => null }, playback: { currentFrame: 0 } };
  installControls({ PZ, doc, register: (id, type, create) => created.set(id, create), editor: () => editor });
  const { list, properties: [slider, seed] } = listWith(PZ, [
    { ...KINDS.slider.create(), min: 0, max: 1, snap: 0.5 },
    { ...KINDS.seed.create(), snap: 5 },
  ]);
  void list;
  slider.getAddress = () => [0]; seed.getAddress = () => [0];
  const controls = { editor: { history: { startOperation() {}, finishOperation() {}, discardOperation() {} }, playback: { currentFrame: 0 } },
    propertyOps: { startEdit() {}, setValue() {} } };
  const box = created.get("shader-plus/slider")(slider);
  const range = box.children[1];
  const ul = doc.createElement("ul"), li = doc.createElement("li");
  li.appendChild(box); ul.appendChild(li); ul.pz_controls = controls;
  range.value = "0.62";
  range.dispatch("input", {});
  assert.equal(slider.get(0), 0.5, "the range bar commits the grid value");
  assert.equal(range.value, "0.5", "the thumb follows the grid");
  const seedBox = created.get("shader-plus/seed")(seed);
  const seedLi = doc.createElement("li"), seedUl = doc.createElement("ul");
  seedLi.appendChild(seedBox); seedUl.appendChild(seedLi); seedUl.pz_controls = controls;
  editor.project.addressLookup = () => seed;
  const realRandom = Math.random;
  Math.random = () => 0.00007;
  try {
    // Seed randomizes through a direct onclick handler, not a listener.
    seedBox.children[1].onclick({ stopPropagation() {} });
  } finally { Math.random = realRandom; }
  assert.equal(seed.get(0), 5, "randomize commits through the grid: floor(7) snaps to 5");
});

test("an Angle row snaps the native degree input and converts to radians", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const { registerAngle } = require("../plugins/shader-plus/angle-control.js");
  const created = new Map();
  const doc = document();
  registerAngle({ PZ, doc, register: (id, type, create) => created.set(id, create), commit() { throw new Error("no commit in this test"); } });
  const { properties: [angle] } = listWith(PZ, [{ ...KINDS.angle.create(), snap: 15 }]);
  angle.getAddress = () => [0];
  const { box, input } = captureInput(PZ, () => created.get("shader-plus/angle")(angle));
  assert.equal(Object.hasOwn(input, "set"), true);
  nest(box);
  input.setValue(17);
  assert.ok(Math.abs(angle.get(0) - 15 * Math.PI / 180) < 1e-12, "17 degrees snaps to 15, stored as radians");
  box.pz_update(0);
  assert.equal(box.children[0].innerText, "15.0", "the row shows snapped degrees");
});

test("loaded keyframes keep their saved values; snap only touches new edits", () => {
  const { PZ } = realm();
  installWrapper(PZ);
  const owner = new PZ.object(), list = new PZ.objectList(owner, PZ.property);
  owner.children = [list];
  const record = { type: { ...KINDS.slider.create(), snap: 0.5 }, properties: { name: "Value" },
    animated: true, keyframes: [{ frame: 0, value: 0.62, tween: 1 }, { frame: 10, value: 0.87, tween: 1 }] };
  const p = PZ.property.create(record.type);
  list.push(p); p.load(record);
  assert.equal(p.get(0), 0.62);
  assert.equal(p.get(10), 0.87);
  const { box, input } = captureInput(PZ, () => PZ.ui.controls.generateInput(p));
  nest(box);
  input.setValue(0.9);
  assert.equal(p.get(0), 1, "only the new edit lands on the grid");
});
