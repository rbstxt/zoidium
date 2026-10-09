"use strict";

// Shared fakes for the Camera+ tests. They model only the CM3 and Zoidium
// surface that plugins/camera-plus uses: property lists, objects with a parent
// chain, scene layers with an update and a RenderPass, the vanilla camera
// class, the 3D object registry, the floating window API, and the expression
// method table. Nothing here is copied from CM3 sources.

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(projectRoot, "plugins", "camera-plus");

class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
}
class Vec3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
class Vec4 {
  constructor(x = 0, y = 0, z = 0, w = 0) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(v) { return this.set(v.x, v.y, v.z, v.w); }
}
class Euler {
  constructor(x = 0, y = 0, z = 0, order = "XYZ") { this.x = x; this.y = y; this.z = z; this.order = order; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class Object3D {
  constructor() {
    this.position = new Vec3();
    this.rotation = new Euler();
    this.children = [];
    this.parent = null;
  }
  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }
  remove(child) {
    const at = this.children.indexOf(child);
    if (at >= 0) this.children.splice(at, 1);
    child.parent = null;
    return this;
  }
  updateMatrixWorld() {}
  // Translation-only world transform: enough for distance checks.
  getWorldPosition(target) {
    let x = 0;
    let y = 0;
    let z = 0;
    for (let node = this; node; node = node.parent) {
      x += node.position.x;
      y += node.position.y;
      z += node.position.z;
    }
    return target.set(x, y, z);
  }
}

class PerspectiveCamera extends Object3D {
  constructor() {
    super();
    this.isPerspectiveCamera = true;
    this.fov = 60;
    this.aspect = 1;
    this.near = 0.1;
    this.far = 5000;
    this.zoom = 1;
    this.filmGauge = 35;
    this.filmOffset = 0;
    this.projectionMatrix = { elements: new Array(16).fill(0) };
  }
  updateProjectionMatrix() {}
  getFilmHeight() { return this.filmGauge / Math.max(this.aspect, 1); }
}

class OrthographicCamera extends Object3D {
  constructor() { super(); this.isOrthographicCamera = true; }
  updateProjectionMatrix() {}
}

class Scene extends Object3D {
  constructor() {
    super();
    this.overrideMaterial = null;
  }
}

class RenderTarget {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.viewport = new Vec4(0, 0, width, height);
    this.texture = { target: this };
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

class Material {
  constructor(options = {}) {
    this.uniforms = options.uniforms || {};
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

class Mesh extends Object3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}

function createTHREE() {
  function RenderPass(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.overrideMaterial = null;
    this.envMap = { renders: 0, render() { this.renders += 1; } };
    this.motionBlur = { render() {} };
  }
  RenderPass.prototype.render = function (renderer, target, readTarget, forceClear) {
    this.scene.overrideMaterial = this.overrideMaterial;
    this.envMap.render(renderer);
    this.motionBlur.render(renderer);
    renderer.render(this.scene, this.camera, target, forceClear);
    this.scene.overrideMaterial = null;
  };
  return {
    Vector2: Vec2,
    Vector3: Vec3,
    Vector4: Vec4,
    Euler,
    Object3D,
    PerspectiveCamera,
    OrthographicCamera,
    Scene,
    Mesh,
    PlaneBufferGeometry: function PlaneBufferGeometry() {},
    MeshDepthMaterial: function MeshDepthMaterial(options) { return new Material(options); },
    ShaderMaterial: Material,
    WebGLRenderTarget: RenderTarget,
    RenderPass,
    LinearFilter: 1,
    NearestFilter: 2,
    RGBAFormat: 3,
    RGBADepthPacking: 4,
  };
}

// ---- CM3 property model -----------------------------------------------------

const PROPERTY_TYPE = { NUMBER: 0, VECTOR2: 1, VECTOR3: 2, VECTOR4: 3, COLOR: 4, OPTION: 6, TEXT: 7, LIST: 9 };

class FakeProperty {
  constructor(definition) {
    this.definition = definition;
    this.value = clone(definition.value);
    this.expression = null;
    this.frameOffset = 0;
    this.parent = null;
    this.keyframes = [];
    this.changes = 0;
    // Grouped (vector) properties read and write their children, as in CM3.
    if (Array.isArray(definition.objects)) {
      this.objects = definition.objects.map((child) => {
        const property = new FakeProperty(child);
        property.parent = this;
        return property;
      });
      this.value = null;
    }
  }
  get parentObject() {
    let node = this.parent;
    while (node && !(node instanceof FakeObject)) node = node.parent;
    return node || null;
  }
  get(time) {
    if (this.expression) return this.expression.evaluate(time);
    if (this.objects) return this.objects.map((child) => child.get(time));
    return clone(this.value);
  }
  set(value, time) {
    if (this.objects) {
      value.forEach((item, index) => this.objects[index].set(item, time));
      return;
    }
    this.value = clone(value);
    this.changes += 1;
    if (typeof this.definition.changed === "function") this.definition.changed.call(this);
  }
  load(data) {
    if (this.objects) {
      this.objects.forEach((child, index) => child.load(data ? data[index] : undefined));
      return;
    }
    this.value = clone(data === undefined || data === null ? this.definition.value : data);
    if (typeof this.definition.changed === "function") this.definition.changed.call(this);
  }
  getAddress() {
    const parentKey = this.parent && typeof this.parent.keyOf === "function" ? this.parent.keyOf(this) : undefined;
    const base = this.parent && typeof this.parent.getAddress === "function" ? this.parent.getAddress() : [];
    return parentKey === undefined ? base : base.concat(parentKey);
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  return value;
}

class FakePropertyList {
  constructor(definitions, parent) {
    Object.defineProperty(this, "parent", { value: parent || null, writable: true });
    Object.defineProperty(this, "displayName", { value: undefined, writable: true });
    if (definitions) this.addAll(definitions);
  }
  add(key, value) {
    const child = value instanceof FakePropertyList || value instanceof FakeProperty
      ? value
      : new FakeProperty(value);
    child.parent = this;
    this[key] = child;
    return child;
  }
  addAll(definitions) {
    for (const key of Object.keys(definitions)) this.add(key, definitions[key]);
  }
  keyOf(child) {
    return Object.keys(this).find((key) => this[key] === child);
  }
  getAddress() {
    const parentKey = this.parent && typeof this.parent.keyOf === "function" ? this.parent.keyOf(this) : undefined;
    const base = this.parent && typeof this.parent.getAddress === "function" ? this.parent.getAddress() : [];
    return parentKey === undefined ? base : base.concat(parentKey);
  }
  load(data) {
    for (const key of Object.keys(this)) {
      this[key].load(data ? data[key] : undefined);
    }
  }
  toJSON() {
    const out = {};
    for (const key of Object.keys(this)) out[key] = this[key];
    return out;
  }
}

class FakeObject {
  constructor() {
    this.parent = null;
    this.properties = new FakePropertyList(FakeObject.propertyDefinitions, this);
    this.children = [this.properties];
  }
  tryGetParentOfType(cls) {
    for (let node = this.parent; node; node = node.parent) {
      if (node instanceof cls) return node;
    }
    return null;
  }
  forEachItemOfType(cls, fn) {
    if (this instanceof cls) fn(this);
    for (const child of this.children || []) {
      if (child && typeof child.forEachItemOfType === "function") child.forEachItemOfType(cls, fn);
    }
  }
  getAddress() {
    const parentAddress = this.parent && typeof this.parent.getAddress === "function"
      ? this.parent.getAddress() : [];
    const index = this.parent && typeof this.parent.indexOf === "function" ? this.parent.indexOf(this) : -1;
    return index >= 0 ? parentAddress.concat(index) : parentAddress;
  }
}
FakeObject.propertyDefinitions = {
  name: { visible: false, name: "Name", type: PROPERTY_TYPE.TEXT, value: "Object" },
};

class FakeObjectList extends Array {
  constructor(parent) {
    super();
    Object.defineProperty(this, "parent", { value: parent, writable: true });
  }
  forEachItemOfType(cls, fn) {
    for (const item of this) {
      if (item && typeof item.forEachItemOfType === "function") item.forEachItemOfType(cls, fn);
    }
  }
  getAddress() {
    return this.parent && typeof this.parent.getAddress === "function" ? this.parent.getAddress() : [];
  }
}

// ---- CM3 runtime fake ---------------------------------------------------------

function createPZ(THREE) {
  const PZ = {};
  PZ.property = {
    type: PROPERTY_TYPE,
    create: (definition) => new FakeProperty(definition),
  };
  PZ.propertyList = FakePropertyList;
  PZ.object = FakeObject;
  PZ.object3d = class extends FakeObject {
    constructor() {
      super();
      this.threeObj = null;
    }
    getAddress() { return FakeObject.prototype.getAddress.call(this); }
  };
  PZ.object3d.propertyDefinitions = {};
  PZ.object3d.eulerOrders = [{ name: "XYZ", value: "XYZ" }, { name: "ZXY", value: "ZXY" }];

  // Vanilla CM3 camera (type 6). Plugins never replace it.
  PZ.object3d.camera = class VanillaCamera extends PZ.object3d {
    constructor() {
      super();
      this.type = 6;
      this.objectType = 1;
      this.threeObj = new THREE.PerspectiveCamera();
    }
    load(data) {
      this.objectType = data && data.objectType === 2 ? 2 : 1;
      this.properties.load(data && data.properties);
      if (this.parentLayer && this.parentLayer.pass) this.parentLayer.pass.camera = this.threeObj;
    }
    update(time) {
      this.threeObj.position.set(0, 0, 80);
    }
  };
  PZ.object3d.camera.propertyDefinitions = {};

  PZ.objectList = FakeObjectList;

  PZ.layer = class FakeLayer extends FakeObject {
    constructor() {
      super();
      this.type = 5;
      this.effects = [];
    }
    static create(type) {
      if (typeof type === "number") {
        const layer = new PZ.layer();
        layer.type = type;
        return layer;
      }
      return new PZ.layer();
    }
    load(data) {
      this.properties.load(data && data.properties);
    }
    update() {}
    unload() {}
  };
  PZ.layer.propertyDefinitions = {};

  PZ.layer.scene = class FakeScene extends PZ.layer {
    constructor() {
      super();
      this.type = 4;
      this.objects = new FakeObjectList(this);
      this.children = [this.properties, this.objects];
      this.threeObj = new THREE.Scene();
      this.pass = new THREE.RenderPass(this.threeObj, null);
      this.updates = [];
      this.unloaded = false;
    }
    keyOf(child) { return child === this.objects ? "objects" : undefined; }
    push(object) {
      object.parent = this.objects;
      this.objects.push(object);
      if (object.threeObj) this.threeObj.add(object.threeObj);
      if (object instanceof PZ.object3d.camera) object.parentLayer = this;
      return object;
    }
    update(time) {
      this.updates.push(time);
      for (const object of this.objects) object.update(time);
      this.threeObj.updateMatrixWorld();
      return "scene-update";
    }
    unload() {
      this.unloaded = true;
    }
  };

  PZ.ui = {
    properties: class FakeOps {
      constructor(editor) { this.editor = editor; }
      setExpression(op) {
        this.editor.log.push(["setExpression", op.property, op.expression]);
      }
      setValue(op) {
        this.editor.log.push(["setValue", op.property, op.frame, op.value]);
      }
    },
  };

  PZ.expression = { methods: { add() { return 0; } } };
  PZ.zoidium = PZ.zoidium || {};
  PZ.compositor = { prototype: { renderLayer() { return "rl"; }, renderSequence() { return "rs"; } } };
  PZ.sequence = { prototype: { update() { return "su"; } } };
  return PZ;
}

// ---- Zoidium host fakes -----------------------------------------------------

function createObject3DRegistry() {
  const classes = new Map();
  const tracked = [];
  return {
    classes,
    tracked,
    registerClass(definition) {
      if (!/^zoidium:camera-plus\//.test(definition.type)) {
        throw new Error("A plugin may only register its own 3D object namespace: " + definition.type);
      }
      if (classes.has(definition.type)) throw new Error("already registered: " + definition.type);
      classes.set(definition.type, definition);
      return function unregister() { classes.delete(definition.type); };
    },
    isRegistered(type) { return classes.has(type); },
    instantiate(type) {
      const definition = classes.get(type);
      const instance = definition.factory({});
      instance.type = type;
      tracked.push(instance);
      return instance;
    },
  };
}

function createPropertyControls() {
  const registered = new Map();
  return {
    registered,
    register(id, spec) {
      registered.set(id, spec);
      return function unregister() { registered.delete(id); };
    },
  };
}

function createZoidiumUI() {
  const windows = [];
  const rows = [];
  const lists = [];
  const element = () => ({
    children: [],
    className: "",
    appendChild(child) { this.children.push(child); return child; },
  });
  return {
    windows,
    rows,
    lists,
    controls: {
      section(title) { const el = element(); return { element: el, body: el, title }; },
      list(options) {
        const built = { element: element(), options };
        lists.push(built);
        return built;
      },
      note(message) { return { element: { message } }; },
      buttonRow(buttons) {
        const built = { element: element(), buttons };
        rows.push(built);
        return built;
      },
    },
    openWindow(options) {
      const win = { options, closed: false, close() { this.closed = true; } };
      windows.push(win);
      return win;
    },
    notify() {},
  };
}

function createEditor(project) {
  const editor = {
    log: [],
    project,
    playback: { currentFrame: 12 },
    history: {
      depth: 0,
      startOperation() { editor.log.push(["start"]); },
      finishOperation() { editor.log.push(["finish"]); },
      pushCommand() {},
    },
  };
  return editor;
}

// A minimal project: addresses are registered explicitly by the test.
function createProject() {
  const byAddress = new Map();
  return {
    byAddress,
    register(address, object) { byAddress.set(JSON.stringify(address), object); return object; },
    addressLookup(address) { return byAddress.get(JSON.stringify(address)) || null; },
    forEachItemOfType(cls, fn) {
      for (const object of byAddress.values()) {
        if (object instanceof cls) fn(object);
      }
    },
  };
}

function readPluginSource(name) {
  return fs.readFileSync(path.join(pluginDir, name), "utf8");
}

function getAsset(kind, url) {
  const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
  return fs.readFileSync(path.join(projectRoot, key), "utf8");
}

// Builds a complete activation context. `overrides` replaces any field.
function createContext(overrides = {}) {
  const THREE = createTHREE();
  const PZ = createPZ(THREE);
  const project = createProject();
  const editor = createEditor(project);
  const registry = createObject3DRegistry();
  const apis = { propertyControls: createPropertyControls() };
  const disposers = [];
  const zoidiumUI = createZoidiumUI();
  const context = {
    PZ,
    THREE,
    editor,
    window: { THREE, ZoidiumUI: zoidiumUI },
    object3d: registry,
    apis,
    ui: { openWindow: zoidiumUI.openWindow, notify() {}, controls: zoidiumUI.controls },
    getAsset,
    lifecycle: { onDispose(fn) { disposers.push(fn); return fn; } },
    ...overrides,
  };
  return { context, THREE, PZ, project, editor, registry, apis, zoidiumUI, disposers };
}

function loadRuntime() {
  const file = path.join(pluginDir, "camera-runtime.js");
  delete require.cache[require.resolve(file)];
  return require(file);
}

module.exports = {
  Vec2,
  Vec3,
  Vec4,
  Object3D,
  PerspectiveCamera,
  Scene,
  PROPERTY_TYPE,
  createTHREE,
  createPZ,
  createContext,
  createProject,
  createEditor,
  loadRuntime,
  readPluginSource,
  getAsset,
  pluginDir,
  projectRoot,
};
