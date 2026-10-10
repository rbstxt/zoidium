"use strict";

// Fluid motion options of the Trapcode Particular CPU simulation: every fluid
// control (and gravity/wind/air resistance while fluid mode is on) must change
// the simulated motion, new controls must default to the legacy behavior so
// old projects render identically, and results must stay deterministic.

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

// Fluid enabled with the vortex field placed at the emitter, so the vortex,
// tilt, rotate, core size and offset controls all act on live particles.
function fluidSystem(PZ, configure) {
  return makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.set(120);
    p.emitter.randomSeed.set(4242);
    p.emitter.velocity.set(150);
    p.emitter.velocityRandom.set(10);
    p.emitter.direction.set([0, -1, 0]);
    p.emitter.directionSpread.set(20);
    p.particle.life.set(2);
    p.particle.lifeRandom.set(0);
    p.physics.fluidEnabled.set(1);
    p.physics.vortexStrength.set(100);
    p.spherical.position.set([0, 0, 0]);
    p.spherical.radius.set(400);
    if (configure) configure(p);
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

function differsAtFrame60(PZ, baseConfigure, mutate) {
  const base = snapshot(fluidSystem(PZ, baseConfigure).simulateFrame(60));
  const altered = snapshot(fluidSystem(PZ, (p) => {
    if (baseConfigure) baseConfigure(p);
    mutate(p);
  }).simulateFrame(60));
  assert.notDeepStrictEqual(altered.positions, base.positions);
}

const swirlOn = (p) => p.physics.fluidSwirlEnabled.set(1);
const buoyant = (p) => p.physics.fluidForceType.set(1);
const gravityOn = (p) => p.physics.gravity.set(200);

test("every fluid control changes the simulated motion", () => {
  const PZ = loadSystemModule();
  // Previously dead controls: buoyancy did nothing and the vortex always used
  // the spherical radius.
  differsAtFrame60(PZ, buoyant, (p) => p.physics.buoyancy.set(40));
  differsAtFrame60(PZ, null, (p) => p.physics.fluidForceType.set(1));
  differsAtFrame60(PZ, null, (p) => p.physics.vortexStrength.set(250));
  differsAtFrame60(PZ, null, (p) => p.physics.vortexCoreSize.set(100));
  differsAtFrame60(PZ, null, (p) => p.physics.fluidVortexTilt.set(45));
  differsAtFrame60(PZ, null, (p) => p.physics.fluidVortexRotate.set(90));
  differsAtFrame60(PZ, null, (p) => p.physics.fluidOffset.set([150, 0, 0]));
  differsAtFrame60(PZ, null, swirlOn);
  differsAtFrame60(PZ, swirlOn, (p) => p.physics.fluidSwirlScale.set(400));
  differsAtFrame60(PZ, swirlOn, (p) => p.physics.fluidSwirlStrength.set(300));
  differsAtFrame60(PZ, swirlOn, (p) => p.physics.fluidSeed.set(7));
  differsAtFrame60(PZ, null, (p) => p.physics.fluidViscosity.set(0.5));
  differsAtFrame60(PZ, null, (p) => p.physics.fluidTimeScale.set(50));
  differsAtFrame60(PZ, gravityOn, (p) => p.physics.gravityDirection.set([1, 0, 0]));
});

test("fluid mode still honours gravity, wind and air resistance", () => {
  const PZ = loadSystemModule();
  differsAtFrame60(PZ, null, (p) => p.physics.gravity.set(200));
  differsAtFrame60(PZ, null, (p) => p.environment.windX.set(50));
  differsAtFrame60(PZ, null, (p) => p.physics.drag.set(0.5));
});

test("new controls default to the legacy behavior, so old saves render identically", () => {
  const PZ = loadSystemModule();
  const withDefaults = snapshot(fluidSystem(PZ).simulateFrame(60));
  // A project saved before the new controls lacks their properties entirely.
  const legacy = fluidSystem(PZ);
  for (const key of [
    "fluidForceType", "fluidOffset", "fluidSwirlEnabled", "fluidSwirlScale",
    "fluidSwirlStrength", "fluidSeed", "fluidVortexTilt", "fluidVortexRotate",
    "fluidViscosity", "fluidTimeScale", "gravityDirection",
  ]) delete legacy.properties.physics[key];
  assert.deepStrictEqual(snapshot(legacy.simulateFrame(60)), withDefaults);

  // With fluid motion off, every new control is gated and changes nothing.
  const calm = makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.set(120);
    p.emitter.velocity.set(150);
    p.particle.life.set(2);
  });
  const calmState = snapshot(calm.simulateFrame(60));
  const stirred = makeSystem(PZ, (p) => {
    p.emitter.particlesPerSec.set(120);
    p.emitter.velocity.set(150);
    p.particle.life.set(2);
    p.physics.fluidForceType.set(1);
    p.physics.buoyancy.set(40);
    p.physics.fluidSwirlEnabled.set(1);
    p.physics.fluidSwirlScale.set(400);
    p.physics.fluidSwirlStrength.set(300);
    p.physics.fluidSeed.set(7);
    p.physics.vortexStrength.set(250);
    p.physics.vortexCoreSize.set(100);
    p.physics.fluidVortexTilt.set(45);
    p.physics.fluidVortexRotate.set(90);
    p.physics.fluidOffset.set([150, 0, 0]);
    p.physics.fluidViscosity.set(0.5);
    p.physics.fluidTimeScale.set(50);
    // Gravity direction is not fluid-gated (it steers gravity on every path),
    // so it stays at its default here; its effect is covered above.
  });
  assert.deepStrictEqual(snapshot(stirred.simulateFrame(60)).positions, calmState.positions);
});

test("fluid results are deterministic under repeat, sparse and cold-cache evaluation", () => {
  const PZ = loadSystemModule();
  for (const configure of [
    (p) => {
      p.physics.fluidSwirlEnabled.set(1);
      p.physics.fluidSwirlScale.set(200);
      p.physics.fluidVortexTilt.set(30);
      p.physics.fluidVortexRotate.set(60);
      p.physics.fluidViscosity.set(0.2);
    },
    (p) => {
      p.physics.fluidForceType.set(1);
      p.physics.buoyancy.set(20);
      p.physics.fluidSwirlEnabled.set(1);
      p.physics.gravity.set(100);
      p.physics.gravityDirection.set([0.3, 1, -0.2]);
    },
  ]) {
    const warm = fluidSystem(PZ, configure);
    const frames = [0, 15, 30, 45, 60, 90];
    const expected = new Map(frames.map((f) => [f, snapshot(warm.simulateFrame(f))]));
    for (const f of [60, 30, 90, 0, 45, 15]) {
      assert.deepStrictEqual(snapshot(warm.simulateFrame(f)), expected.get(f), `reverse frame ${f}`);
    }
    for (const f of frames) {
      const cold = fluidSystem(PZ, configure);
      cold._simTables = null;
      assert.deepStrictEqual(snapshot(cold.simulateFrame(f)), expected.get(f), `cold frame ${f}`);
    }
  }
});
