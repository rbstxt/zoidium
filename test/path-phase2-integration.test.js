"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");
const { installPathEditing } = require("../plugins/shape-plus/runtime.js");
const { createModel, clone } = require("../plugins/shape-plus/model.js");
const { TYPE, createLayerClass } = require("../plugins/shape-plus/layer.js");
const { getMasks, setMasks, createMask } = require("../plugins/shape-plus/mask-model.js");
const { find } = require("../plugins/shape-plus/editor-tree-data.js");

function setupDom(t) {
  const calls = [], storage = new Map(), jobs = new Map();
  const context = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return (...args) => calls.push({ method: key, args, color: target.strokeStyle, width: target.lineWidth });
    },
  });
  class Element extends FakeElement {
    ownerDocument = document;
    captures = new Set();
    append(...children) { children.forEach(child => this.appendChild(child)); }
    after(child) {
      const parent = this.parentElement;
      parent.insertBefore(child, parent.children[parent.children.indexOf(this) + 1]);
    }
    setAttributeNS(_ns, name, value) { this.setAttribute(name, value); }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) { delete this.attributes[name]; }
    getBoundingClientRect() {
      const transform = this.style.transform?.match(/^translate\(([-.\d]+)px, ([-.\d]+)px\) scale\(([-.\d]+)\)$/);
      const [, dx = 0, dy = 0, scale = 1] = transform || [];
      return { left: 0.5 + Number(dx), top: 1.5 + Number(dy), width: 240 * scale, height: 160 * scale };
    }
    getContext() { return context; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    addEventListener(type, handler, capture) {
      super.addEventListener(type, { handler, capture: capture === true });
    }
    removeEventListener(type, handler) {
      this.listeners[type] = (this.listeners[type] || []).filter(entry => entry.handler !== handler);
    }
    matches(selector) {
      return selector.split(",").some(part => {
        const name = part.trim();
        if (name === 'button[title="layer transform controls (t)"]') return this.title === "layer transform controls (t)";
        if (name.startsWith("[")) return this.hasAttribute(name.slice(1, -1));
        return name.startsWith(".") ? super.matches(name) : this.tagName === name.toUpperCase();
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    focus() {
      const previous = document.activeElement;
      document.activeElement = this;
      if (previous === this) return;
      if (previous) fire(previous, "focusout", { relatedTarget: this });
      fire(this, "focusin", { relatedTarget: previous });
    }
  }
  let document;
  document = new Element("document");
  const window = new Element("window"), body = new Element("body");
  Object.assign(document, {
    body, activeElement: body, defaultView: window,
    createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag),
  });
  Object.assign(window, {
    document, devicePixelRatio: 1, navigator: {}, crypto: globalThis.crypto, queueMicrotask,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame(fn) { const id = Symbol(); jobs.set(id, fn); return id; },
    cancelAnimationFrame(id) { jobs.delete(id); },
  });
  document.append(body);
  const before = { document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  Object.assign(globalThis, { document, window, ResizeObserver: class { observe() {} disconnect() {} } });
  const cleanups = [];
  t.after(() => {
    try { while (cleanups.length) cleanups.pop()(); }
    finally { Object.assign(globalThis, before); }
  });

  function fire(target, type, props = {}) {
    const event = { type, target, pointerId: 1, button: 0, buttons: 1, isPrimary: true, pointerType: "mouse",
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = this.immediate = true; },
      ...props };
    const chain = [];
    for (let node = target; node; node = node.parentElement) chain.push(node);
    function dispatch(list, capture) {
      for (const node of list) {
        event.currentTarget = node;
        for (const entry of [...node.listeners[type] || []]) {
          if (entry.capture === capture) entry.handler(event);
          if (event.immediate) break;
        }
        if (event.stopped) return;
      }
    }
    dispatch(chain.slice().reverse(), true);
    if (!event.stopped) dispatch(chain, false);
    return event;
  }
  return { document, window, body, Element, fire, calls, storage, cleanups, frame() {
    const pending = [...jobs.values()];
    jobs.clear();
    pending.forEach(fn => fn());
  } };
}

const keys = value => ({ animated: false, keyframes: [{ frame: 0, value, tween: 1 }] });
const zero = [0, 0];
const vertex = (point, incoming = zero, outgoing = zero) => [...point, ...incoming, ...outgoing];
function path(id, vertices, { closed = false, animated = false } = {}) {
  const data = { id, kind: "path", vertexIds: vertices.map((_, i) => id + "-" + i), vertexModes: {},
    properties: { closed: Number(closed), path: keys(vertices.flat()) } };
  if (animated) {
    data.properties.path.animated = true;
    data.properties.path.keyframes.push({ frame: 40, value: vertices.flat().map(value => value * 2), tween: 1 });
  }
  return data;
}
function mask(id, vertices, flags = {}) {
  const data = path(id, vertices, flags);
  const defaults = createMask(id, "Mask " + id, vertices[0].slice(0, 2));
  return { ...defaults, ...data, locked: !!flags.locked, properties: { ...defaults.properties, ...data.properties } };
}
const group = (id, contents, { position, scale, rotation }) => ({
  id, kind: "group", contents, properties: { position: keys(position), scale: keys(scale), rotation: keys(rotation) },
});

function fixture(t, { contents, masks, perspective = false }) {
  const dom = setupDom(t), { document, window, body, Element, fire } = dom;
  const cm = host(), { PZ, THREE } = cm, { Content } = createModel(PZ);
  const Layer = createLayerClass(PZ, THREE, Content);
  const createLayer = PZ.layer.create;
  PZ.layer.create = type => type === TYPE ? new Layer() : createLayer(type);
  cm.document = document;
  window.PZ = PZ;
  const project = new PZ.project(), { sequence } = project;
  sequence.properties.load();
  sequence.properties.resolution.set([240, 160]);
  project.assets.createFromPreset = () => ({});
  project.assets.load = asset => asset;
  project.assets.unload = () => {};
  PZ.asset.shader = class { getShader() { return Promise.resolve("void main(){}"); } };
  const editor = editorFor(PZ, project);
  editor.playback.currentFrame = 20;
  window.CM = editor;
  const track = new PZ.track.video();
  sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(contents ? TYPE : 4);
  clip.start = 10;
  clip.length = 160;
  track.clips.push(clip);
  clip.properties.load({ name: "Clip" });
  const layer = clip.object;
  if (contents) layer.load({ type: TYPE, contents, properties: { name: "Shape+" }, effects: [] });
  else {
    layer.properties.load();
    layer.properties.resolution.set([240, 160]);
    setMasks(layer, masks);
  }

  const top = Object.assign(Object.create(PZ.ui.edit.prototype), { selection: new PZ.objectList(),
    list: new Element("ul"), selectItems() {} });
  for (const panel of [top, Object.assign(Object.create(PZ.ui.edit.prototype), { objects: top.selection })]) {
    const root = new Element("div");
    root.classList.add("editorpanel"); root.pz_panel = panel; body.append(root);
  }
  const toolbar = new Element("div"), transform = new Element("button");
  toolbar.classList.add("toolbarpanel");
  toolbar.pz_panel = { buttons: [], click: PZ.ui.toolbar.prototype.click };
  transform.title = "layer transform controls (t)";
  toolbar.append(transform); body.append(toolbar);

  const el = new Element("div"), canvas = new Element("canvas"), widget2d = { el: new Element("div") };
  PZ.observable.defineObservableProp(widget2d, "edit", "onEditChanged");
  widget2d.edit = false;
  el.append(canvas, widget2d.el);
  body.append(el);
  const objects = new PZ.objectList();
  objects.push(clip);
  const viewport = { el, canvas, widget2d, enabled: true, objects, renderMode: perspective,
    camera: { isPerspectiveCamera: true }, options: { helper3dObjects: top.selection } };
  editor.mainViewport = viewport;
  const cleanups = [], notices = [], controls = [];
  let menu = [];
  const context = { lifecycle: { onDispose(fn) { cleanups.push(fn); } }, ui: {
    notify({ message }) { notices.push(message); },
    openMenu({ items }) { menu = items; return { close() {}, isOpen: () => false }; },
    openWindow({ mount }) { mount(new Element("div")); },
    controls: { number(options) { controls.push(options); return { element: new Element("input") }; } },
  } };
  const runtime = installPathEditing(context, Layer, Content);
  const dispose = () => { while (cleanups.length) cleanups.pop()(); };
  dom.cleanups.push(dispose);
  const state = () => runtime.shapeOverlay.state || runtime.maskOverlay.state;
  function pointer(type, [x, y], props) {
    const target = state()?.canvas || canvas;
    const { left, top } = target.getBoundingClientRect();
    return fire(target, type, { clientX: left + x, clientY: top + y, ...props });
  }
  function click(point, props) {
    pointer("pointerdown", point, props);
    pointer("pointerup", point, { ...props, buttons: 0 });
  }
  function drag(start, end, props) {
    pointer("pointerdown", start, props);
    pointer("pointermove", end, props);
    pointer("pointerup", end, { ...props, buttons: 0 });
  }
  return { ...dom, ...runtime, dispose, state, viewport, layer, editor, notices, controls, pointer, click, drag,
    controller: runtime.paths.controller,
    activate: id => PZ.zoidium.pathEditor.activate(contents ? "shape" : "mask", layer, id),
    key: (key, props = {}, type = "keydown") => fire(document.activeElement, type, { key, ...props }),
    command(point, label = "Set First Vertex") {
      pointer("contextmenu", point);
      const item = menu.find(entry => entry.label === label);
      assert.ok(item, label);
      return item;
    },
    points: () => clone(state().pathPoints()),
    snapshot: () => clone(contents ? layer.contents : getMasks(layer)),
  };
}

function approximate(actual, expected) {
  actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) < 1e-7, `Expected ${n} near ${expected[i]}`));
}
const toViewport = ([x, y]) => [120 + x, 80 - y];
function warp([x, y], { position, scale, rotation }) {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return [position[0] + c * x * scale[0] - s * y * scale[1], position[1] + s * x * scale[0] + c * y * scale[1]];
}
function badge(h, p) {
  h.calls.length = 0;
  h.pointer("pointermove", p, { buttons: 0 });
  h.frame();
  return h.calls.filter(call => call.method === "fillText").map(call => call.args[0]);
}

for (const kind of ["shape", "mask"]) {
  test(kind + " picking keeps a nine-pixel anchor and handle radius at two zoom levels", t => {
    const points = kind === "shape" ? [vertex([-60, 20], zero, [25, 0]), vertex([50, 20])] :
      [vertex([60, 60], zero, [25, 0]), vertex([170, 60])];
    const h = fixture(t, kind === "shape" ? { contents: [path("p", points)] } : { masks: [mask("p", points)] });
    assert.equal(h.activate("p"), true);
    for (const scale of [1, 2]) {
      h.click([51, 60]);
      assert.deepEqual(h.controller.getSelection(), ["p-0"]);
      h.click([50.9, 60]);
      assert.deepEqual(h.controller.getSelection(), []);
      h.pointer("pointermove", [60 + 25 * scale, 69], { buttons: 0 });
      assert.equal(h.controller.hover.kind, "handle");
      h.pointer("pointermove", [60 + 25 * scale, 69.1], { buttons: 0 });
      assert.equal(h.controller.hover, null);
      if (scale === 1) {
        const wheel = h.pointer("wheel", [60, 60], { deltaY: -Math.log(2) / .0012 });
        assert.equal(wheel.defaultPrevented, true);
        assert.equal(h.state().canvasApi.projection()[0], 2);
      }
    }
  });
}

test("a vertex drag round-trips through two transformed groups and a transformed Shape+ layer", t => {
  const inner = { position: [8, 11], scale: [.7, 1.3], rotation: -.5 };
  const outer = { position: [-12, -6], scale: [1.4, .6], rotation: .3 };
  const layer = { position: [10, -8, 0], scale: [1.2, .8, 1], rotation: .24 };
  const h = fixture(t, { contents: [group("outer", [group("inner", [
    path("p", [vertex([-34, 12], zero, [6, -1]), vertex([46, -18])]),
  ], inner)], outer)] });
  for (const [key, value] of Object.entries(layer)) h.layer.properties[key].set(value);
  h.frame();
  h.activate("p");
  h.state().snap = false;
  const screen = p => toViewport(warp(warp(warp(p, inner), outer), layer));
  const from = screen([-34, 12]), middle = screen([-24, 18]), end = screen([-13, 1]);
  // Hover an anchor just outside its nearby handle's hit circle.
  const grab = [from[0] - 5, from[1] + 3];
  const offset = [grab[0] - from[0], grab[1] - from[1]];
  const shifted = q => q.map((v, i) => v + offset[i]);
  h.pointer("pointerdown", grab);
  h.pointer("pointermove", shifted(middle));
  approximate(h.points()[0].point, [-24, 18]);
  h.pointer("pointermove", shifted(end));
  h.pointer("pointerup", shifted(end), { buttons: 0 });
  approximate(h.points()[0].point, [-13, 1]);
  assert.deepEqual(h.points()[0].out, [6, -1]);
  assert.deepEqual(h.controller.getSelection(), ["p-0"]);
  assert.equal(h.editor.history.undoStack.length, 1);
  h.editor.history.undo();
  assert.deepEqual(h.points()[0].point, [-34, 12]);
});

test("a mask drag accounts for its top-left origin and the layer transform", t => {
  const h = fixture(t, { masks: [mask("p", [vertex([70, 55]), vertex([150, 75])])] });
  const layer = { position: [16, -9, 0], scale: [1.3, .7, 1], rotation: -.3 };
  for (const [key, value] of Object.entries(layer)) h.layer.properties[key].set(value);
  h.frame();
  h.activate("p");
  h.state().snap = false;
  const screen = ([x, y]) => toViewport(warp([x - 120, 80 - y], layer));
  h.drag(screen([70, 55]), screen([85, 94]));
  approximate(h.points()[0].point, [85, 94]);
  approximate(getMasks(h.layer)[0].properties.path.keyframes[0].value.slice(0, 2), [85, 94]);
  assert.equal(h.editor.history.undoStack.length, 1);
});

test("Alt drag breaks a linked handle and Alt click converts a vertex", t => {
  const data = path("p", [vertex([-70, 20]), vertex([0, 20], [-20, 0], [20, 0]), vertex([70, 20])]);
  data.vertexModes["p-1"] = "symmetric";
  const h = fixture(t, { contents: [data] });
  h.activate("p");
  h.drag([140, 60], [152, 80], { altKey: true });
  assert.deepEqual(h.points()[1], { point: [0, 20], in: [-20, 0], out: [32, -20] });
  assert.equal(h.state().active().vertexModes["p-1"], "independent");
  h.click([120, 60], { altKey: true });
  assert.equal(h.state().active().vertexModes["p-1"], "corner");
  assert.deepEqual(h.points()[1].out, [0, 0]);
});

test("Pen draws endpoint, delete, add, and start feedback in the mounted canvas", t => {
  const h = fixture(t, { contents: [path("p", [vertex([-60, 20]), vertex([0, 20]), vertex([60, 20])])] });
  h.activate("p");
  h.key("q");
  assert.deepEqual(badge(h, [180, 60]), ["/"]);
  h.click([180, 60]);
  assert.ok(h.controller.drawing);
  assert.deepEqual(badge(h, [60, 60]), ["o"]);
  assert.ok(h.calls.filter(call => call.method === "arc" && call.args[0] === 60 && call.args[1] === 60).length >= 4);
  assert.ok(h.calls.some(call => call.method === "fillRect" && call.args[0] === 176));
  assert.ok(h.calls.some(call => call.method === "stroke" && call.color === "rgba(88,166,255,.7)"));
  assert.deepEqual(badge(h, [180, 60]), ["/"]);
  assert.deepEqual(badge(h, [120, 60]), ["-"]);
  assert.ok(h.calls.some(call => call.method === "strokeRect" && call.color === "#e5484d"));
  assert.deepEqual(badge(h, [150, 60]), ["+"]);
  assert.ok(h.calls.some(call => call.method === "stroke" && call.color === "#58a6ff" && call.width === 3));
  assert.deepEqual(badge(h, [150, 100]), []);
  assert.equal(h.state().canvas.style.cursor, "crosshair");
  h.click([60, 60]);
  assert.equal(h.controller.drawing, null);
  assert.equal(Number(h.state().active().properties.closed.get()), 1);
});

test("Pen prefers closing when both open endpoints are within the pick radius", t => {
  const h = fixture(t, { contents: [path("p", [vertex([20, 20]), vertex([-50, -20]), vertex([25, 20])])] });
  h.activate("p");
  h.key("q");
  assert.deepEqual(badge(h, [145, 60]), ["/"]);
  h.click([145, 60]);
  assert.deepEqual(badge(h, [145, 60]), ["o"]);
  h.click([145, 60]);
  assert.equal(Number(h.state().active().properties.closed.get()), 1);
});

test("Path Display Settings updates marker sizes locally and leaves the pick radius fixed", t => {
  const h = fixture(t, { contents: [path("p", [vertex([-60, 20], zero, [25, 0]), vertex([50, 20])])] });
  h.activate("p");
  const before = h.snapshot();
  h.command([130, 60], "Path Display Settings…").action();
  assert.deepEqual(h.controls.map(control => control.value), [8, 6]);
  h.controls[0].onChange(18);
  h.controls[1].onChange(12);
  h.calls.length = 0;
  h.frame();
  assert.ok(h.calls.some(call => call.method === "strokeRect" && call.args[2] === 18));
  assert.ok(h.calls.some(call => call.method === "arc" && call.args[2] === 6 && call.args[0] === 85));
  assert.deepEqual(JSON.parse([...h.storage.values()][0]), { vertexSize: 18, handleSize: 12 });
  assert.deepEqual(h.snapshot(), before);
  h.pointer("pointermove", [50, 60], { buttons: 0 });
  assert.equal(h.controller.hover, null);
});

test("mask snapping prioritizes a locked vertex, then a frame guide, then the drag axis", t => {
  const h = fixture(t, { masks: [
    mask("p", [vertex([30, 60]), vertex([65, 70]), vertex([40, 100])]),
    mask("locked", [vertex([238, 66])], { locked: true }),
  ] });
  h.activate("p");
  const before = h.snapshot();
  for (const [target, expected, kind] of [
    [[234, 64], [238, 66], "vertex"],
    [[236, 55], [240, 55], "guide"],
    [[160, 64], [160, 60], "axis"],
  ]) {
    h.pointer("pointerdown", [30, 60]);
    h.pointer("pointermove", target);
    assert.equal(h.state().snapGuide.kind, kind);
    approximate(h.points()[0].point, expected);
    approximate(getMasks(h.layer)[0].properties.path.keyframes[0].value.slice(0, 2), expected);
    h.calls.length = 0;
    h.frame();
    assert.ok(h.calls.some(call => call.method === "stroke" && call.color === "#6ee7db"));
    assert.equal(h.key("Escape").defaultPrevented, true);
    assert.equal(h.state().snapGuide, null);
    assert.deepEqual(h.points()[0].point, [30, 60]);
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.state().canvas.captures.size, 0);
  }
  assert.deepEqual(getMasks(h.layer)[1].properties.path.keyframes[0].value.slice(0, 2), [238, 66]);
  assert.equal(h.editor.history.undoStack.length, 0);
});

test("the point box moves, scales, and rotates the selected anchors and handles", t => {
  const h = fixture(t, { contents: [path("p", [
    vertex([-40, 35], zero, [8, 8]), vertex([20, -15]), vertex([70, -45]),
  ])] });
  h.activate("p");
  h.state().snap = false;
  h.drag([45, 30], [154, 103]);
  assert.deepEqual(h.controller.getSelection(), ["p-0", "p-1"]);
  const origin = h.points();

  h.drag([120, 45], [140, 65]);
  approximate(h.points()[0].point, [-20, 15]);
  approximate(h.points()[1].point, [40, -35]);
  assert.deepEqual(h.points()[0].out, [8, 8]);
  assert.equal(h.editor.history.undoStack.length, 1);
  h.editor.history.undo();

  h.drag([68, 33], [89, 51.5]);
  approximate(h.points()[0].point, [-25, 22.5]);
  approximate(h.points()[1].point, [5, -2.5]);
  approximate(h.points()[0].out, [4, 4]);
  assert.deepEqual(h.points()[2], origin[2]);
  assert.equal(h.editor.history.undoStack.length, 1);
  h.editor.history.undo();

  h.drag([110, 131], [49, 70]);
  approximate(h.points()[0].point, [15, 40]);
  approximate(h.points()[1].point, [-35, -20]);
  approximate(h.points()[0].out, [8, -8]);
  assert.equal(h.editor.history.undoStack.length, 1);
});

test("a direct segment drag translates both endpoints and preserves their handle vectors", t => {
  const h = fixture(t, { contents: [path("p", [
    vertex([-70, 20], zero, [20, 0]), vertex([10, 20], [-15, 0]), vertex([65, -40]),
  ])] });
  h.activate("p");
  h.drag([90, 60], [104, 87]);
  approximate(h.points()[0].point, [-56, -7]);
  approximate(h.points()[1].point, [24, -7]);
  assert.deepEqual(h.points()[2].point, [65, -40]);
  assert.deepEqual(h.points()[0].out, [20, 0]);
  assert.deepEqual(h.points()[1].in, [-15, 0]);
  assert.equal(h.editor.history.undoStack.length, 1);
});

for (const kind of ["shape", "mask"]) {
  test(kind + " Set First Vertex rotates a static closed path in one undo step", t => {
    const geometry = kind === "shape" ? [vertex([-50, 20]), vertex([30, 20], [-5, 0], [0, -7]), vertex([30, -20])] :
      [vertex([70, 60]), vertex([150, 60], [-5, 0], [0, 7]), vertex([150, 100])];
    const h = fixture(t, kind === "shape" ? { contents: [path("p", geometry, { closed: true })] } :
      { masks: [mask("p", geometry, { closed: true })] });
    h.activate("p");
    const before = h.points();
    const command = h.command([150, 60]);
    assert.equal(command.disabled, false);
    command.action();
    assert.deepEqual(Array.from(h.state().active().vertexIds), ["p-1", "p-2", "p-0"]);
    assert.deepEqual(h.points(), [before[1], before[2], before[0]]);
    assert.equal(h.editor.history.undoStack.length, 1);
    h.editor.history.undo();
    assert.deepEqual(h.points(), before);
  });
}

test("Set First Vertex reverses an open path only from its other endpoint", t => {
  const h = fixture(t, { contents: [path("p", [
    vertex([-50, 20], zero, [4, 2]), vertex([0, 20]), vertex([30, 20], [-5, 3]),
  ])] });
  h.activate("p");
  h.command([120, 60]).action();
  assert.match(h.notices.pop(), /choose an endpoint/i);
  assert.equal(h.editor.history.undoStack.length, 0);
  h.command([150, 60]).action();
  assert.deepEqual(Array.from(h.state().active().vertexIds), ["p-2", "p-1", "p-0"]);
  assert.deepEqual(h.points()[0].out, [-5, 3]);
  assert.deepEqual(h.points()[2].in, [4, 2]);
});

test("Set First Vertex rotates the animated channel blocks and undoes in one step", t => {
  const h = fixture(t, { contents: [path("p", [vertex([-40, 0]), vertex([0, 0]), vertex([40, 20])],
    { closed: true, animated: true })] });
  h.activate("p");
  const before = h.snapshot();
  h.command([120, 80]).action();
  const after = h.snapshot()[0];
  assert.deepEqual(after.vertexIds, ["p-1", "p-2", "p-0"]);
  const channels = before[0].properties.path.objects;
  assert.deepEqual(after.properties.path.objects, [...channels.slice(6), ...channels.slice(0, 6)]);
  assert.equal(h.editor.history.undoStack.length, 1);
  h.editor.history.undo();
  assert.deepEqual(h.snapshot(), before);
});

test("Escape and a drag back to its start restore an animated path without new keys", t => {
  const h = fixture(t, { contents: [path("p", [vertex([-40, 0]), vertex([40, 0])], { animated: true })] });
  h.activate("p");
  h.state().snap = false;
  const before = h.snapshot(), from = toViewport(h.points()[0].point);
  for (const cancel of [true, false]) {
    h.pointer("pointerdown", from);
    h.pointer("pointermove", [120, 30]);
    assert.notDeepEqual(h.snapshot(), before);
    if (cancel) assert.equal(h.key("Escape").defaultPrevented, true);
    else h.pointer("pointerup", from, { buttons: 0 });
    assert.deepEqual(h.snapshot(), before);
    assert.equal(h.controller.gesture, null);
    assert.equal(h.state().canvas.captures.size, 0);
  }
  assert.equal(h.editor.history.undoStack.length, 0);
  assert.equal(h.editor.history.operation, null);
});

test("a playhead change cancels an in-progress point transform", t => {
  const h = fixture(t, { contents: [path("p", [vertex([-40, 0]), vertex([40, 0])], { animated: true })] });
  h.activate("p");
  const before = h.snapshot(), from = toViewport(h.points()[0].point);
  h.pointer("pointerdown", from);
  h.pointer("pointermove", [120, 30]);
  assert.notDeepEqual(h.snapshot(), before);
  h.editor.playback.currentFrame++;
  h.frame();
  assert.match(h.notices.pop(), /frame changed/i);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.state().canvas.captures.size, 0);
  assert.equal(h.editor.history.undoStack.length, 0);
});

test("Space hands the gesture to the preview and releases capture without changing the Pen drawing", t => {
  const h = fixture(t, { masks: [mask("p", [vertex([65, 55]), vertex([150, 55])])] });
  h.activate("p");
  h.key("q");
  h.click([150, 55]);
  const before = h.snapshot(), drawing = clone(h.controller.drawing);
  assert.ok(drawing);
  assert.equal(h.key(" ", { code: "Space" }).defaultPrevented, true);
  assert.equal(h.state().canvas.style.cursor, "grab");
  h.pointer("pointerdown", [65, 55]);
  assert.equal(h.state().canvas.style.cursor, "grabbing");
  h.pointer("pointermove", [86, 69]);
  assert.match(h.viewport.canvas.style.transform, /translate\(21px, 14px\)/);
  assert.equal(h.state().canvas.captures.size, 1);
  h.key(" ", { code: "Space" }, "keyup");
  assert.equal(h.state().canvas.captures.size, 0);
  assert.equal(h.state().canvas.style.cursor, "crosshair");
  assert.deepEqual(clone(h.controller.drawing), drawing);
  assert.deepEqual(h.snapshot(), before);
  h.pointer("pointermove", [86, 69], { buttons: 0 });
  assert.equal(h.controller.hover.vertexIndex, 0);
  assert.equal(h.editor.history.undoStack.length, 0);
  h.key(" ", { code: "Space" });
  h.pointer("pointerdown", [86, 69]);
  h.fire(h.window, "blur");
  assert.equal(h.state().canvas.captures.size, 0);
  assert.equal(h.state().canvas.style.cursor, "crosshair");
  const input = h.document.createElement("input");
  h.viewport.el.append(input);
  input.focus();
  assert.equal(h.key(" ", { code: "Space" }).defaultPrevented, undefined);
  h.dispose();
  assert.equal(h.viewport.canvas.style.transform, "");
});

test("a locked path can be selected but denies transform and Set First Vertex", t => {
  const h = fixture(t, { masks: [mask("p", [vertex([60, 60]), vertex([150, 60]), vertex([150, 100])],
    { closed: true, locked: true })] });
  h.activate("p");
  const before = h.snapshot();
  h.drag([60, 60], [80, 85]);
  assert.deepEqual(h.controller.getSelection(), ["p-0"]);
  h.drag([105, 60], [120, 85]);
  assert.equal(h.command([150, 60]).disabled, true);
  assert.deepEqual(h.snapshot(), before);
  assert.equal(h.editor.history.undoStack.length, 0);
});

test("Scene perspective mode explains why path edits are disabled and composited mode recovers", t => {
  const h = fixture(t, { masks: [mask("p", [vertex([60, 60]), vertex([150, 60])])], perspective: true });
  h.viewport.el.focus();
  const before = h.snapshot();
  h.key("q");
  assert.match(h.notices.pop(), /perspective view.*press C/i);
  assert.equal(h.state(), undefined);
  assert.equal(h.activate("p"), false);
  assert.match(h.notices.pop(), /perspective view/i);
  h.click([100, 100]);
  assert.match(h.notices.pop(), /perspective view/i);
  assert.deepEqual(h.snapshot(), before);
  h.viewport.renderMode = false;
  h.frame();
  assert.equal(h.activate("p"), true);
  assert.ok(h.state());
});

test("a singular parent rejects a Pen point and becomes editable after its scale is restored", t => {
  const h = fixture(t, { contents: [group("group", [], { position: [0, 0], scale: [0, 1], rotation: 0 })] });
  const state = h.state();
  state.selectItem("group");
  state.canvas.focus();
  h.key("q");
  h.click([110, 45]);
  assert.match(h.notices.pop(), /singular/i);
  assert.equal(h.editor.history.undoStack.length, 0);
  find(h.layer.contents, "group").item.properties.scale.set([1, 1]);
  h.frame();
  h.click([110, 45]);
  assert.deepEqual(h.points()[0].point, [-10, 35]);
  assert.equal(h.editor.history.undoStack.length, 1);
});
