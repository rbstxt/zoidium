"use strict";

// Geometry+ releases its generated geometry on unload. The object must rebuild
// it on a later update (an undo can restore an unloaded layer), and Repeater
// cloning must tolerate a source that is still released instead of throwing
// inside Three.js r91 Mesh.clone and stopping the preview.

require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness.js");
const { _test } = require("../plugins/scene-plus/scene-plus.js");
const geometryPlus = require("../plugins/geometry-plus/geometry-plus.js");

test("an unloaded Geometry+ object rebuilds its geometry on the next update", () => {
  const { PZ, THREE } = nativeHost();
  const classes = [];
  geometryPlus.activate({
    PZ,
    window: { THREE },
    object3d: { registerClass(entry) { classes.push(entry); return () => {}; } },
  });
  try {
    const shape = classes.find((entry) => entry.type.endsWith("/rounded-box")).factory();
    shape.properties.load();
    shape.materials.push({ load() {}, update() {}, unload() {} });
    shape.load({});
    shape.update(0);
    const first = shape.threeObj.geometry;
    assert.ok(first, "the first update generates geometry");

    shape.unload();
    assert.equal(shape.threeObj.geometry, null, "unload releases the geometry");
    assert.equal(shape.geometryNeedsUpdate, true, "unload marks the mesh for rebuild");

    shape.update(0);
    assert.ok(shape.threeObj.geometry, "the next update rebuilds the geometry");
    assert.notEqual(shape.threeObj.geometry, first, "a fresh geometry replaces the released one");
    assert.doesNotThrow(() => shape.threeObj.clone(true), "the rebuilt mesh clones");
  } finally {
    geometryPlus.deactivate();
  }
});

test("a repeater clones a released Geometry+ source without crashing", () => {
  const { PZ, THREE } = nativeHost();
  const Repeater = _test.createRepeaterClass(PZ, THREE, "linear", "zoidium:scene-plus/linear-repeater");
  const repeater = Object.create(Repeater.prototype);
  repeater.threeObj = new THREE.Object3D();
  repeater._instanceRoots = [];
  repeater._cloneDirty = true;
  repeater._cloneSignature = "";
  repeater.repeaterProperties = { count: { get: () => 2 } };

  const source = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.Geometry(), new THREE.Material());
  mesh.geometry = null;
  source.add(mesh);
  repeater.objects = [{ threeObj: source, update() {} }];

  assert.doesNotThrow(() => repeater.rebuildInstances(0));
  assert.equal(repeater._instanceRoots.length, 2, "instances are still built");
  const cloned = repeater._instanceRoots[0].root.children[0];
  assert.ok(cloned.children[0].geometry, "the clone receives a usable geometry");
  assert.equal(mesh.geometry, null, "the source stays released");
});
