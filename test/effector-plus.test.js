"use strict";

// Coverage for the Effector+ deformers: the extracted framework classes
// evaluate against a stub runtime, Twist/Warp deform math behaves, the
// create wrapper dispatches 7/8/9 with delegation + restore, and the Scene
// layer update runs the deform chain.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(projectRoot, "plugins/effector-plus");

function numberProperty(value) {
  return { get: () => value, set() {} };
}

function createPZ() {
  class StubObject {}
  class StubObjectList extends Array {}
  class StubObject3D extends StubObject {
    constructor() {
      super();
      this.properties = {
        defs: {},
        addAll(defs) { Object.assign(this.defs, defs); return this; },
        load() {},
      };
      this.children = [];
    }
    static create(type) {
      const t = new StubObject3D();
      t.type = type;
      return t;
    }
  }
  const PZ = {
    object: StubObject,
    objectList: StubObjectList,
    object3d: StubObject3D,
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3 }, create: (def) => ({ def }) },
    propertyList: function () { return {}; },
    layer: { scene: function () {} },
  };
  PZ.layer.scene.prototype = { update() { return "orig-update"; } };
  return PZ;
}

function evalSources(PZ, THREE = {}) {
  const g = globalThis;
  const keepPZ = g.PZ;
  const keepTHREE = g.THREE;
  g.PZ = PZ;
  g.THREE = THREE;
  try {
    for (const file of ["deform-framework.js", "deformer-objects.js"]) {
      const source = fs.readFileSync(path.join(pluginDir, file), "utf8");
      new Function("PZ", "THREE", source)(PZ, THREE);
    }
  } finally {
    if (keepPZ === undefined) delete g.PZ;
    else g.PZ = keepPZ;
    if (keepTHREE === undefined) delete g.THREE;
    else g.THREE = keepTHREE;
  }
}

function loadRuntime() {
  const full = path.join(pluginDir, "effector-runtime.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

test("framework and deformer classes evaluate against a stub runtime", () => {
  const PZ = createPZ();
  evalSources(PZ);
  for (const key of ["deform", "deformer", "twist", "warp", "voronoi"]) {
    assert.ok(PZ.object3d[key], key + " defined");
  }
  assert.equal(typeof PZ.object3d.deform.apply, "function");
  assert.equal(typeof PZ.object3d.deform.fieldWeight, "function");
  assert.equal(PZ.object3d.twist.prototype.defaultName, "Twist");
  assert.equal(PZ.object3d.voronoi.prototype.defaultName, "Voronoi Fracture");
});

test("twist rotates positions around the axis pivot", () => {
  const PZ = createPZ();
  evalSources(PZ);
  const tw = new PZ.object3d.twist();
  // Axis Y (1), raw angle pi/2, pivot at y=0 for points spanning -1..1.
  // theta = angle * ((y - pivot) / size); pair for Y is [2, 0] (z, x).
  tw.properties = {
    angle: numberProperty(Math.PI / 2),
    axis: numberProperty(1),
    offset: numberProperty(0),
  };
  const positions = new Float32Array([1, 1, 0]);
  const data = { min: [-1, -1, -1], max: [1, 1, 1] };
  const out = tw.deformPositions(positions, 0, data, null);
  const theta = (Math.PI / 2) * ((1 - 0) / 2);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  assert.ok(Math.abs(out[0] - (0 * sin + 1 * cos)) < 1e-6, "x rotated: " + out[0]);
  assert.ok(Math.abs(out[2] - (0 * cos - 1 * sin)) < 1e-6, "z rotated: " + out[2]);
  assert.equal(out[1], 1);
  // Zero angle returns the input untouched.
  tw.properties.angle = numberProperty(0);
  assert.equal(tw.deformPositions(positions, 0, data, null), positions);
});

test("warp is identity at zero strength and bends otherwise", () => {
  const PZ = createPZ();
  evalSources(PZ);
  const warp = new PZ.object3d.warp();
  warp.properties = {
    amount: numberProperty(0),
    axis: numberProperty(0),
    offset: numberProperty(0),
    field: numberProperty(0),
    fieldPosition: numberProperty([0, 0, 0]),
    fieldScale: numberProperty([1, 1, 1]),
  };
  const positions = new Float32Array([0.5, 0.2, 0.3]);
  const data = { min: [0, 0, 0], max: [1, 1, 1] };
  assert.equal(warp.deformPositions(positions, 0, data, null), positions);
  warp.properties.amount = numberProperty(90);
  const bent = warp.deformPositions(new Float32Array([0.5, 0.2, 0.3]), 0, data, null);
  assert.ok(bent[0] !== 0.5 || bent[1] !== 0.2, "warp displaces vertices");
});

test("create wrapper dispatches 7/8/9, delegates, and restores", () => {
  const PZ = createPZ();
  const getAsset = (kind, url) => {
    const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
    return fs.readFileSync(path.join(projectRoot, key), "utf8");
  };
  const runtime = loadRuntime();
  const originalCreate = PZ.object3d.create;
  const context = { PZ, window: { THREE: {} }, getAsset };
  runtime.activate(context);
  for (const [type, key] of [[7, "twist"], [8, "warp"], [9, "voronoi"]]) {
    const inst = PZ.object3d.create(type);
    assert.ok(inst instanceof PZ.object3d[key], "create(" + type + ")");
    assert.equal(inst.type, type);
  }
  const other = PZ.object3d.create(0);
  assert.equal(other.type, 0);
  assert.ok(!(other instanceof PZ.object3d.twist));
  // Scene layer update runs the deform chain.
  let applied = null;
  PZ.object3d.deform.apply = (layer, time) => { applied = { layer, time }; };
  const fakeLayer = {};
  const out = PZ.layer.scene.prototype.update.call(fakeLayer, 42);
  assert.equal(out, "orig-update");
  assert.deepEqual(applied, { layer: fakeLayer, time: 42 });
  runtime.deactivate();
  assert.equal(PZ.object3d.create, originalCreate);
});

test("manifest declares the 3D EFFECTS picker entries", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  const byType = new Map(manifest.objectTypes.map((e) => [e.type, e]));
  for (const [type, name] of [[7, "Twist"], [8, "Warp"], [9, "Voronoi Fracture"]]) {
    assert.ok(byType.has(type), name + " entry declared");
    assert.ok(byType.get(type).list.length >= 1);
  }
});
