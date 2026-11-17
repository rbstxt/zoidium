"use strict";

// Particular flags `material.needsUpdate` only when a define actually changed.
// An unchanged frame must not re-initialise the material.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env.js");

function setup() {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "particular.js"]);
  THREE.Material = class { dispose() {} };
  THREE.DataTexture.prototype.dispose = () => {};
  PZ.property.prototype.toJSON = function () { return this.get(); };
  const particular = new PZ.object3d.particular();
  particular.load({ spinMode: 0 });
  const system = particular.systems[0];
  system.sceneRate = () => 30;
  return { PZ, T: PZ.trapcode, particular, system, p: system.properties };
}

test("two identical Particular frames do not flag a material update", () => {
  const { system } = setup();
  system.update(30);
  const material = system.material;
  material.needsUpdate = false;
  system.update(30);
  assert.equal(material.needsUpdate, false, "unchanged defines keep the material");
  system.update(31);
  assert.equal(material.needsUpdate, false, "uniform-only changes keep the material");
});

test("a define change still flags a Particular material update", () => {
  const { system, p } = setup();
  system.update(30);
  const material = system.material;
  material.needsUpdate = false;
  const lighting = p.lighting;
  lighting.enabled.set(1);
  system.update(30);
  assert.equal(material.defines.USE_SHADING, 1);
  assert.equal(material.needsUpdate, true, "a new define compiles once");
});

test("two identical layer-map frames do not flag a material update", () => {
  const { system, p } = setup();
  system.update(30);
  const material = system.material;
  material.needsUpdate = false;
  system.updateLayerMaps();
  assert.equal(material.needsUpdate, false);
  p.layerMaps.sizeEnabled.set(1);
  system.updateLayerMaps();
  assert.equal(material.defines.USE_LAYER_SIZE, 1);
  assert.equal(material.needsUpdate, true, "a layer define compiles once");
  material.needsUpdate = false;
  system.updateLayerMaps();
  assert.equal(material.needsUpdate, false, "the same layer defines do not compile again");
});
