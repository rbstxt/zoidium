"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const M = require("../zoidium/gradient-model.js");
const { nativeHost, core } = require("./expressions-plus-harness.js");
const source = fs.readFileSync(require.resolve("../zoidium/gradient-native.js"), "utf8");
const stops = [{ position: 0, color: "rgba(12.3456, 23, 34, 0.5)" }];

function fixture() {
  const calls = [], warnings = [], widgets = [];
  const controls = {
    generateGradientInput() { calls.push({ receiver: this, args: [...arguments] }); return { classic: true }; },
  };
  const history = { operation: null };
  const document = { createElement() { return {
    append() {}, closest: () => ({ pz_controls: { editor: { history } } }),
  }; } };
  const api = { create(options) {
    // The preview samples immediately, including during property-list changes.
    M.sample(options.value.stops, 0.5);
    const widget = { element: {}, options, set(value) { M.sample(value.stops, 0.5); widget.value = value; } };
    widgets.push(widget);
    return widget;
  } };
  const window = { PZ: { ui: { controls } }, document,
    ZoidiumGradientEditor: api, ZoidiumGradientModel: M, ZoidiumUI: { refreshEditors() {} },
    console: { warn(...args) { warnings.push(args); } } };
  vm.runInNewContext(source, { window, console: window.console });
  return { api, controls, calls, warnings, widgets };
}

test("a gradient control can be built before property load without changing the property", () => {
  const f = fixture();
  let value, writes = 0;
  const property = { definition: {}, get: () => value, set() { writes++; } };
  const box = f.controls.generateGradientInput(property);
  assert.deepEqual(Array.from(f.widgets[0].value.stops), []);
  value = stops;
  box.pz_update(12);
  assert.equal(f.widgets[0].value.stops, stops);
  assert.equal(writes, 0);
  assert.equal(f.warnings.length, 0);
});

test("native addAll notifications can build the gradient before load initializes its value", {
  skip: !fs.existsSync(core),
}, () => {
  const { PZ } = nativeHost(), f = fixture();
  const owner = new PZ.object();
  const list = new PZ.propertyList({}, owner);
  let box;
  list.onListChanged.watch(() => { box = f.controls.generateGradientInput(list.ramp); });
  list.addAll({ ramp: { name: "Color Ramp Curve", type: PZ.property.type.GRADIENT, value: stops } });
  assert.equal(list.ramp.get(), undefined);
  assert.ok(box);
  list.load();
  box.pz_update(0);
  assert.deepEqual(JSON.parse(JSON.stringify(f.widgets[0].value.stops)), stops);
});

test("material load completes its name and numeric values while its gradient panel is open", {
  skip: !fs.existsSync(core),
}, async () => {
  const { PZ } = nativeHost(), f = fixture(), labels = [];
  const material = PZ.material.create("panelprobe");
  material.properties.name.onChanged.watch(() => labels.push(material.properties.name.get()), true);
  let box;
  material.properties.onListChanged.watch(() => {
    box = f.controls.generateGradientInput(material.properties.ramp);
  });
  PZ.material.fnList.panelprobe = Promise.resolve(function () {
    this.defaultName = "Panel probe material";
    this.properties.addAll({
      roughness: { name: "Roughness", dynamic: true, type: PZ.property.type.NUMBER, value: 0.5 },
      ramp: { name: "Color Ramp Curve", type: PZ.property.type.GRADIENT, value: stops },
    });
    this.load = function () { this.properties.load(); };
  });
  await material.load();
  box.pz_update(0);
  assert.equal(labels.at(-1), "Panel probe material");
  assert.equal(material.properties.roughness.get(0), 0.5);
  assert.deepEqual(JSON.parse(JSON.stringify(f.widgets[0].value.stops)), stops);
  assert.equal(f.calls.length, 0, "initialization must not fall back to Classic");
  assert.equal(f.warnings.length, 0);
});

test("gradient updates read the supplied local frame and contain a failing preview", () => {
  const f = fixture(), frames = [];
  const property = { definition: {}, get(frame) { frames.push(frame); return stops; } };
  const box = f.controls.generateGradientInput(property);
  box.pz_update(18.25);
  assert.equal(frames.at(-1), 18.25);
  const widget = f.widgets[0], set = widget.set;
  widget.set = () => { throw new Error("Preview unavailable"); };
  // Change the value so each update attempts a new paint.
  property.get = () => [{ position: 1, color: "rgba(0,0,0,1)" }];
  assert.doesNotThrow(() => box.pz_update(20));
  assert.doesNotThrow(() => box.pz_update(20));
  assert.equal(f.warnings.length, 1);
  widget.set = set;
  box.pz_update(20);
  assert.equal(widget.value.stops[0].position, 1);
});

test("a broken gradient factory falls back to Classic and reports once per property", () => {
  const f = fixture(), property = { definition: {}, get: () => stops };
  f.api.create = () => { throw new Error("Preview unavailable"); };
  assert.equal(f.controls.generateGradientInput(property).classic, true);
  assert.equal(f.controls.generateGradientInput(property).classic, true);
  assert.equal(f.warnings.length, 1);
  assert.equal(f.calls.length, 2);
});

test("Classic calls retain their receiver, arguments, and return value", () => {
  const f = fixture(), property = { definition: {}, get() { throw new Error("Must not read"); } };
  f.api.setClassic(true);
  const receiver = {}, result = f.controls.generateGradientInput.call(receiver, property, "extra");
  assert.equal(result.classic, true);
  assert.equal(f.calls[0].receiver, receiver);
  assert.deepEqual(f.calls[0].args, [property, "extra"]);
  assert.equal(f.widgets.length, 0);
  assert.equal(f.warnings.length, 0);
});
