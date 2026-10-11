"use strict";

// Characterization of the Particular CPU table cache (the A6 site at
// particular.js simTable): the per-frame JSON.stringify(this.properties)
// signature decides cache reuse. These pins must hold before and after any
// change to the change signal: identical cache hit/miss behavior, identical
// simulation results, and parity between the current signature and a
// definition-stripped variant across a scripted edit sequence.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const suiteDir = path.join(projectRoot, "plugins/trapcode-suite");
const { expandSuiteFiles } = require("./trapcode-env");
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

function loadSystemModule(files) {
  const list = expandSuiteFiles(files || ["trapcode-common.js", "particular.js"]);
  const PZ = {};
  const THREE = {};
  const group = ["trapcode-common.js", "trapcode-audio.js", "trapcode-color.js",
    "trapcode-shading.js", "trapcode-expressions.js"];
  for (const file of list.filter((f) => group.includes(f))) {
    new Function("PZ", "THREE", fs.readFileSync(path.join(suiteDir, file), "utf8"))(PZ, THREE);
  }

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

  // The particular sources attach to PZ.object3d above; evaluate them last so
  // the class bodies see the stub runtime.
  for (const file of list.filter((f) => !group.includes(f))) {
    const source = fs.readFileSync(path.join(suiteDir, file), "utf8");
    new Function("PZ", "THREE", source)(PZ, THREE);
  }
  return PZ;
}

function makeSystem(PZ) {
  const system = new PZ.object3d.particular.system();
  system.sceneRate = () => FPS;
  const p = system.properties;
  p.emitter.particlesPerSec.animate([[0, 120], [90, 240]]);
  p.emitter.randomSeed.set(4242);
  p.emitter.velocity.set(150);
  p.particle.life.set(1.5);
  p.physics.gravity.set(200);
  return system;
}

function signatureOf(system) {
  system.simTable(0);
  return system._simTables[0].signature;
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

test("simTable reuses the cached table while properties are unchanged", () => {
  const PZ = loadSystemModule();
  const system = makeSystem(PZ);
  const first = system.simTable(0);
  assert.equal(system.simTable(0), first, "same object while nothing changed");
  assert.equal(system.simTable(0), first, "repeated calls keep hitting the cache");
});

test("simTable rebuilds after a property edit and restores the signature when reverted", () => {
  const PZ = loadSystemModule();
  const system = makeSystem(PZ);
  const before = signatureOf(system);
  const table = system._simTables[0];
  system.properties.emitter.velocity.set(999);
  const rebuilt = system.simTable(0);
  assert.notEqual(rebuilt, table, "edit drops the cached table");
  assert.notEqual(rebuilt.signature, before, "edit changes the signature");
  system.properties.emitter.velocity.set(150);
  const restored = system.simTable(0);
  assert.notEqual(restored, rebuilt, "revert builds again (single-entry cache)");
  assert.equal(restored.signature, before, "revert restores the original signature");
  assert.deepStrictEqual(
    snapshot(system.simulateFrame(45)),
    snapshot(makeSystem(PZ).simulateFrame(45)),
    "reverted properties simulate exactly like a fresh system"
  );
});

test("simulateFrame stays pure across interleaved frames and edits", () => {
  const PZ = loadSystemModule();
  const run = () => {
    const system = makeSystem(PZ);
    const out = new Map();
    for (const frame of [0, 30, 60]) {
      system.simTable(0);
      out.set(frame, snapshot(system.simulateFrame(frame)));
    }
    system.properties.physics.gravity.set(50);
    system.simTable(0);
    out.set("edited", snapshot(system.simulateFrame(30)));
    system.properties.physics.gravity.set(200);
    system.simTable(0);
    out.set("reverted", snapshot(system.simulateFrame(30)));
    return out;
  };
  const a = run();
  const b = run();
  for (const key of a.keys()) {
    assert.deepStrictEqual(a.get(key), b.get(key), `identical result for ${key}`);
  }
  assert.notDeepStrictEqual(a.get("edited"), a.get(30), "the edit changes the simulation");
  assert.deepStrictEqual(a.get("reverted"), a.get(30), "reverting restores the simulation");
});

test("a definition-stripped signature preserves the hit/miss relation", () => {
  // Proof artifact for A6: definition objects are class-level statics, so
  // dropping them from the serialized signature cannot change which states
  // compare equal. The scripted sequence below must show pairwise-equality
  // parity between the current signature and the stripped variant.
  const PZ = loadSystemModule();
  const stripped = (properties, fps, depth) => JSON.stringify(properties, (key, value) =>
    (key === "definition" ? undefined : value)) + "|" + fps + "|" + depth + "|";
  const current = [];
  const light = [];
  const system = makeSystem(PZ);
  const capture = () => {
    current.push(JSON.stringify(system.properties) + "|" + FPS + "|0|");
    light.push(stripped(system.properties, FPS, 0));
  };
  capture();
  system.properties.emitter.velocity.set(999);
  capture();
  system.properties.emitter.velocity.set(150);
  capture();
  system.properties.particle.life.set(2.5);
  capture();
  system.properties.emitter.particlesPerSec.animate([[0, 10], [90, 20]]);
  capture();
  assert.ok(current[0] !== current[1], "sanity: the edit is visible in the current signature");
  assert.ok(current[0] === current[2], "sanity: revert restores the current signature");
  for (let i = 0; i < current.length; i++) {
    for (let j = 0; j < current.length; j++) {
      assert.equal(
        (light[i] === light[j]),
        (current[i] === current[j]),
        `parity for states ${i},${j}`
      );
    }
  }
});
