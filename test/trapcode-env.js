"use strict";

// Minimal CM3-like runtime for evaluating the Trapcode Suite sources in node
// tests. It implements only the surface the suite touches: properties, object
// base classes, object lists, and a THREE stub with plain fields. Used by the
// trapcode-form, trapcode-plexus and trapcode-lights tests.

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function readSource(file) {
  return fs.readFileSync(path.join(projectRoot, "plugins/trapcode-suite", file), "utf8");
}

function clone(value) {
  return value === undefined || value === null ? value : JSON.parse(JSON.stringify(value));
}

class Observable {
  constructor() {
    this.listeners = [];
  }
  watch(fn) {
    this.listeners.push(fn);
  }
  update(...args) {
    this.listeners.forEach((fn) => fn(...args));
  }
}

class Vec {
  constructor(x = 0, y = 0, z = 0, w = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    if (w !== undefined) this.w = w;
    return this;
  }
}

function createTHREE() {
  class Object3D {
    constructor() {
      this.position = new Vec();
      this.scale = new Vec(1, 1, 1);
      this.children = [];
      this.parent = null;
      this.visible = true;
      this.matrixUpdates = 0;
    }
    add(child) {
      child.parent = this;
      this.children.push(child);
      return this;
    }
    remove(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      child.parent = null;
      return this;
    }
    lookAt(x, y, z) {
      this.lookedAt = [x, y, z];
    }
    updateMatrixWorld() {
      this.matrixUpdates += 1;
    }
  }

  class BufferAttribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.count = array.length / itemSize;
      this.needsUpdate = false;
    }
  }

  class BufferGeometry {
    constructor() {
      this.attributes = {};
      this.index = null;
      this.drawRange = null;
      this.disposed = false;
    }
    addAttribute(name, attribute) {
      this.attributes[name] = attribute;
      return this;
    }
    setIndex(index) {
      this.index = index;
      return this;
    }
    setDrawRange(start, count) {
      this.drawRange = { start, count };
    }
    computeVertexNormals() {}
    dispose() {
      this.disposed = true;
    }
  }

  class ShaderMaterial {
    constructor(options) {
      Object.assign(this, options);
      this.defines = options.defines || {};
      this.needsUpdate = false;
    }
    dispose() {}
  }

  class LineBasicMaterial {
    constructor(options) {
      Object.assign(this, options);
    }
    dispose() {}
  }

  class Points extends Object3D {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
      this.frustumCulled = true;
    }
  }
  class LineSegments extends Points {}
  class Mesh extends Points {}

  class Light extends Object3D {
    constructor(color, intensity) {
      super();
      this.color = { r: 1, g: 1, b: 1, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } };
      this.intensity = intensity;
      this.castShadow = undefined;
    }
  }
  class SpotLight extends Light {
    constructor(color, intensity, distance, angle, penumbra, decay) {
      super(color, intensity);
      this.distance = distance;
      this.angle = angle;
      this.penumbra = penumbra;
      this.decay = decay;
      this.target = new Object3D();
    }
  }
  class PointLight extends Light {
    constructor(color, intensity, distance) {
      super(color, intensity);
      this.distance = distance;
    }
  }
  class DirectionalLight extends Light {
    constructor(color, intensity) {
      super(color, intensity);
      this.target = new Object3D();
    }
  }
  class HemisphereLight extends Light {
    constructor(sky, ground, intensity) {
      super(sky, intensity);
      this.groundColor = { r: 1, g: 1, b: 1, setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; } };
    }
  }
  class RectAreaLight extends Light {
    constructor(color, intensity, width, height) {
      super(color, intensity);
      this.width = width;
      this.height = height;
      this.isRectAreaLight = true;
    }
  }

  class DataTexture {
    constructor(data, width, height) {
      this.image = { data, width, height };
    }
  }

  return {
    Vector2: Vec,
    Vector3: Vec,
    Vector4: Vec,
    Object3D,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    LineBasicMaterial,
    Points,
    LineSegments,
    Mesh,
    SpotLight,
    PointLight,
    DirectionalLight,
    HemisphereLight,
    RectAreaLight,
    DataTexture,
    UniformsLib: {},
    NormalBlending: 1,
    AdditiveBlending: 2,
    LinearFilter: 3,
    RGBAFormat: 4,
    DoubleSide: 2,
  };
}

const PROPERTY_TYPE = {
  NUMBER: 0,
  VECTOR2: 1,
  VECTOR3: 2,
  VECTOR4: 3,
  COLOR: 4,
  GRADIENT: 5,
  CURVE: 10,
  OPTION: 6,
  TEXT: 7,
  ASSET: 8,
  LIST: 9,
  SHADER: 11,
};

function createPZ() {
  const PZ = {};
  PZ.asset = { type: { IMAGE: 1, GEOMETRY: 2, AV: 3 } };

  class Property {
    constructor(definition) {
      this.definition = definition;
      this.type = definition.type;
      this.name = definition.name;
      this.parentObject = null;
      this.value = clone(definition.value);
    }
    get() {
      return this.value;
    }
    set(value) {
      this.value = clone(value);
      if (typeof this.definition.changed === "function" && this.parentObject) {
        this.definition.changed.call(this);
      }
    }
    getDefaultValue() {
      return clone(this.definition.value);
    }
  }

  class GroupProperty extends Property {
    constructor(definition) {
      super(definition);
      this.objects = definition.objects.map((child) => {
        const property = Property.create(child);
        return property;
      });
    }
    get() {
      return this.objects.map((child) => child.get());
    }
    set(value) {
      this.objects.forEach((child, i) => child.set(value[i]));
    }
  }

  Property.create = function (definition) {
    if (definition.group) return new GroupProperty(definition);
    return new Property(definition);
  };
  Property.type = PROPERTY_TYPE;
  PZ.property = Property;

  class PropertyList {
    constructor(definitions, parent) {
      Object.defineProperty(this, "parentObject", { value: parent || null, writable: true });
      if (definitions) this.addAll(definitions);
    }
    addAll(definitions) {
      Object.keys(definitions).forEach((key) => {
        const value = definitions[key];
        const item = value instanceof Property || value instanceof PropertyList
          ? value
          : Property.create(value);
        if (item instanceof Property) item.parentObject = this.parentObject;
        this[key] = item;
      });
    }
    remove(key) {
      delete this[key];
    }
    load(data) {
      if (!data) return;
      Object.keys(this).forEach((key) => {
        const item = this[key];
        if (item instanceof PropertyList) item.load(data[key]);
        else if (item instanceof Property && data[key] !== undefined) item.set(data[key]);
      });
    }
  }
  PZ.propertyList = PropertyList;

  class PZObject {
    constructor() {
      this.parent = null;
      this.children = [];
      this.onParentChanged = new Observable();
    }
    tryGetParentOfType() {
      return null;
    }
    getParentOfType() {
      return null;
    }
    parentChanged() {
      this.onParentChanged.update();
    }
  }
  PZ.object = PZObject;

  class PZObject3d extends PZObject {
    constructor() {
      super();
      const defs = this.constructor.propertyDefinitions;
      this.properties = new PropertyList(defs || {}, this);
    }
  }
  PZ.object3d = PZObject3d;
  PZ.object3d.particular = { presetTexturesList: [] };

  class ObjectList extends Array {
    static get [Symbol.species]() {
      return Array;
    }
    constructor(parent, type) {
      super();
      this.parent = parent || null;
      this.type = type || PZObject;
      this.onListChanged = new Observable();
    }
    push(...items) {
      items.forEach((item) => {
        item.parent = this.parent;
      });
      return super.push(...items);
    }
  }
  PZ.objectList = ObjectList;

  return PZ;
}

// Builds PZ + THREE and evaluates the requested Trapcode sources into them.
function loadSuite(files) {
  const PZ = createPZ();
  const THREE = createTHREE();
  for (const file of files) {
    new Function("PZ", "THREE", readSource(file))(PZ, THREE);
  }
  return { PZ, THREE };
}

module.exports = { loadSuite, createPZ, createTHREE, readSource, projectRoot };
