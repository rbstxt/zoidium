"use strict";
const { test, before } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { PZ } = require("./shape-plus-host"), { createModel, clone } = require("../plugins/shape-plus/model");
const { axisLabel, REGISTERED_AXIS_NAMES } = require("../plugins/shape-plus/text-font");
const { axes } = require("../plugins/shape-plus/text-properties");
const { animatorAxes } = require("../plugins/shape-plus/text-animator-properties");
const { textStatus, STATIC_FONT } = require("../plugins/shape-plus/native-hints");
const { decorate } = require("../plugins/shape-plus/native-properties");
const { createLoader } = require("../plugins/shape-plus/text-engine");

test("axis labels use the font name with registered fallbacks and bare tags", () => {
  assert.deepEqual(REGISTERED_AXIS_NAMES, { wght: "Weight", wdth: "Width", slnt: "Slant", ital: "Italic", opsz: "Optical Size" });
  assert.equal(axisLabel("wght", "Weight"), "Weight (wght)");
  assert.equal(axisLabel("XOPQ", "Parametric Thick Stroke"), "Parametric Thick Stroke (XOPQ)");
  for (const [tag, name] of Object.entries(REGISTERED_AXIS_NAMES)) assert.equal(axisLabel(tag, undefined), name + " (" + tag + ")");
  assert.equal(axisLabel("wght", "wght"), "Weight (wght)", "tag-as-name counts as unnamed");
  assert.equal(axisLabel("custom", undefined), "custom");
  assert.equal(axisLabel("XOPQ", "XOPQ"), "XOPQ");
});

class MutableLists extends PZ.propertyList {
  add(key, definition) { this[key] = new PZ.property(definition); this[key].parent = this; }
  remove(key) { delete this[key]; }
}
const host = { ...PZ, propertyList: MutableLists };
const variable = (over = {}) => ({ axes: { wght: { min: 100, default: 400, max: 900, ...over } }, style: "Regular", instances: [] });

test("text axis rows keep axis_<tag> keys and read as Weight (wght)", () => {
  const { Content } = createModel(host);
  const node = new Content("text");
  axes(host, node, variable());
  assert.ok(node.properties.axis_wght);
  assert.equal(node.properties.axis_wght.definition.name, "Weight (wght)");
  assert.equal(node.properties.axis_wght.get(), 400);
  axes(host, node, { axes: { wght: { min: 100, default: 400, max: 900, name: "Epaisseur" } }, style: "Regular", instances: [] });
  assert.equal(node.properties.axis_wght.definition.name, "Epaisseur (wght)");
  assert.equal(node.properties.axis_wght.get(), 400, "renaming keeps the value");
  axes(host, node, { axes: { custom: { min: 0, default: 1, max: 10 } }, style: "Regular", instances: [] });
  assert.equal(node.properties.axis_wght, undefined);
  assert.equal(node.properties.axis_custom.definition.name, "custom");
});

test("a project saved before the change loads with its axis keys", () => {
  const { Content } = createModel(host);
  const saved = { id: "text", properties: { sourceText: "A", axis_wght: { animated: true, keyframes: [{ frame: 0, value: 700, tween: 1 }] } } };
  const node = new Content("text");
  node.load(saved);
  axes(host, node, variable());
  assert.ok(node.properties.axis_wght);
  assert.equal(node.properties.axis_wght.get(), 700);
  assert.equal(node.properties.axis_wght.definition.name, "Weight (wght)");
  assert.deepEqual(clone(node).properties.axis_wght, saved.properties.axis_wght);
});

test("animator axis rows share the Weight (wght) labels", () => {
  const { Content } = createModel(host);
  const node = new Content("textAnimator");
  animatorAxes(host, node, [{ axes: { wght: { min: 100, default: 400, max: 900 } } }, { axes: { custom: { min: 0, default: 1, max: 10, name: "Custom" } } }]);
  assert.equal(node.properties.axis_wght.definition.name, "Weight (wght)");
  assert.equal(node.properties.axis_custom.definition.name, "Custom (custom)");
});

let engine;
before(async () => {
  engine = await createLoader((_, name) => fs.readFileSync(path.join(path.resolve(__dirname, ".."), name), "utf8"), name => require("../plugins/shape-plus/" + name))();
});

test("opened fonts carry fvar names into axis rows", async () => {
  const bytes = fs.readFileSync(path.join(__dirname, "fixtures/shape-text/RobotoFlex-subset.ttf"));
  const font = engine.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), "fixture");
  assert.equal(font.axes.wght.name, "Weight");
  assert.equal(font.axes.opsz.name, "Optical Size");
  assert.equal(font.axes.GRAD.name, "Grade");
  const { Content } = createModel(host);
  const node = new Content("text");
  axes(host, node, font);
  assert.equal(node.properties.axis_wght.definition.name, "Weight (wght)");
  font.dispose();
});

test("static-font hint defers to loading and missing-font messages", () => {
  assert.equal(textStatus(undefined), "Loading text font");
  assert.equal(textStatus({ state: "loading", message: "Loading text font" }), "Loading text font");
  assert.equal(textStatus({ state: "missing", message: "The text font is missing from the project." }), "The text font is missing from the project.");
  assert.equal(textStatus({ state: "error", message: "The font file is invalid." }), "The font file is invalid.");
  assert.equal(textStatus({ state: "ready", primary: { axes: {} } }), STATIC_FONT);
  assert.equal(STATIC_FONT, "Static font: no variable axes");
  assert.equal(textStatus({ state: "ready", primary: { axes: { wght: { min: 100, default: 400, max: 900 } } } }), "", "fonts with axes stay quiet");
});

function fakeList() {
  return { tagName: "UL", children: [] };
}
function fakeRow(list, pz_object) {
  const row = {
    tagName: "LI", pz_object, parent: list, classes: new Set(),
    get nextElementSibling() {
      const siblings = this.parent.children;
      return siblings[siblings.indexOf(this) + 1] || null;
    },
    after(node) {
      const siblings = this.parent.children, at = siblings.indexOf(node);
      if (at !== -1) siblings.splice(at, 1);
      siblings.splice(siblings.indexOf(this) + 1, 0, node);
      node.parent = this.parent;
    },
  };
  row.classList = { contains: name => row.classes.has(name),
    toggle: (name, force) => { if (force === undefined) { row.classes.has(name) ? row.classes.delete(name) : row.classes.add(name); } else if (force) row.classes.add(name); else row.classes.delete(name); } };
  row.parent = list; list.children.push(row);
  return row;
}

test("axis rows render directly below Style in registration order", () => {
  // Native key order: static properties first, dynamic axes appended last.
  const order = ["sourceText", "font", "fontStyle", "fontSize", "tracking", "axis_wdth", "axis_wght"];
  const p = Object.fromEntries(order.map(key => [key, { key }]));
  const list = fakeList(), panel = { columnTemplate: "", propertyListEls: [] };
  for (const key of order) fakeRow(list, p[key]);
  decorate(panel, { nextElementSibling: list }, { properties: p });
  assert.deepEqual(list.children.map(row => row.pz_object.key), ["sourceText", "font", "fontStyle", "axis_wdth", "axis_wght", "fontSize", "tracking"]);
  assert.deepEqual(panel.propertyListEls, [], "reordering creates no groups");
});

test("rows without Style keep their native order", () => {
  const order = ["position", "axis_wght"];
  const p = Object.fromEntries(order.map(key => [key, { key }]));
  const list = fakeList();
  for (const key of order) fakeRow(list, p[key]);
  decorate({ columnTemplate: "", propertyListEls: [] }, { nextElementSibling: list }, { properties: p });
  assert.deepEqual(list.children.map(row => row.pz_object.key), order);
});
