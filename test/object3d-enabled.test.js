"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

function host() {
  class PropertyList {
    constructor(definitions, parent) { Object.defineProperty(this, "parent", { value: parent }); this.addAll(definitions); }
    addAll(definitions) { for (const [key, value] of Object.entries(definitions || {})) this.add(key, value); }
    add(key, definition) {
      this[key] = { definition, get: frame => this[key].keys?.[frame] ?? definition.value,
        load(data) { this.keys = data?.keys; }, toJSON() { return { keys: this.keys }; } };
    }
    load(data = {}) { for (const [key, property] of Object.entries(this)) property.load(data[key]); }
  }
  class Object3D {
    constructor() { this.properties = new PropertyList(Object3D.propertyDefinitions, this); this.threeObj = { visible: true }; }
    update(frame) { this.updated = frame; }
    prepare(frame) { this.prepared = frame; }
    zoidiumFrameReady() { return false; }
  }
  class Group extends Object3D {
    constructor() { super(); this.properties.addAll(Group.propertyDefinitions); this.objects = []; }
    update(frame) { this.threeObj.visible = this.properties.enabled.get(frame) === 1; for (const child of this.objects) child.update(frame); }
    prepare(frame) { for (const child of this.objects) child.prepare(frame); }
  }
  class Camera extends Object3D {}
  Object3D.camera = Camera; Object3D.group = Group;
  Object3D.propertyDefinitions = { name: { value: "Object" } };
  Group.propertyDefinitions = { enabled: { dynamic: true, name: "Enabled", type: 7, value: 1, items: "off;on" } };
  const PZ = { object3d: Object3D, propertyList: PropertyList };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/core/object3d-enabled.js"), "utf8"), { window: { PZ } });
  return { Object3D, Group, Camera };
}

test("object enabled defaults on, survives loading, and skips disabled frames", async () => {
  const { Object3D } = host();
  for (const type of ["shape", "text", "light", "particles", "model", "particular", "form", "plexus"]) {
    const object = new (class extends Object3D {})();
    object.properties.load({});
    assert.equal(object.properties.enabled.get(0), 1, type);
    assert.equal(object.properties.enabled.definition.items, "off;on");
    object.properties.enabled.load({ keys: { 9: 1, 10: 0, 11: 1 } });
    object.update(9); await object.prepare(9);
    assert.equal(object.updated, 9); assert.equal(object.prepared, 9);
    object.update(10); await object.prepare(10);
    assert.equal(object.threeObj.visible, false); assert.equal(object.updated, 9); assert.equal(object.prepared, 9);
    assert.equal(object.zoidiumFrameReady(10), true);
    object.update(11); await object.prepare(11);
    assert.equal(object.threeObj.visible, true); assert.equal(object.updated, 11); assert.equal(object.prepared, 11);
  }
});

test("disabled groups skip children except when they contain cameras", () => {
  const { Object3D, Group, Camera } = host();
  const group = new Group(), child = new Object3D(); group.objects.push(child);
  group.properties.enabled.load({ keys: { 10: 0 } });
  group.update(10); assert.equal(child.updated, undefined); assert.equal(group.threeObj.visible, false);
  group.objects.push(new Camera()); group.update(10); assert.equal(child.updated, 10);
  assert.equal(new Camera().properties.enabled, undefined);
});

test("native object types load and serialize the keyed property", () => {
  const { nativeHost } = require("./expressions-plus-harness");
  const { PZ, context } = nativeHost();
  context.window = context;
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/object3d-enabled.js"), "utf8"), context);
  const keyed = { animated: true, keyframes: [
    { frame: 0, value: 1, tween: 0 }, { frame: 10, value: 0, tween: 0 },
    { frame: 20, value: 1, tween: 0 },
  ] };
  for (const type of [0, 1, 2, 3, 4, 5]) {
    const object = PZ.object3d.create(type);
    object.properties.enabled.load();
    assert.equal(object.properties.enabled.get(0), 1, `type ${type} old default`);
    object.properties.enabled.load(keyed);
    assert.deepEqual([9, 10, 11, 20].map(frame => object.properties.enabled.get(frame)), [1, 0, 0, 1]);
    const saved = JSON.parse(JSON.stringify(object.properties.enabled));
    const copy = PZ.object3d.create(type);
    copy.properties.enabled.load(saved);
    assert.deepEqual([9, 10, 11, 20].map(frame => copy.properties.enabled.get(frame)), [1, 0, 0, 1]);
  }
  assert.equal(PZ.object3d.create(6).properties.enabled, undefined);
});

 test("existing objects use prototype patches installed later", () => {
  const { Object3D } = host();
  class Shape extends Object3D {}
  const object = new Shape();
  Shape.prototype.update = function (frame) { this.patched = frame; };
  object.update(7);
  assert.equal(object.patched, 7);
});

test("a disabled group exposes zoidiumSkipsWork so readiness does not wait on skipped children", () => {
  const { Object3D, Group } = host();
  const group = new Group();
  const child = new (class extends Object3D {})();
  group.objects.push(child);
  group.properties.enabled.keys = { 5: 0 };
  assert.equal(group.zoidiumSkipsWork(5), true);
  assert.equal(group.zoidiumSkipsWork(4), false);
  child.threeObj = { visible: true };
  child.properties.enabled.keys = { 5: 0 };
  child.prepare(5);
  assert.equal(child.threeObj.visible, false);
});

test("pack subclasses registered later get Enabled with default on", () => {
  const { Object3D } = host();
  class Pack extends Object3D { constructor() { super(); this.type = "zoidium:pack/thing"; } }
  const object = new Pack();
  assert.equal(object.properties.enabled.get(0), 1);
});
