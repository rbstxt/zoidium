"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const hints = require("../plugins/shape-plus/native-hints");
const { createAddRouting } = require("../plugins/shape-plus/native-ui");
const { paintScope } = require("../plugins/shape-plus/contents-ops");
const { createModel, clone } = require("../plugins/shape-plus/model");
const { PZ } = require("./shape-plus-host");

// Minimal DOM stand-in: rows are li > [cell div > [name span], actions div].
function style() {
  let text = "";
  return { display: "", get cssText() { return text; }, set cssText(value) { text = value; this.display = /display:([^;]+)/.exec(value)?.[1] || ""; } };
}
class Element {
  constructor(tagName) { this.tagName = tagName.toUpperCase(); this.children = []; this.style = style(); this.attributes = {}; this.classes = new Set(); this.isConnected = true; this.textContent = ""; }
  get firstElementChild() { return this.children[0] || null; }
  get classList() { const c = this.classes; return { contains: n => c.has(n), add: n => c.add(n), remove: n => c.delete(n) }; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  after(...nodes) { const list = this.parentNode.children; list.splice(list.indexOf(this) + 1, 0, ...nodes); for (const node of nodes) node.parentNode = this.parentNode; }
  querySelector(tag) { return this.children.find(child => child.tagName === tag.toUpperCase()) || null; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === "title") this.title = value; }
  removeAttribute(key) { delete this.attributes[key]; if (key === "title") delete this.title; }
}
const document = { createElement: tag => new Element(tag) };
function row() {
  const li = new Element("li"), cell = new Element("div"), name = new Element("span");
  cell.append(name); li.append(cell, new Element("div"));
  return li;
}
function host() {
  const { Content } = createModel(PZ);
  const clip = { start: 10, offset: 5 };
  class Layer extends PZ.object {
    constructor() {
      super(); this.contents = new PZ.objectList(this, Content);
      // Like CM3's objectList, splice parents inserted items.
      const list = this.contents, splice = list.splice;
      list.splice = (...args) => { for (const item of args.slice(2)) item.parent = list; return splice.apply(list, args); };
    }
    tryGetParentOfType() { return clip; }
    getAddress() { return [0]; }
  }
  const layer = new Layer();
  const load = data => { for (const item of data) { const node = new Content(item.kind, item); layer.contents.push(node); node.load(item); } };
  return { Content, Layer, layer, load };
}
const animated = (a, b) => ({ animated: true, keyframes: [{ frame: 0, value: a, tween: 1 }, { frame: 70, value: b, tween: 1 }] });

test("swatch styles: solid fill, hollow stroke ring and gradient stops", () => {
  const fill = hints.swatchStyle("fill", [1, 0.5, 0]);
  assert.match(fill, /width:10px;height:10px/);
  assert.match(fill, /border:1px solid #000;background:rgb\(255,128,0\)$/);
  const stroke = hints.swatchStyle("stroke", [0, 0, 1.5]);
  assert.match(stroke, /border:3px solid rgb\(0,0,255\)/);
  assert.match(stroke, /background:transparent;outline:1px solid #000;outline-offset:-1px/);
  const stops = [{ position: 1, color: "rgba(26,102,255,1)" }, { position: 0, color: "rgba(255,77,26,0.5)" }];
  assert.equal(hints.gradientCss(stops), "linear-gradient(90deg,rgba(255,77,26,0.5) 0%,rgba(26,102,255,1) 100%)");
  assert.match(hints.swatchStyle("gradientFill", stops), /background:linear-gradient\(90deg,/);
  assert.match(hints.swatchStyle("gradientStroke", stops), /border:3px solid transparent;border-image:linear-gradient\(.*\) 1;background:transparent/);
  assert.throws(() => hints.gradientCss([]), /stops/);
});

test("structural outline ignores animated values and reads live enabled flags", () => {
  const { layer, load } = host();
  load([{ id: "g", kind: "group", properties: {}, contents: [{ id: "r", kind: "rectangle", properties: { enabled: 0 } }, { id: "f", kind: "fill", properties: { color: animated([0, 0, 0], [1, 1, 1]) } }] }]);
  const live = hints.outline(layer.contents);
  assert.deepEqual(live, [{ id: "g", kind: "group", properties: { enabled: 1 }, contents: [
    { id: "r", kind: "rectangle", properties: { enabled: 0 } }, { id: "f", kind: "fill", properties: { enabled: 1 } },
  ] }]);
  assert.deepEqual(hints.outline(clone(layer.contents)), live);
  const scope = paintScope(live);
  assert.equal(hints.hintFor(scope, { id: "f", kind: "fill" }), hints.NO_PATHS);
  assert.equal(hints.hintFor(scope, { id: "r", kind: "rectangle" }), "", "disabled items have no hint");
  assert.equal(hints.hintFor(scope, { id: "g", kind: "group" }), "");
});

test("row hints, swatches and titles follow structure, enable flags and the clip's local frame", () => {
  const { Content, Layer, layer, load } = host();
  load([
    { id: "top", kind: "fill", properties: {} },
    { id: "g", kind: "group", properties: {}, contents: [
      { id: "r", kind: "rectangle", properties: {} },
      { id: "s", kind: "stroke", properties: { color: animated([0, 0, 0], [1, 0.5, 0]) } },
    ] },
    { id: "p", kind: "polystar", properties: {} },
  ]);
  let queued = null, cancelled = 0;
  const view = { CM: { playback: { currentFrame: 40 } }, requestAnimationFrame: fn => { queued = fn; return 7; }, cancelAnimationFrame: () => { queued = null; cancelled++; } };
  const ui = hints.createHints({ PZ: { clip: class {} }, Layer, Content, document, view });
  const items = [layer.contents[0], layer.contents[1].contents[0], layer.contents[1].contents[1], layer.contents[2]];
  const rows = items.map(() => row());
  items.forEach((item, i) => ui.attach(rows[i], item));
  ui.attach(row(), { id: "x", kind: "fill" });
  assert.equal(ui.size, 4);
  assert.equal(typeof queued, "function");
  queued();
  const hintOf = r => r.firstElementChild.children.find(c => c.className === "shape-plus-scope-hint");
  const swatchOf = r => r.firstElementChild.children.find(c => c.className === "shape-plus-paint-swatch");
  assert.deepEqual(rows.map(r => hintOf(r).textContent), [hints.NO_PATHS, "", "", hints.NO_PAINT]);
  assert.equal(rows[0].firstElementChild.title, hints.RULE);
  assert.equal(rows[1].firstElementChild.title, undefined);
  assert.equal(rows[0].firstElementChild.children[1], swatchOf(rows[0]), "swatch directly follows the name");
  assert.equal(swatchOf(rows[1]), undefined);
  // Local frame 40 - 10 + 5 = 35, halfway through the color animation.
  assert.match(swatchOf(rows[2]).style.cssText, /border:3px solid rgb\(128,64,0\)/);
  assert.match(swatchOf(rows[0]).style.cssText, /background:rgb\(255,255,255\)/);
  view.CM.playback.currentFrame = 75; queued();
  assert.match(swatchOf(rows[2]).style.cssText, /rgb\(255,128,0\)/);
  // Disabling the rectangle leaves its stroke without paths.
  layer.contents[1].contents[0].properties.enabled.value = 0; queued();
  assert.deepEqual(rows.map(r => hintOf(r).textContent), [hints.NO_PATHS, "", hints.NO_PATHS, hints.NO_PAINT]);
  // Native rename hides then clears child display; the loop restores it after.
  rows[2].classList.add("editing"); swatchOf(rows[2]).style.display = ""; queued();
  assert.equal(swatchOf(rows[2]).style.display, "");
  rows[2].classList.remove("editing"); queued();
  assert.equal(swatchOf(rows[2]).style.display, "inline-block");
  for (const r of rows) ui.detach(r);
  assert.equal(ui.size, 0);
  assert.equal(queued, null);
  assert.equal(cancelled, 1);
  ui.attach(rows[0], items[0]); ui.dispose();
  assert.equal(queued, null);
  assert.equal(ui.size, 0);
});

test("native add routing wraps root geometry in a group, is one undoable step and selects the new item", () => {
  const { Content, Layer, layer, load } = host();
  load([{ id: "g", kind: "group", properties: { name: "Rectangle 1" }, contents: [{ id: "r", kind: "rectangle", properties: {} }, { id: "f", kind: "fill", properties: {} }] }]);
  const commands = [];
  const history = {
    operation: null,
    startOperation() { this.operation = []; },
    pushCommand(fn, data) { this.operation.push([fn, data]); },
    finishOperation() { commands.push(this.operation); this.operation = null; },
    discardOperation() { this.operation = null; },
  };
  const flatten = list => Array.from(list).flatMap(item => [item, ...flatten(item.contents || [])]);
  let rows = [];
  const panel = {
    editor: { history, project: { addressLookup: () => layer } },
    selection: [],
    list: { querySelectorAll: () => (rows = flatten(layer.contents).map(item => { const r = row(); r.pz_object = item; return r; })) },
    deselectItems() { for (const r of rows) r.classList.remove("selected"); },
    selectItems() { this.selection.splice(0, this.selection.length, ...rows.filter(r => r.classList.contains("selected")).map(r => r.pz_object)); },
  };
  let cancelled = 0;
  const container = { firstElementChild: { click: () => cancelled++ } };
  const addTo = createAddRouting(PZ, Layer, Content);
  const before = JSON.stringify(layer.contents);
  assert.equal(addTo(panel, layer.contents, "path", container), true);
  assert.equal(cancelled, 1);
  assert.equal(commands.length, 1);
  const added = layer.contents[0];
  assert.equal(added.kind, "group");
  assert.equal(added.properties.name.get(), "Shape 1");
  assert.deepEqual(Array.from(added.contents, item => item.kind), ["path", "fill"]);
  assert.deepEqual(panel.selection, [added]);
  // Paint into the selected group's context goes to its bottom.
  panel.selection.splice(0, 1, layer.contents[1].contents[0]);
  addTo(panel, layer.contents, "stroke", container);
  assert.deepEqual(Array.from(layer.contents[1].contents, item => item.kind), ["rectangle", "fill", "stroke"]);
  assert.equal(panel.selection[0], layer.contents[1].contents[2]);
  // A nested Contents list passes its group as the target.
  addTo(panel, layer.contents[1].contents, "ellipse", container);
  assert.equal(layer.contents[1].contents[0].kind, "ellipse");
  // Undo restores the exact snapshot taken before the first add.
  const undo = commands.slice().reverse();
  for (const operation of undo) { history.startOperation(); for (const [fn, data] of operation.slice().reverse()) fn(data); history.discardOperation(); }
  assert.equal(JSON.stringify(layer.contents), before);
  assert.equal(addTo(panel, { parentObject: {} }, "fill", container), false, "foreign lists keep the native handler");
});

test("every Contents kind has an Objects row and add-menu icon", () => {
  const { titles } = require("../plugins/shape-plus/properties");
  const { paths } = require("../plugins/shape-plus/editor-icons");
  assert.deepEqual(Object.keys(titles).filter(kind => !paths[kind]), []);
});
