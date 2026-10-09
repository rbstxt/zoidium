"use strict";

// Setup-window coverage for VHS and Datamosh. The real effect sources supply
// the property definitions. The real setup modules run against a fake context,
// fake controls and a fake CM3 history. The tests check that the property
// button opens one window, that gestures and presets are one undoable step
// each, that the window refreshes from external changes, and that cleanup
// runs when the window or plugin closes.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const LEGACY = "plugins/openzoid-legacy/";

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function loadEffect(relative, type) {
  class Pass {}
  const sandbox = {
    console,
    PZ: {
      property: { type: { NUMBER: 0, OPTION: 9, TEXT: 15 } },
      expression: function Expression(source) {
        this.source = source;
      },
      zoidium: {},
    },
    THREE: { Pass },
  };
  vm.createContext(sandbox);
  vm.runInContext(read("zoidium/plugin-apis.js"), sandbox, { filename: "plugin-apis.js" });
  const instance = { type, properties: createPropertyList(), parent: {}, parentLayer: null };
  sandbox.instance = instance;
  vm.runInContext(`(function () {\n${read(relative)}\n}).call(instance);`, sandbox, {
    filename: relative,
  });
  return instance;
}

function createPropertyList() {
  const list = {};
  Object.defineProperties(list, {
    addAll: {
      value(definitions) {
        for (const key of Object.keys(definitions)) {
          const definition = definitions[key];
          let value = typeof definition.value === "function" ? 0 : definition.value;
          list[key] = {
            definition,
            parentObject: null,
            get() {
              return value;
            },
            set(next) {
              value = next;
            },
            getAddress() {
              return key;
            },
            frameOffset: 0,
          };
        }
      },
    },
    load: { value() {} },
  });
  return list;
}

function loadModule(relative) {
  const module = { exports: {} };
  new Function("module", "exports", "plugin", read(relative))(module, module.exports, {});
  return module.exports;
}

function fakeElement() {
  const element = {
    style: {},
    className: "",
    classList: { add() {} },
    listeners: {},
    appendChild() {},
    addEventListener(type, handler) {
      element.listeners[type] = handler;
    },
  };
  return element;
}

// A minimal stand-in for the CM3 editor: playback, history and property ops.
function createEditor(effectOf) {
  const log = [];
  return {
    log,
    playback: { currentFrame: 0 },
    history: {
      startOperation() {
        log.push("start");
      },
      finishOperation() {
        log.push("finish");
      },
    },
    propertyOps: {
      setValue(event) {
        const property = effectOf().properties[event.property];
        log.push({ set: event.property, value: event.value, oldValue: event.oldValue });
        property.set(event.value);
      },
    },
  };
}

function createContext({ PZ, editor, effect }) {
  const created = [];
  const registrations = {};
  const unregistered = [];
  const windows = [];
  const disposers = [];
  const timers = [];
  const cleared = [];

  function record(kind, options) {
    const entry = {
      kind,
      options,
      element: fakeElement(),
      value: options.value,
      get() {
        return entry.value;
      },
      set(next) {
        entry.value = next;
      },
    };
    created.push(entry);
    return entry;
  }

  const controls = {
    slider: (options) => record("slider", options),
    number: (options) => record("number", options),
    select: (options) => record("select", options),
    note: () => ({ element: fakeElement() }),
    section: () => ({ element: fakeElement(), body: fakeElement() }),
    button: (options) => record("button", options),
    buttonRow: (buttons) => record("buttonRow", { buttons, value: undefined }),
  };

  const context = {
    PZ,
    editor,
    document: { createElement: () => fakeElement() },
    window: {
      setInterval(handler) {
        timers.push(handler);
        return timers.length;
      },
      clearInterval(id) {
        cleared.push(id);
      },
    },
    apis: {
      propertyControls: {
        register(id, spec) {
          registrations[id] = spec;
          return () => unregistered.push(id);
        },
      },
    },
    lifecycle: {
      onDispose(cleanup) {
        disposers.push(cleanup);
      },
    },
    ui: {
      controls,
      openWindow(options) {
        windows.push(options);
        return { close() {} };
      },
      getWindow() {
        return null;
      },
    },
  };
  return { context, created, registrations, unregistered, windows, disposers, timers, cleared };
}

function findControl(created, label) {
  const found = created.find((entry) => entry.options.label === label);
  assert.ok(found, `control "${label}" was built`);
  return found;
}

function openFromButton(harness, registrationId, effect) {
  const spec = harness.registrations[registrationId];
  assert.ok(spec, `${registrationId} registered`);
  const property = { parentObject: effect, definition: {} };
  const button = spec.create(property);
  button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(harness.windows.length, 1, "the button opens exactly one window");
  return harness.windows[0];
}

function mountWindow(windowOptions) {
  const body = fakeElement();
  const cleanup = windowOptions.mount(body, { close() {} });
  assert.equal(typeof cleanup, "function", "mount returns a cleanup");
  return cleanup;
}

function setupHarness(moduleFile, registrationId, effectFile, type) {
  const effect = loadEffect(LEGACY + effectFile, type);
  const editor = createEditor(() => effect);
  const PZ = {
    property: { type: { TEXT: 15, NUMBER: 0, OPTION: 9 } },
    layer: { adjustment: class Adjustment {} },
  };
  const harness = createContext({ PZ, editor, effect });
  const module = loadModule(LEGACY + moduleFile);
  module.activate(harness.context);
  return { ...harness, effect, editor, module, registrationId };
}

// --- VHS -------------------------------------------------------------------

test("vhs: the property button registers once and opens one window per effect", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  assert.equal(h.registrations["openzoid-legacy.vhs-setup"].type, 15, "TEXT storage");
  const win = openFromButton(h, h.registrationId, h.effect);
  assert.equal(win.title, "VHS Setup");
  assert.equal(win.persistKey, "vhs-setup-v2");
  assert.equal(typeof win.mount, "function");
  assert.equal(typeof win.isValid, "function");
  assert.equal(win.isValid(), true);
  h.effect.parent = null;
  assert.equal(win.isValid(), false, "window closes when the effect is removed");
});

test("vhs: slider drags preview live and commit one undo step on release", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  const win = openFromButton(h, h.registrationId, h.effect);
  mountWindow(win);
  const slider = findControl(h.created, "Signal Strength");
  assert.equal(h.effect.properties.signalStrength.get(), 0.25);

  slider.options.onInput(0.5);
  slider.options.onInput(0.6);
  assert.equal(h.effect.properties.signalStrength.get(), 0.6, "preview writes the property");
  assert.deepEqual(h.editor.log, [], "no history during the drag");

  slider.options.onChange(0.7);
  assert.deepEqual(h.editor.log, [
    "start",
    { set: "signalStrength", value: 0.7, oldValue: 0.25 },
    "finish",
  ], "the whole gesture is one operation with the pre-drag value as undo target");
  assert.equal(h.effect.properties.signalStrength.get(), 0.7);
});

test("vhs: a click-to-type edit (change without input) records the previous value", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  mountWindow(openFromButton(h, h.registrationId, h.effect));
  const slider = findControl(h.created, "Flicker");
  slider.options.onChange(0.5);
  assert.deepEqual(h.editor.log, [
    "start",
    { set: "flicker", value: 0.5, oldValue: 0.08 },
    "finish",
  ]);
});

test("vhs: applying a preset is one undoable operation and records old values", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  mountWindow(openFromButton(h, h.registrationId, h.effect));
  const before = {};
  for (const key of Object.keys(h.effect.properties)) before[key] = h.effect.properties[key].get();

  findControl(h.created, "Preset").options.onChange("damaged");

  assert.equal(h.editor.log[0], "start");
  assert.equal(h.editor.log[h.editor.log.length - 1], "finish");
  assert.equal(h.editor.log.filter((entry) => entry === "start").length, 1);
  const sets = h.editor.log.filter((entry) => typeof entry === "object");
  assert.ok(sets.length > 0, "preset changes are recorded");
  for (const entry of sets) {
    assert.equal(entry.oldValue, before[entry.set], `${entry.set} keeps its undo target`);
    assert.equal(h.effect.properties[entry.set].get(), entry.value, `${entry.set} is applied`);
  }
  const signal = sets.find((entry) => entry.set === "signalStrength");
  assert.ok(signal, "Signal Strength changes in Damaged Tape");
  assert.equal(signal.value, 0.7);
  assert.equal(signal.oldValue, 0.25);
});

test("vhs: the window refreshes from external changes such as undo", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  mountWindow(openFromButton(h, h.registrationId, h.effect));
  const slider = findControl(h.created, "Signal Strength");
  h.effect.properties.signalStrength.set(0.9);
  h.timers[0]();
  assert.equal(slider.get(), 0.9, "control follows the property");
  const preset = findControl(h.created, "Preset");
  assert.equal(preset.get(), "custom", "a hand-edited value shows Custom");
});

test("vhs: closing the window clears its timer and the plugin removes the button", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  const win = openFromButton(h, h.registrationId, h.effect);
  const cleanup = mountWindow(win);
  assert.equal(h.timers.length, 1, "one refresh timer per window");
  cleanup();
  assert.equal(h.cleared.length, 1, "the timer is cleared on window close");

  for (const dispose of h.disposers) dispose();
  assert.deepEqual(h.unregistered, ["openzoid-legacy.vhs-setup"]);
});

test("vhs: a button on an unrelated effect is disabled", () => {
  const h = setupHarness("vhs-setup.js", "openzoid-legacy.vhs-setup", "effects/vhs.js", "vhs");
  const spec = h.registrations["openzoid-legacy.vhs-setup"];
  const button = spec.create({ parentObject: { type: "echo-legacy", properties: {} } });
  assert.equal(button.disabled, true);
});

// --- Datamosh --------------------------------------------------------------

test("datamosh: motion is a select over the nine modes and stores the index", () => {
  const h = setupHarness("datamosh-setup.js", "openzoid-legacy.datamosh-setup", "effects/datamosh.js", "datamosh");
  const win = openFromButton(h, "openzoid-legacy.datamosh-setup", h.effect);
  assert.equal(win.title, "Datamosh Setup");
  mountWindow(win);
  const motion = findControl(h.created, "Motion");
  assert.equal(motion.options.options.length, 9);
  motion.options.onChange("8");
  assert.deepEqual(h.editor.log, [
    "start",
    { set: "motion", value: 8, oldValue: 0 },
    "finish",
  ]);
  assert.equal(h.effect.properties.motion.get(), 8);
});

test("datamosh: presets apply as one undo step and keep the seed", () => {
  const h = setupHarness("datamosh-setup.js", "openzoid-legacy.datamosh-setup", "effects/datamosh.js", "datamosh");
  mountWindow(openFromButton(h, "openzoid-legacy.datamosh-setup", h.effect));
  h.effect.properties.seed.set(4242);
  findControl(h.created, "Preset").options.onChange("blocky");
  assert.equal(h.editor.log.filter((entry) => entry === "start").length, 1);
  assert.equal(h.effect.properties.interval.get(), 24);
  assert.equal(h.effect.properties.samples.get(), 8);
  assert.equal(h.effect.properties.seed.get(), 4242, "presets do not touch the seed");
});

test("datamosh: New Seed stores one new seed as one undo step", () => {
  const h = setupHarness("datamosh-setup.js", "openzoid-legacy.datamosh-setup", "effects/datamosh.js", "datamosh");
  mountWindow(openFromButton(h, "openzoid-legacy.datamosh-setup", h.effect));
  const row = h.created.find((entry) => entry.kind === "buttonRow" &&
    entry.options.buttons.some((button) => button.title === "New Seed"));
  assert.ok(row, "New Seed button built");
  row.options.buttons[0].onClick();
  const seedWrites = h.editor.log.filter((entry) => typeof entry === "object" && entry.set === "seed");
  assert.equal(seedWrites.length, 1);
  assert.ok(Number.isInteger(h.effect.properties.seed.get()));
  assert.ok(h.effect.properties.seed.get() >= 0 && h.effect.properties.seed.get() <= 9999);
});

test("datamosh: the migrated Davidium motion value shows in the window", () => {
  const h = setupHarness("datamosh-setup.js", "openzoid-legacy.datamosh-setup", "effects/datamosh.js", "datamosh");
  h.effect.properties.motion.set(7);
  mountWindow(openFromButton(h, "openzoid-legacy.datamosh-setup", h.effect));
  assert.equal(findControl(h.created, "Motion").get(), "7");
});

test("datamosh: closing the window clears its timer", () => {
  const h = setupHarness("datamosh-setup.js", "openzoid-legacy.datamosh-setup", "effects/datamosh.js", "datamosh");
  const cleanup = mountWindow(openFromButton(h, "openzoid-legacy.datamosh-setup", h.effect));
  cleanup();
  assert.equal(h.cleared.length, 1);
});

// --- Theme and dependency rules --------------------------------------------

test("setup modules carry no logos, Inter font, fullscreen overlay or shared stylesheet", () => {
  for (const file of ["vhs-setup.js", "datamosh-setup.js"]) {
    const source = read(LEGACY + file);
    assert.ok(!/\bInter\b/.test(source), `${file} has no Inter font`);
    assert.ok(!/\.(jpg|png|svg)\b/.test(source), `${file} loads no logo images`);
    assert.ok(!source.includes("position: fixed"), `${file} has no fullscreen overlay`);
    assert.ok(!source.includes("vhs-setup.css"), `${file} loads no stylesheet`);
    assert.ok(!source.includes("tracery-font"), `${file} loads no font`);
  }
  assert.equal(fs.existsSync(path.join(root, LEGACY + "vhs-setup.css")), false);
  assert.equal(fs.existsSync(path.join(root, LEGACY + "datamosh-render.js")), false);
  assert.equal(fs.existsSync(path.join(root, LEGACY + "datamosh-export.js")), false);
});
