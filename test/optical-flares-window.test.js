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
    this.definition = { min: undefined, max: undefined, step: 1, items: "" };
    this.onChanged = new Observable();
    this.frameOffset = 0;
  }
  get() { return JSON.parse(JSON.stringify(this.value)); }
  set(value) {
    const old = this.value;
    this.value = JSON.parse(JSON.stringify(value));
    this.onChanged.update(old);
  }
  getAddress() { return ["prop", this.id]; }
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
        foreground: { occlude: register(prop(0, "off;on")) },
        margin: register(prop(0.25)),
        distanceFalloff: register(prop(0)),
        referenceDistance: register(prop(10)),
        flicker: { amount: register(prop(0)), speed: register(prop(2)) },
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

function installCommon(fakes) {
  const { root, editor, history, registry, FakeElement } = fakes;
  const PZ = {};
  PZ.object3d = { optflares: { element: FakeElement } };
  PZ.opticalflares = {
    ELEMENT_TYPES: [{ name: "Glow" }, { name: "Streak" }, { name: "Ring" }],
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
        this.editor.history.pushCommand(() => {}, { property: e.property, old: e.oldValue });
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
    list: (config) => {
      const node = { kind: "list", config, items: config.items, value: config.value };
      log.controls.push(node);
      return {
        element: { kind: "list" },
        setItems(items) { node.items = items; },
        set(id) { node.value = id; },
        get: () => node.value,
      };
    },
    button: (config) => ({ element: { kind: "button" }, config }),
    buttonRow(buttons) {
      log.buttons.push(...buttons);
      log.rows.push(buttons.map((b) => b.title));
      return { element: { kind: "buttonRow" } };
    },
    section(options) {
      return { element: { kind: "section", title: options.title }, body: { children: [], appendChild(c) { this.children.push(c); } } };
    },
    note(message) { return { element: { kind: "note", message } }; },
  };
}

function setup() {
  const fakes = createFakes();
  const { PZ, root, editor, history } = installCommon(fakes);
  const log = { controls: [], buttons: [], rows: [] };
  const ui = {
    controls: installControls(log),
    windows: [],
    openWindow(options) {
      this.windows.push(options);
      return {
        close() { this.closed = true; },
        setSubtitle(text) { this.subtitle = text; },
      };
    },
  };
  const sandbox = { PZ, document: { createElement: () => ({ children: [], textContent: "", appendChild(c) { this.children.push(c); } }) } };
  const saved = { PZ: globalThis.PZ, document: globalThis.document };
  globalThis.document = sandbox.document;
  new Function("PZ", windowSource)(PZ);
  return { PZ, root, editor, history, ui, log, restore() {
    globalThis.PZ = saved.PZ;
    globalThis.document = saved.document;
  } };
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

test("the window opens once, namespaced, persisted and tied to the flare's life", () => {
  const env = setup();
  try {
    const { options, cleanup } = openAndMount(env);
    assert.match(options.id, /^flares:\d+$/);
    assert.equal(options.persistKey, "options");
    assert.equal(options.isValid(), true);
    assert.equal(typeof cleanup, "function");
    cleanup();
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

test("applying a preset replaces the whole stack in one operation", () => {
  const env = setup();
  try {
    openAndMount(env);
    buttonNamed(env, "Add").onClick();
    buttonNamed(env, "Add").onClick();
    const before = env.history.operations;
    buttonNamed(env, "Apply preset").onClick();
    assert.equal(env.root.stack.length, 4, "default preset has four elements in this fixture");
    assert.equal(env.history.operations, before + 1, "one operation for the preset");
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

test("element rows read as position and type, and the action buttons form two rows", () => {
  const env = setup();
  try {
    openAndMount(env);
    buttonNamed(env, "Add").onClick();
    buttonNamed(env, "Duplicate").onClick();
    env.root.stack[1].properties.element.elementType.set(1);
    const list = env.log.controls.find((c) => c.kind === "list" && c.config.emptyText);
    assert.ok(list, "element list");
    assert.deepEqual(list.items.map((item) => item.title), ["1. Glow", "2. Streak"]);
    assert.ok(env.log.rows.some((row) => row.join(",") === "Add,Duplicate,Remove"), "first row");
    assert.ok(env.log.rows.some((row) => row.join(",") === "Move Up,Move Down"), "second row");
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
