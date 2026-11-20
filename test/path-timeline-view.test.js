"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const view = require("../plugins/shape-plus/path-timeline-view.js");
test("exports native timeline installer", () => assert.equal(typeof view.install, "function"));

class Element {
  constructor(doc) {
    this.ownerDocument = doc; this.children = []; this.parentElement = null; this.style = {}; this.listeners = {};
    const values = new Set();
    this.classList = { add: (...names) => names.forEach((n) => values.add(n)), remove: (n) => values.delete(n),
      contains: (n) => values.has(n), toggle: (n, on) => on ? values.add(n) : values.delete(n) };
  }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  remove() { if (this.parentElement) { const list = this.parentElement.children; list.splice(list.indexOf(this), 1); this.parentElement = null; } }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  removeEventListener(type, fn) { if (this.listeners[type] === fn) delete this.listeners[type]; }
  focus() {}
  getElementsByClassName(names) { const parts = names.split(" "); return this.children.flatMap((n) => [...(parts.every((p) => n.classList.contains(p)) ? [n] : []), ...n.getElementsByClassName(names)]); }
  querySelectorAll(selector) { return this.getElementsByClassName(selector.slice(1).replaceAll(".", " ")); }
}
function fixture() {
  const doc = { createElement: () => new Element(doc) }, calls = [], listeners = new Set();
  function Panel() {
    this.container = new Element(doc); this.container.clientWidth = 300; this.container.scrollLeft = 0;
    this.labels = new Element(doc); this.el = new Element(doc);
    this.timeline = { scrollBar: { firstElementChild: { style: { width: "400px" } } }, frameToPx: (f) => f * 2 };
    this.keyframe_drag = { startfn_bound() {}, addElts(node) { node.addEventListener("mousedown", this.startfn_bound); } };
  }
  const p = Panel.prototype;
  p.objectsChanged = function () { assert.equal(this.container.children.length, 0); calls.push("objects"); };
  p.zoom = function () { for (const n of this.container.getElementsByClassName("keyframe")) n.style.left = n.pz_frame * 2 + "px"; };
  p.objectOffsetChanged = function () { for (const n of this.container.getElementsByClassName("keyframe")) n.pz_frame += 20; this.zoom(); };
  p.selectKeyframe = function (n) { n.classList.add("selected"); };
  p.deselectKeyframe = function (n) { n.classList.remove("selected"); };
  p.deselectAll = function () { for (const n of this.container.getElementsByClassName("selected")) n.classList.remove("selected"); };
  p.keydown = function () { calls.push("native keydown"); };
  for (const name of ["keyframeDragStart", "keyframeDrag", "keyframeDragUpdate", "keyframeDragEnd"]) p[name] = function () { calls.push("native " + name); };
  p.snap = (px) => Math.round(px / 2);
  p.updateKeyframeColor = () => {}; p.updateTrackColors = () => {};
  const PZ = { ui: { timeline: { keyframes: Panel } } }, installer = view.install(PZ), panel = new Panel();
  const data = () => ({ vertexIds: ["v"], properties: { path: { objects: Array.from({ length: 6 }, () => ({ animated: true, keyframes: [0, 5, 10].map((frame) => ({ frame, value: frame, tween: 1 })) })) } } });
  const state = { value: data(), history: [], seeks: [] };
  const host = { get data() { return state.value; }, commit(v) { state.history.push(state.value); state.value = v; for (const fn of listeners) fn(); }, seek(f) { state.seeks.push(f); } };
  const context = { project: {}, clip: { start: 100, offset: 20 }, overlay: {}, paths: [{ id: "m", kind: "mask", name: "Mask A", host }, { id: "s", kind: "shape", name: "Shape A", host }], observe(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
  const adapter = installer.attach(panel, context);
  const diamonds = () => panel.container.getElementsByClassName("keyframe");
  const event = (node, extra = {}) => ({ currentTarget: node, pageX: 160, shiftKey: false, stopPropagation() {}, preventDefault() {}, ...extra });
  return { panel, adapter, installer, context, state, calls, listeners, diamonds, event };
}

test("renders both hierarchies and positions model frames after offset and zoom", () => {
  const f = fixture();
  assert.deepEqual(f.panel.labels.children.map((n) => n.textContent), ["Masks", "Mask A", "Mask Path", "Shape+", "Shape A", "Path"]);
  assert.deepEqual(f.diamonds().slice(0, 3).map((n) => n.style.left), ["160px", "170px", "180px"]);
  f.context.clip.start = 120;
  f.panel.objectOffsetChanged();
  assert.deepEqual(f.diamonds().slice(0, 3).map((n) => n.style.left), ["200px", "210px", "220px"]);
  f.panel.zoom(); assert.equal(f.diamonds()[0].style.left, "200px");
  f.installer.dispose();
});

test("click seeks; selected logical diamonds move and delete in one transaction", () => {
  const f = fixture(), drag = { ctx: f.panel };
  let d = f.diamonds()[0]; f.panel.keyframeDragStart.call(drag, f.event(d)); f.panel.keyframeDragEnd.call(drag, f.event(d));
  assert.deepEqual(f.state.seeks, [80]);
  f.panel.selectKeyframe(f.diamonds()[1]);
  d = f.diamonds()[0]; f.panel.keyframeDragStart.call(drag, f.event(d));
  f.panel.keyframeDrag.call(drag, f.event(d, { pageX: 164 })); f.panel.keyframeDragUpdate.call(drag); f.panel.keyframeDragEnd.call(drag, f.event(d));
  assert.equal(f.state.history.length, 1);
  assert.deepEqual(f.state.value.properties.path.objects[0].keyframes.map((k) => k.frame), [2, 7, 10]);
  f.panel.keydown(f.event(null, { key: "Delete" }));
  assert.equal(f.state.history.length, 2);
  assert.deepEqual(f.state.value.properties.path.objects[0].keyframes.map((k) => k.frame), [10]);
  assert.deepEqual(f.calls, []); f.installer.dispose();
});

test("refresh, project replacement, and disposal detach observers and rows", () => {
  const f = fixture(), old = [...f.listeners][0], before = f.diamonds()[0];
  for (const fn of f.listeners) fn(); assert.equal(before.parentElement, null);
  f.panel.objectsChanged(); assert.deepEqual(f.calls, ["objects"]);
  for (const key of ["clip", "project", "overlay"]) {
    f.context[key] = key === "clip" ? { start: 20, offset: 5 } : {};
    f.adapter.bind(f.context); assert.equal(f.listeners.size, 1);
  }
  assert.equal(f.diamonds()[0].style.left, "30px");
  old(); assert.equal(f.listeners.size, 1);
  f.adapter.dispose(); assert.equal(f.listeners.size, 0); assert.equal(f.panel.container.children.length, 0);
  f.installer.dispose();
});

test("cancellation and rebinding discard an active drag and native events fall through", () => {
  const f = fixture(), drag = { ctx: f.panel }, d = f.diamonds()[0];
  f.panel.keyframeDragStart.call(drag, f.event(d));
  f.panel.keyframeDrag.call(drag, f.event(d, { pageX: 166 })); f.panel.keyframeDragUpdate.call(drag);
  f.panel.keyframeDragEnd.call(drag, f.event(d, { key: "Escape" }));
  assert.equal(f.state.history.length, 0); assert.equal(f.diamonds()[0].style.left, "160px");
  const next = f.diamonds()[0]; f.panel.keyframeDragStart.call(drag, f.event(next));
  f.panel.keyframeDrag.call(drag, f.event(next, { pageX: 166 })); f.panel.keyframeDragUpdate.call(drag);
  f.adapter.bind({ ...f.context, project: {} }); f.panel.keyframeDragEnd.call(drag, f.event(next));
  assert.equal(f.state.history.length, 0);
  f.panel.keyframeDragStart.call({ ctx: f.panel }, f.event({}));
  assert.deepEqual(f.calls, ["native keyframeDragStart"]);
  f.installer.dispose();
});

test("selection stays within one path and dispose restores the prototype", () => {
  const f = fixture(), originalWrapper = f.panel.keyframeDragStart;
  f.panel.selectKeyframe(f.diamonds()[0]); f.panel.selectKeyframe(f.diamonds()[3]);
  assert.equal(f.diamonds()[0].classList.contains("selected"), false);
  assert.equal(f.diamonds()[3].classList.contains("selected"), true);
  f.panel.deselectAll(); assert.equal(f.diamonds()[3].classList.contains("selected"), false);
  const node = f.diamonds()[0]; f.installer.dispose();
  assert.equal(node.listeners.mousedown, undefined); assert.notEqual(f.panel.keyframeDragStart, originalWrapper);
});
