"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { loadSuite } = require("./trapcode-env");
const keys = ["rotateX", "rotateY", "rotateZ", "randomRotation", "degreesPerSecX", "degreesPerSecY", "degreesPerSecZ", "randomSpeedRotate", "randomSpeedDistribution"];
function form() { const { PZ } = loadSuite(["trapcode-common.js", "form.js"]); const root = new PZ.object3d.form(); root.load(null); return { PZ, root, instance: root.forms[0] }; }
test("Form rotation defaults retain the original sampling path and particle positions", () => {
  const { instance } = form(); instance.update(0);
  for (const key of keys) assert.equal(instance.properties.particle[key].get(0), key === "randomSpeedDistribution" ? .5 : 0);
  assert.equal(Object.hasOwn(instance.material.defines, "USE_PARTICLE_ROTATION"), false);
  const positions = [...instance.outPositions];
  instance.properties.particle.rotateZ.set(45); instance.update(0);
  assert.equal(Object.hasOwn(instance.material.defines, "USE_PARTICLE_ROTATION"), true);
  assert.deepEqual([...instance.outPositions], positions);
  instance.properties.particle.rotateZ.set(0); instance.update(0);
  assert.equal(Object.hasOwn(instance.material.defines, "USE_PARTICLE_ROTATION"), false);
});
test("Form rotations use absolute seconds and repeat under shuffled frame order", () => {
  const { instance } = form(), p = instance.properties.particle;
  instance.sceneRate = () => 24;
  keys.forEach((key, i) => p[key].set(i + 1));
  const state = () => JSON.stringify(instance.material.uniforms);
  instance.update(48); const expected = state();
  assert.equal(instance.material.uniforms.rotationTime.value, 2);
  assert.equal(instance.material.uniforms.rotBase.value.x, Math.PI / 180);
  for (const frame of [0, 7, 72, 1, 48]) instance.update(frame);
  assert.equal(state(), expected);
});
test("Form rotation values survive serialization and duplication and old saves stay neutral", () => {
  const { PZ, instance } = form();
  keys.forEach((key, i) => instance.properties.particle[key].set(i + 1));
  const saved = { forms: [{ properties: { particle: Object.fromEntries(keys.map(key => [key, instance.properties.particle[key].get(0)])) } }] };
  const duplicate = new PZ.object3d.form(); duplicate.load(saved); duplicate.update(12);
  keys.forEach((key, i) => assert.equal(duplicate.forms[0].properties.particle[key].get(12), i + 1));
  delete saved.forms[0].properties.particle;
  const legacy = new PZ.object3d.form(); legacy.load(saved); legacy.update(12);
  assert.equal(Object.hasOwn(legacy.forms[0].material.defines, "USE_PARTICLE_ROTATION"), false);
});
