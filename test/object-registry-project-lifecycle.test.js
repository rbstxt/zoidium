"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../plugins/core/object3d-registry.js"), "utf8");
const type = "zoidium:test/shape";

function fixture(withEditor = true) {
  class Object3d { load() {} unload() { this.unloaded = true; } }
  Object3d.create = () => new Object3d();
  class Shape extends Object3d {
    load(data) { this.value = data.value; }
  }
  const PZ = { object3d: Object3d, zoidium: { define(name, api) { this[name] = api; } } };
  const first = {}, next = {};
  const context = vm.createContext({ PZ, ...(withEditor ? { CM: { project: first } } : {}) });
  vm.runInContext(source, context);
  const api = PZ.zoidium.object3d;
  const register = () => api.registerClass({ type, factory: () => new Shape() });
  const release = register();
  const object = PZ.object3d.create(type);
  object.parent = { parent: first };
  object.load({ value: 7 });
  return { context, first, next, api, PZ, object, release, register };
}

test("retired project objects do not prevent disabling and re-enabling their class", () => {
  const f = fixture();
  assert.equal(f.api.isInUse("test"), true);
  assert.throws(f.release, /while it is in use/);
  f.context.CM.project = f.next;
  assert.equal(f.api.isInUse("test"), false);
  assert.doesNotThrow(f.release);
  assert.equal(f.object.value, 7);
  assert.equal(f.object.unloaded, undefined, "unregistering does not release a retired object's resources");
  const release = f.register();
  const active = f.PZ.object3d.create(type);
  active.parent = { parent: f.next };
  active.load({ value: 11 });
  assert.equal(f.api.isInUse("test"), true);
  assert.throws(release, /while it is in use/);
  active.unload();
  assert.doesNotThrow(release);
});

test("plugin-wide removal ignores retired trees and still protects the current tree", () => {
  const f = fixture();
  assert.throws(() => f.api.unregisterPlugin("test"), /while it is in use/);
  f.context.CM.project = f.next;
  assert.doesNotThrow(() => f.api.unregisterPlugin("test"));
  assert.equal(f.api.isRegistered(type), false);
  assert.doesNotThrow(f.register);
});

test("standalone hosts keep the original guard until tracked objects unload", () => {
  const f = fixture(false);
  assert.equal(f.api.isInUse("test"), true);
  assert.throws(f.release, /while it is in use/);
  f.object.unload();
  assert.equal(f.api.isInUse("test"), false);
  assert.doesNotThrow(f.release);
});
