"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env.js");

function setup(mode = 1) {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "particular.js"]);
  THREE.Material = class { dispose() {} };
  THREE.DataTexture.prototype.dispose = () => {};
  // The shared fixture's properties deliberately omit serialization. These
  // tests need the same value-only cache signatures as native properties.
  PZ.property.prototype.toJSON = function () { return this.get(); };
  const particular = new PZ.object3d.particular();
  particular.load(mode === undefined ? {} : { spinMode: mode });
  const system = particular.systems[0];
  system.sceneRate = () => 30;
  const p = system.properties;
  p.emitter.emitterBehavior.set(1); p.emitter.burstCount.set(8);
  p.emitter.velocity.set(20); p.emitter.direction.set([1, 0, 0]);
  p.emitter.velocityRandom.set(0); p.emitter.directionSpread.set(0);
  p.particle.life.set(3); p.particle.lifeRandom.set(0);
  return { PZ, particular, system, p, spin: PZ.trapcode.particularSpin };
}
function motion(state) {
  return { count: state.count, positions: Array.from(state.positions), velocities: Array.from(state.velocities),
    phases: Array.from(state.phases), pids: Array.from(state.pids) };
}

test("missing saved modes stay legacy; every new Particular picker preset opts in and saves its mode", () => {
  const { particular, PZ } = setup(0);
  particular.load({ systems: [{ properties: {} }] });
  assert.equal(particular.spinMode, 0);
  assert.equal(particular.toJSON().spinMode, 0);
  particular.load({ spinMode: 1 });
  assert.equal(particular.spinMode, 1);
  assert.equal(particular.toJSON().spinMode, 1);
  particular.load({ spinMode: "1" });
  assert.equal(particular.spinMode, 0, "only the saved numeric mode opts in");
  assert.equal(new PZ.object3d.particular().spinMode, 0);
  const manifest = JSON.parse(fs.readFileSync(require.resolve("../plugins/trapcode-suite/manifest.json"), "utf8"));
  for (const preset of manifest.objectTypes[0].list) assert.equal(preset.data.spinMode, 1);
  assert.equal(manifest.objectClasses[0].defaultData.spinMode, 1);
});

test("legacy nonzero spin controls keep the same particles and shader path", () => {
  const { system, p, spin } = setup(0);
  const baseline = motion(system.simulateFrame(30));
  p.emitter.rotationSpeed.set(90); p.displace.spinAmplitude.set(80); p.displace.spinFrequency.set(1.3);
  p.environment.turbulenceEnabled.set(1); p.environment.turbulenceAffectOrientation.set(120);
  assert.deepEqual(motion(system.simulateFrame(30)), baseline);
  assert.equal(system.simulateFrame(30).spinOffsets, undefined);
  assert.equal(spin.active(system, 30, 30), false);
  system.update(30);
  assert.equal(system.material.defines.USE_PARTICULAR_SPIN, undefined);
});

test("new zero controls retain the original motion and GPU path", () => {
  const legacy = setup(0), current = setup(1);
  assert.deepEqual(motion(current.system.simulateFrame(30)), motion(legacy.system.simulateFrame(30)));
  assert.equal(current.system.needsCPU(), false);
  current.system.update(30);
  assert.equal(current.system.material.defines.USE_PARTICULAR_SPIN, undefined);
  assert.equal(current.system.material.defines.USE_CPU, undefined);
});

test("spin amplitude and frequency produce bounded, seeded per-particle orientation noise", () => {
  const { system, p } = setup();
  p.displace.spinAmplitude.set(80); p.displace.spinFrequency.set(1.3);
  const a = system.simulateFrame(30);
  assert.ok(a.spinOffsets.some(value => value !== 0));
  assert.ok(a.spinOffsets.every(value => Math.abs(value) <= 80 * Math.PI / 180));
  assert.notDeepEqual(Array.from(a.spinOffsets.slice(0, 3)), Array.from(a.spinOffsets.slice(3, 6)));
  p.displace.spinFrequency.set(2.6);
  const b = system.simulateFrame(30);
  assert.notDeepEqual(a.spinOffsets, b.spinOffsets);
  assert.deepEqual(motion(a), motion(b), "orientation noise does not displace the particles");
  p.emitter.randomSeed.set(4321);
  assert.notDeepEqual(b.spinOffsets, system.simulateFrame(30).spinOffsets);
  p.displace.spinAmplitude.set(0);
  assert.ok(system.simulateFrame(30).spinOffsets.every(value => value === 0));
});

test("air orientation follows the seeded, wind-advected turbulence field without changing position influence", () => {
  const { system, p, spin } = setup();
  p.environment.turbulenceEnabled.set(1);
  const baseline = motion(system.simulateFrame(30));
  p.environment.turbulenceAffectOrientation.set(120);
  const state = system.simulateFrame(30);
  assert.deepEqual(motion(state), baseline);
  assert.ok(state.spinOffsets.some(value => value !== 0));
  const settings = spin.sample(system, 1, 30);
  const a = spin.orientation(settings, 42, 7, 1, [12, 3, -8]);
  settings.wind = [20, 0, 0];
  assert.notDeepEqual(spin.orientation(settings, 42, 7, 1, [12, 3, -8]), a);
  settings.complexity = 1;
  assert.notDeepEqual(spin.orientation(settings, 42, 7, 1, [12, 3, -8]), a);
  p.environment.turbulenceEnabled.set(0);
  assert.ok(system.simulateFrame(30).spinOffsets.every(value => value === 0));
});

test("emitter speed integrates over project time and rotates newborn emission, not existing trajectories", () => {
  const { system, p, spin } = setup();
  p.emitter.emitterBehavior.set(0); p.emitter.burstCount.set(0); p.emitter.particlesPerSec.set(10);
  const baseline = system.simulateFrame(45);
  p.emitter.rotationSpeed.set(90);
  const state = system.simulateFrame(45), table = system.simTable(0);
  assert.ok(Math.abs(table.emitterRotationAt(1) - 90) < 1e-10);
  assert.notDeepEqual(state.positions, baseline.positions);
  const angle = spin.emitterAngle(table.rowAtTime(1).spin, 42, 1, table.emitterRotationAt(1));
  const direction = spin.rotateXY(20, 0, angle);
  assert.ok(Math.abs(direction[0]) < 1e-10); assert.ok(Math.abs(direction[1] - 20) < 1e-10);
  assert.equal(table.emitterRotationAt(-1), 0);
  p.emitter.emitterBehavior.set(1); p.emitter.burstCount.set(8);
  assert.deepEqual(motion(system.simulateFrame(45)), motion(setup(0).system.simulateFrame(45)),
    "a burst born at zero is unaffected by subsequent emitter rotation");
});

test("animated emitter angular speed retains its integrated angle when the current speed becomes zero", () => {
  const { system, p } = setup();
  const speed = p.emitter.rotationSpeed;
  speed.animated = true;
  speed.get = frame => frame <= 30 ? 90 : 0;
  speed.toJSON = () => "animated speed";
  p.emitter.emitterBehavior.set(0);
  assert.equal(system.needsCPU(), true);
  const table = system.simTable(0);
  assert.ok(Math.abs(table.emitterRotationAt(2) - 90.75) < 1e-8);
  assert.ok(Math.abs(table.emitterRotationAt(3) - table.emitterRotationAt(2)) < 1e-8);
});

test("repeat, reverse, sparse and cold-cache seeks produce identical particle orientations", () => {
  const { system, p } = setup();
  p.displace.spinAmplitude.set(80); p.displace.spinFrequency.set(1.3);
  p.environment.turbulenceEnabled.set(1); p.environment.turbulenceAffectOrientation.set(120);
  p.environment.windX.set(20); p.emitter.rotationSpeed.set(70);
  const expected = system.simulateFrame(45);
  for (const frame of [2, 100, 15, 45]) system.simulateFrame(frame);
  assert.deepEqual(system.simulateFrame(45), expected);
  system._simTables = {};
  assert.deepEqual(system.simulateFrame(45), expected);
});

test("CPU rendering uploads orientation attributes, clears hidden slots, and invalidates tables on a mode change", () => {
  const { particular, system, p } = setup();
  p.displace.spinAmplitude.set(80);
  const table = system.simTable(0);
  system.update(30);
  assert.equal(system.material.defines.USE_PARTICULAR_SPIN, 1);
  const offsets = system.threeObj.geometry.attributes.spinOffset;
  assert.ok(offsets.array.some(value => value !== 0));
  assert.equal(offsets.needsUpdate, true);
  system.writeCPU({ count: 0 });
  assert.ok(system.threeObj.geometry.attributes.spinOffset.array.every(value => value === 0));
  particular.spinMode = 0;
  assert.notEqual(system.simTable(0), table);
  system.update(30);
  assert.equal(system.material.defines.USE_PARTICULAR_SPIN, undefined);
});
