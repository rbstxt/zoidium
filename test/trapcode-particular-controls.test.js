"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  return { PZ, particular, system, p: system.properties };
}

function burst(env) {
  const p = env.p;
  p.emitter.emitterBehavior.set(1);
  p.emitter.burstCount.set(12);
  p.emitter.randomSeed.set(417);
  p.emitter.direction.set([1, 0, 0]);
  p.emitter.velocity.set(100);
  return env;
}

function digest(state) {
  const hash = crypto.createHash("sha256");
  for (const key of ["positions", "velocities", "phases", "pids"]) hash.update(Buffer.from(state[key].buffer));
  return hash.digest("hex");
}

function repeatable(system, expected) {
  system.simulateFrame(75);
  system.simulateFrame(5);
  assert.deepEqual(system.simulateFrame(30), expected);
  system._simTables = {};
  assert.deepEqual(system.simulateFrame(30), expected);
}

test("default CPU particles retain the previous implementation's exact bytes", () => {
  const env = setup();
  assert.equal(digest(env.system.simulateFrame(30)), "679aa138a70af1bf195509f391a04e67fc5fdab4c8526ab18f595dcb22ea474e");
  env.p.physics.enabled.set(1);
  env.p.physics.drag.set(0.3);
  env.p.physics.gravity.set(25);
  assert.equal(digest(env.system.simulateFrame(30)), "a1f1034d5be96edc50a255d62b4d340181772a4c41008317df83734dfc1ee69a");
});

test("unsupported controls stay hidden and retain their saved values", () => {
  const { PZ, system, p } = setup();
  const C = PZ.object3d.particular.system;
  const fields = {
    particle: ["particleType", "setColor"],
    physics: ["flockingEnabled", "flockAttract", "flockSeparate", "flockAlign", "flockRangeValue", "flockFieldOfView"],
  };
  for (const [group, keys] of Object.entries(fields)) {
    for (const key of keys) {
      assert.equal(C[group + "Definitions"][key].visible, false);
      p[group][key].set(3);
    }
  }
  assert.equal(C.emitterDefinitions.emitterType.items, "point;box;sphere");
  assert.equal(C.displaceDefinitions.disperseStrengthOver.items, "off;life");
  p.emitter.emitterType.set(6);
  p.displace.disperseStrengthOver.set(3);
  const saved = JSON.parse(JSON.stringify(system));
  const restored = setup();
  restored.system.load(saved);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.system)), saved);
  assert.equal(restored.p.emitter.emitterType.get(0), 6);
  assert.equal(restored.p.displace.disperseStrengthOver.get(0), 3);
});

test("bounce boost keeps the property key and numeric rebound effect", () => {
  const { PZ, system, p } = burst(setup());
  assert.equal(PZ.object3d.particular.system.physicsDefinitions.bounceHeight.name, "Bounce boost");
  p.emitter.position.set([0, -1, 0]); p.emitter.velocity.set(0);
  p.physics.bounceEnabled.set(1); p.physics.bounceStrength.set(0);
  const a = system.simulateFrame(30);
  p.physics.bounceHeight.set(1000);
  const b = system.simulateFrame(30);
  assert.ok(b.positions[1] > a.positions[1]);
});

test("velocity distribution biases random initial speeds and keeps its neutral default", () => {
  const { system, p } = burst(setup());
  const baseline = system.simulateFrame(30);
  p.emitter.velocityDistribution.set(0);
  const slow = system.simulateFrame(30);
  p.emitter.velocityDistribution.set(1);
  const fast = system.simulateFrame(30);
  for (let i = 0; i < slow.count; i++) {
    assert.ok(slow.velocities[i * 3] <= baseline.velocities[i * 3]);
    assert.ok(fast.velocities[i * 3] >= baseline.velocities[i * 3]);
  }
  repeatable(system, fast);
  system.update(30);
  assert.equal(system.material.uniforms.velocityDistribution.value, 1);
  assert.equal(system.material.uniforms.velocityRandom.value, 0.2);
  assert.match(system.material.vertexShader, /baseVel \*= 1\.0 \+ 2\.0 \* velocityRandom/);
  p.emitter.velocityDistribution.set(0.5);
  assert.deepEqual(system.simulateFrame(30), baseline);
  p.emitter.velocityRandom.set(0);
  const noRandom = system.simulateFrame(30);
  p.emitter.velocityDistribution.set(0);
  assert.deepEqual(system.simulateFrame(30), noRandom);
});

for (const [axis, key] of ["driftX", "driftY", "driftZ"].entries()) {
  test(key + " offsets position by particle age without mass or drag", () => {
    const { system, p } = burst(setup());
    const baseline = system.simulateFrame(30);
    p.displace[key].set(80);
    const changed = system.simulateFrame(30);
    for (let i = 0; i < baseline.count; i++) {
      assert.ok(Math.abs(changed.positions[i * 3 + axis] - baseline.positions[i * 3 + axis] - 80) < 1e-4);
      assert.ok(Math.abs(changed.velocities[i * 3 + axis] - baseline.velocities[i * 3 + axis] - 80) < 1e-4);
    }
    repeatable(system, changed);
    system.update(30);
    assert.equal(system.material.uniforms.drift.value[["x", "y", "z"][axis]], 80);
    assert.match(system.material.vertexShader, /worldPos \+= drift \* age; vel \+= drift/);
    p.displace[key].set(0);
    assert.deepEqual(system.simulateFrame(30), baseline);
  });
}

test("air density scales resistance with a CPU fallback and leaves density one unchanged", () => {
  const { system, p } = burst(setup());
  p.physics.drag.set(0.2);
  const normal = system.simulateFrame(30);
  assert.equal(system.needsCPU(), false);
  p.environment.airDensity.set(0);
  const vacuum = system.simulateFrame(30);
  assert.equal(system.needsCPU(), true);
  p.environment.airDensity.set(2);
  const dense = system.simulateFrame(30);
  assert.ok(Math.abs(vacuum.velocities[0]) > Math.abs(normal.velocities[0]));
  assert.ok(Math.abs(normal.velocities[0]) > Math.abs(dense.velocities[0]));
  system.update(30);
  assert.equal(system.material.defines.USE_CPU, 1);
  repeatable(system, dense);
  p.environment.airDensity.set(1);
  assert.deepEqual(system.simulateFrame(30), normal);
});

test("disperse life mode samples the curve at each particle age and ignores hidden modes", () => {
  const { system, p } = burst(setup());
  p.displace.disperse.set(70);
  const baseline = system.simulateFrame(30);
  p.displace.disperseStrengthCurve.set([{ position: 0, color: "rgba(255,255,255,0)" }]);
  assert.deepEqual(system.simulateFrame(30), baseline, "off ignores the curve");
  p.displace.disperseStrengthOver.set(1);
  const zero = system.simulateFrame(30);
  assert.notDeepEqual(zero.positions, baseline.positions);
  p.displace.disperse.set(0);
  assert.deepEqual(system.simulateFrame(30), zero, "zero curve removes only disperse");
  p.displace.disperse.set(70);
  p.displace.disperseStrengthCurve.set([
    { position: 0, color: "rgba(255,255,255,0)" },
    { position: 1, color: "rgba(255,255,255,1)" },
  ]);
  const ramp = system.simulateFrame(30);
  assert.notDeepEqual(ramp.positions, zero.positions);
  assert.notDeepEqual(ramp.positions, baseline.positions);
  repeatable(system, ramp);
  system.update(30);
  assert.equal(system.material.defines.USE_CPU, 1);
  for (const mode of [2, 3]) {
    p.displace.disperseStrengthOver.set(mode);
    assert.deepEqual(system.simulateFrame(30), baseline);
  }
});

const appearance = [
  ["particle", "aspect", 0.3, "aspect", 0.3, /sp\.x \/= max\(aspect, 0\.01\)/],
  ["particle", "opacityRandom", 80, "opacityRandom", 0.8, /vColor\.a \*= 1\.0 - rand\(vec2\(wPid \+ controlSeed, 44\.0\)\) \* opacityRandom/],
  ["particle", "colorRandom", 90, "colorRandom", 0.9, /vColor\.rgb = mix\(vColor\.rgb, randomRgb, colorRandom\)/],
  ["displace", "turbulenceAffectSize", 70, "turbulenceSize", 0.7, /pointSize \*= fieldSize/],
  ["displace", "turbulenceAffectOpacity", 80, "turbulenceOpacity", 0.8, /vColor\.a \*= max\(0\.0, 1\.0 \+ field \* turbulenceOpacity\)/],
];
for (const [group, key, value, uniform, expected, expression] of appearance) {
  test(key + " uses the same appearance shader for CPU and GPU particles", () => {
    const { system, p } = burst(setup());
    const baseline = system.simulateFrame(30);
    p[group][key].set(value);
    assert.deepEqual(system.simulateFrame(30), baseline, "appearance does not alter physical state");
    for (const cpu of [0, 1]) {
      p.physics.enabled.set(cpu);
      system.update(30);
      assert.equal(system.material.uniforms[uniform].value, expected);
      assert.equal(system.material.defines.USE_CPU, cpu ? 1 : undefined);
      assert.match(system.material.vertexShader + system.material.fragmentShader, expression);
      if (cpu) assert.deepEqual(system.threeObj.geometry.attributes.position.array, baseline.positions);
    }
    repeatable(system, system.simulateFrame(30));
  });
}

test("old saves with absent controls keep neutral uniforms and finite simulation", () => {
  const { system, p } = burst(setup());
  for (const [group, key] of appearance) delete p[group][key];
  delete p.emitter.velocityDistribution;
  delete p.environment.airDensity;
  for (const key of ["driftX", "driftY", "driftZ", "disperseStrengthOver", "disperseStrengthCurve"]) delete p.displace[key];
  system.update(30);
  assert.equal(system.material.uniforms.aspect.value, 1);
  assert.equal(system.material.uniforms.velocityDistribution.value, 0.5);
  assert.equal(system.material.uniforms.opacityRandom.value, 0);
  assert.ok(system.simulateFrame(30).positions.every(Number.isFinite));
});
