"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "plugins/core/display-labels.js"), "utf8");
const PACK_MARKER = '// @zoidium-plugin {"id":"alipfx-shader-pack-4","name":"Afterzoid Shader Pack 4","effect":"a-glossy"}\n';
const PLAIN_SHADER = "void main() {}\n";

// A label element with the innerText behaviour the guard relies on: the
// setter stores text, and the getter returns what was stored.
function FakeElement(tagName) {
  this.tagName = tagName;
  this.textContent = "";
  this.title = "";
  this.children = [];
  this.isConnected = true;
}
Object.defineProperty(FakeElement.prototype, "innerText", {
  configurable: true,
  get() { return this.textContent; },
  set(value) { this.textContent = String(value); },
});
FakeElement.prototype.appendChild = function (child) { this.children.push(child); return child; };

// Stand-in for PZ.observable: watchers run synchronously on update.
function FakeObservable() {
  this.listeners = [];
}
FakeObservable.prototype.watch = function (listener) { this.listeners.push(listener); };
FakeObservable.prototype.unwatch = function (listener) {
  this.listeners = this.listeners.filter(function (entry) { return entry !== listener; });
};
FakeObservable.prototype.update = function () {
  this.listeners.slice().forEach(function (listener) { listener(); });
};

// Stand-in for a CM3 property: get, set (which notifies), and onChanged.
function FakeProperties(values) {
  const properties = {};
  Object.keys(values).forEach(function (key) {
    const prop = { value: values[key], onChanged: new FakeObservable() };
    prop.get = function () { return prop.value; };
    prop.set = function (value) {
      prop.value = value;
      prop.onChanged.update();
    };
    properties[key] = prop;
  });
  return properties;
}

// CM3 objects: an effect owns a fragShader property; a custom property has a
// parentObject that points at its effect.
function makeEffect(name, withMarker) {
  return {
    properties: FakeProperties({
      name: name,
      fragShader: PLAIN_SHADER + (withMarker ? PACK_MARKER : ""),
    }),
  };
}

function FakeProperty(owner, name) {
  this.parentObject = owner;
  this.properties = FakeProperties({ name: name });
  this.definition = {};
}

// Stand-in for CM3's generateListItem: a row whose first child holds a
// collapse button (for groups) and then the label span.
function originalGenerateListItem(parent, object) {
  const row = new FakeElement("DIV");
  if (object.isGroup) row.appendChild(new FakeElement("BUTTON"));
  const label = new FakeElement("SPAN");
  row.appendChild(label);
  const item = new FakeElement("LI");
  item.firstElementChild = row;
  const text = object.properties.name.get();
  label.innerText = text;
  label.title = label.innerText;
  item.label = label;
  return item;
}

function runDisplayLabels(prototype) {
  const sandbox = {
    console: console,
    HTMLElement: FakeElement,
    PZ: {
      ui: { edit: { prototype: prototype } },
      property: FakeProperty,
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
}

function loadDisplayLabels() {
  const prototype = { generateListItem: originalGenerateListItem };
  runDisplayLabels(prototype);
  return { prototype: prototype, generate: prototype.generateListItem };
}

function rowFor(generate, object) {
  return generate.call({}, null, object, 0).label;
}

test("alipfx effect names drop the A_ prefix and underscores", () => {
  const { generate } = loadDisplayLabels();
  const label = rowFor(generate, makeEffect("A_Glossy", true));
  assert.equal(label.innerText, "Glossy");
  assert.equal(label.title, "Glossy");
});

test("alipfx property labels replace underscores and title-case all-caps headings", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Glossy", true);
  const expectations = {
    Global_Color: "Global Color",
    Enable_4_Colors: "Enable 4 Colors",
    Fill_Color_1: "Fill Color 1",
    "SETUP GLOSSY": "Setup Glossy",
    Choker_1: "Choker 1",
    "MULTI-COLOR": "MULTI-COLOR",
  };
  Object.keys(expectations).forEach(function (name) {
    const label = rowFor(generate, new FakeProperty(effect, name));
    assert.equal(label.innerText, expectations[name], name);
    assert.equal(label.title, expectations[name], name);
  });
});

test("separator rows made only of = or - get an empty label and keep their row", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Puddle", true);
  const row = generate.call({}, null, new FakeProperty(effect, "====="), 0);
  assert.equal(row.label.innerText, "");
  assert.equal(row.label.title, "");
  assert.equal(row.firstElementChild.children.length, 1, "the row container is kept");
  assert.equal(rowFor(generate, new FakeProperty(effect, "-- --")).innerText, "");
  assert.equal(rowFor(generate, new FakeProperty(effect, "Fragment shader")).innerText, "Fragment shader");
});

test("the stored name is never changed by the display transform", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Glossy", true);
  const property = new FakeProperty(effect, "Global_Color");
  rowFor(generate, property);
  assert.equal(property.properties.name.get(), "Global_Color");
  assert.equal(effect.properties.name.get(), "A_Glossy");
});

test("later CM3 writes through innerText, such as a rename, are transformed too", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Glossy", true);
  const label = rowFor(generate, new FakeProperty(effect, "Global_Color"));
  label.innerText = "Hue_Shift_2";
  assert.equal(label.innerText, "Hue Shift 2");
  label.innerText = "Hue Shift 2";
  assert.equal(label.innerText, "Hue Shift 2", "display text is stable when written again");
});

test("the transform is idempotent on its own output", () => {
  const { generate } = loadDisplayLabels();
  const label = rowFor(generate, makeEffect("A_Glossy", true));
  for (let i = 0; i < 3; i += 1) {
    label.innerText = label.innerText;
  }
  assert.equal(label.innerText, "Glossy");
});

test("a row built before its shader loads is relabeled when the shader arrives", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Glossy", false);
  const label = rowFor(generate, effect);
  assert.equal(label.innerText, "A_Glossy", "no marker yet, so the text is as typed");
  effect.properties.fragShader.set(PLAIN_SHADER + PACK_MARKER);
  assert.equal(label.innerText, "Glossy");
  assert.equal(label.title, "Glossy");
});

test("a property row relabels whether its name or its shader arrives first", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Glossy", false);
  const property = new FakeProperty(effect, "Global_Color");
  const label = rowFor(generate, property);
  effect.properties.fragShader.set(PLAIN_SHADER + PACK_MARKER);
  assert.equal(label.innerText, "Global Color");
  assert.equal(label.title, "Global Color");

  // Name first, shader second: the shader notification relabels the row.
  const late = makeEffect("A_Glossy", false);
  const lateProperty = new FakeProperty(late, "Fill_Color_1");
  const lateLabel = rowFor(generate, lateProperty);
  lateLabel.innerText = "Fill_Color_1";
  late.properties.fragShader.set(PLAIN_SHADER + PACK_MARKER);
  assert.equal(lateLabel.innerText, "Fill Color 1");
});

test("effects and properties outside the alipfx pack are left as typed", () => {
  const { generate } = loadDisplayLabels();
  const plainEffect = makeEffect("A_Other", false);
  assert.equal(rowFor(generate, plainEffect).innerText, "A_Other");
  const otherPack = makeEffect("A_Thing", false);
  otherPack.properties.fragShader.get = function () {
    return PLAIN_SHADER + '// @zoidium-plugin {"id":"ccfx-shader-pack","effect":"x"}\n';
  };
  assert.equal(rowFor(generate, otherPack).innerText, "A_Thing");
  assert.equal(rowFor(generate, new FakeProperty(plainEffect, "Global_Color")).innerText, "Global_Color");
  assert.equal(rowFor(generate, new FakeProperty(otherPack, "Global_Color")).innerText, "Global_Color");
});

test("a built-in effect keeps its labels when its shader changes", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Other", false);
  const label = rowFor(generate, effect);
  effect.properties.fragShader.set(PLAIN_SHADER + "// edited\n");
  assert.equal(label.innerText, "A_Other");
  assert.equal(label.title, "A_Other");
});

test("non-effect objects and malformed markers are untouched", () => {
  const { generate } = loadDisplayLabels();
  const folder = { properties: FakeProperties({ name: "Shader_Group" }) };
  assert.equal(rowFor(generate, folder).innerText, "Shader_Group");
  const broken = makeEffect("A_Broken", false);
  broken.properties.fragShader.get = function () {
    return "// @zoidium-plugin {not json\n";
  };
  assert.equal(rowFor(generate, broken).innerText, "A_Broken");
});

test("group rows put the label after the collapse button and still transform", () => {
  const { generate } = loadDisplayLabels();
  const effect = makeEffect("A_Glossy", true);
  const group = new FakeProperty(effect, "Fill_Color_1");
  group.isGroup = true;
  const item = generate.call({}, null, group, 0);
  assert.equal(item.label.innerText, "Fill Color 1");
  assert.equal(item.firstElementChild.children[0].tagName, "BUTTON");
});

test("the wrapper returns the original row and is installed only once", () => {
  const first = loadDisplayLabels();
  const wrapped = first.generate;
  assert.equal(wrapped.__zoidiumDisplayLabels, true);
  const row = wrapped.call({}, null, makeEffect("A_Glossy", true), 0);
  assert.equal(row.tagName, "LI");
  // Loading the file again on the same prototype must not wrap the wrapper.
  runDisplayLabels(first.prototype);
  assert.equal(first.prototype.generateListItem, wrapped);
});

test("the file does nothing when CM3's edit panel is not present", () => {
  const sandbox = { console: console, HTMLElement: FakeElement, PZ: {} };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  assert.doesNotThrow(() => vm.runInContext(source, sandbox));
});
