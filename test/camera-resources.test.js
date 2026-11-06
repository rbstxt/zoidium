"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../plugins/core/camera-resources.js"), "utf8");

function fixture() {
  class Signal {
    constructor() { this.watchers = []; }
    watch(callback, immediate) { this.watchers.push(callback); if (immediate) callback(); }
    unwatch(callback) { const index = this.watchers.indexOf(callback); if (index >= 0) this.watchers.splice(index, 1); }
    update() { for (const callback of this.watchers) callback(); }
  }
  class Camera {
    constructor(signal) { this.parentLayer = { properties: { resolution: { onChanged: signal } } }; this.updates = 0; }
    resolutionChanged() { this.updates++; }
    changeObjectType() {
      this.parentLayer.properties.resolution.onChanged.watch(this.resolutionChanged.bind(this), true);
      if (this.fail) throw Error("Failed type change");
      return 17;
    }
    unload() { return 23; }
  }
  const PZ = { object3d: { camera: Camera } };
  vm.runInNewContext(source, { PZ });
  return { PZ, Camera, signal: new Signal() };
}

test("camera deletion detaches its listener while live cameras still resize", () => {
  const { PZ, Camera, signal } = fixture();
  const method = Camera.prototype.changeObjectType;
  vm.runInNewContext(source, { PZ });
  assert.equal(Camera.prototype.changeObjectType, method);
  const live = new Camera(signal), removed = new Camera(signal);
  const watch = signal.watch;
  assert.equal(live.changeObjectType(), 17);
  removed.changeObjectType();
  assert.equal(signal.watch, watch);
  assert.equal(Object.hasOwn(signal, "watch"), false);
  assert.equal(signal.watchers.length, 2);
  for (let i = 0; i < 100; i++) removed.changeObjectType();
  assert.equal(signal.watchers.length, 2);
  const updates = removed.updates;
  assert.equal(removed.unload(), 23);
  removed.unload();
  signal.update();
  assert.equal(removed.updates, updates);
  assert.equal(live.updates, 2);
  assert.equal(signal.watchers.length, 1);
  // Native undo reloads a new camera from JSON, which must attach again.
  const restored = new Camera(signal);
  restored.changeObjectType(); signal.update();
  assert.equal(restored.updates, 2);
});

test("a failed camera type change restores the observable and releases partial subscriptions", () => {
  const { Camera, signal } = fixture();
  const camera = new Camera(signal); camera.fail = true;
  assert.throws(() => camera.changeObjectType(), /Failed type change/);
  assert.equal(signal.watchers.length, 0);
  assert.equal(Object.hasOwn(signal, "watch"), false);
});


test("the deleted active camera keeps resizing until its replacement takes over", () => {
  const { Camera, signal } = fixture();
  const layer = { properties: { resolution: { onChanged: signal } }, pass: {} };
  const old = new Camera(signal); old.parentLayer = layer; old.threeObj = {};
  old.changeObjectType(); layer.pass.camera = old.threeObj;
  old.unload(); signal.update();
  assert.equal(old.updates, 2);
  const replacement = new Camera(signal); replacement.parentLayer = layer;
  replacement.threeObj = {}; replacement.changeObjectType();
  layer.pass.camera = replacement.threeObj; signal.update();
  assert.equal(old.updates, 2);
  assert.equal(replacement.updates, 2);
  assert.equal(signal.watchers.length, 1);
});


test("the deleted active camera can resolve its project after native detachment", () => {
  const { Camera, signal } = fixture();
  Object.defineProperty(Camera.prototype, "parentProject", { get() {
    if (!this.parent) throw Error("Detached camera");
    return this.parent.project;
  } });
  Camera.prototype.resolutionChanged = function () { this.size = this.parentProject.size; };
  const project = { size: 1 }, layer = { properties: { resolution: { onChanged: signal } }, pass: {} };
  const old = new Camera(signal); old.parentLayer = layer; old.parent = { project }; old.threeObj = {};
  old.changeObjectType(); layer.pass.camera = old.threeObj;
  old.unload(); old.parent = null;
  project.size = 2; signal.update();
  assert.equal(old.size, 2);
  old.unload();
  const replacement = new Camera(signal); replacement.parentLayer = layer; replacement.parent = { project };
  replacement.threeObj = {}; replacement.changeObjectType();
  project.size = 3; signal.update();
  assert.equal(old.size, 2);
  assert.equal(replacement.size, 3);
  assert.equal(Object.hasOwn(old, "parentProject"), false);
});
