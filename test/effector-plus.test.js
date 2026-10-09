"use strict";

// Effector+ is a compatibility layer: it maps numeric object types 7/8/9 from
// Davidium projects onto the Effector classes and adds no menu entries.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(projectRoot, "plugins/effector-plus");

function loadRuntime() {
  const full = path.join(pluginDir, "effector-runtime.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

function createPZ() {
  const original = (type) => ({ created: type });
  return {
    object3d: { create: original },
    original,
  };
}

test("numeric types 7, 8, and 9 resolve to the namespaced Effector classes", () => {
  const PZ = createPZ();
  const runtime = loadRuntime();
  runtime.activate({ PZ });
  assert.deepEqual(PZ.object3d.create(7), { created: "zoidium:repeater/twist" });
  assert.deepEqual(PZ.object3d.create(8), { created: "zoidium:repeater/warp" });
  assert.deepEqual(PZ.object3d.create(9), { created: "zoidium:repeater/voronoi-fracture" });
  assert.deepEqual(PZ.object3d.create(0), { created: 0 }, "other numeric types pass through");
  assert.deepEqual(PZ.object3d.create("zoidium:repeater/twist"), { created: "zoidium:repeater/twist" });
  runtime.deactivate();
});

test("deactivation restores the previous create and releases the claim", () => {
  const PZ = createPZ();
  const runtime = loadRuntime();
  runtime.activate({ PZ });
  assert.equal(PZ.zoidium.legacyObject3dTypes.get(7), "effector-plus");
  runtime.deactivate();
  assert.equal(PZ.object3d.create, PZ.original);
  assert.equal(PZ.zoidium.legacyObject3dTypes.has(7), false);
});

test("activation refuses to take numeric types already claimed by another plugin", () => {
  const PZ = createPZ();
  PZ.zoidium = { legacyObject3dTypes: new Map([[8, "some-other-plugin"]]) };
  const runtime = loadRuntime();
  assert.throws(() => runtime.activate({ PZ }), /already claimed by another plugin/);
  assert.equal(PZ.object3d.create, PZ.original, "no wrapper installed on failure");
  assert.equal(PZ.zoidium.legacyObject3dTypes.get(8), "some-other-plugin");
});

test("re-activation after deactivation installs the mapping again", () => {
  const PZ = createPZ();
  const runtime = loadRuntime();
  runtime.activate({ PZ });
  runtime.deactivate();
  runtime.activate({ PZ });
  assert.deepEqual(PZ.object3d.create(7), { created: "zoidium:repeater/twist" });
  runtime.deactivate();
});

test("the manifest is an extension without picker entries, so there are no duplicate menu items", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  assert.equal(manifest.kind, "extension");
  assert.equal(manifest.objectTypes, undefined);
  assert.equal(manifest.objectClasses, undefined);
  assert.deepEqual(manifest.modules.map((module) => module.id), ["effector-runtime"]);
  assert.equal(fs.existsSync(path.join(pluginDir, "deform-framework.js")), false, "Davidium framework removed");
  assert.equal(fs.existsSync(path.join(pluginDir, "deformer-objects.js")), false, "Davidium deformers removed");
});


test("lifecycle rollback is registered before host mutation and is idempotent", () => {
  const PZ = createPZ();
  const runtime = loadRuntime();
  let dispose;
  runtime.activate({ PZ, lifecycle: { onDispose(fn) {
    assert.equal(PZ.object3d.create, PZ.original);
    assert.equal(PZ.zoidium, undefined);
    dispose = fn;
  } } });
  dispose(); dispose();
  assert.equal(PZ.object3d.create, PZ.original);
  assert.equal(PZ.zoidium.legacyObject3dTypes.size, 0);
  runtime.deactivate();
});

test("a failed factory patch releases the numeric claims immediately", () => {
  const PZ = createPZ();
  Object.defineProperty(PZ.object3d, "create", { get: () => PZ.original, set() { throw new Error("read-only factory"); } });
  const runtime = loadRuntime();
  assert.throws(() => runtime.activate({ PZ }), /read-only factory/);
  assert.equal(PZ.zoidium.legacyObject3dTypes.size, 0);
});
