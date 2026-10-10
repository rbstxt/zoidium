"use strict";

// Behaviour of the Optical Flares options window with fake controls, a fake
// CM3 history and a fake flare root. Checks that every stack edit and property
// commit goes through one history operation, and that drags only preview.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const windowSource = fs.readFileSync(
  path.join(__dirname, "..", "plugins", "optical-flares", "optflares-window.js"),
  "utf8"
);

class Observable {
  constructor() { this.watchers = []; }
  watch(fn) { this.watchers.push(fn); }
  unwatch(fn) {
    const i = this.watchers.indexOf(fn);
    if (i >= 0) this.watchers.splice(i, 1);
  }
  update(...args) { for (const fn of this.watchers.slice()) fn(...args); }
}

class Prop {
  constructor(value, id) {
    this.id = id;
    this.value = value;
    this.initial = JSON.parse(JSON.stringify(value));
    this.definition = { min: undefined, max: undefined, step: 1, items: "" };
    this.onChanged = new Observable();
    // CM3 fires onKeyframeChanged (not onChanged) after a dynamic value edit.
    this.onKeyframeChanged = new Observable();
    this.onAnimatedChanged = new Observable();
    this.frameOffset = 0;
  }
  get() { return JSON.parse(JSON.stringify(this.value)); }
  set(value) {
    const old = this.value;
    this.value = JSON.parse(JSON.stringify(value));
    this.onChanged.update(old);
  }
  reset() { this.set(this.initial); }
  getAddress() { return ["prop", this.id]; }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Minimal fake DOM: enough for the window's rows, tiles and tabs.
function makeEl(tag) {
  const classes = new Set();
  const node = {
    tag,
    children: [],
    title: "",
    type: "",
    draggable: false,
    width: 0,
    height: 0,
    hidden: false,
    style: {},
    dataset: {},
    classList: {
      add(c) { classes.add(c); },
      remove(c) { classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        } else if (force) classes.add(c);
        else classes.delete(c);
      },
      contains(c) { return classes.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
  };
  Object.defineProperty(node, "className", {
    get() { return Array.from(classes).join(" "); },
    set(v) {
      classes.clear();
      String(v || "").split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
  });
  Object.defineProperty(node, "textContent", {
    get() { return this._text || ""; },
    set(v) {
      this._text = String(v);
      if (v === "") this.children = [];
    },
  });
  if (tag === "canvas") node.getContext = () => null;
  return node;
}

function createFakes() {
  let propId = 0;
  const prop = (value, items) => {
    const p = new Prop(value, (propId += 1));
    if (items) p.definition.items = items;
    return p;
  };
  const registry = new Map();
  const register = (p) => {
    registry.set(p.id, p);
    return p;
  };

  class FakeElement {
    constructor() {
      this.properties = {
        name: register(prop("Glow")),
        element: {
          elementType: register(prop(0)),
          enabled: register(prop(1)),
          distance: register(prop(5)),
          rotation: register(prop(0)),
          opacity: register(prop(100)),
          animate: register(prop(1)),
          solo: register(prop(0)),
        },
        globalParams: {
          scale: register(prop(100)),
          scaleOffset: register(prop(0)),
          aspectRatio: register(prop(1)),
          blendMode: register(prop(0)),
          color: register(prop([1, 1, 1])),
          globalSeed: register(prop(5000)),
        },
        matteBox: {
          shape: register(prop(0)),
          startRange: register(prop(25)),
          fadeAmount: register(prop(25)),
        },
        lensTexture: {
          textureImage: register(prop(0)),
          illuminationRadius: register(prop(100)),
          falloff: register(prop(0.5)),
        },
      };
    }
    get type() { return this.properties.element.elementType.get(); }
    load(data) {
      if (!data) return;
      const src = data.properties;
      const walk = (target, values) => {
        for (const key of Object.keys(target)) {
          if (target[key] instanceof Prop) {
            if (values && values[key] !== undefined) target[key].value = values[key];
          } else if (target[key] && typeof target[key] === "object") {
            walk(target[key], values && values[key]);
          }
        }
      };
      walk(this.properties, src);
    }
    toJSON() {
      const values = (target) => {
        const out = {};
        for (const key of Object.keys(target)) {
          out[key] = target[key] instanceof Prop ? target[key].get() : values(target[key]);
        }
        return out;
      };
      return { type: this.type, properties: values(this.properties) };
    }
    static create(type) {
      const element = new FakeElement();
      element.properties.element.elementType.value = type;
      return element;
    }
  }

  // Roots and their stacks.
  const root = {
    properties: {
      name: prop("Optical Flares"),
      flareSetup: {
        brightness: register(prop(100)),
        scale: register(prop(100)),
        scaleOffset: register(prop(0)),
        color: register(prop([1, 1, 1])),
        colorMode: register(prop(0, "Tint;RGB;Alpha")),
        rotationOffset: register(prop(0)),
        animationEvolution: register(prop(0)),
        gpu: register(prop(1, "off;on")),
        centerPosition: register(prop([0, 0])),
      },
      positioning: {
        sourceType: register(prop(1, "Screen (2D);Object 3D;Light")),
        lightIndex: register(prop(0)),
        foreground: { occlude: register(prop(0, "off;on")), fade: register(prop(100)) },
        margin: register(prop(0.25)),
        distanceFalloff: register(prop(0)),
        referenceDistance: register(prop(10)),
        flicker: { amount: register(prop(0)), speed: register(prop(2)) },
        customLayers: { layer1: register(prop(null)), layer2: register(prop(null)), layer3: register(prop(null)) },
      },
      motionBlur: { renderMode: register(prop(0, "On Black;Transparent")) },
      global: {
        scale: register(prop(100)),
        scaleOffset: register(prop(0)),
        aspectRatio: register(prop(1)),
        blendMode: register(prop(0)),
        color: register(prop([1, 1, 1])),
        globalSeed: register(prop(5000)),
      },
    },
    stack: [],
    isLive() { return true; },
  };
  root.stack.onListChanged = new Observable();
  root.stack.getAddress = () => ["stack"];
  root.stack.type = FakeElement;

  const history = {
    operations: 0,
    open: 0,
    commands: [],
    startOperation() { this.open += 1; this.operations += 1; },
    finishOperation() { this.open -= 1; },
    pushCommand(fn, params) { this.commands.push({ fn, params }); },
  };
  const editor = {
    history,
    playback: { currentFrame: 0 },
    project: {
      addressLookup(address) {
        return address[0] === "stack" ? root.stack : null;
      },
    },
  };

  return { root, editor, history, register, registry, FakeElement };
}

function resetTree(node) {
  if (node instanceof Prop) {
    node.reset();
    return;
  }
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      if (key === "onListChanged") continue;
      resetTree(node[key]);
    }
  }
}

function installCommon(fakes) {
  const { root, editor, history, registry, FakeElement } = fakes;
  const PZ = {};
  PZ.object3d = { optflares: { element: FakeElement } };
  PZ.opticalflares = {
    ELEMENT_TYPES: [
      { key: "glow", name: "Glow", color: [1, 1, 1] },
      { key: "streak", name: "Streak", color: [1, 1, 1] },
      { key: "ring", name: "Ring", color: [1, 1, 1] },
    ],
    PRESETS: [{ key: "default", name: "Default" }, { key: "two", name: "Two" }],
    presetData(key) {
      const types = key === "two" ? [1, 2] : [0, 1, 2, 0];
      return types.map((type) => FakeElement.create(type).toJSON());
    },
  };
  // Mirrors CM3's object list commands: each records its own undo command.
  const commands = {
    createObject(e) {
      const list = this.editor.project.addressLookup(e.newParentAddress);
      const item = e.baseType.create(e.subType);
      item.load(e.data);
      list.splice(e.newIdx, 0, item);
      list.onListChanged.update();
      this.editor.history.pushCommand(() => {}, { oldIdx: e.newIdx });
    },
    deleteObject(e) {
      const list = this.editor.project.addressLookup(e.oldParentAddress);
      list.splice(e.oldIdx, 1);
      list.onListChanged.update();
      this.editor.history.pushCommand(() => {}, { idx: e.oldIdx });
    },
    moveObject(e) {
      const list = this.editor.project.addressLookup(e.oldParentAddress);
      const [item] = list.splice(e.oldIdx, 1);
      list.splice(e.newIdx, 0, item);
      list.onListChanged.update();
      this.editor.history.pushCommand(() => {}, { from: e.oldIdx, to: e.newIdx });
    },
  };
  PZ.ui = {
    edit: { prototype: commands },
    properties: class {
      constructor(ed) { this.editor = ed; }
      setValue(e) {
        const target = registry.get(e.property[1]);
        if (e.value !== undefined) target.set(e.value);
        // Like CM3, a committed edit notifies keyframe listeners.
        target.onKeyframeChanged.update();
        this.editor.history.pushCommand(() => {}, { property: e.property, old: e.oldValue });
      }
      resetAll(list) {
        resetTree(list);
        this.editor.history.pushCommand(() => {}, { reset: true });
      }
    },
  };
  // Commands run with `this` bound to an object carrying the editor.
  for (const key of ["createObject", "deleteObject", "moveObject"]) {
    const original = commands[key];
    commands[key] = function (e) {
      return original.call({ editor }, e);
    };
  }
  return { PZ, root, editor, history };
}

function installControls(log) {
  const make = (kind) => (config) => {
    const node = { kind, config, value: config.value };
    log.controls.push(node);
    return {
      element: { label: config.label, kind },
      get: () => node.value,
      set: (v) => { node.value = v; },
      setItems(items) { node.items = items; },
      setOptions() {},
    };
  };
  return {
    number: make("number"),
    slider: make("slider"),
    checkbox: make("checkbox"),
    select: make("select"),
    color: make("color"),
    text: make("text"),
    tabs(config) {
      const specs = (config && config.tabs) || [];
      log.tabSpecs.push(...specs.map((s) => s.id));
      const api = {
        element: { kind: "tabs" },
        show(id) {
          const spec = specs.find((s) => s.id === id);
          if (!spec) return;
          const panel = makeEl("div");
          log.panels[id] = panel;
          log.tabs.push(id);
          spec.render(panel);
          if (config.onChange) config.onChange(id);
        },
      };
      log.tabApi = api;
      const first = (config && config.value) || (specs[0] && specs[0].id);
      if (first) api.show(first);
      return api;
    },
    button: (config) => ({ element: { kind: "button" }, config }),
    buttonRow(buttons) {
      log.buttons.push(...buttons);
      log.rows.push(buttons.map((b) => b.title));
      return { element: { kind: "buttonRow" } };
    },
    section(options) {
      const element = makeEl("div");
      element.className = "zoidium-section";
      return { element, body: element, title: options.title };
    },
    note(message) { return { element: { kind: "note", message } }; },
  };
}

function setup() {
  const fakes = createFakes();
  const { PZ, root, editor, history } = installCommon(fakes);
  const log = { controls: [], buttons: [], rows: [], tabs: [], tabSpecs: [], panels: {} };
  const skins = [];
  const views = [];
  const ui = {
    controls: installControls(log),
    windows: [],
    registerSkin(name, css) { skins.push({ name, css }); },
    properties(options) {
      const view = { element: { kind: "properties" }, options, disposed: false, dispose() { this.disposed = true; } };
      views.push(view);
      return view;
    },
    openWindow(options) {
      this.windows.push(options);
      return {
        close() { this.closed = true; },
        setSubtitle(text) { this.subtitle = text; },
      };
    },
  };
  // Fresh UI-state storage per setup, like a clean browser profile.
  const storage = new Map();
  const sandbox = {
    PZ,
    document: { createElement: (tag) => makeEl(tag) },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    },
  };
  const saved = { PZ: globalThis.PZ, document: globalThis.document, localStorage: globalThis.localStorage };
  globalThis.document = sandbox.document;
  globalThis.localStorage = sandbox.localStorage;
  new Function("PZ", windowSource)(PZ);
  return {
    PZ, root, editor, history, ui, log, skins, views, storage,
    restore() {
      globalThis.PZ = saved.PZ;
      globalThis.document = saved.document;
      globalThis.localStorage = saved.localStorage;
    },
  };
}

function openAndMount(env) {
  const win = PZ_open(env);
  const options = env.ui.windows[0];
  const body = { children: [], appendChild(c) { this.children.push(c); } };
  const cleanup = options.mount(body, win);
  return { options, cleanup, body, win };
}

function PZ_open(env) {
  return env.PZ.opticalflares.openWindow(env.ui, env.editor, env.root);
}

function findControl(env, label) {
  const node = env.log.controls.find((c) => c.config.label === label);
  assert.ok(node, "control " + label);
  return node;
}

function buttonNamed(env, title) {
  const button = env.log.buttons.find((b) => b.title === title);
  assert.ok(button, "button " + title);
  return button;
}

function tilesIn(panel) {
  const tiles = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.classList && node.classList.contains("of-tile")) tiles.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(panel);
  return tiles;
}

function tileName(tile) {
  let name = "";
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.classList && node.classList.contains("of-tile-name")) name = node._text;
    for (const child of node.children || []) visit(child);
  };
  visit(tile);
  return name;
}

const clickEvent = { stopPropagation() {}, preventDefault() {} };

test("the window opens once, namespaced, persisted, skinned and tied to the flare's life", () => {
  const env = setup();
  try {
    const { options, cleanup } = openAndMount(env);
    assert.match(options.id, /^flares:\d+$/);
    assert.equal(options.persistKey, "options");
    assert.equal(options.skin, "flares");
    assert.equal(options.isValid(), true);
    assert.equal(env.skins.length, 1, "skin registered");
    assert.ok(env.skins[0].css.includes("var(--zui-"), "skin uses theme tokens");
    assert.ok(!env.skins[0].css.includes("position:fixed"), "no overlay positioning");
    assert.equal(typeof cleanup, "function");
    cleanup();
    assert.ok(env.views.length > 0 && env.views.every((v) => v.disposed), "custom view disposed");
  } finally {
    env.restore();
  }
});

test("add, duplicate, move, and remove each commit as one undo step", () => {
  const env = setup();
  try {
    openAndMount(env);
    const stack = env.root.stack;
    const before = env.history.operations;

    buttonNamed(env, "Add").onClick();
    assert.equal(stack.length, 1, "add inserts an element");
    assert.equal(env.history.operations, before + 1, "one operation for add");

    buttonNamed(env, "Duplicate").onClick();
    assert.equal(stack.length, 2);
    assert.equal(stack[1].type, stack[0].type, "duplicate copies the type");
    assert.equal(env.history.operations, before + 2);

    stack[1].properties.element.elementType.set(2);
    buttonNamed(env, "Move Up").onClick();
    assert.equal(stack[0].type, 2, "move up moves the selected element to the front");

    buttonNamed(env, "Remove").onClick();
    assert.equal(stack.length, 1, "remove deletes the selected element");
    assert.equal(env.history.open, 0, "no operation left open");
  } finally {
    env.restore();
  }
});

test("the browser has Flare, Elements and Presets tabs", () => {
  const env = setup();
  try {
    openAndMount(env);
    assert.deepEqual(env.log.tabSpecs, ["flare", "elements", "presets"]);
    assert.ok(env.log.panels.flare, "flare tab renders on open");
  } finally {
    env.restore();
  }
});

test("the Flare tab applies a whole stack and Reset All restores defaults in one step", () => {
  const env = setup();
  try {
    openAndMount(env);
    const panel = env.log.panels.flare;
    const tiles = tilesIn(panel);
    assert.equal(tiles.length, 2, "canonical stacks as tiles in this fixture");
    tiles[1].onclick();
    assert.equal(env.root.stack.length, 2, "applying a tile replaces the stack");

    env.root.properties.flareSetup.brightness.set(40);
    env.root.properties.positioning.margin.set(1);
    const before = env.history.operations;
    buttonNamed(env, "Reset All").onClick();
    assert.equal(env.history.operations, before + 1, "one operation for reset all");
    assert.equal(env.root.stack.length, 4, "default stack restored");
    assert.equal(env.root.properties.flareSetup.brightness.get(), 100, "flare settings restored");
    assert.equal(env.root.properties.positioning.margin.get(), 0.25, "source settings restored");
    assert.equal(env.history.open, 0, "no operation left open");
  } finally {
    env.restore();
  }
});

test("per-section resets restore one group in one undo step", () => {
  const env = setup();
  try {
    openAndMount(env);
    env.root.properties.positioning.margin.set(1);
    env.root.properties.positioning.foreground.fade.set(30);
    let before = env.history.operations;
    buttonNamed(env, "Reset Source").onClick();
    assert.equal(env.history.operations, before + 1, "one operation for the reset");
    assert.equal(env.root.properties.positioning.margin.get(), 0.25);
    assert.equal(env.root.properties.positioning.foreground.fade.get(), 100);
    assert.equal(env.history.open, 0, "no operation left open");

    buttonNamed(env, "Add").onClick();
    const element = env.root.stack[0];
    element.properties.globalParams.scale.set(150);
    before = env.history.operations;
    buttonNamed(env, "Reset Element").onClick();
    assert.equal(env.history.operations, before + 1, "one operation for the element reset");
    assert.equal(element.properties.globalParams.scale.get(), 100);
  } finally {
    env.restore();
  }
});

test("a drag previews through set() and commits one undo record with the original value", () => {
  const env = setup();
  try {
    openAndMount(env);
    const brightness = findControl(env, "Brightness");
    const prop = env.root.properties.flareSetup.brightness;
    const before = env.history.commands.length;

    brightness.config.onInput(60);
    brightness.config.onInput(75);
    assert.equal(prop.get(), 75, "live value follows the drag");
    assert.equal(env.history.commands.length, before, "dragging writes no undo record");

    brightness.config.onChange(80);
    assert.equal(prop.get(), 80);
    const added = env.history.commands.slice(before);
    assert.equal(added.length, 1, "one undo record on commit");
    assert.equal(added[0].params.old, 100, "undo restores the value before the drag");
  } finally {
    env.restore();
  }
});

test("editing the selected element's properties goes through its own property", () => {
  const env = setup();
  try {
    openAndMount(env);
    buttonNamed(env, "Add").onClick();
    const element = env.root.stack[0];
    const size = findControl(env, "Size");
    size.config.onChange(150);
    assert.equal(element.properties.globalParams.scale.get(), 150);
    assert.equal(env.root.stack[0].type, 0, "type unchanged");
  } finally {
    env.restore();
  }
});

test("stack rows carry thumbnails, inline scrubbers and one-step hide, solo and reorder", () => {
  const env = setup();
  try {
    const { body } = openAndMount(env);
    buttonNamed(env, "Add").onClick();
    buttonNamed(env, "Add").onClick();
    const found = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.classList && node.classList.contains("of-row")) found.push(node);
      for (const child of node.children || []) visit(child);
    };
    for (const child of body.children) visit(child);
    assert.equal(found.length, 2, "one row per element");

    const first = found[0];
    const canvas = first.children.find((c) => c.tag === "canvas");
    assert.ok(canvas, "thumbnail canvas in the row");
    const scale = env.log.controls.filter((c) => c.config.label === "Scale");
    assert.ok(scale.length >= 1, "inline scale scrubber");

    // Thumbnail click hides in one undo step.
    const element = env.root.stack[0];
    const before = env.history.operations;
    canvas.onclick(clickEvent);
    assert.equal(element.properties.element.enabled.get(), 0, "thumbnail click hides");
    assert.equal(env.history.operations, before + 1, "one operation for hide");

    // Solo button solos in one undo step.
    const soloButton = first.children
      .find((c) => c.classList && c.classList.contains("of-row-body"))
      .children[0].children[1].children[1];
    const beforeSolo = env.history.operations;
    soloButton.onclick(clickEvent);
    assert.equal(element.properties.element.solo.get(), 1, "solo on");
    assert.equal(env.history.operations, beforeSolo + 1, "one operation for solo");

    // Drag reorder moves in one undo step.
    const second = found[1];
    const beforeMove = env.history.operations;
    second.ondrop({
      preventDefault() {},
      dataTransfer: { getData: () => "0" },
    });
    assert.equal(env.history.operations, beforeMove + 1, "one operation for drag reorder");
    assert.equal(env.history.open, 0, "no operation left open");
  } finally {
    env.restore();
  }
});

test("row toggles refresh the row from the commit notification", () => {
  const env = setup();
  try {
    const { body } = openAndMount(env);
    buttonNamed(env, "Add").onClick();
    const found = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.classList && node.classList.contains("of-row")) found.push(node);
      for (const child of node.children || []) visit(child);
    };
    for (const child of body.children) visit(child);
    const first = found[0];
    const soloButton = first.children
      .find((c) => c.classList && c.classList.contains("of-row-body"))
      .children[0].children[1].children[1];
    soloButton.onclick(clickEvent);
    assert.equal(env.root.stack[0].properties.element.solo.get(), 1, "value committed");
    assert.ok(soloButton.classList.contains("on"), "solo button lights up from the notification");
    const name = first.children
      .find((c) => c.classList && c.classList.contains("of-row-body"))
      .children[0].children[0];
    soloButton.onclick(clickEvent);
    assert.ok(!soloButton.classList.contains("on"), "second toggle clears it");
    void name;
  } finally {
    env.restore();
  }
});

test("the Elements tab adds types and custom layers", () => {
  const env = setup();
  try {
    openAndMount(env);
    env.log.tabApi.show("elements");
    const panel = env.log.panels.elements;
    let tiles = tilesIn(panel);
    assert.equal(tiles.length, 3, "element types in this fixture");
    const before = env.history.operations;
    tiles[2].onclick();
    assert.equal(env.root.stack.length, 1, "type tile adds an element");
    assert.equal(env.root.stack[0].type, 2, "added type matches the tile");
    assert.equal(env.history.operations, before + 1, "one operation for the add");

    // Custom sub-tab: empty layers do nothing, assigned layers add.
    const sub = panel.children[0];
    const customButton = sub.children.find((c) => c._text === "Custom");
    customButton.onclick(clickEvent);
    tiles = tilesIn(env.log.panels.elements);
    assert.equal(tiles.length, 3, "three custom layer tiles");
    tiles[0].onclick();
    assert.equal(env.root.stack.length, 1, "empty layer adds nothing");
    env.root.properties.positioning.customLayers.layer1.set("asset-1");
    tiles = tilesIn(env.log.panels.elements);
    tiles[0].onclick();
    assert.equal(env.root.stack.length, 2, "assigned layer adds an element");
    assert.equal(env.root.stack[1].properties.lensTexture.textureImage.get(), 7, "custom texture wired");
  } finally {
    env.restore();
  }
});

test("the Presets tab applies tint variants and remembers favorites", () => {
  const env = setup();
  try {
    openAndMount(env);
    env.log.tabApi.show("presets");
    let panel = env.log.panels.presets;
    let tiles = tilesIn(panel);
    assert.equal(tiles.length, 8, "eight cinematic variants");
    tiles[0].onclick();
    assert.equal(env.root.stack.length, 4, "variant replaces the stack");

    // Favorite the first preset, then filter to favorites only.
    const first = tiles[0];
    const favButton = first.children[first.children.length - 1].children[1];
    assert.equal(favButton._text, "Fav");
    favButton.onclick(clickEvent);
    panel = env.log.panels.presets;
    tiles = tilesIn(panel);
    assert.ok(tileName(tiles[0]).startsWith("* "), "favorited tile marked");
    assert.ok(env.storage.size > 0, "favorites stored as UI state");

    const favOnly = env.log.controls.filter((c) => c.config.label === "Favorites only").pop();
    favOnly.config.onChange(true);
    panel = env.log.panels.presets;
    assert.equal(tilesIn(panel).length, 1, "only favorites shown");

    // Rainbow variants tint the stack.
    const category = env.log.controls.filter((c) => c.config.label === "Presets").pop();
    favOnly.config.onChange(false);
    category.config.onChange("Rainbow");
    panel = env.log.panels.presets;
    tiles = tilesIn(panel);
    assert.equal(tiles.length, 8, "eight rainbow variants");
    const before = env.history.operations;
    tiles[0].onclick();
    assert.equal(env.history.operations, before + 1, "one operation for the variant");
    const colors = env.root.stack.map((e) => e.properties.globalParams.color.get());
    assert.deepEqual(colors[0], [1, 0.35, 0.5], "rainbow tint applied");
  } finally {
    env.restore();
  }
});

test("the window title is the product name and the flare's name is the subtitle", () => {
  const env = setup();
  try {
    const { options, win } = openAndMount(env);
    assert.equal(options.title, "Optical Flares");
    assert.equal(options.subtitle, "", "the default name is not repeated");
    env.root.properties.name.set("Anamorphic Blue");
    assert.equal(win.subtitle, "Anamorphic Blue", "a renamed flare updates the subtitle");
    env.root.properties.name.set("Optical Flares");
    assert.equal(win.subtitle, "", "back to the default name clears it");
  } finally {
    env.restore();
  }
});

test("thumbnails are deterministic per type and survive a missing context", () => {
  const env = setup();
  try {
    openAndMount(env);
    const draw = env.PZ.opticalflares.drawThumb;
    assert.equal(typeof draw, "function");
    const calls = [];
    const fakeCtx = new Proxy({}, {
      get(target, key) {
        if (key === "canvas") return null;
        return (...args) => {
          calls.push([key, ...args.map((a) => (typeof a === "number" ? Number(a.toFixed(4)) : String(a)))]);
          if (key === "createRadialGradient" || key === "createLinearGradient") {
            return {
              addColorStop(offset, color) {
                calls.push(["addColorStop", Number(Number(offset).toFixed(4)), String(color)]);
              },
            };
          }
          return undefined;
        };
      },
      set(target, key, value) {
        calls.push(["set", String(key), typeof value === "number" ? Number(value.toFixed(4)) : String(value)]);
        return true;
      },
    });
    const run = (type, tint) => {
      calls.length = 0;
      draw({ width: 72, height: 44, getContext: () => fakeCtx }, type, tint);
      return JSON.stringify(calls);
    };
    assert.equal(run(0), run(0), "same type draws identically");
    assert.notEqual(run(0), run(1), "types draw differently");
    assert.notEqual(run(0, [1, 0, 0]), run(0, [0, 0, 1]), "tint changes the drawing");
    assert.doesNotThrow(() => draw({ width: 72, height: 44 }, 0), "no context is left blank");
    assert.doesNotThrow(() => draw(null, 0), "no canvas is ignored");
  } finally {
    env.restore();
  }
});
