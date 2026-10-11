"use strict";

// Coverage for the VHS setup module's contract with the rest of the pack: it
// registers the VHS editor through the shared registerEditor entry (the only
// way to put an open-window button in the property panel), patches no
// property renderer, and installs no property-action dispatcher. Window
// behaviour is covered by vhs-datamosh-setup.test.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

// vhs-setup.js calls the global ZoidiumPluginApis.random directly (the shared
// overlay scripts load before any plugin code runs).
require("./shared-test-apis.js").ensureGlobalApis();

function fakeElement(tag) {
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    appendChild(c) { el.children.push(c); return c; },
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
  };
  return el;
}

function createHarness() {
  const g = globalThis;
  const keep = {};
  for (const k of ["document", "window", "requestAnimationFrame", "setInterval", "clearInterval", "PZ", "CM"]) {
    keep[k] = g[k];
  }
  const CM = { playback: { currentFrame: 0 }, project: { traverse() {} }, timelineSelection: [] };
  const controls = {};
  // A foreign dispatcher, as installed by another pack. VHS must not replace it.
  controls.runPropertyAction = function () { return "foreign"; };
  const created = [];
  controls.createControls = function (e, t, i) {
    created.push([e, t, i]);
    return "controls-out";
  };
  const PZ = {
    ui: { controls },
    effect: { create: () => ({ type: "x" }) },
    property: { type: { NUMBER: 0, OPTION: 9, TEXT: 15 } },
  };
  g.document = {
    createElement: (tag) => fakeElement(tag),
    getElementById: () => null,
    head: { appendChild() {} },
    body: { appendChild() {} },
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
  };
  g.window = g;
  g.window.addEventListener = () => {};
  g.window.removeEventListener = () => {};
  g.requestAnimationFrame = () => {};
  g.setInterval = () => 1;
  g.clearInterval = () => {};
  g.PZ = PZ;
  g.CM = CM;
  const editors = [];
  const unregistered = [];
  const disposers = [];
  const context = {
    PZ,
    editor: CM,
    document: g.document,
    window: g.window,
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
    ui: {
      controls: {},
      openWindow: () => null,
      getWindow: () => null,
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
  return {
    CM,
    PZ,
    controls,
    context,
    created,
    editors,
    unregistered,
    disposers,
    runDisposers() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
    restore() {
      for (const k of ["document", "window", "requestAnimationFrame", "setInterval", "clearInterval", "PZ", "CM"]) {
        if (keep[k] === undefined) delete g[k];
        else g[k] = keep[k];
      }
    },
  };
}

function loadModule(file) {
  const full = path.join(projectRoot, "plugins/openzoid-legacy", file);
  delete require.cache[require.resolve(full)];
  return require(full);
}

test("vhs setup registers its editor and leaves renderers and dispatchers alone", () => {
  const h = createHarness();
  try {
    const dispatcher = h.controls.runPropertyAction;
    const renderer = h.controls.createControls;
    const vhs = loadModule("vhs-setup.js");
    vhs.activate(h.context);
    assert.equal(h.editors.length, 1, "one editor entry");
    assert.equal(h.editors[0].title, "VHS Setup");
    assert.equal(h.editors[0].label, undefined, "the shared button reads Open VHS Setup");
    assert.equal(h.controls.runPropertyAction, dispatcher, "no dispatcher is installed by VHS");
    assert.equal(h.controls.createControls, renderer, "no property renderer is patched by VHS");
    h.runDisposers();
    assert.deepEqual(h.editors, [], "the editor is removed on disable");
    assert.deepEqual(h.unregistered, ["VHS Setup"]);
  } finally {
    h.restore();
  }
});

test("vhs setup installs no legacy button renderer", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins/openzoid-legacy/vhs-setup.js"), "utf8");
  assert.ok(!source.includes("createControls"), "no property renderer patch");
  assert.ok(!source.includes("runPropertyAction"), "no action dispatcher");
  assert.ok(!source.includes("propertyControls"), "no per-effect property control");
  assert.ok(source.includes("registerEditor"), "uses the shared editor registration");
});
