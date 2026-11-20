"use strict";
const assert = require("node:assert/strict");
const { FakeElement } = require("../fake-dom.js");
const { host, editorFor } = require("./editor-identity-host.cjs");
const { installPathEditing } = require("../../plugins/shape-plus/runtime.js");
const { createModel, clone } = require("../../plugins/shape-plus/model.js");
const { TYPE, createLayerClass } = require("../../plugins/shape-plus/layer.js");
const { getMasks, setMasks, createMask } = require("../../plugins/shape-plus/mask-model.js");

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
    get isConnected() { return document.contains(this); }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    getElementsByClassName(names) { return this.querySelectorAll("." + names.split(" ").join(".")); }
    dispatchEvent(event) { return !fire(this, event.type, event, true).defaultPrevented; }
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
      if (selector.startsWith(":scope > ")) return this.children.filter(child => child.matches(selector.slice(9)));
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

  function fire(target, type, props = {}, reuse = false) {
    const values = { type, target, pointerId: 1, button: 0, buttons: 1, isPrimary: true, pointerType: "mouse",
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = this.immediate = true; },
      ...props };
    const event = reuse ? Object.assign(props, values) : values;
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

function fixture(t, { contents, masks, perspective = false, phase3 = false, offset = 0 }) {
  const dom = setupDom(t), { document, window, body, Element, fire } = dom;
  const cm = host(), { PZ, THREE } = cm, { Content } = createModel(PZ);
  const Layer = createLayerClass(PZ, THREE, Content);
  const createLayer = PZ.layer.create;
  PZ.layer.create = type => type === TYPE ? new Layer() : createLayer(type);
  Object.assign(cm, { document, NodeList: class {}, requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame });
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
  function addClip({ contents, masks, start = 10, offset = 0, name = "Clip", load = true }) {
    const track = new PZ.track.video();
    sequence.videoTracks.push(track);
    const clip = new PZ.clip.video(contents ? TYPE : 4);
    Object.assign(clip, { start, length: 160, offset });
    track.clips.push(clip);
    clip.properties.load({ name });
    const layer = clip.object;
    if (contents && load) layer.load({ type: TYPE, contents, properties: { name: "Shape+" }, effects: [] });
    else if (load) {
      layer.properties.load();
      layer.properties.resolution.set([240, 160]);
      setMasks(layer, masks);
    }
    return clip;
  }
  const clip = addClip({ contents, masks, offset }), layer = clip.object;

  const top = Object.assign(Object.create(PZ.ui.edit.prototype), { selection: new PZ.objectList(),
    list: new Element("ul"), selectItems() {} });
  for (const panel of [top, Object.assign(Object.create(PZ.ui.edit.prototype), { objects: top.selection })]) {
    const root = new Element("div");
    panel.el = root;
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
  let timeline, panel, editRow, clipboard;
  if (phase3) {
    const timelineRoot = new Element("div"), timelineContainer = new Element("div"), labels = new Element("div");
    const bar = new Element("div"), barSize = new Element("div"), panelElement = new Element("div");
    timelineRoot.className = "editorpanel";
    timelineRoot.append(panelElement);
    panelElement.append(labels, timelineContainer);
    bar.appendChild(barSize);
    barSize.style.width = "800px";
    timelineContainer.scrollLeft = 0;
    timeline = Object.assign(Object.create(PZ.ui.timeline.prototype), {
      editor, sequence, tracks: { selection: objects }, scrollBar: bar,
      frameToPx: frame => frame * 2, pxToFrame: px => px / 2, keepInView() {},
    });
    panel = Object.assign(Object.create(PZ.ui.timeline.keyframes.prototype), {
      timeline, container: timelineContainer, el: panelElement, labels,
    });
    // Match CM3's constructor so attachment has to rebind captured callbacks.
    panelElement.onkeydown = panel.keydown.bind(panel);
    panel.keyframe_drag = new PZ.ui.drag([], panel.keyframeDragStart, panel.keyframeDrag,
      panel.keyframeDragUpdate, panel.keyframeDragEnd, panel);
    timeline.keyframes = panel;
    timelineRoot.pz_panel = timeline;
    body.append(timelineRoot);
    PZ.ui.edit.prototype.generateListItem = function(container, object) {
      const row = new Element("li");
      row.pz_object = object;
      row.append(new Element("div"), new Element("div"));
      container.append(row);
      return row;
    };
    editRow = object => top.generateListItem(top.el, object);
    clipboard = { text: "", async readText() { return this.text; }, async writeText(value) { this.text = value; } };
    const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const keyboard = globalThis.KeyboardEvent;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
    globalThis.KeyboardEvent = class {
      constructor(type, props) { Object.assign(this, { type, ...props }); }
    };
    dom.cleanups.push(() => {
      if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
      else delete globalThis.navigator;
      globalThis.KeyboardEvent = keyboard;
    });
  }
  const runtime = installPathEditing(context, Layer, Content);
  if (phase3) {
    require("../../plugins/shape-plus/mask-panels.js").installMaskPanels(
      context, Content, runtime.maskOverlay.setMode, runtime.transfer,
    );
    require("../../plugins/shape-plus/workflow.js").install(context, Layer, Content, runtime.transfer);
    require("../../plugins/shape-plus/mask-persist.js").installMaskPersistence(PZ, context.lifecycle.onDispose);
  }
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
    PZ, Content, project, clip, addClip, top, timeline, panel, editRow, clipboard, menu: () => menu,
    switchClip(next) { objects.splice(0, objects.length, ...(next ? [next] : [])); dom.frame(); },
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

module.exports = { fixture, path, mask, group, vertex, zero };
