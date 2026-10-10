"use strict";

// The designer entry points: the module binds the designer to its context.ui,
// registers the designer skin and one editor per Trapcode object. Zoidium then
// draws the gear and the "Open Designer" button; nothing patches CM3 directly.

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const modulePath = path.join(projectRoot, "plugins/trapcode-suite/designer-gear.js");

function loadModule() {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function createHarness({ designer = true, classes = ["particular", "form", "plexus"] } = {}) {
  const bound = [];
  const unbound = [];
  const opened = [];
  const designerApi = {
    skinCss: ":scope{color:#fff;}",
    bind(ui) {
      bound.push(ui);
      return () => unbound.push(ui);
    },
    open(target) {
      opened.push(target);
    },
  };
  const object3d = {};
  for (const key of classes) {
    const cls = class {};
    cls.designer = { title: `Trapcode ${key} Designer`, targets: () => [] };
    object3d[key] = cls;
  }
  const PZ = {
    trapcode: designer ? { designer: designerApi } : {},
    object3d,
  };
  const skins = [];
  const editors = [];
  const removed = [];
  const disposers = [];
  const ui = {
    registerSkin(name, css) {
      skins.push({ name, css });
      return () => removed.push(name);
    },
    registerEditor(spec) {
      editors.push(spec);
      return () => removed.push(spec.title);
    },
  };
  const context = {
    PZ,
    ui,
    lifecycle: { onDispose: (fn) => disposers.push(fn) },
  };
  return { PZ, designerApi, bound, unbound, opened, skins, editors, removed, disposers, ui, context, object3d };
}

test("activation registers the designer skin once and binds the window kit", () => {
  const h = createHarness();
  const mod = loadModule();
  mod.activate(h.context);
  assert.deepEqual(h.skins.map((s) => s.name), ["designer"]);
  assert.equal(h.skins[0].css, ":scope{color:#fff;}");
  assert.deepEqual(h.bound, [h.ui]);
  mod.activate(h.context);
  assert.equal(h.skins.length, 1, "a second activate does not register again");
});

test("one editor per Trapcode object, matched by class and opened through the designer", () => {
  const h = createHarness();
  const mod = loadModule();
  mod.activate(h.context);
  assert.deepEqual(h.editors.map((e) => e.title), [
    "Trapcode particular Designer",
    "Trapcode form Designer",
    "Trapcode plexus Designer",
  ]);
  for (const spec of h.editors) {
    assert.equal(spec.label, "Open Designer");
    assert.equal(spec.icon, "settings");
  }
  const [particular, form] = h.editors;
  const p = new h.object3d.particular();
  assert.equal(particular.match(p), true);
  assert.equal(form.match(p), false);
  assert.equal(form.match({}), false);
  particular.open(p);
  assert.deepEqual(h.opened, [p]);
});

test("disabling unbinds the designer; skin and editors are owned by the module ui", () => {
  const h = createHarness();
  const mod = loadModule();
  mod.activate(h.context);
  assert.equal(h.disposers.length, 1, "one lifecycle cleanup: the binding");
  for (const dispose of h.disposers.splice(0).reverse()) dispose();
  assert.deepEqual(h.unbound, [h.ui], "the designer is unbound");
  mod.deactivate();
});

test("activation fails loudly without the runtime, the window kit or any config", () => {
  const noDesigner = createHarness({ designer: false });
  assert.throws(() => loadModule().activate(noDesigner.context), /Designer windows need/);

  const noUi = createHarness();
  const context = { PZ: noUi.PZ, lifecycle: noUi.context.lifecycle };
  assert.throws(() => loadModule().activate(context), /Designer windows need/);

  const noConfigs = createHarness({ classes: [] });
  assert.throws(() => loadModule().activate(noConfigs.context), /no object configs/);
});

test("no CM3 list renderer is patched: the gear comes from registerEditor", () => {
  const h = createHarness();
  const originalCalls = [];
  h.PZ.ui = {
    edit: {
      prototype: {
        generateItemCommands() {
          originalCalls.push(true);
          return "orig";
        },
      },
    },
  };
  const mod = loadModule();
  mod.activate(h.context);
  assert.equal(h.PZ.ui.edit.prototype.generateItemCommands.__openzoidDesignerGear, undefined);
  assert.equal(h.PZ.ui.edit.prototype.generateItemCommands(), "orig");
});
