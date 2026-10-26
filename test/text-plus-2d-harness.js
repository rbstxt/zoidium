"use strict";

const { installText2D } = require("../zoidium/project-compatibility.js");
const clone = value => JSON.parse(JSON.stringify(value));

class Signal {
  constructor() { this.callbacks = new Set(); }
  watch(fn) { this.callbacks.add(fn); }
  update() { for (const fn of this.callbacks) fn(); }
}

class Item {
  get parentObject() { return this.parent instanceof PropertyList ? this.parent.parentObject : this.parent; }
  getAddress(child) {
    const address = this.parent?.getAddress(this) || [];
    if (child) address.push(this.children.indexOf(child));
    return address;
  }
  addressLookup(address, index = 0) {
    return address[index] === undefined ? this : this.children[address[index]].addressLookup(address, index + 1);
  }
}

class Property extends Item {
  constructor(definition) {
    super();
    this.definition = definition;
    this.reads = [];
    this.onChanged = new Signal();
    if (definition.changed) this.onChanged.watch(definition.changed.bind(this));
    if (definition.objects) this.objects = definition.objects.map(def => new Property(def));
  }
  load(data) {
    const def = this.definition;
    this.expression = data?.expression;
    if (this.objects) this.objects.forEach((property, index) => property.load(data?.objects?.[index]));
    else if (def.dynamic) {
      this.animated = !!data?.animated;
      this.keyframes = clone(data?.keyframes || [{ value: def.value, frame: 0, tween: 1 }]);
    } else this.value = data === undefined ? def.value : data;
    this.onChanged.update();
  }
  get(frame) {
    this.reads.push(frame);
    if (this.expression === "frame * 2") return frame * 2;
    if (this.objects) return this.objects.map(property => property.get(frame));
    if (!this.definition.dynamic) return this.value;
    const keys = this.keyframes;
    if (!this.animated || frame <= keys[0].frame) return keys[0].value;
    const index = keys.findIndex(key => key.frame >= frame);
    if (index < 0) return keys.at(-1).value;
    const a = keys[index - 1], b = keys[index], t = (frame - a.frame) / (b.frame - a.frame);
    return a.value + (b.value - a.value) * t;
  }
  set(value) {
    if (this.objects) this.objects.forEach((property, index) => property.set(value[index]));
    else if (this.definition.dynamic) { this.keyframes[0].value = value; }
    else this.value = value;
    this.onChanged.update();
  }
  toJSON() {
    if (!this.definition.dynamic) return this.value;
    return { ...(this.objects ? { objects: this.objects } : { animated: this.animated, keyframes: this.keyframes }),
      ...(this.expression ? { expression: this.expression } : {}) };
  }
}

class PropertyList {
  constructor(definitions, owner) {
    Object.defineProperties(this, { parent: { value: owner },
      onListChanged: { value: new Signal() }, visible: { value: true, writable: true } });
    for (const [key, def] of Object.entries(definitions || {})) {
      const property = new Property(def);
      property.parent = this;
      this[key] = property;
    }
  }
  get parentObject() { return this.parent; }
  getAddress(property) { return this.parent.getAddress(this).concat(Object.keys(this).find(key => this[key] === property)); }
  addressLookup(address, index) {
    return address[index] === undefined ? this : this[address[index]].addressLookup(address, index + 1);
  }
  load(data) { for (const key of Object.keys(this)) this[key].load(data?.[key]); }
  toJSON() { return { ...this }; }
  *[Symbol.iterator]() { yield* Object.values(this); }
}

function canvas() {
  const log = [], context = { log };
  for (const key of ["save", "restore", "translate", "rotate", "scale", "transform", "path", "fill", "stroke"]) {
    context[key] = (...args) => log.push([key, ...args]);
  }
  return context;
}

function glyph(x, blank = false) {
  const properties = {
    position: { get: () => [x, 10] }, scale: { get: () => [0.1, 0.1] }, rotation: { get: () => 0 },
  };
  return { properties, path: { commands: blank ? [] : [{ type: "M" }],
    getBoundingBox: () => ({ x1: 0, y1: -100, x2: 80, y2: 0 }) },
    draw(frame, context) { context.path(x, frame); },
  };
}

function harness() {
  class Text extends Item {
    constructor() {
      super();
      this.type = 7;
      this.properties = new PropertyList({}, this);
      this.objects = [{ objects: [glyph(-20), glyph(0, true), glyph(20)] }];
      this.effects = [];
      this.children = [this.properties, this.objects, this.effects];
    }
    load() {}
    update(frame) { this.frame = frame; }
    draw(context) {
      for (const child of this.objects[0].objects) { child.draw(this.frame, context); context.fill(); context.stroke(); }
    }
    unload() { this.unloaded = true; }
    toJSON() { return { type: 7, properties: {}, objects: [], effects: this.effects }; }
  }
  const PZ = { layer: { shape: { text: Text } },
    propertyList: PropertyList,
    property: { type: { NUMBER: 0, VECTOR2: 1, VECTOR3: 2, OPTION: 6, TEXT: 7, LIST: 9 } },
    object3d: { eulerOrders: [] },
  };
  installText2D(PZ);
  const layers = [], editor = { project: { forEachItemOfType(type, visit) { for (const layer of layers) visit(layer); } } };
  function add(data) { const layer = new Text(); layer.load(data); layers.push(layer); return layer; }
  return { PZ, editor, Text, add, layers };
}

module.exports = { harness, canvas, glyph, clone };
