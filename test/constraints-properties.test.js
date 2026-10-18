"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPropertyStore, KEYS } = require("../plugins/constraints/constraint-properties.js");

// Minimal property/list contract, with no host code or captured project data.
function setup() {
  class Property {
    constructor(definition) { this.definition = definition; this.visible = definition.visible !== false; }
    get parentObject() { return this.parent.parentObject; }
    load(value) { this.value = value === undefined ? this.definition.value : value; }
    get(frame) { return typeof this.value === "function" ? this.value(frame) : this.value; }
    set(value) { this.value = value; this.definition.changed?.call(this); }
    toJSON() { return this.value; }
  }
  class Object3d {
    constructor() {
      this.threeObj = {};
      const properties = {};
      Object.defineProperties(properties, {
        parentObject: { value: this },
        addAll: { value(entries) { for (const [key, property] of Object.entries(entries)) { this[key] = property; property.parent = this; } } },
        onListChanged: { value: { update() {} } },
      });
      this.properties = properties;
      const entries = {};
      for (const name of ["name", "position", "rotation", "eulerOrder", "scale", "other"]) {
        entries[name] = new Property({ value: name === "rotation" ? [0, 0, 0] : 0 });
        entries[name].load();
      }
      properties.addAll(entries);
    }
  }
  class Light extends Object3d {}
  Object3d.light = Light;
  const objects = [];
  const project = { forEachItemOfType(_type, visit) { objects.forEach(visit); } };
  const PZ = { object3d: Object3d, property: { type: { TEXT: 1, OPTION: 2, NUMBER: 3 }, create: (def) => new Property(def) } };
  let serial = 0;
  const store = createPropertyStore({ PZ, crypto: { randomUUID: () => `uuid-${++serial}` } });
  function object(data, light = false) {
    const instance = light ? new Light() : new Object3d();
    instance.parentProject = project;
    objects.push(instance);
    store.attach(instance, data);
    return instance;
  }
  return { store, object, objects };
}

test("untouched constraints omit their fields and insert rows after rotation order", () => {
  const { object } = setup();
  const item = object();
  assert.deepEqual(Object.keys(item.properties).slice(4, 9), Object.values(KEYS));
  const json = JSON.parse(JSON.stringify(item.properties));
  for (const key of Object.values(KEYS)) assert.equal(Object.hasOwn(json, key), false);
  assert.equal(item.properties[KEYS.target].visible, true);
  assert.equal(item.properties[KEYS.influence].visible, false);
});

test("clearing a saved target explicitly overrides unknown-field preservation", () => {
  const { object } = setup();
  const item = object({ properties: { [KEYS.target]: "saved-uuid", [KEYS.influence]: 50 } });
  assert.equal(item.properties[KEYS.influence].visible, true);
  item.properties[KEYS.target].set("");
  item.properties[KEYS.influence].set(100);
  const merged = { [KEYS.target]: "saved-uuid", ...JSON.parse(JSON.stringify(item.properties)) };
  assert.equal(merged[KEYS.target], "");
  assert.equal(merged[KEYS.influence], 100);
  assert.equal(item.properties[KEYS.influence].visible, false);
});

test("IDs are lazy, persistent and regenerated on duplicate without stealing the original", () => {
  const { store, object } = setup();
  const original = object();
  assert.equal(store.readId(original), "");
  const id = store.ensureId(original);
  assert.equal(store.ensureId(original), id);
  const copy = object({ properties: { [KEYS.id]: id } });
  assert.notEqual(store.readId(copy), id);
  assert.equal(store.readId(original), id);
  // Omnidirectional lights can still serve as targets.
  const light = object(null, true);
  light.objectType = 2;
  assert.ok(store.ensureId(light));
});

test("duplicating a hierarchy remaps its internal links within the load batch", () => {
  const { store, object } = setup();
  const target = object();
  const id = store.ensureId(target);
  store.beginLoad();
  const trackerCopy = object({ properties: { [KEYS.target]: id } });
  const targetCopy = object({ properties: { [KEYS.id]: id } });
  store.endLoad();
  assert.equal(store.readTarget(trackerCopy), store.readId(targetCopy));
  assert.equal(store.readId(target), id);
});

test("influence reads the requested frame and teardown removes only owned fields", () => {
  const { store, object } = setup();
  const item = object();
  item.properties[KEYS.influence].set((frame) => frame * 2);
  assert.equal(store.readInfluence(item, 25), 50);
  store.detach(item);
  assert.equal(store.isAttached(item), false);
  assert.ok(item.properties.rotation);
  for (const key of Object.values(KEYS)) assert.equal(item.properties[key], undefined);
});
