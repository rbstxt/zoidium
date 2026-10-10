"use strict";

// Designer window wiring, evaluated from the real designer.js with a small
// fake DOM. Covers the window options (host chrome, skin, placement), the
// structure of the Davi-style body, undo-recorded presets and palettes,
// transport, the frame counter timer, reopen-focus and cleanup on close.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "plugins/trapcode-suite/designer.js"), "utf8");

function createElement(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    className: "",
    children: [],
    style: {},
    attributes: {},
    title: "",
    type: "",
    onclick: null,
    _text: "",
    appendChild(child) {
      node.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      node.attributes[name] = String(value);
    },
    getAttribute(name) {
      return node.attributes[name];
    },
    get textContent() {
      return node._text;
    },
    set textContent(value) {
      node._text = String(value);
      node.children = [];
    },
    get classList() {
      const names = () => node.className.split(/\s+/).filter(Boolean);
      const write = (list) => {
        node.className = Array.from(new Set(list)).join(" ");
      };
      return {
        add(...items) {
          write([...names(), ...items]);
        },
        remove(...items) {
          write(names().filter((name) => !items.includes(name)));
        },
        toggle(name, force) {
          const has = names().includes(name);
          const want = force === undefined ? !has : Boolean(force);
          if (want) this.add(name);
          else this.remove(name);
          return want;
        },
        contains(name) {
          return names().includes(name);
        },
      };
    },
  };
  return node;
}

function walk(node, visit) {
  visit(node);
  node.children.forEach((child) => walk(child, visit));
}

// Every token of `classNames` (space separated) must be present on the node.
function byClass(root, classNames) {
  const wanted = classNames.split(/\s+/);
  const found = [];
  walk(root, (node) => {
    const have = node.className.split(/\s+/);
    if (wanted.every((name) => have.includes(name))) found.push(node);
  });
  return found;
}

function systemPills(root) {
  return byClass(root, "tc-system").filter((node) => !node.classList.contains("add"));
}

class FakeProperty {
  constructor(value) {
    this.value = value;
  }
  get(frame) {
    return this.value;
  }
  set(value) {
    this.value = value;
  }
  getAddress() {
    return ["fake"];
  }
}

// Builds the PZ surface designer.js touches, plus a designer object shaped like
// the Trapcode objects (a system with three property groups).
function createEnvironment() {
  class Group extends Object {}
  const PZ = {
    property: FakeProperty,
    propertyList: Group,
    object3d: {},
    trapcode: {},
    ops: [],
  };
  PZ.ui = {
    properties: class {
      constructor() {}
      setValue(args) {
        PZ.ops.push(args);
      }
    },
  };
  const T = PZ.trapcode;
  T.palettes = [
    { name: "Fire", stops: [], colors: [[1, 0.5, 0], [1, 0, 0]] },
    { name: "Ice", stops: [], colors: [[0.5, 1, 1], [0, 0.5, 1]] },
  ];
  T.supportsPalette = () => true;
  T.paletteCSS = () => "linear-gradient(90deg,#fff,#000)";
  T.applyPalette = (target) => {
    target.properties.particle.size.set(2);
    return true;
  };

  function makeSystem() {
    const system = { properties: new Group() };
    system.properties.emitter = Object.assign(new Group(), { rate: new FakeProperty(100) });
    system.properties.particle = Object.assign(new Group(), { size: new FakeProperty(6) });
    system.properties.physics = Object.assign(new Group(), { gravity: new FakeProperty(0) });
    return system;
  }

  const applied = [];
  class Particular {}
  Particular.designer = {
    title: "Trapcode Test Designer",
    targets: (root) => root.systems,
    targetName: (system, index) => (index === 0 ? "Primary System" : "System " + (index + 1)),
    addKinds: [{
      name: "Add a System",
      create(root) {
        const system = makeSystem();
        root.systems.push(system);
        return system;
      },
    }],
    blocks: () => [
      { key: "emitter", name: "Emitter" },
      { key: "particle", name: "Particle" },
      { key: "physics", name: "Physics" },
    ],
    groupFor: (target, key) => target.properties[key],
    presets: [{ name: "Default burst", preset: "burst" }, { name: "Fountain", preset: "fountain" }],
    applyPreset(root, target, preset) {
      applied.push(preset.name);
      target.properties.particle.size.set(preset.name === "Fountain" ? 4 : 2);
    },
  };
  const root = new Particular();
  root.systems = [makeSystem()];
  root.parent = {};
  return { PZ, T, root, Particular, applied, makeSystem };
}

// Installs fake globals for one test, then restores the originals.
function withGlobals(fn) {
  const saved = {
    document: globalThis.document,
    CM: globalThis.CM,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const timers = new Map();
  let nextTimer = 1;
  const history = {
    operation: null,
    started: 0,
    finished: 0,
    commands: [],
    startOperation() {
      this.operation = {};
      this.started += 1;
    },
    finishOperation() {
      this.operation = null;
      this.finished += 1;
    },
    pushCommand(fnRef, payload) {
      this.commands.push({ fn: fnRef, payload });
    },
  };
  const playback = { speed: 0, currentFrame: 3, totalFrames: 100 };
  globalThis.document = { createElement, createElementNS: (ns, tag) => createElement(tag) };
  globalThis.CM = { playback, history };
  globalThis.setInterval = (fnRef, ms) => {
    const id = nextTimer++;
    timers.set(id, { fn: fnRef, ms });
    return id;
  };
  globalThis.clearInterval = (id) => timers.delete(id);
  try {
    return fn({ timers, history, playback });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

function loadDesigner(PZ) {
  new Function("PZ", source)(PZ);
  return PZ.trapcode.designer;
}

// A fake host window kit with the methods designer.js calls.
function createUi() {
  const windows = new Map();
  const openCalls = [];
  const views = [];
  return {
    windows,
    openCalls,
    views,
    openWindow(options) {
      openCalls.push(options);
      const win = {
        id: options.id,
        options,
        body: createElement("div"),
        open: true,
        focusCount: 0,
        toggles: 0,
        maximized: false,
        dragHandles: [],
        cleanup: null,
        isOpen() {
          return this.open;
        },
        isMaximized() {
          return this.maximized;
        },
        focus() {
          this.focusCount += 1;
        },
        toggleMaximized() {
          this.toggles += 1;
          this.maximized = !this.maximized;
        },
        makeDragHandle(handle) {
          this.dragHandles.push(handle);
        },
        close() {
          if (!this.open) return;
          this.open = false;
          windows.delete(this.id);
          if (this.cleanup) this.cleanup();
        },
      };
      windows.set(options.id, win);
      win.cleanup = options.mount(win.body, win);
      return win;
    },
    getWindow(id) {
      return windows.get(id) || null;
    },
    properties(options) {
      const view = {
        options,
        element: createElement("div"),
        refreshes: 0,
        disposed: false,
        refresh() {
          this.refreshes += 1;
        },
        dispose() {
          this.disposed = true;
        },
      };
      views.push(view);
      return view;
    },
  };
}

function setup() {
  const env = createEnvironment();
  const designer = loadDesigner(env.PZ);
  const ui = createUi();
  designer.bind(ui);
  return { ...env, designer, ui };
}

test("the skin is a scoped, system-font look without fixed overlays or leftover preview rules", () => {
  const { designer } = setup();
  const css = designer.skinCss;
  assert.ok(css.includes(":scope{"), "window rules are written against :scope");
  assert.ok(css.includes("system-ui"), "system UI stack");
  assert.ok(css.includes("prefers-reduced-motion"), "reduced-motion rule");
  for (const token of ["position:fixed", "inset:", "Inter", "tc-screen", "tc-placeholder", "font-face", "url("]) {
    assert.ok(!css.includes(token), "skin must not contain " + token);
  }
});

test("open asks the host for a custom-chrome, centered, skinned window", () => {
  withGlobals(() => {
    const { designer, root, ui } = setup();
    designer.open(root);
    const options = ui.openCalls[0];
    assert.match(options.id, /^designer:\d+$/);
    assert.equal(options.title, "Trapcode Test Designer");
    assert.equal(options.skin, "designer");
    assert.equal(options.chrome, "custom");
    assert.equal(options.placement, "center");
    assert.equal(options.persistKey, "designer");
    assert.equal(options.width, 1060);
    assert.equal(options.height, 600);
    assert.equal(options.minWidth, 760);
    assert.equal(options.minHeight, 420);
    assert.equal(options.isValid(), true);
    root.parent = null;
    assert.equal(options.isValid(), false, "the window closes when the object is removed");
  });
});

test("the body holds the title bar, presets, blocks, systems and the CM3 parameter view", () => {
  withGlobals(() => {
    const { designer, root, ui } = setup();
    const win = designer.open(root);
    const body = win.body;
    assert.equal(byClass(body, "tc-designer").length, 1);
    const titlebar = byClass(body, "tc-titlebar")[0];
    assert.equal(titlebar.children.length, 5, "PRESETS, title, BLOCKS, maximize, close");
    assert.equal(titlebar.children[0].textContent, "PRESETS");
    assert.equal(titlebar.children[2].textContent, "BLOCKS");
    assert.equal(titlebar.children[1].textContent, "Trapcode Test Designer");
    assert.deepEqual(win.dragHandles, [titlebar], "the title bar drags the window");
    assert.equal(byClass(body, "tc-preset").length, 2);
    assert.equal(byClass(body, "tc-palette").length, 2, "palette rows when the target supports them");
    assert.equal(byClass(body, "tc-palettes-title")[0].textContent, "PALETTE");
    const tiles = byClass(body, "tc-block");
    assert.deepEqual(tiles.map((tile) => tile.children[1].textContent), ["Emitter", "Particle", "Physics"]);
    assert.ok(tiles[0].classList.contains("active"), "the first block starts selected");
    assert.equal(systemPills(body).length, 1);
    assert.equal(systemPills(body)[0].textContent, "Primary System");
    assert.equal(byClass(body, "tc-system add")[0].textContent, "+ Add a System");
    assert.equal(byClass(body, "tc-params").length, 1);
    assert.equal(ui.views.length, 1);
    assert.equal(ui.views[0].options.emptyText, "No parameters.");
    assert.equal(ui.views[0].options.labelWidth, 0.48);
    assert.equal(byClass(body, "tc-params")[0].children[0], ui.views[0].element, "the CM3 rows fill the card");
  });
});

test("the palette list is absent when the target has no colors to set", () => {
  withGlobals(() => {
    const { designer, root, T, ui } = setup();
    T.supportsPalette = () => false;
    const win = designer.open(root);
    assert.equal(byClass(win.body, "tc-palette").length, 0);
    assert.equal(byClass(win.body, "tc-palettes-title").length, 0);
  });
});

test("block tiles switch the parameter view and refresh its rows", () => {
  withGlobals(() => {
    const { designer, root, ui } = setup();
    const win = designer.open(root);
    const view = ui.views[0];
    const system = root.systems[0];
    assert.equal(view.options.target(), system.properties.emitter, "the first block is shown");
    const before = view.refreshes;
    byClass(win.body, "tc-block")[1].onclick();
    assert.equal(view.options.target(), system.properties.particle);
    assert.equal(view.refreshes, before + 1, "the rows re-resolve the new block");
    assert.ok(byClass(win.body, "tc-block")[1].classList.contains("active"));
  });
});

test("a preset is applied as one recorded undo step and the rows are refreshed", () => {
  withGlobals(({ history }) => {
    const { designer, root, ui, applied, PZ } = setup();
    const win = designer.open(root);
    const view = ui.views[0];
    byClass(win.body, "tc-preset")[1].onclick();
    assert.deepEqual(applied, ["Fountain"]);
    assert.equal(PZ.ops.length, 1, "one changed property, one recorded value");
    assert.equal(PZ.ops[0].value, 4);
    assert.equal(PZ.ops[0].oldValue, 6);
    assert.equal(history.started, 1);
    assert.equal(history.finished, 1);
    assert.ok(view.refreshes >= 1);
  });
});

test("a palette is applied as one recorded undo step", () => {
  withGlobals(({ history }) => {
    const { designer, root, PZ } = setup();
    const win = designer.open(root);
    byClass(win.body, "tc-palette")[0].onclick();
    assert.equal(PZ.ops.length, 1);
    assert.equal(PZ.ops[0].value, 2);
    assert.equal(history.started, 1);
  });
});

test("adding a system is undoable and selects the new system", () => {
  withGlobals(({ history }) => {
    const { designer, root, ui } = setup();
    const win = designer.open(root);
    byClass(win.body, "tc-system add")[0].onclick();
    assert.equal(root.systems.length, 2);
    const pills = systemPills(win.body);
    assert.equal(pills.length, 2);
    assert.equal(pills[1].textContent, "System 2");
    assert.ok(pills[1].classList.contains("active"));
    assert.equal(history.commands.length, 1, "the insert is recorded for undo");
    assert.equal(history.commands[0].payload.item, root.systems[1]);
  });
});

test("transport moves the frame and pauses playback", () => {
  withGlobals(({ playback }) => {
    const { designer, root } = setup();
    const win = designer.open(root);
    const transport = byClass(win.body, "tc-transport")[0];
    transport.children[1].onclick();
    assert.equal(playback.speed, 1, "play");
    transport.children[2].onclick();
    assert.equal(playback.speed, 0, "pause");
    transport.children[3].onclick();
    assert.equal(playback.currentFrame, 4, "next frame");
    transport.children[0].onclick();
    transport.children[0].onclick();
    assert.equal(playback.currentFrame, 2, "previous frame");
  });
});

test("the frame counter follows the frame on the sync timer, which is not faster than 250 ms", () => {
  withGlobals(({ timers, playback }) => {
    const { designer, root } = setup();
    const win = designer.open(root);
    const time = byClass(win.body, "tc-transport")[0].children[4];
    assert.equal(time.textContent, "0003");
    assert.equal(timers.size, 1);
    const [timer] = timers.values();
    assert.ok(timer.ms >= 250, "timer interval");
    playback.currentFrame = 42;
    timer.fn();
    assert.equal(time.textContent, "0042");
  });
});

test("the PRESETS, BLOCKS, maximize and close controls drive the window", () => {
  withGlobals(({ timers }) => {
    const { designer, root, ui } = setup();
    const win = designer.open(root);
    const titlebar = byClass(win.body, "tc-titlebar")[0];
    const presets = byClass(win.body, "tc-presets")[0];
    const params = byClass(win.body, "tc-params")[0];
    titlebar.children[0].onclick();
    assert.ok(presets.classList.contains("hidden"), "PRESETS hides the presets column");
    titlebar.children[0].onclick();
    assert.ok(!presets.classList.contains("hidden"));
    titlebar.children[2].onclick();
    assert.ok(params.classList.contains("hidden"), "BLOCKS hides the parameter card");
    titlebar.children[3].onclick();
    assert.equal(win.toggles, 1, "maximize toggles the host window");
    assert.equal(titlebar.children[3].title, "Restore", "the label follows the state");
    win.maximized = false;
    const time = byClass(win.body, "tc-transport")[0].children[4];
    const [timer] = timers.values();
    timer.fn();
    assert.equal(titlebar.children[3].title, "Maximize", "the sync tick picks up a double-click restore");
    assert.equal(time.textContent, "0003");
    titlebar.children[4].onclick();
    assert.equal(win.open, false, "close closes the window");
    assert.equal(timers.size, 0, "the sync timer is cleared on close");
    assert.equal(ui.views[0].disposed, true, "the CM3 view is disposed on close");
  });
});

test("reopening an open designer focuses it instead of opening a second window", () => {
  withGlobals(() => {
    const { designer, root, ui } = setup();
    const first = designer.open(root);
    const again = designer.open(root);
    assert.equal(again, first);
    assert.equal(ui.openCalls.length, 1);
    assert.equal(first.focusCount, 1);
  });
});

test("after the binding is released no window opens", () => {
  withGlobals(() => {
    const { designer, root, ui } = setup();
    const unbind = designer.bind(ui);
    unbind();
    assert.equal(designer.open(root), null);
    assert.equal(ui.openCalls.length, 0);
  });
});

test("curve and gradient picker controls are constrained to the parameter card", () => {
  const { designer } = setup();
  const css = designer.skinCss;
  // CM3's pickers carry a fixed 245px inline width that overflows the card;
  // the designer skin caps them at the card width with dark input colors.
  assert.ok(css.includes(".tc-params .editbox"), "editbox scope rule");
  assert.ok(css.includes("max-width:100%"), "width cap");
  assert.ok(css.includes("width:100%!important"), "inline-width override");
  assert.ok(css.includes("background:#202020"), "dark input color");
  // Scoped to the designer window only: no bare global control selectors.
  for (const line of css.split("\n")) {
    assert.ok(!line.startsWith(".editbox"), "no unscoped control rule: " + line.slice(0, 60));
  }
});
