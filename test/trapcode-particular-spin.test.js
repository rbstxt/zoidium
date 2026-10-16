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

test("Displace Spin moves particles on seeded circles without rotating the sprite", () => {
  const { system, p } = setup();
  const baseline = system.simulateFrame(30);
  p.displace.spinAmplitude.set(80); p.displace.spinFrequency.set(1.3);
  const a = system.simulateFrame(30);
  assert.ok(a.spinOffsets.every(value => value === 0));
  for (let i = 0; i < a.count; i++) {
    const delta = Array.from(a.positions.slice(i * 3, i * 3 + 3), (value, axis) => value - baseline.positions[i * 3 + axis]);
    assert.ok(Math.abs(Math.hypot(...delta) - 80) < 1e-4, "amplitude is the orbit radius in scene units");
  }
  p.displace.spinFrequency.set(2.6);
  const b = system.simulateFrame(30);
  assert.notDeepEqual(a.positions, b.positions);
  assert.notDeepEqual(a.velocities, b.velocities, "motion alignment follows the orbit tangent");
  assert.deepEqual(a.phases, b.phases);
  assert.deepEqual(a.pids, b.pids);
  p.emitter.randomSeed.set(4321);
  assert.notDeepEqual(b.positions, system.simulateFrame(30).positions);
  p.displace.spinAmplitude.set(0);
  p.emitter.randomSeed.set(100);
  assert.ok(system.simulateFrame(30).spinOffsets.every(value => value === 0));
});

test("orbit radius, period, tangent and particle-age clock are deterministic", () => {
  const { spin } = setup();
  assert.equal(spin.orbit(null, 42, 3, 1), null);
  assert.equal(spin.orbit({ amplitude: 0, frequency: 2 }, 42, 3, 1), null);
  const settings = { amplitude: 12, frequency: 2 };
  const a = spin.orbit(settings, 42, 3, 0.17);
  const b = spin.orbit(settings, 42, 3, 0.67);
  assert.ok(Math.abs(Math.hypot(...a.offset) - 12) < 1e-12);
  assert.ok(Math.abs(Math.hypot(...a.velocity) - 12 * 4 * Math.PI) < 1e-10);
  assert.ok(Math.abs(a.offset.reduce((sum, v, i) => sum + v * a.velocity[i], 0)) < 1e-10);
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(a.offset[axis] - b.offset[axis]) < 1e-12);
  const later = spin.orbit(settings, 42, 3, 0.170001);
  for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs((later.offset[axis] - a.offset[axis]) / 0.000001 - a.velocity[axis]) < 0.002);
  assert.notDeepEqual(a, spin.orbit(settings, 42, 4, 0.17));
  assert.notDeepEqual(a, spin.orbit(settings, 43, 3, 0.17));
  assert.deepEqual(spin.orbit({ amplitude: 12, frequency: 0 }, 42, 3, 0).offset,
    spin.orbit({ amplitude: 12, frequency: 0 }, 42, 3, 90).offset);
});

test("continuous particles use their birth age for Displace Spin", () => {
  const { system, p, spin } = setup();
  p.emitter.emitterBehavior.set(0); p.emitter.burstCount.set(0); p.emitter.particlesPerSec.set(10);
  const baseline = system.simulateFrame(45);
  p.displace.spinAmplitude.set(8); p.displace.spinFrequency.set(0.7);
  const state = system.simulateFrame(45), table = system.simTable(0);
  for (let i = 0; i < state.count; i++) {
    const ev = table.eventFor(state.pids[i]);
    const expected = spin.orbit(spin.sample(system, 1.5, 30), ev.row.seed, ev.key, 1.5 - ev.birth);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(state.positions[i * 3 + axis] - baseline.positions[i * 3 + axis] - expected.offset[axis]) < 1e-5);
      assert.ok(Math.abs(state.velocities[i * 3 + axis] - baseline.velocities[i * 3 + axis] - expected.velocity[axis]) < 1e-5);
    }
  }
});

test("child trails originate on the parent's orbital path and inherit its tangent", () => {
  const { PZ, particular, system: parent, p } = setup();
  p.emitter.burstCount.set(1);
  p.displace.spinAmplitude.set(8); p.displace.spinFrequency.set(0.7);
  const child = new PZ.object3d.particular.system();
  child.load(null, particular);
  particular.systems.push(child);
  child.sceneRate = () => 30;
  Object.defineProperty(child, "parentSystem", { value: parent });
  const c = child.properties;
  c.emitter.emitFromParent.set(1); c.emitter.particlesPerSec.set(10);
  c.emitter.velocity.set(0); c.emitter.velocityRandom.set(0); c.emitter.directionSpread.set(0);
  c.emitter.inheritVelocity.set(0);
  c.particle.life.set(3); c.particle.lifeRandom.set(0);
  const stationary = child.simulateFrame(45);
  const table = child.simTable(0);
  assert.ok(stationary.count > 0);
  for (let i = 0; i < stationary.count; i++) {
    const birth = table.eventFor(stationary.pids[i]).birth;
    const expected = parent.simulateFrame(birth * 30);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(stationary.positions[i * 3 + axis] - expected.positions[axis]) < 1e-5);
    }
  }
  c.emitter.inheritVelocity.set(100);
  const inherited = child.simulateFrame(45), inheritedTable = child.simTable(0);
  for (let i = 0; i < inherited.count; i++) {
    const birth = inheritedTable.eventFor(inherited.pids[i]).birth;
    const expected = parent.simulateFrame(birth * 30);
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(inherited.velocities[i * 3 + axis] - expected.velocities[axis]) < 1e-5);
    }
  }
  child._simTables = parent._simTables = {};
  assert.deepEqual(child.simulateFrame(45), inherited);
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

test("repeat, reverse, sparse and cold-cache seeks produce identical orbital motion and orientations", () => {
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
  p.environment.turbulenceEnabled.set(1); p.environment.turbulenceAffectOrientation.set(120);
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
