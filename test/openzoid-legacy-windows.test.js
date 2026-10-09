"use strict";

// Coverage for the ASCII and Tracery setup windows (effect-windows.js): action
// routing through the property-button dispatcher, control generation from the
// effect property definitions, undoable edits (one history step per edit,
// one per preset), live preview during drags, external sync, and teardown.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");
const windowsPath = path.join(legacyDir, "effect-windows.js");

const PZ_TYPES = { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 };

// Evaluates an effect source the way the runtime does and returns its
// property definitions (no DOM or WebGL is needed for definitions).
function effectDefinitions(file) {
  const source = fs.readFileSync(path.join(legacyDir, "effects", file), "utf8");
  const PZ = { property: { type: PZ_TYPES }, tween: {} };
  const THREE = { Pass: function () {}, WebGLRenderTarget: function () {}, ShaderMaterial: function () {} };
  THREE.Pass.prototype = {};
  const fakeThis = { properties: { addAll() {}, load() {} } };
  new Function("PZ", "THREE", source).call(fakeThis, PZ, THREE);
  return fakeThis.propertyDefinitions;
}

function defaultOf(def) {
  if (def.group) return def.objects.map((o) => o.value);
  return def.value;
}

function makeEffect(defs) {
  const properties = {};
  for (const key of Object.keys(defs)) {
    let value = defaultOf(defs[key]);
    properties[key] = {
      getAddress: () => "EFFECT/" + key,
      frameOffset: 0,
      get() { return JSON.parse(JSON.stringify(value)); },
      set(next) { value = JSON.parse(JSON.stringify(next)); },
    };
  }
  return { parent: {}, propertyDefinitions: defs, properties };
}

function makeHarness(defs, effect) {
  const made = [];
  const windows = [];
  const history = {
    ops: [],
    startOperation() { this.ops.push("start"); },
    finishOperation() { this.ops.push("finish"); },
  };
  const editor = { playback: { currentFrame: 7 }, history };
  const edits = [];
  const byAddress = {};
  for (const key of Object.keys(effect.properties)) byAddress["EFFECT/" + key] = effect.properties[key];

  const make = (kind) => (opts) => {
    const record = { kind, opts, sets: [], element: { children: [] } };
    made.push(record);
    return {
      element: record.element,
      get() { return undefined; },
      set(value) { record.sets.push(value); },
      setDisabled() {},
    };
  };
  const controls = {
    slider: make("slider"),
    checkbox: make("checkbox"),
    select: make("select"),
    color: make("color"),
    text: make("text"),
    button: make("button"),
    list(opts) {
      const record = { kind: "list", opts, sets: [] };
      made.push(record);
      return { element: { children: [] }, get() { return undefined; }, set() {}, setItems() {} };
    },
    buttonRow(specs) {
      const record = { kind: "buttonRow", specs };
      made.push(record);
      return { element: { children: [] } };
    },
    section(opts) {
      const record = { kind: "section", opts };
      made.push(record);
      const element = { children: [], appendChild(c) { this.children.push(c); return c; } };
      const body = { children: [], appendChild(c) { this.children.push(c); return c; } };
      return { element, body, setCollapsed() {} };
    },
    tabs(opts) {
      const record = { kind: "tabs", opts };
      made.push(record);
      return { element: { children: [] } };
    },
  };
  const PropertyOps = function (ed) { this.editor = ed; };
  PropertyOps.prototype.setValue = function (args) {
    edits.push(args);
    const prop = byAddress[args.property];
    if (args.value !== undefined) prop.set(args.value, args.frame);
  };
  const PZ = {
    property: { type: PZ_TYPES },
    ui: { controls, properties: PropertyOps },
  };
  const ui = {
    controls,
    openWindow(options) {
      const win = { options, closed: false, close() { this.closed = true; } };
      windows.push(win);
      return win;
    },
  };
  return {
    PZ,
    context: { PZ, editor, ui },
    made,
    windows,
    edits,
    history,
  };
}

function loadWindows() {
  delete require.cache[require.resolve(windowsPath)];
  return require(windowsPath);
}

// Mounted windows start a sync timer. The stub keeps timers out of the event
// loop and records them so tests can drive and clear them.
const timerLog = { timers: [], cleared: [] };
globalThis.setInterval = (callback) => { timerLog.timers.push(callback); return timerLog.timers.length; };
globalThis.clearInterval = (id) => { timerLog.cleared.push(id); };

function mountWindow(harness, index) {
  const body = { children: [], appendChild(c) { this.children.push(c); return c; } };
  const cleanup = harness.windows[index].options.mount(body, harness.windows[index]);
  return { body, cleanup };
}

test("dispatcher routes setup actions to windows and passes other actions through", () => {
  const defs = effectDefinitions("ascii.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const passed = [];
  h.PZ.ui.controls.runPropertyAction = function (list, target, action) {
    passed.push(action);
    return "previous";
  };
  const previous = h.PZ.ui.controls.runPropertyAction;
  const windows = loadWindows();
  windows.activate(h.context);
  const dispatch = h.PZ.ui.controls.runPropertyAction;
  assert.notEqual(dispatch, previous, "dispatcher wrapped");
  dispatch({}, { parentObject: effect }, "asciiSetup", null);
  assert.equal(h.windows.length, 1);
  assert.deepEqual(passed, [], "setup action does not reach the previous dispatcher");
  const opts = h.windows[0].options;
  assert.ok(opts.id.startsWith("ascii:"), "window id is per effect");
  assert.equal(opts.title, "ASCII Setup");
  assert.equal(opts.persistKey, "ascii-setup");
  assert.equal(opts.footer[0].title, "Done");
  assert.equal(opts.isValid(), true);
  effect.parent = null;
  assert.equal(opts.isValid(), false, "window closes when the effect is removed");
  assert.equal(dispatch({}, { parentObject: effect }, "vhsSetup", null), "previous");
  assert.deepEqual(passed, ["vhsSetup"], "other actions delegate");
  windows.deactivate();
  assert.equal(h.PZ.ui.controls.runPropertyAction, previous, "dispatcher restored");
  windows.deactivate();
});

test("tracery action opens a window with six point tabs", () => {
  const defs = effectDefinitions("tracery.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "tracerySetup", null);
  assert.equal(h.windows[0].options.title, "Tracery Setup");
  assert.ok(h.windows[0].options.id.startsWith("tracery:"));
  const { body } = mountWindow(h, 0);
  assert.ok(body.children.length > 0, "sections mounted");
  const tabs = h.made.find((r) => r.kind === "tabs");
  assert.equal(tabs.opts.tabs.length, 6);
  const panel = { children: [], appendChild(c) { this.children.push(c); return c; } };
  tabs.opts.tabs[0].render(panel);
  assert.equal(panel.children.length, 7, "enable, position, size, label and label offsets");
  windows.deactivate();
});

test("ASCII window builds controls from the effect property definitions", () => {
  const defs = effectDefinitions("ascii.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "asciiSetup", null);
  mountWindow(h, 0);
  const find = (label) => h.made.find((r) => r.opts && r.opts.label === label);
  const contrast = find("Contrast");
  assert.equal(contrast.kind, "slider");
  assert.equal(contrast.opts.min, 0);
  assert.equal(contrast.opts.max, 4);
  assert.equal(find("Character set").kind, "select");
  assert.equal(find("Character set").opts.options.length, 5);
  assert.equal(find("Character set").opts.value, "0");
  assert.equal(find("Enable advanced noise").kind, "checkbox");
  assert.equal(find("Background color").kind, "color");
  assert.equal(find("Background color").opts.value, "#08080a");
  assert.equal(find("Custom characters").kind, "text");
  assert.equal(find("Black fill").kind, "text");
  const font = find("Font");
  assert.deepEqual(font.opts.options.map((o) => o.label), ["source code pro", "monospace"]);
  assert.ok(!h.made.some((r) => r.opts && /inter/i.test(String(r.opts.label))), "no Inter control");
  windows.deactivate();
});

test("slider drags preview live and commit one history step with the drag-start value", () => {
  const defs = effectDefinitions("ascii.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "asciiSetup", null);
  mountWindow(h, 0);
  const contrast = h.made.find((r) => r.opts && r.opts.label === "Contrast");
  contrast.opts.onInput(2);
  contrast.opts.onInput(3);
  assert.equal(effect.properties.contrast.get(), 3, "preview applied to the project");
  assert.deepEqual(h.history.ops, [], "previews are not history steps");
  assert.equal(h.edits.length, 0);
  contrast.opts.onChange(3.5);
  assert.deepEqual(h.history.ops, ["start", "finish"], "one history step per drag");
  assert.equal(h.edits.length, 1);
  assert.equal(h.edits[0].property, "EFFECT/contrast");
  assert.equal(h.edits[0].value, 3.5);
  assert.equal(h.edits[0].oldValue, 1, "undo restores the value from before the drag");
  assert.equal(effect.properties.contrast.get(), 3.5);
  windows.deactivate();
});

test("discrete edits commit single history steps with the right values", () => {
  const defs = effectDefinitions("ascii.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "asciiSetup", null);
  mountWindow(h, 0);
  const find = (label) => h.made.find((r) => r.opts && r.opts.label === label);
  find("Enable advanced noise").opts.onChange(true);
  assert.equal(h.edits.at(-1).value, 1, "checkbox writes the option index");
  assert.equal(h.edits.at(-1).oldValue, 0);
  find("Character set").opts.onChange("2");
  assert.equal(h.edits.at(-1).value, 2, "select writes the option index");
  find("Background color").opts.onChange("#ff0000");
  assert.deepEqual(h.edits.at(-1).value, [1, 0, 0], "color converts to CM3 channels");
  assert.deepEqual(h.edits.at(-1).oldValue, [0.03, 0.03, 0.04]);
  find("Background color").opts.onChange("not a color");
  assert.equal(h.edits.length, 3, "invalid colors are ignored");
  assert.equal(h.history.ops.length, 6, "each committed edit is one start/finish pair");
  windows.deactivate();
});

test("a preset applies as one history step and refreshes the controls", () => {
  const defs = effectDefinitions("ascii.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "asciiSetup", null);
  mountWindow(h, 0);
  const list = h.made.find((r) => r.kind === "list");
  assert.equal(list.opts.items.length, 5, "five ASCII looks");
  assert.deepEqual(list.opts.items.map((i) => i.title), ["Red Matrix", "Mono Paper", "Blueprint", "Neon Night", "Glitch Storm"]);
  const before = h.edits.length;
  list.opts.onSelect(1); // Mono Paper: block size 18, courier-free monospace font
  assert.deepEqual(h.history.ops.slice(-2), ["start", "finish"], "preset is one history step");
  const applied = h.edits.slice(before);
  assert.ok(applied.length > 20, "preset writes its values");
  assert.equal(effect.properties.blockSize.get(), 18);
  assert.equal(effect.properties.blackFill.get(), "@");
  const blockSlider = h.made.find((r) => r.opts && r.opts.label === "Block size");
  assert.equal(blockSlider.sets.at(-1), 18, "controls refresh after the preset");
  windows.deactivate();
});

test("Tracery presets switch off unused points and set their point values", () => {
  const defs = effectDefinitions("tracery.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "tracerySetup", null);
  mountWindow(h, 0);
  const row = h.made.find((r) => r.kind === "buttonRow");
  assert.deepEqual(row.specs.map((s) => s.title), ["Surveillance", "Blueprint", "Neon Callout", "Minimal", "Key Track"]);
  const before = h.edits.length;
  row.specs[4].onClick();
  const keys = h.edits.slice(before).map((e) => e.property);
  for (let n = 1; n <= 6; n++) assert.ok(keys.includes("EFFECT/point" + n + "Enable"), "point " + n);
  assert.equal(effect.properties.point1Enable.get(), 0, "Key Track is detection-only");
  row.specs[0].onClick();
  assert.equal(effect.properties.point1Enable.get(), 1);
  assert.equal(effect.properties.point1X.get(), 30);
  assert.equal(effect.properties.point1LabelDX.get(), 150);
  windows.deactivate();
});

test("external property changes sync into the window and cleanup stops the timer", () => {
  timerLog.timers.length = 0;
  timerLog.cleared.length = 0;
  const defs = effectDefinitions("ascii.js");
  const effect = makeEffect(defs);
  const h = makeHarness(defs, effect);
  const windows = loadWindows();
  windows.activate(h.context);
  h.PZ.ui.controls.runPropertyAction({}, { parentObject: effect }, "asciiSetup", null);
  const { cleanup } = mountWindow(h, 0);
  const timers = timerLog.timers;
  assert.equal(timers.length, 1, "one sync timer per window");
  const block = h.made.find((r) => r.opts && r.opts.label === "Block size");
  effect.properties.blockSize.set(40, 0);
  timers[0]();
  assert.equal(block.sets.at(-1), 40, "external change reaches the control");
  const settled = block.sets.length;
  timers[0]();
  assert.equal(block.sets.length, settled, "unchanged values are not re-set");
  cleanup();
  assert.equal(timerLog.cleared.length, 1, "timer cleared on window close");
  windows.deactivate();
});

test("window source keeps to the shared floating window API", () => {
  const source = fs.readFileSync(windowsPath, "utf8");
  for (const banned of [/\bInter\b/, /fullscreen/i, /position: fixed/, /tracery-font/, /backdrop/, /document\.createElement/, /innerHTML/]) {
    assert.ok(!banned.test(source), "no " + banned);
  }
  assert.ok(source.includes("context.ui.openWindow"), "uses the plugin window API");
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(source), "no nondeterministic inputs");
});
