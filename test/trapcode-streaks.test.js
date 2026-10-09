"use strict";

// Coverage for the Particular streak controls: emitter-motion velocity,
// the mass/air-resistance family, and the rotation/stretch rows exist with
// behavior-preserving defaults.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const suiteDir = path.join(projectRoot, "plugins/trapcode-suite");

function loadSuite() {
  const PZ = {};
  const THREE = {};
  const common = fs.readFileSync(path.join(suiteDir, "trapcode-common.js"), "utf8");
  new Function("PZ", "THREE", common)(PZ, THREE);
  return { PZ, THREE };
}

function loadParticular(PZ, THREE) {
  class StubObject3D {}
  class StubObjectList extends Array {}
  class StubObject {}
  PZ.object = StubObject;
  PZ.object3d = StubObject3D;
  PZ.objectList = StubObjectList;
  PZ.property = {
    type: {
      NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR2: 4, VECTOR3: 5, LIST: 6, COLOR: 7,
      ASSET: 8, GRADIENT: 9, CURVE: 10, VECTOR4: 11, SHADER: 12, FONT: 13,
    },
  };
  PZ.asset = { type: { IMAGE: 3 } };
  const source = fs.readFileSync(path.join(suiteDir, "particular.js"), "utf8");
  new Function("PZ", "THREE", source)(PZ, THREE);
  return PZ;
}

test("streak controls exist with behavior-preserving defaults", () => {
  const { PZ, THREE } = loadSuite();
  loadParticular(PZ, THREE);
  const sys = PZ.object3d.particular.system;
  assert.ok(sys, "system class");
  const E = sys.emitterDefinitions;
  assert.equal(E.velocityFromEmitterMotion.value, 0);
  assert.equal(E.velocityFromEmitterMotion.min, 0);
  assert.equal(E.velocityFromEmitterMotion.max, 100);
  const PH = sys.physicsDefinitions;
  assert.equal(PH.mass.value, 10, "mass 10 keeps gravity/wind response neutral");
  assert.equal(PH.massRandom.value, 0);
  assert.equal(PH.sizeAffectsMass.value, 0);
  assert.equal(PH.airResistanceRandom.value, 0);
  assert.equal(PH.sizeAffectsAirResistance.value, 0);
  assert.equal(PH.rotationalAirResistance.value, 0);
  assert.ok(PH.drag, "flat air resistance predates this change");
  const P = sys.particleDefinitions;
  assert.equal(P.orientToMotion.value, 0);
  assert.equal(P.orientFadeIn.value, 20);
  assert.equal(P.rotateX.value, 0);
  assert.equal(P.rotateY.value, 0);
  assert.equal(P.rotateZ.value, 0);
  assert.equal(P.randomRotation.value, 0);
  assert.equal(P.degreesPerSecX.value, 0);
  assert.equal(P.degreesPerSecY.value, 0);
  assert.equal(P.degreesPerSecZ.value, 0);
  assert.equal(P.randomSpeedRotate.value, 0);
  assert.equal(P.randomSpeedDistribution.value, 0.5);
  assert.equal(P.stretch.value, 0);
});
