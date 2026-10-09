"use strict";

// Coverage for the designer gear button: the Rowbyte & Red Giant Suite
// prepends the settings gear to 3D list rows whose constructor carries a
// designer config, opening designer.open(item) on click.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function fakeElement() {
  const el = {
    children: [],
    dataset: {},
    appendChild(c) { el.children.push(c); return c; },
    insertBefore(c, ref) {
      const at = el.children.indexOf(ref);
      if (at < 0) el.children.push(c);
      else el.children.splice(at, 0, c);
      return c;
    },
    querySelector(sel) {
      if (sel === "button[data-designer-gear]") {
        return el.children.find((c) => c.tagName === "BUTTON" && c["data-designer-gear"]) || null;
      }
      return null;
    },
    setAttribute(k, v) { el[k] = v; },
  };
  Object.defineProperty(el, "firstElementChild", { get: () => el.children[0] || null });
  return el;
}

function fakeButton() {
  return { tagName: "BUTTON", title: "", onclick: null, setAttribute(k, v) { this[k] = v; } };
}

class FakeObjectList extends Array {}

function createHarness({ designer = true, owner = true } = {}) {
  const opened = [];
  const design = designer ? { open: (item) => opened.push(item), registerConfig: () => {} } : null;
  class FakeParticular {}
  FakeParticular.designer = { title: "Trapcode Particular Designer" };
  const itemOwner = owner
    ? { generateItemCommands(e, t) { return "orig-out"; } }
    : {};
  const PZ = {
    trapcode: design ? { designer: design } : {},
    objectList: FakeObjectList,
    object3d: {},
    opticalflares: { open: () => {} },
    ui: { panels: { itemOwner } },
  };
  const g = globalThis;
  const keepPZ = g.PZ;
  g.PZ = PZ;
  const panel = {
    options: { showListItemButtons: true },
    generateButton: (name) => {
      assert.equal(name, "settings");
      return fakeButton();
    },
  };
  return {
    PZ,
    design,
    opened,
    panel,
    itemOwner,
    FakeParticular,
    makeRow() {
      return { children: [fakeElement(), fakeElement()] };
    },
    makeItem(configured = true) {
      const parent = new FakeObjectList();
      return { constructor: configured ? FakeParticular : Object, parent };
    },
    restore() {
      if (keepPZ === undefined) delete g.PZ;
      else g.PZ = keepPZ;
    },
  };
}

function loadModule() {
  const full = path.join(projectRoot, "plugins/trapcode-suite/designer-gear.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

test("gear prepends for configured items and opens the designer", () => {
  const h = createHarness();
  try {
    const mod = loadModule();
    mod.activate({ PZ: h.PZ });
    const row = h.makeRow();
    const item = h.makeItem(true);
    const out = h.itemOwner.generateItemCommands.call(h.panel, row, item);
    assert.equal(out, "orig-out");
    const host = row.children[1];
    assert.equal(host.children.length, 1);
    const gear = host.children[0];
    assert.equal(gear.title, "designer");
    assert.equal(gear["data-designer-gear"], "1");
    let stopped = false;
    gear.onclick({ stopPropagation: () => { stopped = true; }, currentTarget: gear });
    assert.equal(stopped, true);
    assert.deepEqual(h.opened, [item]);
    mod.deactivate();
    assert.equal(h.itemOwner.generateItemCommands.__openzoidDesignerGear, undefined);
  } finally {
    h.restore();
  }
});

test("gear stays away without designer, config, list parent, or the option", () => {
  const h = createHarness({ designer: false });
  try {
    const mod = loadModule();
    mod.activate({ PZ: h.PZ });
    // No designer on the runtime: nothing renders.
    let row = h.makeRow();
    h.itemOwner.generateItemCommands.call(h.panel, row, h.makeItem(true));
    assert.equal(row.children[1].children.length, 0);
    // Designer appears later: gear renders without re-enabling.
    h.PZ.trapcode.designer = { open: (item) => h.opened.push(item) };
    row = h.makeRow();
    h.itemOwner.generateItemCommands.call(h.panel, row, h.makeItem(true));
    assert.equal(row.children[1].children.length, 1);
    // Unconfigured constructors never get the gear.
    row = h.makeRow();
    h.itemOwner.generateItemCommands.call(h.panel, row, h.makeItem(false));
    assert.equal(row.children[1].children.length, 0);
    // Items outside object lists never get the gear.
    row = h.makeRow();
    const orphan = { constructor: h.FakeParticular, parent: null };
    h.itemOwner.generateItemCommands.call(h.panel, row, orphan);
    assert.equal(row.children[1].children.length, 0);
    // Panels without list buttons never get the gear.
    row = h.makeRow();
    const quiet = { options: {}, generateButton: () => { throw new Error("must not render"); } };
    h.itemOwner.generateItemCommands.call(quiet, row, h.makeItem(true));
    assert.equal(row.children[1].children.length, 0);
    // Re-rendering the same row does not duplicate the gear.
    row = h.makeRow();
    const item = h.makeItem(true);
    h.itemOwner.generateItemCommands.call(h.panel, row, item);
    h.itemOwner.generateItemCommands.call(h.panel, row, item);
    assert.equal(row.children[1].children.length, 1);
    mod.deactivate();
  } finally {
    h.restore();
  }
});

test("optical flares config reconciles whatever order packs enable in", () => {
  const h = createHarness();
  try {
    class FakeFlares {}
    h.PZ.object3d.optflares = FakeFlares;
    let registered = null;
    h.PZ.trapcode.designer.registerConfig = (cls, cfg) => { registered = { cls, cfg }; };
    const mod = loadModule();
    mod.activate({ PZ: h.PZ });
    assert.equal(registered.cls, FakeFlares);
    assert.equal(registered.cfg.title, "Optical Flares Options");
    assert.equal(typeof registered.cfg.customOpen, "function");
    mod.deactivate();
  } finally {
    h.restore();
  }
});

test("activation fails loudly when the list renderer is gone", () => {
  const h = createHarness({ owner: false });
  try {
    const mod = loadModule();
    assert.throws(() => mod.activate({ PZ: h.PZ }), /object list renderer/);
  } finally {
    h.restore();
  }
});
