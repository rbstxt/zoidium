"use strict";

// Coverage for the VHS setup module's contract with the rest of the pack: it
// registers the VHS property control through propertyControls, owns the shared
// legacy `buttons` renderer (createControls) that effect-windows.js relies on,
// and leaves the existing runPropertyAction dispatcher untouched. Window
// behaviour is covered by vhs-datamosh-setup.test.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const bundle = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "plugins/openzoid-legacy/bundle.json"), "utf8")
);

function bundleAsset(url) {
  const key = "/" + String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "").replace(/^\/+/, "");
  return bundle.assets.text[key];
}

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
    querySelector(sel) {
      const walk = (node) => {
        for (const child of node.children || []) {
          if (sel === "div.vhs-setup-buttons" && child.tagName === "DIV" && child.className === "vhs-setup-buttons") {
            return child;
          }
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(el);
    },
  };
  return el;
}

function createHarness() {
  const styles = [];
  const byId = {};
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
    getElementById: (id) => byId[id] || null,
    head: { appendChild: (c) => { styles.push(c); if (c && c.id) byId[c.id] = c; } },
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
  const registrations = {};
  const unregistered = [];
  const disposers = [];
  const context = {
    PZ,
    editor: CM,
    document: g.document,
    window: g.window,
    getAsset: (kind, url) => bundleAsset(url),
    apis: {
      propertyControls: {
        register(id, spec) {
          registrations[id] = spec;
          return () => unregistered.push(id);
        },
      },
    },
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
    ui: {
      controls: {},
      openWindow: () => null,
      getWindow: () => null,
    },
  };
  return {
    CM,
    PZ,
    controls,
    context,
    styles,
    created,
    registrations,
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

test("vhs setup registers its property control and leaves the dispatcher alone", () => {
  const h = createHarness();
  try {
    const dispatcher = h.controls.runPropertyAction;
    const vhs = loadModule("vhs-setup.js");
    vhs.activate(h.context);
    const spec = h.registrations["openzoid-legacy.vhs-setup"];
    assert.ok(spec, "VHS property control registered");
    assert.equal(spec.type, 15, "TEXT storage type");
    assert.equal(typeof spec.create, "function");
    assert.equal(h.controls.runPropertyAction, dispatcher, "no dispatcher is installed by VHS");
    h.runDisposers();
    assert.deepEqual(h.unregistered, ["openzoid-legacy.vhs-setup"]);
  } finally {
    h.restore();
  }
});

test("the shared button renderer is refcounted across activations and restored last", () => {
  const h = createHarness();
  try {
    const original = h.controls.createControls;
    const first = loadModule("vhs-setup.js");
    const second = loadModule("vhs-setup.js");
    // Each activation registers its own disposers; collect them per owner.
    const before = h.disposers.length;
    first.activate(h.context);
    const firstOwned = h.disposers.slice(before);
    const mark = h.disposers.length;
    second.activate(h.context);
    const secondOwned = h.disposers.slice(mark);
    assert.equal(h.controls.createControls.__openzoidLegacyButtons, true);
    assert.equal(h.controls.createControls.__openzoidLegacyRefs, 2);
    // Dispose the first owner only: the renderer stays for the second.
    firstOwned.forEach((dispose) => dispose());
    assert.equal(h.controls.createControls.__openzoidLegacyButtons, true);
    assert.equal(h.controls.createControls.__openzoidLegacyRefs, 1);
    secondOwned.forEach((dispose) => dispose());
    assert.equal(h.controls.createControls, original, "original renderer restored");
  } finally {
    h.restore();
  }
});

test("createControls wrapper appends declared property buttons", () => {
  const h = createHarness();
  try {
    const vhs = loadModule("vhs-setup.js");
    vhs.activate(h.context);
    const host = fakeElement("div");
    const row = { children: [fakeElement("div"), host] };
    const property = {
      definition: {
        type: "OPTION",
        buttons: [{ name: "Tracery Setup", title: "Open", action: "tracerySetup" }],
      },
    };
    const out = h.controls.createControls(row, property, false);
    assert.equal(out, "controls-out");
    const buttons = host.querySelector("div.vhs-setup-buttons");
    assert.ok(buttons);
    assert.equal(buttons.children.length, 1);
    // A second render into the same host does not duplicate the buttons.
    h.controls.createControls(row, property, false);
    assert.equal(host.children.filter((c) => c.className === "vhs-setup-buttons").length, 1);
    h.runDisposers();
  } finally {
    h.restore();
  }
});
