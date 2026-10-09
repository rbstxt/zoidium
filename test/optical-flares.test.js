"use strict";

// Object-level checks for the Optical Flares 3D object. CM3 classes are stubbed
// just enough to load optflares-math.js and optflares.js the way the runtime
// evaluates them. The stubs are inline so this file stays self-contained.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const flaresDir = path.join(projectRoot, "plugins", "optical-flares");

function readFlareSource(file) {
  return fs.readFileSync(path.join(flaresDir, file), "utf8");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function buildEnv() {
  class Observable {
    constructor() { this.watchers = []; }
    watch(fn) { this.watchers.push(fn); }
    unwatch(fn) {
      const index = this.watchers.indexOf(fn);
      if (index >= 0) this.watchers.splice(index, 1);
    }
    update(...args) {
      for (let i = 0; i < this.watchers.length; i += 1) this.watchers[i](...args);
    }
  }

  class Vector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Object3D {
    constructor() {
      this.position = new Vector3();
      this.rotation = new Vector3();
      this.scale = new Vector3(1, 1, 1);
      this.matrixWorld = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
      this.children = [];
      this.parent = null;
    }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parent = null;
    }
    updateWorldMatrix() {}
  }
  class Mesh extends Object3D {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
    }
  }
  class Disposable {
    constructor() { this.disposed = false; }
    dispose() { this.disposed = true; }
  }
  class ShaderMaterial extends Disposable {
    constructor(options) {
      super();
      Object.assign(this, options);
    }
  }
  const THREE = {
    LinearFilter: 1,
    RGBAFormat: 2,
    CustomBlending: 3,
    OneFactor: 4,
    OneMinusSrcColorFactor: 5,
    AddEquation: 6,
    NormalBlending: 7,
    Vector2,
    Vector3,
    Object3D,
    Mesh,
    ShaderMaterial,
    DataTexture: class extends Disposable {},
    PlaneBufferGeometry: class extends Disposable {},
  };

  // Property and list stubs. Enough behaviour for load(), get(), set(),
  // toJSON() and the observables the flare reads.
  class Prop {
    constructor(definition) {
      this.definition = definition;
      this.onChanged = new Observable();
      this.frameOffset = 0;
      this.value = clone(this.defaultValue());
    }
    defaultValue() {
      if (this.definition.group) return this.definition.objects.map((o) => o.value);
      return this.definition.value;
    }
    get() { return clone(this.value); }
    set(value) {
      const old = this.value;
      this.value = clone(value);
      this.onChanged.update(old);
    }
    load(data) {
      this.value = data === undefined || data === null ? clone(this.defaultValue()) : clone(data);
    }
    toJSON() { return clone(this.value); }
    getAddress() { return []; }
  }
  class GroupProp extends Prop {}

  class PropList {
    constructor(definitions, parent) {
      Object.defineProperty(this, "onListChanged", { value: new Observable() });
      Object.defineProperty(this, "parentObject", { value: parent || null, writable: true });
      this.addAll(definitions || {});
    }
    addAll(definitions) {
      for (const key of Object.keys(definitions)) {
        const entry = definitions[key];
        this[key] = entry instanceof Prop || entry instanceof PropList ? entry : PZ.property.create(entry);
      }
    }
    load(data) {
      const source = data || {};
      for (const key of Object.keys(this)) {
        if (this[key] instanceof Prop || this[key] instanceof PropList) this[key].load(source[key]);
      }
    }
    toJSON() {
      const result = {};
      for (const key of Object.keys(this)) {
        if (this[key] instanceof Prop || this[key] instanceof PropList) result[key] = this[key];
      }
      return result;
    }
  }

  class ObjectList extends Array {
    static get [Symbol.species]() { return Array; }
    constructor(parent, type) {
      super();
      Object.defineProperties(this, {
        parent: { value: parent || null, writable: true },
        type: { value: type || PZObject, writable: true },
        onListChanged: { value: new Observable() },
      });
    }
    splice(...args) {
      const removed = super.splice(...args);
      for (const item of removed) item.parent = null;
      for (let i = 2; i < args.length; i += 1) args[i].parent = this;
      this.onListChanged.update();
      return removed;
    }
    push(...items) {
      this.splice(this.length, 0, ...items);
      return this.length;
    }
    getAddress() { return []; }
    forEachItemOfType() {}
  }

  class PZObject {
    constructor() {
      Object.defineProperty(this, "parent", { value: null, writable: true });
      this.children = null;
    }
    tryGetParentOfType() { return null; }
    getAddress() { return []; }
  }

  const PZ = {};
  PZ.object = PZObject;
  PZ.property = {
    type: { NUMBER: 1, OPTION: 2, VECTOR2: 3, VECTOR3: 4, COLOR: 5, ASSET: 6, TEXT: 7 },
    create(definition) {
      return definition.group ? new GroupProp(definition) : new Prop(definition);
    },
  };
  PZ.asset = { type: { IMAGE: "image" }, image: class {} };
  PZ.propertyList = PropList;
  PZ.objectList = ObjectList;
  PZ.object3d = class extends PZObject {
    constructor() {
      super();
      this.properties = new PropList({}, this);
      this.children = [this.properties];
    }
    parentChanged() {}
  };
  PZ.object3d.light = class {};
  PZ.layer = class {};
  PZ.sequence = class {};
  PZ.project = class {};
  PZ.ui = {
    objectTypes: new Map(),
    edit: {
      prototype: {
        generateItemCommands() { return "original"; },
      },
    },
  };

  // Loads the sources in the same order the runtime uses.
  for (const file of ["optflares-math.js", "optflares.js", "optflares-window.js"]) {
    new Function("PZ", "THREE", readFlareSource(file))(PZ, THREE);
  }
  return { PZ, THREE };
}

// Minimal three.js-convention camera matrices (column-major).
function perspective(fovYDegrees, aspect, near, far) {
  const top = near * Math.tan((fovYDegrees * Math.PI) / 360);
  const right = top * aspect;
  return [
    near / right, 0, 0, 0,
    0, near / top, 0, 0,
    0, 0, -(far + near) / (far - near), -1,
    0, 0, (-2 * far * near) / (far - near), 0,
  ];
}

function viewMatrix(position, yawDegrees) {
  const yaw = (yawDegrees * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Camera rotation Ry(yaw); the view rotation is its transpose.
  const v = [[c, 0, -s], [0, 1, 0], [s, 0, c]];
  const t = [
    -(v[0][0] * position[0] + v[0][1] * position[1] + v[0][2] * position[2]),
    -(v[1][0] * position[0] + v[1][1] * position[1] + v[1][2] * position[2]),
    -(v[2][0] * position[0] + v[2][1] * position[1] + v[2][2] * position[2]),
  ];
  return [
    v[0][0], v[1][0], v[2][0], 0,
    v[0][1], v[1][1], v[2][1], 0,
    v[0][2], v[1][2], v[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const PROJ = perspective(50, 16 / 9, 0.1, 5000);

function camera(position, yawDegrees) {
  return {
    matrixWorldInverse: { elements: viewMatrix(position, yawDegrees) },
    projectionMatrix: { elements: PROJ },
  };
}

function placeFlare(flare, world) {
  const e = flare.threeObj.matrixWorld.elements;
  e[12] = world[0];
  e[13] = world[1];
  e[14] = world[2];
}

function createFlare(PZ, data) {
  const flare = new PZ.object3d.optflares();
  flare.type = 13;
  flare.load(data || { objectType: 0 });
  return flare;
}

function uniformSnapshot(flare) {
  const u = flare.material.uniforms;
  return JSON.stringify({
    source: [u.uSource.value.x, u.uSource.value.y],
    depth: u.uDepth.value,
    brightness: u.uBrightness.value,
    scale: u.uScale.value,
    count: u.uElementCount.value,
  });
}

test("the flare sources define the object class, presets and element catalogue", () => {
  const { PZ } = buildEnv();
  assert.equal(typeof PZ.object3d.optflares, "function");
  assert.equal(typeof PZ.object3d.optflares.element, "function");
  assert.equal(PZ.opticalflares.PRESETS.length, 5);
  assert.equal(PZ.opticalflares.ELEMENT_TYPES.length, 12);
  assert.equal(typeof PZ.opticalflares.openWindow, "function");
});

test("presets load their stacks and keep the saved element types", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 1 });
  assert.equal(flare.stack.length, 6);
  assert.deepEqual(Array.from(flare.stack, (element) => element.type), [0, 3, 3, 3, 1, 9]);
  assert.equal(flare.stack[1].properties.globalParams.aspectRatio.get(), 9);
});

test("serialization round-trips exactly, so saved projects keep their look", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  const saved = JSON.parse(JSON.stringify(flare));
  const reloaded = new PZ.object3d.optflares();
  reloaded.type = 13;
  reloaded.load(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded)), saved);
  assert.equal(reloaded.stack.length, flare.stack.length);
});

test("projects saved with the old 2D, preview and fade fields still load", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 2 });
  const legacy = JSON.parse(JSON.stringify(flare));
  legacy.properties.positioning.sourceType = 0;
  legacy.properties.positioning.previewBg = "asset-id";
  legacy.properties.positioning.foreground.fade = 100;
  legacy.properties.positioning.customLayers.layer1 = null;
  legacy.properties.flareSetup.centerPosition = [640, 360];
  const loaded = new PZ.object3d.optflares();
  loaded.type = 13;
  loaded.load(legacy);
  assert.equal(loaded.stack.length, flare.stack.length);
  assert.equal(loaded.properties.positioning.sourceType.get(), 0);
  assert.deepEqual(loaded.properties.flareSetup.centerPosition.get(), [640, 360]);
});

test("the render hook projects the source through the camera drawing the pass", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  placeFlare(flare, [0, 0, -10]);
  flare.update(0);
  const layerRenderer = {};
  const u = () => flare.material.uniforms;

  flare.quad.onBeforeRender(layerRenderer, null, camera([0, 0, 0], 0));
  assert.ok(Math.abs(u().uSource.value.x) < 1e-9, "centred for a camera at the origin");
  assert.ok(u().uBrightness.value > 0);

  flare.quad.onBeforeRender(layerRenderer, null, camera([1, 0, 0], 0));
  assert.ok(u().uSource.value.x < 0, "moving the camera right moves the flare left");

  flare.quad.onBeforeRender(layerRenderer, null, camera([0, 0, 0], 180));
  assert.equal(u().uBrightness.value, 0, "a source behind the camera is hidden");
});

test("the render hook can be saved and restored without chaining itself", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  placeFlare(flare, [0, 0, -10]);
  flare.update(0);
  let calls = 0;
  const projection = flare.quad.onBeforeRender;
  flare.quad.onBeforeRender = function () { calls += 1; };
  flare.quad.onBeforeRender = projection;
  flare.quad.onBeforeRender({}, null, camera([0, 0, 0], 0));
  assert.equal(calls, 0, "the temporary velocity callback is removed");
  assert.ok(flare.material.uniforms.uBrightness.value > 0, "the flare still updates");
});

test("occlusion enables the depth test only for 3D sources", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  placeFlare(flare, [0, 0, -10]);
  flare.properties.positioning.foreground.occlude.set(1);
  flare.update(0);
  flare.quad.onBeforeRender({}, null, camera([0, 0, 0], 0));
  assert.equal(flare.material.depthTest, true, "3D source with occlusion");
  assert.ok(flare.material.uniforms.uDepth.value > -1 && flare.material.uniforms.uDepth.value < 1);

  flare.properties.positioning.sourceType.set(0);
  flare.update(0);
  flare.quad.onBeforeRender({}, null, camera([0, 0, 0], 0));
  assert.equal(flare.material.depthTest, false, "screen-space source has no depth");
});

test("the same time and scene state always produce the same uniforms", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 3 });
  placeFlare(flare, [2, 1, -12]);
  const render = () => {
    flare.update(7.5);
    flare.quad.onBeforeRender({}, null, camera([0.5, 0, 0], 5));
    return uniformSnapshot(flare);
  };
  const first = render();
  flare.update(100);
  flare.quad.onBeforeRender({}, null, camera([3, 0, 1], -20));
  assert.equal(render(), first);
});

test("live flares are tracked for isInUse and released on unload", () => {
  const { PZ } = buildEnv();
  const before = PZ.opticalflares.liveCount();
  const flare = createFlare(PZ, { objectType: 0 });
  assert.equal(PZ.opticalflares.isInUse(), true);
  assert.equal(PZ.opticalflares.liveCount(), before + 1);
  const material = flare.material;
  const quadGeometry = flare.quad.geometry;
  flare.unload();
  assert.equal(flare.isLive(), false);
  assert.equal(PZ.opticalflares.liveCount(), before);
  assert.equal(material.disposed, true, "material disposed");
  assert.equal(quadGeometry.disposed, true, "geometry disposed");
  assert.equal(flare.material, null);
  assert.equal(flare.threeObj.children.length, 0, "disposed quad detached");
});

test("custom image textures are disposed on replacement and unload", () => {
  const { PZ, THREE } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  const assets = { load: value => ({ value }), unload() {} };
  flare.tryGetParentOfType = () => ({ assets });
  PZ.asset.image = class {
    constructor(asset) { this.asset = asset; }
    getTexture() { return new THREE.DataTexture(); }
  };
  const property = { get: () => "first" };
  flare.updateCustomTexture(property, "uCustom1", 0);
  const first = flare.material.uniforms.uCustom1.value;
  property.get = () => "second";
  flare.updateCustomTexture(property, "uCustom1", 0);
  assert.equal(first.disposed, true);
  const second = flare.material.uniforms.uCustom1.value;
  const white = flare._whiteTexture;
  flare.releaseCustomTextures();
  assert.equal(second.disposed, true);
  assert.equal(white.disposed, false, "shared fallback remains live");
  flare.unload();
  assert.equal(white.disposed, true);
});


test("THREE r91 sources refresh the ancestor matrices without updateWorldMatrix", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  placeFlare(flare, [0, 0, -10]);
  flare.threeObj.updateWorldMatrix = undefined;
  let updated = false;
  flare.threeObj.parent = { parent: null, updateMatrixWorld(force) { updated = force; } };
  flare.update(0);
  flare.quad.onBeforeRender({}, null, camera([0, 0, 0], 0));
  assert.equal(updated, true);
  assert.ok(flare.material.uniforms.uBrightness.value > 0);
});

test("element identity always reads a concrete frame and loading replaces default keys", () => {
  const { PZ } = buildEnv();
  const element = new PZ.object3d.optflares.element();
  const prop = element.properties.element.elementType;
  prop.get = (frame) => { assert.equal(frame, 0); return 3; };
  assert.equal(element.toJSON().type, 3);
  prop.keyframes = [{ frame: 0, value: 0 }];
  const load = prop.load;
  prop.load = function (data) {
    assert.equal(this.keyframes.length, 0, "old default keys removed before CM3 load appends saved keys");
    load.call(this, data);
  };
  element.load({ properties: { element: { elementType: 3 } } });
});

test("a new flare starts off-axis for the default CM3 camera, spread across the frame", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  const world = flare.properties.position.get();
  const view = viewMatrix([0, 0, 80], 0);
  const proj = perspective(60, 16 / 9, 0.1, 5000);
  const ndc = PZ.opticalflares.math.projectPoint(world, view, proj);
  // About 62% of the way from the centre to the upper-left corner.
  assert.ok(Math.abs(ndc.x + 0.62) < 0.02, "left of centre, about 62% of the way: " + ndc.x);
  assert.ok(Math.abs(ndc.y - 0.62) < 0.02, "above centre, about 62% of the way: " + ndc.y);
  assert.equal(flare.properties.flareSetup.brightness.get(), 70, "new flares start at 70% brightness");
  assert.equal(flare.properties.flareSetup.scale.get(), 75, "new flares start at 75% scale");
  assert.equal(flare.properties.positioning.sourceType.get(), 1, "the source stays Object 3D");
});

test("saved positions load unchanged, including the origin", () => {
  const { PZ } = buildEnv();
  const flare = createFlare(PZ, { objectType: 0 });
  const saved = JSON.parse(JSON.stringify(flare));
  saved.properties.position = [0, 0, 0];
  const loaded = new PZ.object3d.optflares();
  loaded.type = 13;
  loaded.load(saved);
  assert.deepEqual(loaded.properties.position.get(), [0, 0, 0]);
});

test("a saved empty stack stays empty; only a missing stack gets the default preset", () => {
  const { PZ } = buildEnv();
  const fresh = createFlare(PZ, { objectType: 0 });
  assert.equal(fresh.stack.length, 15, "a new object starts from the default preset");

  const saved = JSON.parse(JSON.stringify(fresh));
  saved.stack = [];
  const empty = new PZ.object3d.optflares();
  empty.type = 13;
  empty.load(saved);
  assert.equal(empty.stack.length, 0, "the saved empty stack is respected");
  empty.update(0);
  assert.equal(empty.material.uniforms.uElementCount.value, 0, "renders no elements");
  assert.deepEqual(JSON.parse(JSON.stringify(empty)).stack, [], "saves an empty stack again");

  const withoutField = JSON.parse(JSON.stringify(fresh));
  delete withoutField.stack;
  const defaults = new PZ.object3d.optflares();
  defaults.type = 13;
  defaults.load(withoutField);
  assert.equal(defaults.stack.length, 15, "a missing stack field still gets the preset");
});

test("the non-glow elements fade out when the source and centre coincide", () => {
  const { PZ } = buildEnv();
  const source = fs.readFileSync(path.join(flaresDir, "optflares.js"), "utf8");
  assert.ok(source.includes("float axisFade = smoothstep(0.0, 0.02, axisLen);"), "shader fades by axis length");
  assert.ok(source.includes('"c *= (etype == 0) ? 1.0 : axisFade;"'), "the glow keeps full intensity");
  assert.ok(PZ.opticalflares.math.axisFade(0) === 0);
});
