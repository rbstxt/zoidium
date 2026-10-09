"use strict";

// Determinism of the Trapcode Particular CPU simulation: the particle state
// at a project frame is a pure function of (properties, seed, frame). Forward,
// sparse, direct and reverse evaluation, a warm or cold row cache, and parent
// emission must all produce identical particles.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const suiteDir = path.join(projectRoot, "plugins/trapcode-suite");
const FPS = 30;

function interpolate(keys, frame) {
  if (frame <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (frame >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    if (frame <= keys[i][0]) {
      const [f0, v0] = keys[i - 1];
      const [f1, v1] = keys[i];
      const k = (frame - f0) / (f1 - f0);
      return Array.isArray(v0) ? v0.map((x, j) => x + (v1[j] - x) * k) : v0 + (v1 - v0) * k;
    }
  }
  return last[1];
}

// Minimal stand-in for CM3 properties: static value or linear keyframes.
class StubProperty {
  constructor(definition) {
    this.definition = definition;
    const value = definition.group && definition.objects
      ? definition.objects.map((child) => child.value)
      : definition.value;
    this.value = Array.isArray(value) ? value.slice() : value;
    this.keys = null;
  }
  get animated() {
    return !!this.keys;
  }
  get(frame) {
    return this.keys ? interpolate(this.keys, frame) : this.value;
  }
  set(value) {
    this.value = Array.isArray(value) ? value.slice() : value;
    this.keys = null;
  }
  animate(keys) {
    this.keys = keys.map((key) => [key[0], key[1]]);
  }
  toJSON() {
    return this.keys ? { animated: true, keyframes: this.keys } : this.value;
  }
}

function loadSystemModule() {
  const PZ = {};
  const THREE = {};
  const common = fs.readFileSync(path.join(suiteDir, "trapcode-common.js"), "utf8");
  new Function("PZ", "THREE", common)(PZ, THREE);

  class StubObject {
    constructor() {
      this.onParentChanged = { watch() {} };
      this.parent = null;
      this.children = [];
    }
    getParentOfType(type) {
      let node = this.parent;
      while (node) {
        if (node instanceof type) return node;
        node = node.parent;
      }
      return null;
    }
    tryGetParentOfType(type) {
      return this.getParentOfType(type);
    }
  }
  PZ.object = StubObject;
  PZ.object3d = class extends StubObject {};
  PZ.objectList = class extends Array {
    constructor() {
      super();
    }
  };
  PZ.property = {
    type: {
      NUMBER: 0, VECTOR2: 1, VECTOR3: 2, VECTOR4: 3, COLOR: 4, GRADIENT: 5, CURVE: 10,
      OPTION: 6, TEXT: 7, ASSET: 8, LIST: 9, SHADER: 11,
    },
    create: (definition) => new StubProperty(definition),
  };
  PZ.propertyList = class {
    constructor(definitions, parent) {
      Object.defineProperty(this, "parent", { value: parent || null, writable: true });
      if (!definitions) return;
      for (const key of Object.keys(definitions)) {
        const def = definitions[key];
        this[key] = def instanceof StubProperty || def instanceof PZ.propertyList
          ? def
          : PZ.property.create(def);
      }
    }
    toJSON() {
      const out = {};
      for (const key of Object.keys(this)) out[key] = this[key];
      return out;
    }
  };
  PZ.asset = { type: { IMAGE: 0, AV: 3 } };

  class Vec {
    constructor(...values) {
      this.values = values;
    }
    set(...values) {
      this.values = values;
      return this;
    }
  }
  class Attribute {
    constructor(array, itemSize) {
      this.array = array;
      this.itemSize = itemSize;
      this.needsUpdate = false;
    }
  }
  class Geometry {
    constructor() {
      this.attributes = {};
    }
    addAttribute(name, attribute) {
      this.attributes[name] = attribute;
    }
    dispose() {}
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
    }
  }
  class Material {
    constructor(params) {
      Object.assign(this, params || {});
      this.defines = (params && params.defines) || {};
    }
    dispose() {}
  }
  THREE.Object3D = class extends Mesh {};
  THREE.Points = Mesh;
  THREE.BufferGeometry = Geometry;
  THREE.BufferAttribute = Attribute;
  THREE.Material = Material;
  THREE.ShaderMaterial = Material;
  THREE.Vector2 = Vec;
  THREE.Vector3 = Vec;
  THREE.Vector4 = Vec;
  THREE.DataTexture = class {
    constructor(data, width, height) {
      this.image = { data: data, width: width, height: height };
    }
    dispose() {}
  };
  THREE.NormalBlending = 1;
  THREE.AdditiveBlending = 2;
  THREE.LinearFilter = 1;
  THREE.RGBAFormat = 1;

  const source = fs.readFileSync(path.join(suiteDir, "particular.js"), "utf8");
  new Function("PZ", "THREE", source)(PZ, THREE);
  return PZ;
}

function makeSystem(PZ, configure) {
  const system = new PZ.object3d.particular.system();
  system.sceneRate = () => FPS;
  if (configure) configure(system.properties);
  return system;
}

// A continuous emitter with animated rate, gravity, drag, bounce and turbulence.
function busySystem(PZ) {
  return makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.animate([[0, 120], [90, 240]]);
    p.emitter.randomSeed.set(4242);
    p.emitter.velocity.set(150);
    p.emitter.velocityRandom.set(30);
    p.emitter.directionSpread.set(40);
    p.emitter.direction.set([0, -1, 0]);
    p.emitter.emitterSize.set(40);
    p.emitter.emitterType.set(1);
    p.particle.life.set(1.5);
    p.particle.lifeRandom.set(40);
    p.physics.gravity.set(200);
    p.physics.drag.set(0.5);
    p.physics.bounceEnabled.set(1);
    p.physics.bounceStrength.set(60);
    p.environment.turbulenceEnabled.set(1);
    p.environment.turbulenceAffectPosition.set(60);
    p.environment.windX.set(20);
  });
}

function snapshot(state) {
  return {
    count: state.count,
    positions: Array.from(state.positions),
    velocities: Array.from(state.velocities),
    phases: Array.from(state.phases),
    pids: Array.from(state.pids),
  };
}

test("continuous particles are identical under forward, sparse, direct and reverse evaluation", () => {
  const PZ = loadSystemModule();
  const forward = busySystem(PZ);
  const frames = [];
  for (let f = 0; f <= 90; f++) frames.push(f);
  const forwardStates = new Map(frames.map((f) => [f, snapshot(forward.simulateFrame(f))]));

  const sparseSystem = busySystem(PZ);
  for (const f of [0, 7, 30, 61, 90]) {
    assert.deepStrictEqual(snapshot(sparseSystem.simulateFrame(f)), forwardStates.get(f), `sparse frame ${f}`);
  }

  for (const f of [45, 90]) {
    const direct = busySystem(PZ);
    assert.deepStrictEqual(snapshot(direct.simulateFrame(f)), forwardStates.get(f), `direct frame ${f}`);
  }

  const reverse = busySystem(PZ);
  for (let f = 90; f >= 0; f--) {
    assert.deepStrictEqual(snapshot(reverse.simulateFrame(f)), forwardStates.get(f), `reverse frame ${f}`);
  }

  const repeated = busySystem(PZ);
  for (const f of [30, 30, 30]) {
    assert.deepStrictEqual(snapshot(repeated.simulateFrame(f)), forwardStates.get(30), `repeat frame ${f}`);
  }
});

test("row cache on and off give identical output", () => {
  const PZ = loadSystemModule();
  const cached = busySystem(PZ);
  const cold = busySystem(PZ);
  for (const f of [0, 12, 40, 75, 120]) {
    const warm = snapshot(cached.simulateFrame(f));
    cold._simTables = null;
    assert.deepStrictEqual(snapshot(cold.simulateFrame(f)), warm, `frame ${f}`);
  }
});

test("checkpoint reuse matches cold integration at sub-step and checkpoint boundaries", () => {
  const PZ = loadSystemModule();
  const warm = busySystem(PZ);
  // Quarter-frame steps at 30 fps are 1/120 s, which straddles the 1/60 s sub-step grid.
  const times = [];
  for (let f = 0; f <= 120; f += 0.25) times.push(f);
  for (const f of times) {
    const hot = snapshot(warm.simulateFrame(f));
    const cold = busySystem(PZ);
    assert.deepStrictEqual(snapshot(cold.simulateFrame(f)), hot, `frame ${f}`);
  }
});

test("a property change invalidates the cache and changes the state deterministically", () => {
  const PZ = loadSystemModule();
  const system = busySystem(PZ);
  const before = snapshot(system.simulateFrame(60));
  system.properties.physics.gravity.set(-300);
  const after = snapshot(system.simulateFrame(60));
  assert.notDeepStrictEqual(after.positions, before.positions);
  const fresh = busySystem(PZ);
  fresh.properties.physics.gravity.set(-300);
  assert.deepStrictEqual(snapshot(fresh.simulateFrame(60)), after);
});

test("continuous emitter reaches steady state at time zero from the pre-roll", () => {
  const PZ = loadSystemModule();
  const system = makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.set(100);
    p.particle.life.set(2);
    p.particle.lifeRandom.set(0);
  });
  const count = system.simulateFrame(0).count;
  assert.ok(count >= 190 && count <= 210, `expected about 200 live particles, got ${count}`);
});

test("animated emission rate integrates on the grid: no births while the rate is zero", () => {
  const PZ = loadSystemModule();
  const system = makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.animate([[0, 0], [30, 0], [30.5, 200]]);
    p.particle.life.set(1);
    p.particle.lifeRandom.set(0);
  });
  assert.equal(system.simulateFrame(15).count, 0, "no emission before the rate turns on");
  assert.ok(system.simulateFrame(60).count > 0, "particles after the rate turns on");
  assert.equal(system.simulateFrame(60).count, system.simulateFrame(60).count);
});

test("explode and burst emit deterministic groups", () => {
  const PZ = loadSystemModule();
  const explode = makeSystem(PZ, (p) => {
    p.emitter.emitterBehavior.set(1);
    p.emitter.burstCount.set(50);
    p.emitter.randomSeed.set(77);
    p.particle.life.set(1);
    p.particle.lifeRandom.set(0);
  });
  assert.equal(explode.simulateFrame(0).count, 50);
  assert.equal(explode.simulateFrame(45).count, 0, "explode particles die after life");
  assert.deepStrictEqual(snapshot(explode.simulateFrame(10)), snapshot(explode.simulateFrame(10)));

  const burst = makeSystem(PZ, (p) => {
    p.emitter.emitterBehavior.set(2);
    p.emitter.burstCount.set(30);
    p.emitter.burstInterval.set(1);
    p.emitter.randomSeed.set(9);
    p.particle.life.set(0.5);
    p.particle.lifeRandom.set(0);
  });
  const fromBurst = snapshot(burst.simulateFrame(45));
  const freshBurst = makeSystem(PZ, (p) => {
    p.emitter.emitterBehavior.set(2);
    p.emitter.burstCount.set(30);
    p.emitter.burstInterval.set(1);
    p.emitter.randomSeed.set(9);
    p.particle.life.set(0.5);
    p.particle.lifeRandom.set(0);
  });
  assert.deepStrictEqual(snapshot(freshBurst.simulateFrame(45)), fromBurst);
  assert.ok(fromBurst.count > 0, "a burst is alive shortly after its start");
});

test("parent emission depends only on the parent state at the child birth", () => {
  const PZ = loadSystemModule();
  const container = new PZ.object3d.particular();
  const parent = new PZ.object3d.particular.system();
  const child = new PZ.object3d.particular.system();
  parent.parent = container;
  child.parent = container;
  container.systems.push(parent, child);
  for (const system of [parent, child]) system.sceneRate = () => FPS;
  parent.properties.emitter.particlesPerSec.set(60);
  parent.properties.particle.life.set(1.2);
  parent.properties.particle.lifeRandom.set(0);
  parent.properties.emitter.randomSeed.set(11);
  child.properties.emitter.emitFromParent.set(1);
  child.properties.emitter.parentSystemIndex.set(0);
  child.properties.emitter.particlesPerSec.set(40);
  child.properties.emitter.inheritVelocity.set(50);
  child.properties.particle.life.set(0.8);
  child.properties.emitter.randomSeed.set(12);

  const frames = [10, 20, 33, 45, 60];
  const expected = new Map(frames.map((f) => [f, snapshot(child.simulateFrame(f))]));
  assert.ok(expected.get(45).count > 0, "children spawn from live parents");

  const replay = new PZ.object3d.particular();
  const parentB = new PZ.object3d.particular.system();
  const childB = new PZ.object3d.particular.system();
  parentB.parent = replay;
  childB.parent = replay;
  replay.systems.push(parentB, childB);
  for (const system of [parentB, childB]) system.sceneRate = () => FPS;
  parentB.properties.emitter.particlesPerSec.set(60);
  parentB.properties.particle.life.set(1.2);
  parentB.properties.particle.lifeRandom.set(0);
  parentB.properties.emitter.randomSeed.set(11);
  childB.properties.emitter.emitFromParent.set(1);
  childB.properties.emitter.parentSystemIndex.set(0);
  childB.properties.emitter.particlesPerSec.set(40);
  childB.properties.emitter.inheritVelocity.set(50);
  childB.properties.particle.life.set(0.8);
  childB.properties.emitter.randomSeed.set(12);
  for (const f of [60, 45, 33, 20, 10]) {
    assert.deepStrictEqual(snapshot(childB.simulateFrame(f)), expected.get(f), `parent-emission frame ${f}`);
  }
});

test("per-evaluation limits bound far seeks and keep the output finite", () => {
  const PZ = loadSystemModule();
  const system = makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.set(50);
    p.particle.life.set(10000);
    p.particle.lifeRandom.set(0);
  });
  const far = system.simulateFrame(1e7);
  assert.ok(far.count <= PZ.object3d.particular.system.simulation.SIM.MAX_ALIVE);
  for (let i = 0; i < far.positions.length; i++) assert.ok(Number.isFinite(far.positions[i]));
  assert.equal(system.simulateFrame(-40).count, system.simulateFrame(0).count, "negative frames clamp to zero");
});

test("update() writes CPU particles and GPU uniforms through the render path", () => {
  const PZ = loadSystemModule();
  const system = busySystem(PZ);
  system.update(45);
  const expected = system.simulateFrame(45);
  const attrs = system.threeObj.geometry.attributes;
  const alive = Array.from(attrs.life.array).filter((v) => v >= 0).length;
  assert.equal(alive, expected.count);
  assert.equal(system.material.defines.USE_CPU, 1);
  assert.deepStrictEqual(Array.from(attrs.position.array.slice(0, expected.count * 3)), Array.from(expected.positions));

  const gpu = makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.set(50);
  });
  gpu.update(10);
  assert.equal(gpu.material.defines.USE_CPU, undefined);
  assert.equal(gpu.material.uniforms.audioLevel.value, 1, "reactors off keep the neutral level");
});
