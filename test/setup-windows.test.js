"use strict";

// Coverage for the VHS/Datamosh setup windows: module activation installs
// data, hooks, styles and logos; the property-button dispatcher and the
// button renderer work on vanilla upstream CM3 (which has neither) and
// compose with an OpenZoid-style runtime (which ships its own dispatcher).

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

function createHarness({ dispatcher } = {}) {
  const styles = [];
  const byId = {};
  const g = globalThis;
  const keep = {};
  for (const k of ["document", "window", "requestAnimationFrame", "setInterval", "clearInterval", "PZ", "CM"]) {
    keep[k] = g[k];
  }
  const CM = { playback: { currentFrame: 0 }, project: { traverse() {} }, timelineSelection: [] };
  const controls = {};
  if (dispatcher === "openzoid") {
    controls.runPropertyAction = function (list, target, action) {
      if (action === "otherAction") return "foreign-orig";
      return undefined;
    };
  }
  if (dispatcher === "wrapped") {
    controls.runPropertyAction = function () { return "outer"; };
  }
  const created = [];
  controls.createControls = function (e, t, i) {
    created.push([e, t, i]);
    return "controls-out";
  };
  const PZ = { ui: { controls }, effect: { create: () => ({ type: "x" }) } };
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
  const context = { PZ, editor: CM, window: g.window, getAsset: (kind, url) => bundleAsset(url) };
  return {
    CM,
    PZ,
    controls,
    context,
    styles,
    created,
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

test("setup modules install data, hooks, styles, and windows on vanilla CM3", () => {
  const h = createHarness();
  try {
    const vhs = loadModule("vhs-setup.js");
    const dmo = loadModule("datamosh-setup.js");
    vhs.activate(h.context);
    dmo.activate(h.context);
    assert.equal(Object.keys(h.CM.vhsPresets).length, 15);
    assert.equal(h.CM.vhsSliders.length, 31);
    assert.equal(Object.keys(h.CM.datamoshPresets).length, 10);
    assert.equal(h.CM.datamoshAlgos.length, 80);
    assert.equal(typeof h.CM.openVhsSetup, "function");
    assert.equal(typeof h.CM.openDatamoshSetup, "function");
    // Compat dispatcher installed (upstream has none) and routes both actions.
    assert.equal(typeof h.controls.runPropertyAction, "function");
    assert.equal(h.controls.runPropertyAction.__openzoidLegacyCompat, true);
    h.controls.runPropertyAction({ editor: h.CM }, { parentObject: null }, "vhsSetup", null);
    h.controls.runPropertyAction({ editor: h.CM }, { parentObject: null }, "datamoshSetup", null);
    assert.ok(h.CM.vhsWindow);
    assert.ok(h.CM.datamoshWindow);
    // Shared stylesheet installed once for both modules.
    assert.equal(h.styles.filter((s) => s.id === "zoidium-vhs-setup-style").length, 1);
    // Buttons renderer wraps once with a shared refcount.
    assert.equal(h.controls.createControls.__openzoidLegacyButtons, true);
    assert.equal(h.controls.createControls.__openzoidLegacyRefs, 2);
    // First deactivate keeps the shared renderer; the second removes it.
    vhs.deactivate();
    assert.equal(typeof h.controls.createControls, "function");
    assert.equal(h.controls.createControls.__openzoidLegacyButtons, true);
    dmo.deactivate();
    assert.equal(h.controls.createControls.__openzoidLegacyButtons, undefined);
    assert.equal(h.CM.vhsWindow, null);
    assert.equal(h.CM.datamoshWindow, null);
  } finally {
    h.restore();
  }
});

test("setup actions compose with an OpenZoid-style dispatcher", () => {
  const h = createHarness({ dispatcher: "openzoid" });
  try {
    const vhs = loadModule("vhs-setup.js");
    const dmo = loadModule("datamosh-setup.js");
    vhs.activate(h.context);
    dmo.activate(h.context);
    h.controls.runPropertyAction({ editor: h.CM }, { parentObject: null }, "vhsSetup", null);
    h.controls.runPropertyAction({ editor: h.CM }, { parentObject: null }, "datamoshSetup", null);
    assert.ok(h.CM.vhsWindow);
    assert.ok(h.CM.datamoshWindow);
    // Foreign cases still delegate to the original dispatcher.
    assert.equal(h.controls.runPropertyAction({}, {}, "otherAction", null), "foreign-orig");
    vhs.deactivate();
    dmo.deactivate();
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
        buttons: [{ name: "VHS Setup", title: "Open", action: "vhsSetup" }],
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
    vhs.deactivate();
  } finally {
    h.restore();
  }
});
