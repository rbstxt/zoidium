"use strict";

// Lifecycle of the Optical Flares runtime: activation, the numeric type 13
// wrapper, the options gear, disable restoring every host change, and rollback
// when activation fails halfway. Stubs are inline, as in optical-flares.test.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const flaresDir = path.join(__dirname, "..", "plugins", "optical-flares");

function readFlareSource(file) {
  return fs.readFileSync(path.join(flaresDir, file), "utf8");
}

function loadRuntimeModule() {
  const module = { exports: {} };
  new Function("module", "exports", "plugin", readFlareSource("optical-flares-runtime.js"))(
    module,
    module.exports,
    {}
  );
  return module.exports;
}

// Minimal CM3 host: property/list classes, object3d.create and the object list
// editor prototype whose generateItemCommands the gear wraps.
function buildHost() {
  class Observable {
    constructor() { this.watchers = []; }
    watch(fn) { this.watchers.push(fn); }
    unwatch(fn) {
      const i = this.watchers.indexOf(fn);
      if (i >= 0) this.watchers.splice(i, 1);
    }
    update(...args) { for (const fn of this.watchers.slice()) fn(...args); }
  }
  class Prop {
    constructor(definition) {
      this.definition = definition;
      this.onChanged = new Observable();
      this.value = definition.group
        ? definition.objects.map((o) => o.value)
        : definition.value;
    }
    get() { return JSON.parse(JSON.stringify(this.value)); }
    set(value) { this.value = JSON.parse(JSON.stringify(value)); this.onChanged.update(); }
    load(data) { if (data !== undefined && data !== null) this.value = data; }
    toJSON() { return this.get(); }
    getAddress() { return []; }
  }
  class PropList {
    constructor(definitions) { this.addAll(definitions || {}); }
    addAll(definitions) {
      for (const key of Object.keys(definitions)) {
        const entry = definitions[key];
        this[key] = entry instanceof Prop || entry instanceof PropList ? entry : PZ.property.create(entry);
      }
    }
    load(data) {
      const source = data || {};
      for (const key of Object.keys(this)) {
        if (this[key] && typeof this[key].load === "function") this[key].load(source[key]);
      }
    }
  }
  class ObjectList extends Array {
    static get [Symbol.species]() { return Array; }
    constructor(parent, type) {
      super();
      Object.defineProperties(this, {
        parent: { value: parent || null, writable: true },
        type: { value: type || null, writable: true },
      });
    }
  }
  class PZObject {
    constructor() { Object.defineProperty(this, "parent", { value: null, writable: true }); }
    tryGetParentOfType() { return null; }
    getAddress() { return []; }
  }
  class Object3D extends PZObject {
    constructor() {
      super();
      this.properties = new PropList({});
      this.children = [this.properties];
    }
    parentChanged() {}
  }

  const originalCreate = function (type) {
    return "original:" + type;
  };
  const originalGenerate = function () {
    return "original-items";
  };

  const PZ = {
    object: PZObject,
    property: {
      type: { NUMBER: 1, OPTION: 2, VECTOR2: 3, VECTOR3: 4, COLOR: 5, ASSET: 6, TEXT: 7 },
      create(definition) { return new Prop(definition); },
    },
    propertyList: PropList,
    objectList: ObjectList,
    layer: class {},
    sequence: class {},
    project: class {},
    asset: { type: { IMAGE: "image" }, image: class {} },
    ui: {
      objectTypes: new Map(),
      edit: {
        prototype: {
          generateItemCommands: originalGenerate,
          generateButton(kind) {
            return {
              kind,
              title: "",
              attributes: {},
              setAttribute(name, value) { this.attributes[name] = value; },
            };
          },
        },
      },
    },
  };
  PZ.object3d = Object.assign(Object3D, { create: originalCreate });
  PZ.object3d.light = class {};

  const THREE = {
    LinearFilter: 1,
    RGBAFormat: 2,
    CustomBlending: 3,
    OneFactor: 4,
    OneMinusSrcColorFactor: 5,
    AddEquation: 6,
    NormalBlending: 7,
    Vector2: class { set() { return this; } },
    Vector3: class { set() { return this; } },
    Object3D: class {
      constructor() {
        this.position = new THREE.Vector3();
        this.rotation = new THREE.Vector3();
        this.scale = new THREE.Vector3();
        this.matrixWorld = { elements: new Array(16).fill(0) };
      }
      add() {}
      updateWorldMatrix() {}
    },
    Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; } },
    ShaderMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
    DataTexture: class { dispose() {} },
    PlaneBufferGeometry: class { dispose() {} },
  };
  return { PZ, THREE, originalCreate, originalGenerate };
}

// Runs the disposers the way the plugin manager does: the module's lifecycle
// owns them and calls them after deactivate().
function makeContext(host, sources, options = {}) {
  const disposers = [];
  const context = {
    PZ: host.PZ,
    window: { THREE: host.THREE },
    getAsset(kind, source) {
      return sources[source];
    },
    lifecycle: {
      onDispose(fn) { disposers.push(fn); },
    },
    ui: {
      openWindow() {
        return { close() {} };
      },
      controls: {},
    },
    editor: options.editor || null,
  };
  return {
    context,
    dispose() {
      for (const fn of disposers.reverse()) fn();
    },
  };
}

function bundledSources(override = {}) {
  const sources = {};
  for (const file of ["optflares-math.js", "optflares.js", "optflares-window.js"]) {
    sources["./plugins/optical-flares/" + file] = readFlareSource(file);
  }
  return Object.assign(sources, override);
}

test("activation defines the flare type 13 and the options entry point", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const { context } = makeContext(host, bundledSources());
  runtime.activate(context);
  assert.equal(typeof host.PZ.object3d.optflares, "function");
  assert.equal(typeof host.PZ.opticalflares.open, "function");
  const flare = host.PZ.object3d.create(13);
  assert.ok(flare instanceof host.PZ.object3d.optflares, "type 13 creates the flare");
  assert.equal(flare.type, 13);
  assert.equal(host.PZ.object3d.create(7), "original:7", "other types pass through");
});

test("isInUse follows loaded flares and blocks disabling while one is in the project", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  assert.equal(runtime.isInUse(), false);
  const flare = host.PZ.object3d.create(13);
  flare.load({ objectType: 0 });
  assert.equal(runtime.isInUse(), true);
  flare.unload();
  assert.equal(runtime.isInUse(), false);
  dispose();
});

test("the options gear is added once to flare rows only", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  const flare = host.PZ.object3d.create(13);
  flare.load({ objectType: 0 });
  flare.parent = new host.PZ.objectList(null, host.PZ.object3d.optflares.element);
  const inserted = [];
  const host2 = {
    querySelector() { return null; },
    firstElementChild: null,
    insertBefore(node) { inserted.push(node); },
  };
  const item = { children: [null, host2] };
  host.PZ.ui.edit.prototype.generateItemCommands.call(
    { options: { showListItemButtons: true }, generateButton: host.PZ.ui.edit.prototype.generateButton },
    item,
    flare
  );
  assert.equal(inserted.length, 1, "one gear for a flare row");
  assert.equal(inserted[0].attributes["data-designer-gear"], "1");

  const plain = {};
  plain.parent = flare.parent;
  const before = inserted.length;
  host.PZ.ui.edit.prototype.generateItemCommands.call(
    { options: { showListItemButtons: true }, generateButton: host.PZ.ui.edit.prototype.generateButton },
    { children: [null, host2] },
    plain
  );
  assert.equal(inserted.length, before, "other objects get no gear");
  dispose();
});

test("the options gear is not added to the 3D object list, which hides item buttons", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  const flare = host.PZ.object3d.create(13);
  flare.load({ objectType: 0 });
  flare.parent = new host.PZ.objectList(null, host.PZ.object3d.optflares.element);
  const inserted = [];
  const row = {
    querySelector() { return null; },
    firstElementChild: null,
    insertBefore(node) { inserted.push(node); },
  };
  // CM3's 3D object list is created with showListItemButtons:false. The gear
  // lives on the flare's header row in the Properties panel instead.
  const list = { options: { showListItemButtons: false }, generateButton: host.PZ.ui.edit.prototype.generateButton };
  host.PZ.ui.edit.prototype.generateItemCommands.call(list, { children: [null, row] }, flare);
  assert.equal(inserted.length, 0, "no gear in the 3D object list");
  dispose();
});

test("disabling restores the create wrapper, the item commands and the globals", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const createBefore = host.PZ.object3d.create;
  const commandsBefore = host.PZ.ui.edit.prototype.generateItemCommands;
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  assert.notEqual(host.PZ.object3d.create, createBefore);
  assert.notEqual(host.PZ.ui.edit.prototype.generateItemCommands, commandsBefore);
  dispose();
  assert.equal(host.PZ.object3d.create, createBefore);
  assert.equal(host.PZ.ui.edit.prototype.generateItemCommands, commandsBefore);
  assert.equal(host.PZ.object3d.optflares, undefined);
  assert.equal(host.PZ.opticalflares, undefined);
  assert.equal(host.PZ.ui.objectTypes.size, 0, "element object types removed");
  assert.equal(runtime.isInUse(), false);
});

test("a failed activation rolls back every change made before the failure", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const createBefore = host.PZ.object3d.create;
  const commandsBefore = host.PZ.ui.edit.prototype.generateItemCommands;
  const sources = bundledSources({ "./plugins/optical-flares/optflares-window.js": undefined });
  const { context, dispose } = makeContext(host, sources);
  assert.throws(() => runtime.activate(context), /missing its bundled source/);
  dispose();
  assert.equal(host.PZ.object3d.optflares, undefined);
  assert.equal(host.PZ.opticalflares, undefined);
  assert.equal(host.PZ.object3d.create, createBefore);
  assert.equal(host.PZ.ui.edit.prototype.generateItemCommands, commandsBefore);
});

test("activating twice without disabling is refused", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  assert.throws(() => runtime.activate(context), /already installed/);
  dispose();
});

test("a later pack that wrapped create keeps its link when flares are disabled", () => {
  const host = buildHost();
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  const ours = host.PZ.object3d.create;
  // Another pack wraps above ours; disabling flares must not remove it.
  const above = function (type) {
    if (type === 99) return "above:99";
    return ours.call(this, type);
  };
  host.PZ.object3d.create = above;
  dispose();
  assert.equal(host.PZ.object3d.create, above, "the wrapper above is kept");
  assert.equal(above(99), "above:99");
  assert.equal(above(7), "original:7", "our wrapper passes through once disabled");
});

test("velocity and environment renders exclude flares and restore visibility on failure", () => {
  const host = buildHost();
  const quad = { __zoidiumOpticalFlareQuad: true, visible: true };
  const mesh = { visible: true };
  class Pass {
    constructor() { this.scene = { traverse(fn) { fn(quad); fn(mesh); } }; }
    render(fail) {
      assert.equal(quad.visible, false);
      assert.equal(mesh.visible, true);
      if (fail) throw new Error("render failed");
      return "drawn";
    }
  }
  host.PZ.motionBlur = Pass;
  host.PZ.envMap = class extends Pass {};
  const original = Pass.prototype.render;
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  assert.equal(new host.PZ.motionBlur().render(), "drawn");
  assert.equal(quad.visible, true);
  assert.throws(() => new host.PZ.envMap().render(true), /render failed/);
  assert.equal(quad.visible, true);
  quad.visible = false;
  new host.PZ.motionBlur().render();
  assert.equal(quad.visible, false, "initially hidden quads stay hidden");
  dispose();
  assert.equal(Pass.prototype.render, original);
});

test("velocity updates preserve the flare projection callback even on failure", () => {
  const host = buildHost();
  const projection = () => "projection";
  const quad = { __zoidiumOpticalFlareQuad: true, onBeforeRender: projection };
  const mesh = { onBeforeRender: null };
  class Velocity {
    constructor() { this.scene = { traverse(fn) { fn(quad); fn(mesh); } }; }
    update(fail) {
      this.scene.traverse(node => { node.onBeforeRender = () => "velocity"; });
      if (fail) throw new Error("update failed");
    }
  }
  host.PZ.motionBlur = Velocity;
  const original = Velocity.prototype.update;
  const runtime = loadRuntimeModule();
  const { context, dispose } = makeContext(host, bundledSources());
  runtime.activate(context);
  new Velocity().update();
  assert.equal(quad.onBeforeRender, projection);
  assert.equal(mesh.onBeforeRender(), "velocity");
  assert.throws(() => new Velocity().update(true), /update failed/);
  assert.equal(quad.onBeforeRender, projection);
  dispose();
  assert.equal(Velocity.prototype.update, original);
});
