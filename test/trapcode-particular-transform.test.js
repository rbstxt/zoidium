"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function setup() {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "particular.js"]);
  Object.assign(THREE, { CustomBlending: 5, Material: class { dispose() {} } });
  const object = new PZ.object3d.particular();
  object.load({ spinMode: 0 });
  const system = object.systems[0];
  system.sceneRate = () => 30;
  return system;
}

const pose = system => ({
  position: [system.threeObj.position.x, system.threeObj.position.y, system.threeObj.position.z],
  scale: [system.threeObj.scale.x, system.threeObj.scale.y, system.threeObj.scale.z],
  rotation: [system.threeObj.rotation.x, system.threeObj.rotation.y, system.threeObj.rotation.z],
});

test("Particular Transform defaults keep the particle cloud at the identity pose", () => {
  const system = setup();
  system.update(11);
  assert.deepEqual(pose(system), { position: [0, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0] });
});

test("every Particular Transform control moves the particle cloud", () => {
  const system = setup();
  const transform = system.properties.transform;
  transform.offsetX.set(10); transform.offsetY.set(-20); transform.offsetZ.set(30);
  transform.scale.set(250);
  transform.rotationX.set(90); transform.rotationY.set(180); transform.rotationZ.set(-90);
  system.update(11);
  const result = pose(system);
  assert.deepEqual(result.position, [10, -20, 30]);
  assert.deepEqual(result.scale, [2.5, 2.5, 2.5]);
  assert.deepEqual(result.rotation, [Math.PI / 2, Math.PI, -Math.PI / 2]);
});

test("Particular Transform follows keyframed values without render history", () => {
  const system = setup();
  system.properties.transform.offsetX.get = frame => frame * 2;
  system.update(40);
  system.update(5);
  assert.equal(pose(system).position[0], 10);
});

test("Particle Random seed keeps a saved value after it leaves the panel", () => {
  const seed = setup().properties.particle.randomSeed;
  assert.equal(seed.definition.visible, false);
  seed.set(1234);
  assert.equal(seed.get(0), 1234);
});
