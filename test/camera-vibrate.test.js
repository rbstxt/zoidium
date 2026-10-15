"use strict";

// Camera+ vibrate and depth-of-field settings are pure functions of stored
// properties and the evaluation time: no accumulation, no randomness, no
// clock. Repeated, reversed, and direct evaluation give the same pose.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const harness = require("./camera-plus-harness.js");

function loadVibrate(PZ, THREE) {
  const parts = {};
  const source = fs.readFileSync(path.join(harness.pluginDir, "vibrate.js"), "utf8");
  new Function("PZ", "THREE", "parts", source)(PZ, THREE, parts);
  return parts.vibrate;
}

function pose(vibrate, PZ, THREE, t, settings) {
  const list = vibrate.createProperties(PZ);
  for (const [key, value] of Object.entries(settings)) list[key].set(value);
  const camera = new THREE.Object3D();
  const position = [10, 0, 80];
  const rotation = [0, 0, 0];
  camera.position.set(position[0], position[1], position[2]);
  vibrate.applyVibrate(list, t, camera, position, rotation);
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
  };
}

const SHAKE = {
  enabled: 1,
  enablePosition: 1,
  positionAmplitude: [5, 3, 0],
  positionFrequency: 2,
  enableRotation: 1,
  rotationAmplitude: [4, 0, 2],
  rotationFrequency: 1.5,
  seed: 42,
};

test("vibrate is a pure function of time: repeated and reversed evaluation agree", () => {
  const ctx = harness.createContext();
  const vibrate = loadVibrate(ctx.PZ, ctx.THREE);
  const first = pose(vibrate, ctx.PZ, ctx.THREE, 3.25, SHAKE);
  pose(vibrate, ctx.PZ, ctx.THREE, 0.5, SHAKE);
  pose(vibrate, ctx.PZ, ctx.THREE, 9, SHAKE);
  const again = pose(vibrate, ctx.PZ, ctx.THREE, 3.25, SHAKE);
  assert.deepEqual(again, first);
  assert.notDeepEqual(first.position, [10, 0, 80], "shake is visible at this time");
});

test("vibrate depends on seed and pulse mode but never on call history", () => {
  const ctx = harness.createContext();
  const vibrate = loadVibrate(ctx.PZ, ctx.THREE);
  const seeded = pose(vibrate, ctx.PZ, ctx.THREE, 1.7, SHAKE);
  const otherSeed = pose(vibrate, ctx.PZ, ctx.THREE, 1.7, { ...SHAKE, seed: 43 });
  const pulse = pose(vibrate, ctx.PZ, ctx.THREE, 1.7, { ...SHAKE, regularPulse: 1 });
  assert.notDeepEqual(otherSeed, seeded);
  assert.notDeepEqual(pulse, seeded);
  assert.deepEqual(pose(vibrate, ctx.PZ, ctx.THREE, 1.7, SHAKE), seeded);
});

test("disabled vibrate leaves the base pose untouched", () => {
  const ctx = harness.createContext();
  const vibrate = loadVibrate(ctx.PZ, ctx.THREE);
  const result = pose(vibrate, ctx.PZ, ctx.THREE, 4, { ...SHAKE, enabled: 0 });
  assert.deepEqual(result.position, [10, 0, 80]);
  assert.deepEqual(result.rotation, [0, 0, 0]);
});

test("relative vibrate scales by the base pose and never calls Math.random", () => {
  const ctx = harness.createContext();
  const vibrate = loadVibrate(ctx.PZ, ctx.THREE);
  const original = Math.random;
  Math.random = () => {
    throw new Error("Math.random must not influence Camera+ output");
  };
  try {
    const absolute = pose(vibrate, ctx.PZ, ctx.THREE, 2, SHAKE);
    const relative = pose(vibrate, ctx.PZ, ctx.THREE, 2, { ...SHAKE, relative: 1 });
    assert.notDeepEqual(relative, absolute);
  } finally {
    Math.random = original;
  }
});

test("Camera+ depth-of-field settings are read at the requested time only", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const object = ctx.registry.instantiate("zoidium:camera-plus/camera");
  const dof = object.properties.depthOfField;
  dof.enabled.set(1);
  dof.focusDistance.set(64);
  dof.aperture.set(2.5);
  dof.nearBlurLevel.set(50);
  const a = object.readDepthOfField(0);
  object.readDepthOfField(9);
  const b = object.readDepthOfField(0);
  assert.deepEqual(b, a);
  assert.equal(a.focusDistance, 64);
  assert.equal(a.aperture, 2.5);
  assert.equal(a.nearBlurLevel, 0.5);
  dof.enabled.set(0);
  assert.equal(object.readDepthOfField(0), null, "DOF off yields no pass settings");
  runtime.deactivate();
});

test("Camera+ update derives the pose from properties and time, not from the previous pose", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  const object = ctx.registry.instantiate("zoidium:camera-plus/camera");
  object.properties.position.set([0, 0, 80]);
  object.properties.rotation.set([0, 0, 0]);
  object.properties.vibrate.enablePosition.set(1);
  object.properties.vibrate.positionAmplitude.set([2, 2, 2]);
  object.properties.vibrate.positionFrequency.set(3);
  object.update(4);
  const atFour = [object.threeObj.position.x, object.threeObj.position.y, object.threeObj.position.z];
  object.update(10);
  object.update(4);
  assert.deepEqual([object.threeObj.position.x, object.threeObj.position.y, object.threeObj.position.z], atFour);
  runtime.deactivate();
});
