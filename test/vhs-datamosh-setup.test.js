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

// The setup modules call the global ZoidiumPluginApis.random directly (the
// shared overlay scripts load before any plugin code runs).
require("./shared-test-apis.js").ensureGlobalApis();

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
  // Split effects load their parts from the plugin bundle; the harness
  // serves them from disk the way the bundle would.
  instance._zoidiumGetAsset = (kind, assetPath) => {
    assert.equal(kind, "text");
    return read(String(assetPath).replace(/^\.\//, ""));
  };
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
    children: [],
    appendChild(child) {
      element.children.push(child);
    },
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
  const editors = [];
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
    section: (options) => {
      const entry = { kind: "section", options, element: fakeElement(), body: fakeElement() };
      created.push(entry);
      return entry;
    },
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
      registerEditor(spec) {
        editors.push(spec);
        return () => {
          const index = editors.indexOf(spec);
          if (index >= 0) editors.splice(index, 1);
          unregistered.push(spec.title);
        };
      },
    },
  };
  return { context, created, editors, unregistered, windows, disposers, timers, cleared };
}

function findControl(created, label) {
  const found = created.find((entry) => entry.options.label === label);
  assert.ok(found, `control "${label}" was built`);
  return found;
}

function openFromEditor(harness, title, effect) {
  const spec = harness.editors.find((entry) => entry.title === title);
  assert.ok(spec, `${title} registered through registerEditor`);
  assert.equal(spec.match(effect), true, "the editor matches its effect");
  spec.open(effect);
  assert.equal(harness.windows.length, 1, "the editor opens exactly one window");
  return harness.windows[0];
}

function mountWindow(windowOptions) {
  const body = fakeElement();
  const cleanup = windowOptions.mount(body, { close() {} });
  assert.equal(typeof cleanup, "function", "mount returns a cleanup");
  return cleanup;
}

function setupHarness(moduleFile, effectFile, type) {
  const effect = loadEffect(LEGACY + effectFile, type);
  const editor = createEditor(() => effect);
  effect.getAddress = () => ["effect"];
  editor.project = { addressLookup: () => effect.parent ? effect : null };
  const PZ = {
    property: { type: { TEXT: 15, NUMBER: 0, OPTION: 9 } },
    layer: { adjustment: class Adjustment {} },
  };
  const harness = createContext({ PZ, editor, effect });
  const module = loadModule(LEGACY + moduleFile);
  module.activate(harness.context);
  return { ...harness, effect, editor, module };
}

// --- VHS -------------------------------------------------------------------

test("vhs: the editor registers once and opens one window per effect", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  assert.equal(h.editors.length, 1, "one editor entry");
  assert.equal(h.editors[0].title, "VHS Setup");
  assert.equal(h.editors[0].match({ type: "datamosh", properties: {} }), false, "other effects do not match");
  const win = openFromEditor(h, "VHS Setup", h.effect);
  assert.equal(win.title, "VHS Setup");
  assert.equal(win.persistKey, "vhs-setup-v2");
  assert.equal(typeof win.mount, "function");
  assert.equal(typeof win.isValid, "function");
  assert.equal(win.isValid(), true);
  h.effect.parent = null;
  assert.equal(win.isValid(), false, "window closes when the effect is removed");
});

test("vhs: slider drags preview live and commit one undo step on release", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  const win = openFromEditor(h, "VHS Setup", h.effect);
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
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  mountWindow(openFromEditor(h, "VHS Setup", h.effect));
  const slider = findControl(h.created, "Flicker");
  slider.options.onChange(0.5);
  assert.deepEqual(h.editor.log, [
    "start",
    { set: "flicker", value: 0.5, oldValue: 0.08 },
    "finish",
  ]);
});

test("vhs: applying a preset is one undoable operation and records old values", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  mountWindow(openFromEditor(h, "VHS Setup", h.effect));
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
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  mountWindow(openFromEditor(h, "VHS Setup", h.effect));
  const slider = findControl(h.created, "Signal Strength");
  h.effect.properties.signalStrength.set(0.9);
  h.timers[0]();
  assert.equal(slider.get(), 0.9, "control follows the property");
  const preset = findControl(h.created, "Preset");
  assert.equal(preset.get(), "custom", "a hand-edited value shows Custom");
});

test("vhs: closing the window clears its timer and the plugin removes the editor", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  const win = openFromEditor(h, "VHS Setup", h.effect);
  const cleanup = mountWindow(win);
  assert.equal(h.timers.length, 1, "one refresh timer per window");
  cleanup();
  assert.equal(h.cleared.length, 1, "the timer is cleared on window close");

  for (const dispose of h.disposers) dispose();
  assert.deepEqual(h.editors, [], "the editor entry is removed on disable");
  assert.deepEqual(h.unregistered, ["VHS Setup"]);
});

test("vhs: an unrelated effect does not match the editor", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  const spec = h.editors.find((entry) => entry.title === "VHS Setup");
  assert.equal(spec.match({ type: "echo-legacy", properties: {} }), false);
});

test("vhs: Glitch! stores a new seed and is reproducible", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  mountWindow(openFromEditor(h, "VHS Setup", h.effect));
  const row = h.created.find((entry) => entry.kind === "buttonRow" &&
    entry.options.buttons.some((button) => button.title === "Glitch!"));
  assert.ok(row, "Glitch! button built");
  const glitch = row.options.buttons.find((button) => button.title === "Glitch!").onClick;
  h.effect.properties.glitchSeed.set(10);
  glitch();
  assert.equal(h.effect.properties.glitchSeed.get(), (10 + 7919) % 10000);
  const first = {};
  for (const key of ["signalStrength", "tracking", "tear", "blinds", "fastForward"]) {
    first[key] = h.effect.properties[key].get();
  }
  assert.equal(h.editor.log.filter((entry) => entry === "start").length, 1, "one undo step");
  h.effect.properties.glitchSeed.set(10);
  h.editor.log.length = 0;
  glitch();
  for (const key of Object.keys(first)) {
    assert.equal(h.effect.properties[key].get(), first[key], `${key} is reproducible`);
  }
  assert.ok(first.signalStrength >= 0.4 && first.signalStrength <= 1);
});

test("vhs: Clean VHS applies the clean preset and the guide lists every group", () => {
  const h = setupHarness("vhs-setup.js", "effects/vhs.js", "vhs");
  mountWindow(openFromEditor(h, "VHS Setup", h.effect));
  const row = h.created.find((entry) => entry.kind === "buttonRow");
  row.options.buttons.find((button) => button.title === "Clean VHS").onClick();
  assert.equal(h.effect.properties.signalStrength.get(), 0.12);
  const guide = h.created.find((entry) => entry.kind === "section" && entry.options.title === "Field guide");
  assert.ok(guide, "field guide section built");
});

// --- Datamosh --------------------------------------------------------------

test("datamosh: motion is a select over the nine modes and stores the index", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  const win = openFromEditor(h, "Datamosh Setup", h.effect);
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
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  h.effect.properties.seed.set(4242);
  findControl(h.created, "Preset").options.onChange("logo");
  assert.equal(h.editor.log.filter((entry) => entry === "start").length, 1);
  assert.equal(h.effect.properties.algorithm.get(), 13, "Logo Mosh maps donor algo 12 to Look 13");
  assert.equal(h.effect.properties.motion.get(), 8);
  assert.equal(h.effect.properties.interval.get(), 30);
  assert.equal(h.effect.properties.samples.get(), 6);
  assert.equal(h.effect.properties.seed.get(), 4242, "presets do not touch the seed");
});

test("datamosh: all ten donor presets map to the published Look indices", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  const preset = findControl(h.created, "Preset");
  const expected = {
    clean: 1, logo: 13, classic: 12, iframe: 12, swap: 11,
    sweep: 50, sinmelt: 54, mirror: 43, zoom: 6, trail: 34,
  };
  assert.deepEqual(
    preset.options.options.filter((option) => option.value !== "custom").map((option) => option.value).sort(),
    Object.keys(expected).sort(),
    "the ten donor presets, no more",
  );
  for (const [id, look] of Object.entries(expected)) {
    preset.options.onChange(id);
    assert.equal(h.effect.properties.algorithm.get(), look, `${id} maps to Look ${look}`);
  }
});

test("datamosh: Mosh! stores a new seed and derives every value from it", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  const row = h.created.find((entry) => entry.kind === "buttonRow" &&
    entry.options.buttons.some((button) => button.title === "Mosh!"));
  assert.ok(row, "Mosh! button built");
  const mosh = row.options.buttons.find((button) => button.title === "Mosh!").onClick;
  h.effect.properties.seed.set(100);
  mosh();
  const firstSeed = h.effect.properties.seed.get();
  assert.equal(firstSeed, (100 + 7919) % 10000, "the seed advances once per click");
  const firstValues = {};
  for (const key of ["intensity", "acceleration", "blend", "threshold", "blockSize", "algorithm", "hold", "speed", "motion"]) {
    firstValues[key] = h.effect.properties[key].get();
  }
  const starts = h.editor.log.filter((entry) => entry === "start").length;
  assert.equal(starts, 1, "one undo step per click");

  // Same seed, same result: reset and click again.
  h.effect.properties.seed.set(100);
  h.editor.log.length = 0;
  mosh();
  assert.equal(h.effect.properties.seed.get(), firstSeed);
  for (const key of Object.keys(firstValues)) {
    assert.equal(h.effect.properties[key].get(), firstValues[key], `${key} is reproducible`);
  }
  assert.ok(firstValues.intensity >= 0.6 && firstValues.intensity <= 1.6);
  assert.ok([6, 8, 10, 12, 14, 16, 20].includes(firstValues.blockSize));
});

test("datamosh: Remove Frame sets hold to full as one undo step", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  const row = h.created.find((entry) => entry.kind === "buttonRow" &&
    entry.options.buttons.some((button) => button.title === "Remove Frame"));
  assert.ok(row, "Remove Frame button built");
  h.effect.properties.seed.set(7);
  h.effect.properties.intensity.set(0.5);
  row.options.buttons.find((button) => button.title === "Remove Frame").onClick();
  assert.equal(h.effect.properties.seed.get(), (7 + 7919) % 10000);
  assert.equal(h.effect.properties.hold.get(), 1);
  assert.equal(h.effect.properties.intensity.get(), 1, "intensity is raised to the floor");
  assert.equal(h.editor.log.filter((entry) => entry === "start").length, 1);
});

test("datamosh: preset matching uses the donor tolerance", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  const preset = findControl(h.created, "Preset");
  preset.options.onChange("clean");
  // Nudge a value within the donor tolerance: the preset name still shows.
  h.effect.properties.intensity.set(0.25 + 0.01);
  h.timers[0]();
  assert.equal(preset.get(), "clean");
  h.effect.properties.intensity.set(0.9);
  h.timers[0]();
  assert.equal(preset.get(), "custom");
});

test("datamosh: New Seed stores one new seed as one undo step", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
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
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  h.effect.properties.motion.set(7);
  mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  assert.equal(findControl(h.created, "Motion").get(), "7");
});

test("datamosh: closing the window clears its timer", () => {
  const h = setupHarness("datamosh-setup.js", "effects/datamosh.js", "datamosh");
  const cleanup = mountWindow(openFromEditor(h, "Datamosh Setup", h.effect));
  cleanup();
  assert.equal(h.cleared.length, 1);
});

// --- Theme and dependency rules --------------------------------------------

test("setup modules carry no logos, Inter font, fullscreen overlay or shared stylesheet", () => {
  for (const file of ["vhs-setup.js", "datamosh-setup.js", "datamosh-export.js"]) {
    const source = read(LEGACY + file);
    assert.ok(!/\bInter\b/.test(source), `${file} has no Inter font`);
    assert.ok(!/\.(jpg|png|svg)\b/.test(source), `${file} loads no logo images`);
    assert.ok(!source.includes("position: fixed"), `${file} has no fullscreen overlay`);
    assert.ok(!source.includes("vhs-setup.css"), `${file} loads no stylesheet`);
    assert.ok(!source.includes("tracery-font"), `${file} loads no font`);
  }
  assert.equal(fs.existsSync(path.join(root, LEGACY + "vhs-setup.css")), false);
  // The byte-level true-mosh renderer is pure EBML/WebM code with no UI.
  const render = read(LEGACY + "datamosh-render.js");
  assert.ok(!/document|window\.open|Inter|\.jpg/.test(render), "datamosh-render.js has no UI");
});


test("historical setup TEXT keys remain defined and hidden for VHS and Datamosh", () => {
  for (const type of ["vhs", "datamosh"]) {
    const effect = loadEffect(LEGACY + "effects/" + type + ".js", type);
    const setup = effect.properties.setup;
    assert.ok(setup, type + " retains the serialized key");
    assert.equal(setup.definition.type, 15);
    assert.equal(setup.definition.visible, false);
    assert.equal(setup.definition.zoidiumControl, undefined);
    setup.set("historical setup value");
    assert.equal(setup.get(), "historical setup value");
  }
});

for (const [type, label, key] of [["vhs", "Signal Strength", "signalStrength"], ["datamosh", "Intensity", "intensity"]]) {
  for (const invalidation of ["project", "ancestor", "replacement"]) {
    test(`${type}: stale setup controls reject ${invalidation} changes before the validity poll`, () => {
      const h = setupHarness(type + "-setup.js", "effects/" + type + ".js", type);
      const win = openFromEditor(h, type === "vhs" ? "VHS Setup" : "Datamosh Setup", h.effect);
      const cleanup = mountWindow(win);
      const control = findControl(h.created, label);
      const before = h.effect.properties[key].get();
      if (invalidation === "project") h.editor.project = { addressLookup: () => h.effect };
      else h.editor.project.addressLookup = () => invalidation === "replacement" ? {} : null;
      control.options.onInput(0.99);
      control.options.onChange(0.99);
      findControl(h.created, "Preset").options.onChange("clean");
      assert.equal(h.effect.properties[key].get(), before);
      assert.deepEqual(h.editor.log, [], "stale controls start no history operation");
      assert.equal(win.isValid(), false);
      cleanup();
    });
  }
}
