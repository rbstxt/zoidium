"use strict";
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

  // Loads the sources the way the runtime does: math first, then the
  // object installer, then the options window.
  const flareMath = require("../plugins/optical-flares/optflares-math");
  PZ.opticalflares = { math: flareMath };
  require("../plugins/optical-flares/optflares")(PZ, THREE);
  require("../plugins/optical-flares/optflares-window")(PZ);
  return { PZ, THREE };
}

module.exports = { buildEnv };
