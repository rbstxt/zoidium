"use strict";

// Coverage for the ASCII and Tracery setup windows (effect-windows.js): editor
// registration through registerEditor, control generation from the
// effect property definitions, undoable edits (one history step per edit,
// one per preset), live preview during drags, external sync, and teardown.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");
const windowsPath = path.join(legacyDir, "effect-windows.js");

const PZ_TYPES = { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 };

// Evaluates an effect source the way the runtime does and returns its
// property definitions (no DOM or WebGL is needed for definitions). Split
// effects load their parts through the shared module loader, served here
// from disk the way the bundle would serve them.
function effectDefinitions(file) {
  const source = fs.readFileSync(path.join(legacyDir, "effects", file), "utf8");
  const PZ = { property: { type: PZ_TYPES }, tween: {} };
  const THREE = { Pass: function () {}, WebGLRenderTarget: function () {}, ShaderMaterial: function () {} };
  THREE.Pass.prototype = {};
  const fakeThis = {
    properties: { addAll() {}, load() {} },
    _zoidiumGetAsset: (kind, assetPath) => {
      assert.equal(kind, "text");
      return fs.readFileSync(
        path.join(projectRoot, String(assetPath).replace(/^\.\//, "")),
        "utf8",
      );
    },
  };
  if (!globalThis.ZoidiumPluginApis?.modules?.createRequire) {
    globalThis.PZ = globalThis.PZ || { property: { type: PZ_TYPES } };
    eval(fs.readFileSync(path.join(projectRoot, "zoidium/plugin-apis.js"), "utf8"));
  }
  new Function("PZ", "THREE", "ZoidiumPluginApis", source).call(
    fakeThis, PZ, THREE, globalThis.ZoidiumPluginApis,
  );
  return fakeThis.propertyDefinitions;
}

function defaultOf(def) {
  if (def.group) return def.objects.map((o) => o.value);
  return def.value;
}

function makeEffect(defs, type) {
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
  return { type, parent: {}, getAddress: () => "EFFECT", propertyDefinitions: defs, properties };
}

function makeHarness(defs, effect) {
  const made = [];
  const windows = [];
  const editors = [];
  const history = {
    ops: [],
    startOperation() { this.ops.push("start"); },
    finishOperation() { this.ops.push("finish"); },
  };
  const editor = { playback: { currentFrame: 7 }, history,
    project: { addressLookup: () => effect.parent ? effect : null } };
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
      const win = {
        options,
        closed: false,
        subtitle: "",
        setSubtitle(text) { this.subtitle = text; },
        close() { this.closed = true; },
      };
      windows.push(win);
      return win;
    },
    registerEditor(spec) {
      editors.push(spec);
      return () => {
        const index = editors.indexOf(spec);
        if (index >= 0) editors.splice(index, 1);
      };
    },
  };
  const disposers = [];
  return {
    PZ,
    context: { PZ, editor, ui, lifecycle: { onDispose(fn) { disposers.push(fn); } } },
    made,
    windows,
    edits,
    history,
    editors,
    disposers,
  };
}

function loadWindows() {
  delete require.cache[require.resolve(windowsPath)];
  return require(windowsPath);
}

function openFromEditor(h, title, effect) {
  const spec = h.editors.find((entry) => entry.title === title);
  assert.ok(spec, title + " registered through registerEditor");
  assert.equal(spec.match(effect), true, "the editor matches its effect");
  spec.open(effect);
  assert.equal(h.windows.length, 1, "the editor opens exactly one window");
}


module.exports = { effectDefinitions, makeEffect, makeHarness, loadWindows, openFromEditor, projectRoot, windowsPath };
