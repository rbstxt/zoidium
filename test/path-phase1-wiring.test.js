"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEditorPathRegistry } = require("../plugins/shape-plus/path-hosts.js");
const { FakeElement } = require("./fake-dom.js");
const { host: loadCM3, editorFor } = require("./helpers/editor-identity-host.cjs");
const { installPathEditing } = require("../plugins/shape-plus/runtime.js");
const { createModel, clone } = require("../plugins/shape-plus/model.js");
const { TYPE, createLayerClass } = require("../plugins/shape-plus/layer.js");
const { createMask, getMasks, setMasks } = require("../plugins/shape-plus/mask-model.js");
const { find } = require("../plugins/shape-plus/editor-tree-data.js");
const { selectionKey } = require("../plugins/shape-plus/editor-selection.js");


test("editor registry shares adapters and disposes the controller on project change", () => {
  const watchers = new Set();
  const editor = { project: {}, onProjectChanged: {
    watch: fn => watchers.add(fn), unwatch: fn => watchers.delete(fn),
  } };
  const viewport = {}, layer = {};
  const session = { selectItem(id) { this.activeId = id; }, read: () => [{ kind: "group", contents: [
    { kind: "path", id: "path", vertexIds: ["vertex"] },
  ] }], nextId: () => "new" };
  const registry = createEditorPathRegistry(editor, viewport);
  const original = registry.controller;
  const host = registry.register("shape", layer, session);
  assert.equal(registry.register("shape", layer, session), host);
  assert.equal(registry.activate("shape", layer, "missing"), false);
  assert.equal(registry.activate("shape", layer, "path"), true);
  assert.equal(session.activeId, "path");
  assert.deepEqual(host.listVertexIds("path"), ["vertex"]);
  editor.project = {};
  for (const fn of watchers) fn();
  assert.equal(original.disposed, true);
  assert.notEqual(registry.controller, original);
  assert.equal(registry.controller.activePathId, null);
  registry.dispose();
  assert.equal(watchers.size, 0);
  assert.equal(registry.controller.disposed, true);
});

function fakeViewportDom(t) {
  const rect = { left: 0, top: 0, width: 240, height: 160 };
  const noop = () => {};
  const ctx = new Proxy({ isPointInPath: () => false }, { get: (target, key) => target[key] || noop });
  class Element extends FakeElement {
    constructor(tag) {
      super(tag);
      this.ownerDocument = doc;
      this.captures = new Set();
    }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    after(node) { this.parentElement.insertBefore(node, this.parentElement.children[this.parentElement.children.indexOf(this) + 1]); }
    setAttributeNS(_namespace, name, value) { this.setAttribute(name, value); }
    hasAttribute(name) { return this.getAttribute(name) !== null; }
    removeAttribute(name) { delete this.attributes[name]; }
    getBoundingClientRect() { return rect; }
    getContext() { return ctx; }
    setPointerCapture(id) { this.captures.add(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    addEventListener(type, listener, capture = false) {
      (this.listeners[type] ||= []).push({ listener, capture: capture === true });
    }
    removeEventListener(type, listener, capture = false) {
      this.listeners[type] = (this.listeners[type] || []).filter(entry => entry.listener !== listener || entry.capture !== (capture === true));
    }
    matches(selector) {
      return selector.split(",").some(part => {
        part = part.trim();
        if (part === 'button[title="layer transform controls (t)"]') return this.title === "layer transform controls (t)";
        if (part === "[contenteditable]:not([contenteditable='false'])") return this.hasAttribute("contenteditable") && this.getAttribute("contenteditable") !== "false";
        if (part.startsWith("[")) return this.hasAttribute(part.slice(1, -1));
        if (part === ".zoidium-masks button") return this.tagName === "BUTTON" && !!this.parentElement?.closest(".zoidium-masks");
        if (part.startsWith(".")) return super.matches(part);
        return this.tagName === part.toUpperCase();
      });
    }
    closest(selector) {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    }
    querySelectorAll(selector) {
      return this.children.flatMap(child => (child.matches(selector) ? [child] : []).concat(child.querySelectorAll(selector)));
    }
    getElementsByClassName(names) {
      return new Proxy([], { get: (_target, key) => {
        const matches = this.querySelectorAll("." + names.replaceAll(" ", "."));
        return typeof matches[key] === "function" ? matches[key].bind(matches) : matches[key];
      } });
    }
    focus() {
      const previous = doc.activeElement;
      doc.activeElement = this;
      if (previous && previous !== this) fire(previous, "focusout", { relatedTarget: this });
      if (previous !== this) fire(this, "focusin", { relatedTarget: previous });
    }
  }
  let doc;
  doc = new Element("document");
  doc.ownerDocument = doc;
  const win = new Element("window"), body = new Element("body");
  Object.assign(doc, { defaultView: win, body, activeElement: body,
    createElement: tag => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) });
  doc.append(body);
  let nextId = 0, nextFrame = 0;
  const frames = new Map();
  Object.assign(win, { document: doc, navigator: {}, queueMicrotask, devicePixelRatio: 1,
    crypto: { randomUUID: () => String(++nextId) },
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  t.mock.method(globalThis.crypto, "randomUUID", () => String(++nextId));
  const previous = { document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver };
  Object.assign(globalThis, { window: win, document: doc, ResizeObserver: class { observe() {} disconnect() {} } });
  const cleanups = [];
  t.after(() => {
    try { while (cleanups.length) cleanups.pop()(); }
    finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  });

  function fire(target, type, extra = {}) {
    const event = { type, target, pointerId: 1, button: 0, buttons: 1, isPrimary: true,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; this.immediate = true; },
      ...extra };
    const chain = [];
    for (let node = target; node; node = node.parentElement) chain.push(node);
    const run = (current, capture) => {
      event.currentTarget = current;
      for (const entry of [...current.listeners[type] || []]) {
        if (entry.capture === capture) entry.listener(event);
        if (event.immediate) return;
      }
      if (!capture) current["on" + type]?.(event);
    };
    for (const node of [...chain].reverse()) {
      run(node, true);
      if (event.stopped) return event;
    }
    for (const node of chain) {
      run(node, false);
      if (event.stopped) return event;
    }
    return event;
  }
  return { doc, win, body, Element, fire, cleanups, frame() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn());
  }, frames };
}

function path(id, points, closed = 0) {
  return { id, kind: "path", vertexIds: points.map((_, i) => id + "-" + i), vertexModes: {},
    properties: { closed, path: { animated: false, keyframes: [
      { frame: 0, value: points.flatMap(([x, y]) => [x, y, 0, 0, 0, 0]), tween: 1 },
    ] } } };
}
function mask(id, points, locked = false) {
  const data = path(id, points, 1);
  const defaults = createMask(id, "Mask " + id, points[0]);
  return { ...defaults, ...data, locked, properties: { ...defaults.properties, ...data.properties } };
}
const group = (id, contents, properties = {}) => ({ id, kind: "group", properties, contents });

function editorFixture(t, setup) {
  const dom = fakeViewportDom(t), { doc, win, body, Element, fire } = dom;
  const cm = loadCM3(), { PZ, THREE } = cm, { Content } = createModel(PZ);
  cm.document = doc;
  const Layer = createLayerClass(PZ, THREE, Content);
  const createLayer = PZ.layer.create;
  PZ.layer.create = type => type === TYPE ? new Layer() : createLayer(type);
  win.PZ = PZ;
  const project = new PZ.project(), { sequence } = project;
  project.assets.createFromPreset = () => ({});
  project.assets.load = asset => asset;
  project.assets.unload = () => {};
  PZ.asset.shader = class { getShader() { return Promise.resolve("void main(){}"); } };
  sequence.properties.load();
  sequence.properties.resolution.set([240, 160]);
  const editor = editorFor(PZ, project);
  Object.assign(editor.playback, { currentFrame: 20, speed: 0 });
  win.CM = editor;

  const timeline = Object.assign(Object.create(PZ.ui.timeline.prototype), { editor, sequence });
  const tracks = Object.assign(Object.create(PZ.ui.timeline.tracks.prototype), {
    timeline, sequence, selection: new PZ.objectList(), container: new Element("div"),
  });
  timeline.tracks = tracks;
  function addPanel(panel, element = new Element("div")) {
    element.classList.add("editorpanel"); element.pz_panel = panel; body.append(element);
    return element;
  }
  addPanel(timeline, tracks.container);
  const top = Object.assign(Object.create(PZ.ui.edit.prototype), { selection: new PZ.objectList(), list: new Element("ul") });
  top.deselectItems = function() { for (const row of this.list.getElementsByClassName("selected")) row.classList.remove("selected"); };
  top.selectItems = function() { this.selection.splice(0, this.selection.length,
    ...this.list.getElementsByClassName("selected").map(row => row.pz_object)); };
  addPanel(top).append(top.list);
  addPanel(Object.assign(Object.create(PZ.ui.edit.prototype), { objects: top.selection }));
  const toolbarEl = new Element("div"), transform = new Element("button");
  const nativeKeys = [];
  const toolbar = { enabled: true, buttons: ["t", "c", "m", "v"].map(key => ({
    key, fn: () => { nativeKeys.push(key); if (key === "t") widget2d.edit = !widget2d.edit; },
  })), click: PZ.ui.toolbar.prototype.click, shouldIgnoreKeydown: PZ.ui.toolbar.prototype.shouldIgnoreKeydown };
  doc.addEventListener("keydown", PZ.ui.toolbar.prototype.keydown.bind(toolbar));
  toolbarEl.classList.add("toolbarpanel"); toolbarEl.pz_panel = toolbar;
  transform.title = "layer transform controls (t)"; toolbarEl.append(transform); body.append(toolbarEl);

  const viewportEl = new Element("div"), viewportCanvas = new Element("canvas");
  const widget2d = { el: new Element("div") };
  PZ.observable.defineObservableProp(widget2d, "edit", "onEditChanged");
  widget2d.edit = false; widget2d.el.style.visibility = "";
  viewportEl.append(viewportCanvas, widget2d.el); body.append(viewportEl);
  const viewport = { el: viewportEl, canvas: viewportCanvas, widget2d, enabled: true, renderMode: false,
    objects: tracks.selection, options: { helper3dObjects: top.selection } };
  editor.mainViewport = viewport;
  function rows() {
    const layer = viewport.objects[0]?.object;
    top.list.replaceChildren();
    function add(contents) {
      for (const item of contents) {
        const row = new Element("li");
        row.pz_object = item;
        top.list.append(row);
        if (item.contents) add(item.contents);
      }
    }
    if (layer instanceof Layer) add(layer.contents);
  }
  tracks.selection.onListChanged.watch(() => {
    viewport.renderMode = viewport.objects[0]?.object instanceof PZ.layer.scene;
    top.selection.splice(0, top.selection.length);
    rows();
  });
  function timelineRows() {
    const clips = Array.from(sequence.videoTracks).flatMap(track => Array.from(track.clips, clip => {
      const row = new Element("div");
      row.classList.add("clip");
      row.classList.toggle("selected", tracks.selection.includes(clip));
      row.pz_object = clip;
      return row;
    }));
    tracks.container.replaceChildren(...clips);
  }
  for (const name of ["onTrackCreated", "onTrackDeleted", "onClipCreated", "onClipDeleted"]) {
    sequence.ui[name].watch(timelineRows);
  }
  function addClip(type, { contents = [], masks = [], start = 12, length = 180 } = {}) {
    const track = new PZ.track.video();
    sequence.videoTracks.push(track);
    const clip = new PZ.clip.video(type);
    track.clips.push(clip);
    clip.start = start; clip.length = length; clip.offset = 0;
    clip.properties.load({ name: "Clip" });
    if (type === TYPE) clip.object.load({ type, contents, properties: { name: "Shape+" }, effects: [] });
    else {
      clip.object.properties.load();
      clip.object.properties.resolution.set([240, 160]);
      if (masks.length) setMasks(clip.object, masks);
    }
    timelineRows();
    return clip;
  }
  function choose(...clips) {
    tracks.deselectClips();
    for (const row of tracks.container.querySelectorAll(".clip"))
      if (clips.includes(row.pz_object)) row.classList.add("selected");
    tracks.selectClips();
  }
  const extra = setup({ addClip, choose, viewport, editor });
  const cleanup = [], notices = [];
  let menu;
  const context = { lifecycle: { onDispose(fn) { cleanup.push(fn); } }, ui: {
    notify(notice) { notices.push(notice.message); },
    openMenu({ items }) { menu = items; return { close() {}, isOpen: () => false }; },
  } };
  const runtime = installPathEditing(context, Layer, Content);
  const api = PZ.zoidium.pathEditor;
  const dispose = () => { while (cleanup.length) cleanup.pop()(); };
  dom.cleanups.push(dispose);

  function key(key, props = {}, target = doc.activeElement) { return fire(target, "keydown", { key, ...props }); }
  function state() { return runtime.shapeOverlay.state || runtime.maskOverlay.state; }
  function pointer(type, x, y, props = {}, canvas = state()?.canvas || viewportCanvas) {
    return fire(canvas, type, { clientX: x, clientY: y, pointerType: "mouse", ...props });
  }
  function click(x, y, props = {}, canvas = state()?.canvas || viewportCanvas) {
    pointer("pointerdown", x, y, props, canvas);
    pointer("pointerup", x, y, { ...props, buttons: 0 }, canvas);
  }
  function rowSelect(id, additive = false) {
    if (!additive) top.deselectItems();
    const row = top.list.querySelectorAll("li").find(row => row.pz_object.id === id);
    assert.ok(row, id);
    row.classList.add("selected"); top.selectItems();
  }
  const activate = (...args) => api.activate(...args);
  t.after(() => assert.deepEqual(notices, [], "unexpected runtime notifications"));
  return { ...dom, ...runtime, ...extra, editor, project, sequence, viewport, tracks, top, viewportCanvas,
    toolbar, toolbarEl, nativeKeys, menu: () => menu, key, pointer, click, state, activate, api, dispose, choose, rowSelect, notices };
}

for (const type of [4, 1]) {
  test("first Pen click creates one undoable " + (type === 4 ? "Scene" : "Adjustment") + " mask", t => {
    const h = editorFixture(t, ({ addClip, choose }) => {
      const clip = addClip(type, { masks: [mask("original", [[20, 20], [70, 20]])] });
      choose(clip);
      return { layer: clip.object };
    });
    h.viewport.el.focus();
    h.key("q"); h.key("q"); h.key("q");
    assert.equal(h.paths.controller.tool, "pen");
    assert.equal(h.state().tool, "pen");
    assert.equal(getMasks(h.layer).length, 1);
    assert.equal(h.editor.history.undoStack.length, 0);
    h.click(120, 80);
    const [original, created] = getMasks(h.layer);
    assert.equal(original.id, "original");
    assert.equal(created.id, h.paths.controller.activePathId);
    assert.deepEqual(Array.from(h.state().pathPoints()[0].point), [120, 80]);
    assert.deepEqual(h.paths.controller.getSelection(), created.vertexIds);
    assert.equal(h.editor.history.undoStack.length, 1);
    h.editor.history.undo();
    h.frame();
    assert.deepEqual(getMasks(h.layer).map(item => item.id), ["original"]);
    assert.equal(h.paths.controller.activePathId, null);
    h.editor.history.redo();
    assert.equal(getMasks(h.layer)[1].id, created.id);
  });
}

test("Pen creates a path inside the current Shape+ group and continues it in place", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const position = { animated: false, keyframes: [{ frame: 0, value: [25, 10], tween: 1 }] };
    const clip = addClip(TYPE, { contents: [group("outer", [group("inner", [
      { kind: "fill", id: "paint", properties: {} },
    ], { position })])] });
    choose(clip);
    return { layer: clip.object };
  });
  h.rowSelect("inner");
  h.viewport.el.focus();
  h.key("P");
  assert.equal(h.editor.history.undoStack.length, 0);
  h.click(160, 55);
  const inner = find(h.layer.contents, "inner").item;
  const id = h.paths.controller.activePathId;
  assert.deepEqual(Array.from(inner.contents, item => item.id), [id, "paint"]);
  assert.deepEqual(Array.from(h.state().pathPoints()[0].point), [15, 15]);
  assert.equal(h.editor.history.undoStack.length, 1);
  h.click(200, 90);
  assert.equal(h.paths.controller.activePathId, id);
  assert.equal(h.state().active().vertexIds.length, 2);
  assert.equal(h.editor.history.undoStack.length, 2);
  h.editor.history.undo();
  assert.equal(h.state().active().vertexIds.length, 1);
  h.editor.history.undo();
  assert.deepEqual(Array.from(find(h.layer.contents, "inner").item.contents, item => item.id), ["paint"]);
});

for (const incompatible of [false, true]) {
  test("one Pen click creates a native Shape+ clip " + (incompatible ? "with an incompatible selection" : "without a selection"), t => {
    const h = editorFixture(t, ({ addClip, choose }) => {
      const prior = incompatible ? addClip(6) : null;
      if (prior) choose(prior);
      return { prior };
    });
    h.viewport.el.focus();
    h.key("q");
    assert.equal(h.sequence.videoTracks.length, Number(incompatible));
    assert.equal(h.editor.history.undoStack.length, 0);
    h.key("v");
    assert.equal(h.paths.controller.tool, "select");
    h.click(140, 60);
    assert.equal(h.sequence.videoTracks.length, Number(incompatible));
    h.key("q");
    h.click(140, 60);
    const track = h.sequence.videoTracks[Number(incompatible)], clip = track.clips[0];
    assert.equal(clip.object.type, TYPE);
    assert.equal(clip.start, 20);
    assert.equal(clip.length, 180);
    assert.equal(h.tracks.selection[0], clip);
    const [g] = clip.object.contents;
    assert.deepEqual(Array.from(g.contents, item => item.kind), ["path", "stroke", "fill"]);
    assert.deepEqual(Array.from(h.state().pathPoints()[0].point), [20, 20]);
    assert.equal(h.paths.controller.activePathId, g.contents[0].id);
    assert.equal(h.editor.history.undoStack.length, 1);
    h.editor.history.undo();
    assert.equal(h.paths.controller.activePathId, null);
    assert.equal(h.sequence.videoTracks.length, Number(incompatible));
    assert.deepEqual(Array.from(h.tracks.selection), h.prior ? [h.prior] : []);
    h.editor.history.redo();
    assert.equal(h.sequence.videoTracks[Number(incompatible)].clips[0].object.contents[0].contents[0].id, g.contents[0].id);
  });
}

test("viewport shortcuts respect focus, composition, Graph+, and native toolbar dispatch", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const clip = addClip(TYPE, { contents: [path("line", [[-50, 20], [50, 20]])] });
    choose(clip);
    return { layer: clip.object };
  });
  const tool = () => h.paths.controller.tool;
  const canvas = h.state().canvas;
  const typing = h.doc.createElement("input"), graph = h.doc.createElement("button");
  graph.classList.add("g2-editor");
  h.viewport.el.append(typing, graph);
  const pen = h.toolbarEl.querySelectorAll("button").find(button => button.title === "Shape+ pen (p)");
  typing.focus();
  assert.equal(h.key("q").defaultPrevented, undefined);
  h.toolbar.click({ currentTarget: pen });
  assert.equal(tool(), "select");
  graph.focus();
  h.key("q");
  assert.equal(tool(), "select");
  h.body.focus();
  h.key("q", {}, canvas);
  assert.equal(tool(), "select");
  canvas.focus();
  h.key("q", { isComposing: true });
  h.key("q", { keyCode: 229 });
  h.fire(canvas, "compositionstart");
  h.key("q");
  assert.equal(tool(), "select");
  h.fire(canvas, "compositionend");
  h.key("q", { metaKey: true });
  h.key("Q", { shiftKey: true });
  assert.equal(tool(), "select");

  assert.equal(h.activate("shape", h.layer, "line"), true);
  h.click(70, 60);
  assert.deepEqual(h.paths.controller.getSelection(), ["line-0"]);
  pen.focus();
  h.toolbar.click({ currentTarget: pen });
  assert.equal(tool(), "pen");
  assert.deepEqual(h.paths.controller.getSelection(), ["line-0"]);
  h.key("Control", { ctrlKey: true });
  assert.equal(tool(), "select");
  assert.equal(h.key("v", { ctrlKey: true }).defaultPrevented, undefined);
  typing.focus();
  assert.equal(tool(), "pen");
  assert.equal(h.paths.controller.focusOwner, null);
  canvas.focus();
  h.key("Meta", { metaKey: true });
  assert.equal(tool(), "select");
  h.fire(canvas, "keyup", { key: "Meta" });
  assert.equal(tool(), "pen");
  h.key("V");
  h.key("Q");
  assert.equal(tool(), "pen");
  assert.deepEqual(h.paths.controller.getSelection(), ["line-0"]);
  h.key("c");
  h.key("m");
  h.key("t");
  assert.equal(tool(), "select");
  assert.deepEqual(h.nativeKeys, ["c", "m", "t"]);
  assert.equal(h.shapeOverlay.state, undefined);
  assert.deepEqual(h.paths.controller.getSelection(), ["line-0"]);
  assert.equal(h.activate("shape", h.layer, "line"), true);
  assert.deepEqual([...h.state().selection], [selectionKey("line-0")]);
});

test("Escape cancels a drag, finishes drawing, then clears points; Enter can finish", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const clip = addClip(4); choose(clip);
    return { layer: clip.object };
  });
  h.viewport.el.focus(); h.key("q");
  h.click(30, 35);
  const controller = h.paths.controller, id = controller.activePathId;
  const [first] = controller.getSelection();
  h.pointer("pointerdown", 90, 35);
  h.pointer("pointermove", 95, 48);
  assert.ok(controller.gesture);
  assert.equal(h.state().active().vertexIds.length, 2);
  assert.equal(h.key("Escape").defaultPrevented, true);
  assert.equal(controller.gesture, null);
  assert.equal(h.state().canvas.captures.size, 0);
  assert.equal(h.state().active().vertexIds.length, 1);
  assert.equal(h.editor.history.undoStack.length, 1);
  assert.ok(controller.drawing);
  assert.deepEqual(controller.getSelection(), [first]);
  assert.equal(h.key("Escape").defaultPrevented, true);
  assert.equal(controller.drawing, null);
  assert.deepEqual(controller.getSelection(), [first]);
  assert.equal(h.key("Escape").defaultPrevented, true);
  assert.equal(controller.activePathId, id);
  assert.deepEqual(controller.getSelection(), []);
  assert.equal(h.key("Escape").defaultPrevented, undefined);

  h.click(100, 90);
  assert.notEqual(controller.activePathId, id);
  const selected = controller.getSelection();
  assert.equal(h.key("Enter").defaultPrevented, true);
  assert.equal(controller.drawing, null);
  assert.deepEqual(controller.getSelection(), selected);
  assert.equal(h.key("Enter").defaultPrevented, undefined);
});

test("Delete and Backspace affect only selected anchors within path focus", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const clip = addClip(TYPE, { contents: [path("line", [[-50, 20], [0, 20], [50, 20]])] });
    choose(clip);
    return { layer: clip.object };
  });
  h.activate("shape", h.layer, "line");
  const item = () => find(h.layer.contents, "line").item;
  assert.equal(h.key("Delete").defaultPrevented, undefined);
  assert.equal(item().vertexIds.length, 3);
  h.click(70, 60);
  h.body.focus();
  assert.equal(h.key("Backspace").defaultPrevented, undefined);
  assert.deepEqual(item().vertexIds, ["line-0", "line-1", "line-2"]);
  const control = h.doc.createElement("button");
  control.setAttribute("data-zoidium-path-control", "");
  h.body.append(control);
  control.focus();
  assert.equal(h.key("Delete").defaultPrevented, true);
  assert.deepEqual(item().vertexIds, ["line-1", "line-2"]);
  assert.equal(h.editor.history.undoStack.length, 1);
  assert.equal(h.paths.controller.activePathId, "line");
  h.click(120, 60);
  assert.equal(h.key("Backspace").defaultPrevented, true);
  assert.deepEqual(item().vertexIds, ["line-2"]);
  assert.equal(h.editor.history.undoStack.length, 2);
});

for (const kind of ["shape", "mask"]) {
  test(kind + " outlines cycle in draw order and Shift marquee toggles controller selection", t => {
    const h = editorFixture(t, ({ addClip, choose }) => {
      const clip = kind === "shape" ? addClip(TYPE, { contents: [
        group("front-group", [path("front", [[-60, 20], [60, 20], [60, -25]], 1)]),
        path("back", [[-60, 20], [60, 20], [60, -25]], 1),
      ] }) : addClip(1, { masks: [
        mask("front", [[60, 60], [180, 60], [180, 105]]),
        mask("back", [[60, 60], [180, 60], [180, 105]]),
      ] });
      choose(clip);
      return { layer: clip.object };
    });
    assert.equal(h.activate(kind, h.layer, "back"), true);
    const controller = h.paths.controller;
    const active = () => {
      assert.equal(h.state().activeId, controller.activePathId);
      return controller.activePathId;
    };
    h.click(120, 60); assert.equal(active(), "front");
    h.click(120, 60); assert.equal(active(), "back");
    h.pointer("pointermove", 30, 25, { buttons: 0 });
    h.click(120, 60); assert.equal(active(), "front");
    const frame = h.editor.playback.currentFrame;
    h.editor.playback.currentFrame++;
    h.frame();
    h.editor.playback.currentFrame = frame;
    h.frame();
    h.click(120, 60); assert.equal(active(), "front");
    h.click(120, 60); assert.equal(active(), "back");
    assert.equal(h.activate(kind, h.layer, "back"), true);
    h.click(120, 60); assert.equal(active(), "front");

    const startMarquee = (x, y, shiftKey = false) => h.pointer("pointerdown", x, y, { shiftKey });
    const endMarquee = (x, y, shiftKey = false) => h.pointer("pointerup", x, y, { shiftKey });
    startMarquee(30, 30);
    h.pointer("pointermove", 80, 70);
    assert.deepEqual(controller.getSelection(), ["front-0"]);
    endMarquee(80, 70);
    startMarquee(30, 30, true);
    h.pointer("pointermove", 200, 72, { shiftKey: true });
    assert.deepEqual(controller.getSelection(), ["front-1"]);
    h.pointer("pointermove", 70, 72, { shiftKey: true });
    assert.deepEqual(controller.getSelection(), []);
    h.pointer("pointermove", 200, 72, { shiftKey: true });
    endMarquee(200, 72, true);
    assert.deepEqual([...h.state().selection], [selectionKey("front-1")]);
    assert.equal(h.editor.history.undoStack.length, 0);
  });
}

test("locked mask geometry, topology, keys and deletion stay unchanged through the editor", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const clip = addClip(1, { masks: [mask("locked", [[60, 60], [180, 60], [180, 105]], true)] });
    choose(clip);
    return { layer: clip.object };
  });
  assert.equal(h.activate("mask", h.layer, "locked"), true);
  const before = clone(getMasks(h.layer));
  h.pointer("pointerdown", 60, 60);
  h.pointer("pointermove", 80, 75);
  h.pointer("pointerup", 80, 75);
  assert.deepEqual(h.paths.controller.getSelection(), ["locked-0"]);
  assert.equal(h.key("Backspace").defaultPrevented, true);
  h.key("ArrowRight");
  h.key("q");
  h.click(60, 60, { altKey: true });
  h.click(120, 60);
  h.key("v");
  for (const label of ["Open Path", "Reverse Path Direction", "Smooth Points", "Keyframe Path", "Delete"]) {
    h.pointer("contextmenu", 120, 60);
    const command = h.menu().find(item => item.label === label);
    assert.ok(command, label);
    command.action();
  }
  assert.deepEqual(getMasks(h.layer), before);
  assert.equal(h.editor.history.undoStack.length, 0);
  assert.equal(h.editor.history.operation, null);
  assert.equal(h.notices.length, 6);
  for (const notice of h.notices.splice(0)) assert.match(notice, /unlock|locked/i);
});

test("non-path Shape+ tools still edit a rectangle while path shortcuts yield to the layer", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const clip = addClip(TYPE, { contents: [
      { id: "rectangle", kind: "rectangle", properties: {} },
      path("line", [[-60, 30], [-25, 30]]),
    ] });
    choose(clip);
    return { layer: clip.object };
  });
  h.rowSelect("rectangle");
  h.state().canvas.focus();
  h.key("v");
  assert.deepEqual(h.nativeKeys, ["v"]);
  const rectangle = () => find(h.layer.contents, "rectangle").item;
  const before = Array.from(rectangle().properties.position.get(8));
  h.key("ArrowRight");
  h.fire(h.state().canvas, "keyup", { key: "ArrowRight" });
  assert.deepEqual(Array.from(rectangle().properties.position.get(8)), [before[0] + 1, before[1]]);
  assert.equal(h.editor.history.undoStack.length, 1);
  h.editor.history.undo();
  assert.deepEqual(Array.from(rectangle().properties.position.get(8)), before);
});

test("Shape+ snapshots restore paths in their nested parent without rebuilding sibling nodes", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const clip = addClip(TYPE, { contents: [
      group("outer", [group("inner", [
        path("first", [[-50, 20], [50, 20]]),
        { kind: "fill", id: "paint", properties: {} },
        path("second", [[-50, 10], [50, 10]]),
      ])]),
    ] });
    choose(clip);
    return { layer: clip.object };
  });
  h.rowSelect("first");
  const { controller } = h.paths, host = controller.activeHost;
  const contents = h.layer.contents, inner = find(contents, "inner").item;
  const list = inner.contents, paint = list[1], sibling = list[2];
  const before = host.readSnapshot();
  const after = clone(before);
  after[0].properties.closed = 1;
  host.writeSnapshot(after);
  assert.equal(controller.activePathId, "first");
  assert.equal(h.state().active().properties.closed.get(), 1);
  assert.equal(h.layer.contents, contents);
  assert.equal(inner.contents, list);
  assert.equal(list[1], paint);
  assert.equal(list[2], sibling);
  host.deletePath("first");
  assert.equal(controller.activePathId, null);
  host.restoreSnapshot(before);
  assert.deepEqual(Array.from(list, item => item.id), ["first", "paint", "second"]);
  assert.equal(list[1], paint);
  assert.equal(list[2], sibling);
});

test("public activation mounts either host and survives session rebinds until project dispose", t => {
  const h = editorFixture(t, ({ addClip, choose }) => {
    const shape = addClip(TYPE, { contents: [path("line", [[-50, 20], [50, 20]])], start: 40 });
    const scene = addClip(4, { masks: [mask("mask", [[60, 60], [180, 60], [180, 105]])] });
    choose(scene);
    return { shape, scene };
  });
  assert.equal(h.shapeOverlay.state, undefined);
  assert.equal(h.maskOverlay.state, undefined);
  assert.equal(h.activate("mask", h.scene.object, "missing"), false);
  assert.equal(h.activate("shape", h.scene.object, "mask"), false);
  assert.equal(h.activate("mask", h.scene.object, "mask"), true);
  const first = h.state().canvas;
  h.click(60, 60);
  h.maskOverlay.setMode("off");
  assert.equal(first.parentElement, null);
  assert.equal(h.activate("mask", h.scene.object, "mask"), true);
  assert.notEqual(h.state().canvas, first);
  assert.deepEqual([...h.state().selection], [selectionKey("mask-0")]);
  assert.equal(h.activate("shape", h.shape.object, "line"), true);
  assert.equal(h.editor.playback.currentFrame, 40);
  assert.equal(h.tracks.selection[0], h.shape);
  const controller = h.paths.controller, host = controller.activeHost, originalState = h.state();
  h.click(70, 60);
  assert.equal(h.activate("shape", h.shape.object, "line"), true);
  assert.deepEqual(controller.getSelection(), ["line-0"]);
  h.key("t");
  assert.equal(h.shapeOverlay.state, undefined);
  h.rowSelect("line");
  assert.notEqual(h.state(), originalState);
  assert.equal(controller.activeHost, host);
  assert.deepEqual([...h.state().selection], [selectionKey("line-0")]);
  h.click(170, 60);
  assert.deepEqual(controller.getSelection(), ["line-1"]);
  assert.deepEqual([...originalState.selection], [selectionKey("line-0")]);
  const canvas = h.state().canvas;
  h.pointer("pointerdown", 170, 60);
  assert.equal(canvas.captures.size, 1);
  const next = new h.win.PZ.project();
  h.editor.sequence = next.sequence;
  h.editor.project = next;
  assert.equal(controller.disposed, true);
  assert.equal(h.paths.controller.activePathId, null);
  assert.equal(canvas.captures.size, 0);
  assert.equal(canvas.parentElement, null);
  assert.equal(h.win.PZ.zoidium.pathEditor, h.api);
  assert.equal(h.activate("shape", h.shape.object, "line"), false);
  h.dispose();
  assert.equal(h.win.PZ.zoidium.pathEditor, undefined);
  assert.equal(h.api.activate("mask", h.scene.object, "mask"), false);
  assert.equal(h.frames.size, 0);
});
