"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Selection, curvesFor, animatedCurves, controllers, FOLLOW_KEY } = require("../plugins/graph-plus/selection.js");
const install = require("../plugins/graph-plus/selection-host.js");
const { FakeElement } = require("./fake-dom.js");
class Channel {
  constructor(name, animated = false) { this.definition = { name }; this.animated = animated; this.keyframes = [{ value: 1 }]; }
}
class Group {
  constructor(name, axes) { this.definition = { name }; this.objects = axes.map(axis => new Channel(axis)); }
}
class PropertyList {
  constructor(properties) { this.properties = properties; }
  *[Symbol.iterator]() { yield* this.properties; }
}
class Edit {}
class Timeline {}
class Keys {}
Timeline.keyframes = Keys;
const PZ = { propertyList: PropertyList, property: { dynamic: { keyframes: Channel, group: Group } }, ui: { edit: Edit, timeline: Timeline } };
function panel() {
  return { _left: { selection: [], list: { querySelectorAll: () => [] } }, _right: {
    width: 600, height: 300, fits: 0, fitAll() { this.fits++; }, followBtn: new FakeElement("button"),
  } };
}
function observable() {
  const listeners = new Set();
  return { watch: fn => listeners.add(fn), unwatch: fn => listeners.delete(fn), emit: () => { for (const fn of listeners) fn(); }, listeners };
}
function fixture() {
  const listeners = new Map(), rows = [];
  const doc = { defaultView: { innerWidth: 1000, innerHeight: 800 }, body: new FakeElement("body"),
    createElement: tag => new FakeElement(tag), querySelectorAll: () => [],
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const editor = { onProjectChanged: observable(), onSequenceChanged: observable(), history: new Proxy({}, { get() { throw Error("History must not be read"); } }) };
  const edit = Object.assign(new Edit(), { editor, options: { showPropertyControls: true }, selection: [], el: { closest: () => null } });
  let focused = null, opens = 0;
  const graph = panel();
  const host = install({ PZ, editor, document: doc, open: () => { opens++; host.selection.attach(graph); return graph; } });
  function row(property) {
    const element = new FakeElement("li");
    element.pz_object = property;
    element.isConnected = true;
    element.closest = selector => selector === ".editorpanel" ? { pz_panel: edit } : selector === "li, .kftrack" ? element : null;
    element.focus = () => { focused = element; };
    rows.push(element);
    return element;
  }
  function event(type, target, extra = {}) {
    const value = { target, button: 0, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    listeners.get(type)?.(value);
    return value;
  }
  return { host, graph, editor, edit, row, event, listeners, doc, rows, get focused() { return focused; }, get opens() { return opens; } };
}

test("property identities map scalar, vector, color, nested material and plugin rows", () => {
  const scalar = new Channel("Opacity"), position = new Group("Position", ["X", "Y", "Z"]), color = new Group("Color", ["R", "G", "B"]);
  assert.deepEqual(curvesFor(PZ, scalar), [scalar]);
  assert.deepEqual(curvesFor(PZ, position), position.objects);
  assert.deepEqual(curvesFor(PZ, color), color.objects);
  const nested = { properties: { materialProperties: { properties: { roughness: new Channel("Roughness") } } } };
  assert.deepEqual(curvesFor(PZ, nested.properties.materialProperties.properties.roughness), [nested.properties.materialProperties.properties.roughness]);
  const plugin = new Group("Plugin distortion", ["U", "V"]);
  assert.deepEqual(curvesFor(PZ, plugin), plugin.objects);
  assert.deepEqual(curvesFor(PZ, { definition: { name: "Position" } }), []);
});

test("follow replaces and adds all components; off pins; direct show overrides the pin", () => {
  const model = new Selection(PZ), graph = panel(), pos = new Group("Position", ["X", "Y", "Z"]), rot = new Group("Rotation", ["X", "Y", "Z"]);
  model.attach(graph);
  model.select([pos]); assert.deepEqual(graph._left.selection, pos.objects);
  model.select([rot], true); assert.deepEqual(graph._left.selection, [...pos.objects, ...rot.objects]);
  model.select([rot]); assert.deepEqual(graph._left.selection, rot.objects);
  model.setFollow(false); model.select([pos]); assert.deepEqual(graph._left.selection, rot.objects);
  model.show(pos, graph); assert.deepEqual(graph._left.selection, pos.objects);
  model.setFollow(true); model.select([rot]); assert.deepEqual(graph._left.selection, rot.objects);
});

test("manual picks survive unchanged selection and playback; actual changes fit exactly once", () => {
  const model = new Selection(PZ), graph = panel(), a = new Channel("A"), b = new Channel("B");
  model.attach(graph); model.select([a]); assert.equal(graph._right.fits, 1);
  graph._left.selection.push(b);
  model.select([a]); assert.deepEqual(graph._left.selection, [a, b]); assert.equal(graph._right.fits, 1);
  model.select([b]); assert.deepEqual(graph._left.selection, [b]); assert.equal(graph._right.fits, 2);
  model.objects([]); assert.deepEqual(graph._left.selection, []); assert.equal(graph._right.fits, 3);
});

test("animated object fallback traverses nested lists once and ignores unkeyed and expression channels", () => {
  const a = new Channel("Opacity", true), pos = new Group("Position", ["X", "Y", "Z"]), unkeyed = new Channel("Static"), expression = new Channel("Expression", true);
  expression.expression = {};
  pos.objects[0].animated = true;
  const material = { children: [new PropertyList([a, unkeyed, expression])] }, object = { children: [material, pos, material] };
  assert.deepEqual(animatedCurves(PZ, [object]), [a, pos.objects[0]]);
  const model = new Selection(PZ), graph = panel(); model.attach(graph); model.objects([object]);
  assert.deepEqual(graph._left.selection, [a, pos.objects[0]]);
  const fits = graph._right.fits; model.objects([object]); assert.equal(graph._right.fits, fits);
});

test("Follow selection defaults on, persists off and tolerates unavailable storage", () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const first = new Selection(PZ, storage); assert.equal(first.follow, true);
  first.setFollow(false); assert.equal(values.get(FOLLOW_KEY), "false");
  assert.equal(new Selection(PZ, storage).follow, false);
  const blocked = new Selection(PZ, { getItem() { throw Error(); }, setItem() { throw Error(); } });
  assert.equal(blocked.follow, true); blocked.setFollow(false); assert.equal(blocked.follow, false);
});

test("new windows defer fitting until measured instead of framing a one-pixel canvas", () => {
  const graph = panel(), model = new Selection(PZ);
  graph._right.width = 1; model.select([new Channel("A")]); model.attach(graph);
  assert.equal(graph._right.fits, 0); assert.equal(graph._right._selectionFitPending, true);
});

test("real row event handlers replace/add, preserve field focus, open by menu and shortcut without history", () => {
  const f = fixture(), pos = new Group("Position", ["X", "Y", "Z"]), rot = new Group("Rotation", ["X", "Y", "Z"]);
  f.host.selection.attach(f.graph);
  const p = f.row(pos), r = f.row(rot);
  const field = { closest: selector => selector.includes("contenteditable") ? {} : p.closest(selector) };
  f.event("pointerdown", field); assert.equal(f.focused, null); assert.deepEqual(f.graph._left.selection, pos.objects);
  f.event("pointerdown", r, { ctrlKey: true }); assert.deepEqual(f.graph._left.selection, [...pos.objects, ...rot.objects]);
  f.event("pointerdown", p, { shiftKey: true }); assert.equal(f.graph._left.selection.length, 6);
  f.event("pointerdown", r); assert.deepEqual(f.graph._left.selection, rot.objects);
  f.event("contextmenu", p, { ctrlKey: true });
  assert.deepEqual(f.graph._left.selection, [...rot.objects, ...pos.objects]);
  assert.equal(f.doc.body.children.length, 0);
  const shortcut = f.event("keydown", p, { key: "G", code: "KeyG", altKey: true, shiftKey: true });
  assert.equal(shortcut.prevented, true); assert.equal(f.opens, 1); assert.deepEqual(f.graph._left.selection, pos.objects);
  assert.equal(f.event("keydown", p, { key: "g", ctrlKey: true }).prevented, undefined);
  f.event("contextmenu", r, { clientX: 300, clientY: 200 });
  const item = f.doc.body.children[0].children[0]; assert.equal(item.textContent, "Show in Graph Editor"); item.click();
  assert.equal(f.opens, 2); assert.deepEqual(f.graph._left.selection, rot.objects);
  f.host.dispose();
});

test("disable restores prototype hooks and row attributes, removes menu/shortcut/listeners and cancels queued follow", async () => {
  const original = Edit.prototype.selectItems = function () {};
  const f = fixture(), p = f.row(new Channel("Opacity"));
  f.event("pointerdown", p);
  f.event("contextmenu", p, { clientX: 0, clientY: 0 });
  f.edit.selection = [{ children: [new Channel("Animated", true)] }]; f.edit.selectItems();
  assert.notEqual(Edit.prototype.selectItems, original);
  f.host.dispose(); await Promise.resolve();
  assert.equal(Edit.prototype.selectItems, original); assert.equal(f.listeners.size, 0);
  assert.equal(f.editor.onProjectChanged.listeners.size, 0); assert.equal(f.editor.onSequenceChanged.listeners.size, 0);
  assert.equal(controllers.has(f.editor), false); assert.equal(f.host.selection.panels.size, 0);
  assert.equal(p.classList.contains("g2-property-selected"), false); assert.equal(p.getAttribute("title"), null);
  assert.equal(f.doc.body.children.length, 0); assert.deepEqual(f.host.selection.curves, []);
  delete Edit.prototype.selectItems;
});

test("timeline key selection coalesces recursive native changes and layer selection shows animated properties", async () => {
  Keys.prototype.selectKeyframe = function (key) { key.classList.add("selected"); };
  Keys.prototype.deselectAll = function () { for (const key of this.keys) key.classList.remove("selected"); };
  Timeline.prototype.selectionChanged = function () {};
  const f = fixture(), a = new Channel("X", true), b = new Channel("Y", true);
  const keys = [a, b].map(property => { const key = new FakeElement("div"); key.parentElement = { pz_object: property }; return key; });
  const timeline = Object.assign(new Timeline(), { editor: f.editor, tracks: { selection: [{ children: [a, b] }] } });
  const host = Object.assign(new Keys(), { timeline, keys, objects: timeline.tracks.selection,
    container: { querySelectorAll: () => keys.filter(key => key.classList.contains("selected")) } });
  f.host.selection.attach(f.graph);
  host.selectKeyframe(keys[0]); host.selectKeyframe(keys[1]);
  assert.deepEqual(f.graph._left.selection, []);
  await Promise.resolve(); assert.deepEqual(f.graph._left.selection, [a, b]); assert.equal(f.graph._right.fits, 1);
  host.deselectAll(); await Promise.resolve(); assert.deepEqual(f.graph._left.selection, [a, b]);
  f.host.selection.select([a]); timeline.selectionChanged(); await Promise.resolve(); assert.deepEqual(f.graph._left.selection, [a, b]);
  f.host.dispose();
  delete Keys.prototype.selectKeyframe; delete Keys.prototype.deselectAll; delete Timeline.prototype.selectionChanged;
});

test("timeline labels map to the track property and are removed on disable", () => {
  Keys.prototype.createKeyframeTrack = function (_container, property) {
    const track = new FakeElement("div"); track.pz_object = property; track.pz_label = new FakeElement("div");
    track.isConnected = track.pz_label.isConnected = true;
    return track;
  };
  const f = fixture(), property = new Group("Color", ["R", "G", "B"]);
  const keys = Object.assign(new Keys(), { timeline: { editor: f.editor } });
  const track = keys.createKeyframeTrack(null, property), label = track.pz_label;
  label.closest = selector => selector === ".g2-property-label" ? label : null;
  f.event("pointerdown", label);
  assert.deepEqual(f.host.selection.curves, property.objects);
  assert.equal(label.classList.contains("g2-property-label"), true);
  f.host.dispose(); assert.equal(label.classList.contains("g2-property-label"), false);
  delete Keys.prototype.createKeyframeTrack;
});


test("native property-row mouse-up selection cannot replace the additive property set", async () => {
  Edit.prototype.selectItems = function () {};
  const f = fixture(), a = new Channel("A"), b = new Channel("B");
  f.host.selection.attach(f.graph);
  f.event("pointerdown", f.row(a)); f.edit.selection = [a]; f.edit.selectItems(); await Promise.resolve();
  f.event("pointerdown", f.row(b), { ctrlKey: true }); f.edit.selection = [b]; f.edit.selectItems(); await Promise.resolve();
  assert.deepEqual(f.graph._left.selection, [a, b]);
  f.host.dispose(); delete Edit.prototype.selectItems;
});


test("shortcut uses the selected row after CM3 moves focus to the containing Edit panel", () => {
  const f = fixture(), a = new Channel("A"), b = new Channel("B"), row = f.row(a);
  f.host.selection.attach(f.graph); f.host.selection.select([b]); f.host.selection.setFollow(false);
  f.event("pointerdown", row);
  const parent = { closest: selector => selector === ".editorpanel" ? { pz_panel: f.edit } : null };
  const event = f.event("keydown", parent, { key: "G", code: "KeyG", altKey: true, shiftKey: true });
  assert.equal(event.prevented, true); assert.equal(f.opens, 1); assert.deepEqual(f.graph._left.selection, [a]);
  f.host.dispose();
});


test("clicking an already selected layer leaves property selection and shows animated curves", () => {
  const f = fixture(), a = new Channel("A", true), b = new Channel("B", true), clip = { children: [new PropertyList([a, b])] };
  f.host.selection.attach(f.graph); f.host.selection.select([a]);
  const timeline = { editor: f.editor, tracks: { selection: [clip] } };
  const target = { pz_object: clip, closest: selector => selector === ".clip" ? target : selector === ".editorpanel" ? { pz_panel: timeline } : null };
  f.event("pointerdown", target); assert.deepEqual(f.graph._left.selection, [a, b]);
  f.host.selection.setFollow(false); f.host.selection.show(a, f.graph); f.event("pointerdown", target);
  assert.deepEqual(f.graph._left.selection, [a]);
  f.host.dispose();
});


test("a different object selection clears manual curves even when neither object has animated properties", () => {
  const model = new Selection(PZ), graph = panel(), a = {}, b = {}, manual = new Channel("Manual");
  model.attach(graph); model.objects([a]); graph._left.selection.push(manual);
  model.objects([a]); assert.deepEqual(graph._left.selection, [manual]);
  model.objects([b]); assert.deepEqual(graph._left.selection, []);
});

test("selecting another timeline key restores its curve after a manual picker change", async () => {
  Keys.prototype.selectKeyframe = function (key) { this.selected = [key]; };
  const f = fixture(), property = new Channel("A"), other = new Channel("Manual");
  const keys = [0, 60].map(frame => ({ frame, parentElement: { pz_object: property } }));
  const timeline = Object.assign(new Keys(), { timeline: { editor: f.editor }, selected: [],
    container: { querySelectorAll() { return timeline.selected; } } });
  f.host.selection.attach(f.graph); timeline.selectKeyframe(keys[0]); await Promise.resolve();
  f.graph._left.selection.splice(0, 1, other);
  timeline.selectKeyframe(keys[0]); await Promise.resolve(); assert.deepEqual(f.graph._left.selection, [other]);
  timeline.selectKeyframe(keys[1]); await Promise.resolve(); assert.deepEqual(f.graph._left.selection, [property]);
  f.host.dispose(); delete Keys.prototype.selectKeyframe;
});


test("native detached Edit windows get property menus and shortcuts and release document listeners on disable", () => {
  class NativeWindow { setPanel(panel) { this.panel = panel; } }
  PZ.ui.window = NativeWindow;
  const original = NativeWindow.prototype.setPanel, f = fixture(), listeners = new Map(), lifecycle = new Map();
  const popup = { ...f.doc, body: new FakeElement("body"),
    defaultView: { ...f.doc.defaultView, addEventListener: (type, fn) => lifecycle.set(type, fn), removeEventListener: type => lifecycle.delete(type) },
    addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const win = Object.assign(new NativeWindow(), { editor: f.editor });
  win.setPanel({ el: { ownerDocument: popup } });
  const row = f.row(new Channel("Detached")); row.ownerDocument = popup;
  listeners.get("contextmenu")({ target: row, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {} });
  assert.equal(popup.body.children.length, 1); assert.equal(f.doc.body.children.length, 0);
  popup.body.children[0].children[0].click(); assert.equal(f.opens, 1);
  lifecycle.get("pagehide")(); assert.equal(listeners.size, 0); assert.equal(lifecycle.size, 0);
  assert.equal(row.getAttribute("title"), null);
  f.host.dispose(); assert.equal(listeners.size, 0); assert.equal(NativeWindow.prototype.setPanel, original);
  delete PZ.ui.window;
});
