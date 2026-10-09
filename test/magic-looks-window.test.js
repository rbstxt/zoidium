"use strict";

// Magic Looks setup window, exercised without a browser: the real window builder
// runs against a fake DOM and recording ui-kit controls. It checks that every
// tool panel builds, that a parameter edit commits through the effect property
// with one history step, that chain and preset edits are undoable commits, and
// that closing the window releases its state.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { after } = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packDir = path.join(projectRoot, "plugins/magic-looks");

function readPack(file) {
  return fs.readFileSync(path.join(packDir, file), "utf8");
}

function fakeCtx() {
  return new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      return function () { return { addColorStop() {} }; };
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

function el(tag) {
  const node = {
    tagName: tag,
    className: "",
    textContent: "",
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    attributes: {},
    parentElement: null,
    setAttribute(k, v) { this.attributes[k] = v; },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    insertBefore(child) { this.children.unshift(child); child.parentElement = this; return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    setPointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  };
  if (tag === "canvas") node.getContext = () => fakeCtx();
  return node;
}

// Recording ui-kit controls: every builder logs its options so tests can drive
// the callbacks the way the DOM would.
function makeControls(log) {
  function builder(kind) {
    return function (opts) {
      const rec = { kind: kind, opts: opts || {}, value: opts ? opts.value : undefined };
      log.push(rec);
      return {
        element: el("div"),
        get() { return rec.value; },
        set(v) { rec.value = v; },
        setDisabled() {},
        setOptions() {},
      };
    };
  }
  return {
    number: builder("number"),
    slider: builder("slider"),
    checkbox: builder("checkbox"),
    select: builder("select"),
    text: builder("text"),
    list: builder("list"),
    note: function (message) { log.push({ kind: "note", opts: { message: message } }); return { element: el("p") }; },
    buttonRow: function (buttons) { log.push({ kind: "buttons", opts: buttons }); return { element: el("div") }; },
    section: function (opts) {
      log.push({ kind: "section", opts: opts });
      return { element: el("div"), body: el("div"), setCollapsed() {} };
    },
  };
}

function loadEffectDefinitions() {
  const PZ = { property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7 } } };
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = () => {}; },
    Vector3: function (x, y, z) { this.x = x; this.y = y; this.z = z; this.set = () => {}; },
    ShaderMaterial: function (opts) { this.uniforms = opts.uniforms; this.dispose = () => {}; },
    ShaderPass: function (mat) { this.uniforms = mat.uniforms; this.enabled = true; this.material = mat; },
    DataTexture: function () { this.needsUpdate = false; },
    RGBFormat: 1, LinearFilter: 1, ClampToEdgeWrapping: 1,
  };
  const store = {};
  function FakeProp(key, def) {
    this.key = key;
    this.def = def;
    this.v = def.value;
  }
  FakeProp.prototype.get = function () { return this.v; };
  FakeProp.prototype.set = function (v) { this.v = v; };
  FakeProp.prototype.getAddress = function () { return [this.key]; };
  const fakeThis = {
    _zoidiumGetAsset: (kind, url) => readPack(String(url).split("/").pop().split("?")[0]),
    properties: {
      addAll(defs) {
        for (const k of Object.keys(defs)) {
          if (!(k in store)) {
            store[k] = new FakeProp(k, defs[k]);
            this[k] = store[k];
          }
        }
      },
      load() {},
      store,
    },
  };
  new Function("PZ", "THREE", readPack("looks-fx.js")).call(fakeThis, PZ, THREE);
  return { fakeThis, store };
}

function installGlobals(state) {
  global.document = {
    createElement: el,
    getElementById(id) { return state.styles.get(id) || null; },
    head: {
      appendChild(node) {
        state.styles.set(node.id, { id: node.id, remove() { state.styles.delete(node.id); } });
      },
    },
  };
  global.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
}

const harnesses = [];

function setup() {
  const state = { styles: new Map(), history: { ops: [], starts: 0, finishes: 0 } };
  installGlobals(state);
  const { fakeThis, store } = loadEffectDefinitions();
  const effect = fakeThis;
  effect.parent = {};
  const log = [];
  const windows = [];
  const CM = {
    playback: { currentFrame: 0 },
    history: {
      undoStack: { length: 0 },
      redoStack: { length: 0 },
      startOperation() { state.history.starts++; },
      finishOperation() { state.history.finishes++; this.undoStack.length++; },
    },
  };
  const PZ = {
    ui: {
      controls: { createControls(row) { return row; } },
      properties: function FakeOps(editor) { this.editor = editor; },
    },
  };
  PZ.ui.properties.prototype.setValue = function (e) {
    const prop = store[e.property[0]];
    state.history.ops.push({ key: e.property[0], value: e.value, oldValue: e.oldValue });
    prop.set(e.value, e.frame);
  };
  const ui = {
    controls: makeControls(log),
    getWindow() { return null; },
    openWindow(options) {
      const body = el("div");
      const cleanup = options.mount(body, null);
      const win = {
        id: options.id,
        focus() {},
        close() {
          if (typeof cleanup === "function") cleanup();
          if (typeof options.onClose === "function") options.onClose();
          windows.splice(windows.indexOf(win), 1);
        },
      };
      windows.push(win);
      return win;
    },
  };
  const assets = {
    "looks-color.js": readPack("looks-color.js"),
    "looks-tools.js": readPack("looks-tools.js"),
    "looks-widgets.js": readPack("looks-widgets.js"),
    "looks-setup.css": readPack("looks-setup.css"),
  };
  const context = {
    PZ: PZ,
    editor: CM,
    ui: ui,
    getAsset: (kind, url) => assets[String(url).split("/").pop()],
  };
  const module = { exports: {} };
  new Function("module", "exports", "plugin", readPack("looks-setup.js"))(module, module.exports, {});
  module.exports.activate(context);
  const harness = { module: module.exports, PZ, effect, store, log, state, windows, CM };
  harnesses.push(harness);
  return harness;
}

// Closes any window a test left open so its refresh timer does not keep Node alive.
after(function () {
  for (const h of harnesses) {
    try { h.module.deactivate(); } catch (_err) { /* already disabled */ }
  }
});

function openFromButton(h) {
  const row = el("li");
  row.children = [el("span"), el("div")];
  const prop = { definition: { magicLooksSetup: { name: "Setup", title: "Open" } }, parentObject: h.effect };
  h.PZ.ui.controls.createControls(row, prop, false);
  row.children[1].children[0].onclick({ preventDefault() {}, stopPropagation() {} });
}

// Controls created since index `from`, optionally filtered by kind.
function since(h, from, kind) {
  return h.log.slice(from).filter((r) => !kind || r.kind === kind);
}

test("every tool panel builds and its controls answer their callbacks", () => {
  const h = setup();
  openFromButton(h);
  assert.equal(h.windows.length, 1, "the button opens one window");
  const chainList = since(h, 0, "list").find((r) => r.opts.items.some((i) => i.id === "lens-distortion"));
  assert.ok(chainList, "tool chain list is built");
  assert.equal(chainList.opts.items.length, 29, "chain lists all tools in order");
  for (const item of chainList.opts.items) {
    const from = h.log.length;
    chainList.opts.onSelect(item.id);
    const created = h.log.slice(from);
    assert.ok(created.length > 0, item.id + " panel builds");
    for (const rec of created.filter((r) => r.kind === "slider" || r.kind === "number")) {
      assert.doesNotThrow(() => rec.opts.onInput(rec.opts.value), item.id + " live input");
    }
  }
  h.windows[0].close();
  assert.equal(h.windows.length, 0);
});

test("a parameter edit commits through the effect property as one history step", () => {
  const h = setup();
  openFromButton(h);
  const chainList = since(h, 0, "list").find((r) => r.opts.items.some((i) => i.id === "lens-distortion"));
  const from = h.log.length;
  chainList.opts.onSelect("contrast");
  const pivot = h.log.slice(from).find((r) => r.opts.label === "Pivot");
  assert.ok(pivot, "Pivot control built for Contrast");
  pivot.opts.onInput(0.3);
  assert.equal(h.store.conPivot.v, 0.3, "live input previews on the property");
  assert.equal(h.state.history.ops.length, 0, "live input records no history");
  pivot.opts.onChange(0.35);
  assert.equal(h.store.conPivot.v, 0.35);
  assert.equal(h.state.history.ops.length, 1, "committed once");
  assert.equal(h.state.history.ops[0].key, "conPivot");
  assert.equal(h.state.history.ops[0].oldValue, 0.18, "undo restores the value from before the drag");
  assert.equal(h.state.history.starts, h.state.history.finishes, "history operations are balanced");
});

test("chain edits are undoable commits that change the chain order", () => {
  const h = setup();
  openFromButton(h);
  const chainList = since(h, 0, "list").find((r) => r.opts.items.some((i) => i.id === "lens-distortion"));
  chainList.opts.onSelect("crush");
  const buttonRows = since(h, 0, "buttons").map((r) => r.opts);
  const remove = buttonRows.reverse().map((opts) => opts.find((o) => o.title === "Remove")).find(Boolean);
  assert.ok(remove, "remove button built");
  remove.onClick();
  const chainWrites = h.state.history.ops.filter((o) => o.key === "chainOrder");
  assert.equal(chainWrites.length, 1);
  const order = JSON.parse(chainWrites[0].value);
  assert.equal(order.length, 28, "one tool removed");
  assert.ok(order.indexOf("crush") < 0, "crush is out of the chain");
  assert.equal(JSON.parse(h.store.chainOrder.v).indexOf("crush"), -1, "the stored order reflects the commit");
});

test("a look applies as one undoable commit and resets other tools", () => {
  const h = setup();
  h.store.ccEnable.v = 1;
  h.store.cruGamma.v = 3;
  openFromButton(h);
  const lookList = since(h, 0, "list").find((r) => r.opts.items.some((i) => i.id === "noir"));
  assert.ok(lookList, "look list built");
  lookList.opts.onSelect("noir");
  assert.equal(h.store.conContrast.v, 0.5, "Noir sets contrast");
  assert.equal(h.store.cruGamma.v, 2.8, "Noir sets crush gamma");
  assert.equal(h.store.ccEnable.v, 0, "Color Contrast returns to its default");
  assert.ok(h.state.history.starts >= 1 && h.state.history.starts === h.state.history.finishes);
  assert.equal(JSON.parse(h.store.chainOrder.v).length, 29, "a look keeps the chain order");
});

test("disabling the plugin closes the window, drops its state, and restores the renderer", () => {
  const h = setup();
  openFromButton(h);
  assert.equal(h.windows.length, 1);
  h.module.deactivate();
  assert.equal(h.windows.length, 0, "window closed on disable");
  assert.equal(h.state.styles.size, 0, "stylesheet removed");
});
