"use strict";

// Effector integration: the Twist, Warp, and Voronoi Fracture classes on a
// stub CM3 object model with a minimal three.js stand-in. Covers mesh-level
// evaluation, pristine-source handling, determinism, caching, disposal,
// deformer frames, scene patching, and legacy numeric type migration.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { _test } = require("../plugins/scene-plus/scene-plus.js");
const core = require("../plugins/scene-plus/effector-core.js");

const projectRoot = path.resolve(__dirname, "..");

class BufferAttribute {
  constructor(array, itemSize, normalized) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.normalized = Boolean(normalized);
    this.version = 0;
  }

  set needsUpdate(value) {
    if (value) this.version += 1;
  }
}

class BufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.groups = [];
    this.disposeCount = 0;
    this.boundingSphereCount = 0;
  }

  addAttribute(name, attribute) {
    this.attributes[name] = attribute;
    return this;
  }

  setIndex(index) {
    this.index = index;
  }

  addGroup(start, count, materialIndex) {
    this.groups.push({ start, count, materialIndex });
  }

  computeVertexNormals() {
    const position = this.attributes.position;
    if (!this.attributes.normal) {
      this.addAttribute("normal", new BufferAttribute(new Float32Array(position.count * 3), 3));
    }
    const normal = this.attributes.normal.array;
    const p = position.array;
    for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
      const ab = [0, 1, 2].map((c) => p[(vertex + 1) * 3 + c] - p[vertex * 3 + c]);
      const ac = [0, 1, 2].map((c) => p[(vertex + 2) * 3 + c] - p[vertex * 3 + c]);
      const face = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const length = Math.hypot(...face) || 1;
      for (let offset = 0; offset < 3; offset += 1) {
        for (let c = 0; c < 3; c += 1) normal[(vertex + offset) * 3 + c] = face[c] / length;
      }
    }
  }

  computeBoundingSphere() {
    this.boundingSphereCount += 1;
  }

  dispose() {
    this.disposeCount += 1;
  }
}

class Material {
  constructor() {
    this.side = 0;
    this.vertexColors = false;
    this.disposeCount = 0;
    this.uniforms = undefined;
  }

  clone() {
    const copy = new Material();
    copy.side = this.side;
    if (this.uniforms) {
      copy.uniforms = {};
      for (const [name, uniform] of Object.entries(this.uniforms)) {
        copy.uniforms[name] = { value: uniform.value };
      }
    }
    return copy;
  }

  dispose() {
    this.disposeCount += 1;
  }
}

const THREE = {
  BufferAttribute,
  BufferGeometry,
  Material,
  DoubleSide: 2,
  Object3D: class {},
  Vector3: class { constructor(x, y, z) { Object.assign(this, { x, y, z }); } },
  Sphere: class { constructor(center, radius) { Object.assign(this, { center, radius }); } },
};

function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function translation(x, y, z) {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function nodeAt(elements) {
  return { matrixWorld: { elements } };
}

function makeMesh(positions, material) {
  const geometry = new BufferGeometry();
  geometry.addAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  return {
    isMesh: true,
    geometry,
    material: material || new Material(),
    matrixWorld: { elements: identity() },
    userData: {},
    frustumCulled: true,
    traverse(callback) {
      callback(this);
    },
  };
}

function cubePositions() {
  const corners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  const out = [];
  for (const face of faces) for (const vertex of face) out.push(...corners[vertex]);
  return out;
}

// Minimal CM3-shaped object model: properties with get(frame), lists, and a group base.
function createHarness() {
  class PropertyList {
    constructor(definitions, parent) {
      this.parent = parent;
      this.addAll(definitions || {});
    }

    addAll(definitions) {
      for (const [name, definition] of Object.entries(definitions || {})) {
        if (this[name]) continue;
        const property = {
          ...definition,
          value: definition.value,
          get() {
            return this.value;
          },
        };
        this[name] = property;
      }
    }

    load() {}
  }

  class ObjectList extends Array {
    constructor(parent) {
      super();
      this.parent = parent;
      this.onListChanged = { watch() {}, unwatch() {} };
    }
  }

  class Object3D {
    constructor() {
      this.properties = new PropertyList({}, this);
      this.children = [this.properties];
    }

    parentChanged() {}
  }

  const PZ = {
    object3d: Object3D,
    objectList: ObjectList,
    propertyList: PropertyList,
    property: { type: { NUMBER: 0, OPTION: 1, VECTOR3: 2, LIST: 3, TEXT: 4 } },
  };

  class GroupObject extends Object3D {
    constructor() {
      super();
      this.threeObj = null;
      this.properties.addAll(GroupObject.propertyDefinitions);
      this.customProperties = new ObjectList(this);
      this.objects = new ObjectList(this);
      this.children.push(this.customProperties, this.objects);
    }
  }
  GroupObject.propertyDefinitions = {
    name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Group" },
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    position: { dynamic: true, name: "Position", type: PZ.property.type.VECTOR3, value: [0, 0, 0] },
    rotation: { dynamic: true, name: "Rotation", type: PZ.property.type.VECTOR3, value: [0, 0, 0] },
    scale: { dynamic: true, name: "Scale", type: PZ.property.type.VECTOR3, value: [1, 1, 1] },
    eulerOrder: { name: "Rotation order", type: PZ.property.type.LIST, value: "XYZ", items: "XYZ" },
  };
  PZ.object3d.group = GroupObject;
  return PZ;
}

function setProperty(owner, name, value) {
  owner.properties[name].get = () => value;
}

function deformerFor(mesh, effector, frame, node = null, polygonCount = 1) {
  const deformer = _test.getMeshDeformer(THREE);
  deformer.deformMesh(mesh, [{ effector, node }], frame, polygonCount);
  return deformer;
}

test("Twist, Warp, and Voronoi Fracture expose the Effector property sets and defaults", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const Warp = _test.createWarpClass(PZ, THREE);
  const Voronoi = _test.createVoronoiClass(PZ, THREE);
  for (const instance of [new Twist(), new Warp(), new Voronoi()]) {
    assert.ok(instance.properties.position);
    assert.ok(instance.properties.rotation);
    assert.ok(instance.properties.scale);
    assert.equal(instance.properties.curveQuality ? instance.properties.curveQuality.value : 1, 1);
  }
  const twist = new Twist();
  assert.equal(twist.properties.polygonCount.value, 16);
  assert.equal(twist.properties.polygonCount.max, 256);
  const voronoi = new Voronoi();
  assert.equal(voronoi.properties.cells.value, 24);
  assert.equal(voronoi.properties.seed.value, 1);
  assert.equal(voronoi.properties.closed.value, 1);
  assert.equal(voronoi.properties.closed.items, "open;closed");
  assert.equal(voronoi.defaultName, "Voronoi Fracture");
  assert.equal(voronoi.properties.spin.scaleFactor, Math.PI / 180);
});

test("mesh evaluation applies Twist to a copy and leaves the source geometry untouched", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", Math.PI / 2);
  setProperty(twist, "axis", 1);
  setProperty(twist, "offset", 0);
  const positions = [1, -1, 0, 1, 1, 0, 0.5, 0, 0.25];
  const mesh = makeMesh(positions);
  const source = mesh.geometry;
  const sourceArray = source.attributes.position.array;
  const pristine = Array.from(sourceArray);

  deformerFor(mesh, twist, 0);

  const expected = Float32Array.from(positions);
  core.twistPositions(expected, Math.PI / 2, 1, 0);
  assert.notEqual(mesh.geometry, source, "a working geometry is used");
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), Array.from(expected));
  assert.deepEqual(Array.from(sourceArray), pristine, "source positions are never written");
  assert.equal(mesh.geometry.disposeCount, 0);
});

test("evaluation depends only on the frame, not on the previous frame or playback order", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  twist.properties.angle.get = (frame) => frame * 0.2;
  setProperty(twist, "axis", 1);
  const positions = [1, -1, 0, 1, 1, 0, 0.5, 0, 0.25, -1, 0.3, 0.7];
  const mesh = makeMesh(positions);
  const read = (frame) => {
    deformerFor(mesh, twist, frame, null, 1);
    return Array.from(mesh.geometry.attributes.position.array);
  };
  const first = read(5);
  read(0);
  read(9);
  assert.deepEqual(read(5), first);
});

test("zero angle restores the original geometry and releases the working copy", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", Math.PI / 3);
  const mesh = makeMesh([1, -1, 0, 1, 1, 0]);
  const source = mesh.geometry;
  deformerFor(mesh, twist, 0);
  const working = mesh.geometry;
  assert.notEqual(working, source);

  const deformer = _test.getMeshDeformer(THREE);
  deformer.deformMesh(mesh, [], 1, 1);
  assert.equal(mesh.geometry, source);
  assert.equal(working.disposeCount, 1, "working copy is disposed");
});

test("the mesh deformer keeps all state off userData, so repeater clones do not copy it", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", 0.5);
  const mesh = makeMesh([1, -1, 0, 1, 1, 0]);
  deformerFor(mesh, twist, 0);
  assert.deepEqual(mesh.userData, {});
});

test("a deformer whose node transform is singular is skipped without NaN", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", Math.PI / 2);
  const singular = identity();
  singular[0] = 0;
  const positions = [1, -1, 0, 1, 1, 0];
  const mesh = makeMesh(positions);
  deformerFor(mesh, twist, 0, nodeAt(singular));
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), positions);
});

test("a deformer's own transform is respected: moving the mesh and its deformer together changes nothing", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", Math.PI / 2);
  setProperty(twist, "axis", 1);
  const positions = [1, -1, 0, 1, 1, 0, -1, 0.5, 0.25];

  const plain = makeMesh(positions);
  deformerFor(plain, twist, 0, nodeAt(identity()));
  const plainResult = Array.from(plain.geometry.attributes.position.array);

  const moved = makeMesh(positions);
  moved.matrixWorld.elements = translation(10, 0, 0);
  deformerFor(moved, twist, 0, nodeAt(translation(10, 0, 0)));
  const movedResult = Array.from(moved.geometry.attributes.position.array);
  // Offsetting both the mesh and the deformer by the same translation gives
  // the same local-space result, and the output is in mesh space again.
  for (let index = 0; index < plainResult.length; index += 1) {
    assert.ok(Math.abs(plainResult[index] - movedResult[index]) < 1e-5);
  }
});

test("Voronoi Fracture caches its topology across animation and rebuilds only when topology inputs change", () => {
  const PZ = createHarness();
  const Voronoi = _test.createVoronoiClass(PZ, THREE);
  const voronoi = new Voronoi();
  setProperty(voronoi, "cells", 8);
  setProperty(voronoi, "seed", 3);
  voronoi.properties.distance.get = (frame) => frame * 0.05;
  voronoi.properties.spin.get = (frame) => frame * 0.01;
  const mesh = makeMesh(cubePositions());

  const library = _test.library();
  const original = library.fracture.buildVoronoiFracture;
  let builds = 0;
  library.fracture.buildVoronoiFracture = (...args) => {
    builds += 1;
    return original(...args);
  };
  try {
    deformerFor(mesh, voronoi, 0);
    const firstGeometry = mesh.geometry;
    deformerFor(mesh, voronoi, 3);
    deformerFor(mesh, voronoi, 1);
    assert.equal(builds, 1, "animating distance and spin does not rebuild the cells");
    assert.equal(mesh.geometry, firstGeometry, "the working geometry is reused");
    setProperty(voronoi, "cells", 12);
    deformerFor(mesh, voronoi, 4);
    assert.equal(builds, 2, "changing the cell count rebuilds the cells");
  } finally {
    library.fracture.buildVoronoiFracture = original;
  }
});

test("Voronoi Fracture output is deterministic for a frame and clones its material for double-sided pieces", () => {
  const PZ = createHarness();
  const Voronoi = _test.createVoronoiClass(PZ, THREE);
  const voronoi = new Voronoi();
  setProperty(voronoi, "cells", 6);
  setProperty(voronoi, "seed", 2);
  setProperty(voronoi, "distance", 0.5);
  setProperty(voronoi, "colors", 1);
  const original = new Material();
  const mesh = makeMesh(cubePositions(), original);
  deformerFor(mesh, voronoi, 0);
  const firstPositions = Array.from(mesh.geometry.attributes.position.array);
  assert.ok(mesh.geometry.attributes.color, "fragments carry piece colours");
  assert.notEqual(mesh.material, original, "fragments use a cloned material");
  assert.equal(mesh.material.side, THREE.DoubleSide);
  assert.equal(mesh.material.vertexColors, true);

  deformerFor(mesh, voronoi, 7);
  deformerFor(mesh, voronoi, 0);
  assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), firstPositions);

  const deformer = _test.getMeshDeformer(THREE);
  const clone = mesh.material;
  deformer.deformMesh(mesh, [], 0, 1);
  assert.equal(mesh.material, original, "the original material is restored");
  assert.equal(clone.disposeCount, 1, "the clone is disposed");
});

test("regenerated source geometry replaces the cached pristine mesh", () => {
  const deformer = require("../plugins/scene-plus/effector-mesh.js").createMeshDeformer(THREE);
  const mesh = makeMesh([1, -1, 0, 1, 1, 0, 0, 0, 1]);
  const effector = { deformPositions(positions) { for (let i = 0; i < positions.length; i++) positions[i] *= 2; return positions; } };
  const chain = [{ effector, node: nodeAt(identity()) }];
  deformer.deformMesh(mesh, chain, 0, 1);
  const replacement = makeMesh([3, -1, 0, 3, 1, 0, 0, 0, 1]).geometry;
  mesh.geometry = replacement;
  deformer.deformMesh(mesh, chain, 1, 1);
  assert.equal(mesh.geometry.attributes.position.array[0], 6);
  deformer.deformMesh(mesh, [], 1, 1);
  assert.equal(mesh.geometry, replacement);
});

test("switching smooth subdivision on and off disposes the superseded working geometry", () => {
  const PZ = createHarness();
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", 0.4);
  const mesh = makeMesh([1, -1, 0, 1, 1, 0, 0, 0, 1]);
  deformerFor(mesh, twist, 0, null, 4);
  const smooth = mesh.geometry;
  assert.equal(smooth.attributes.position.count, 12, "four polygons per triangle");
  deformerFor(mesh, twist, 0, null, 1);
  assert.equal(smooth.disposeCount, 1, "the smooth working copy is released");
  assert.equal(mesh.geometry.attributes.position.count, 3);
});

test("the scene update patch deforms meshes after CM3 updates and restores them on deactivate", () => {
  const PZ = createHarness();
  class Scene {
    constructor() {
      this.objects = [];
    }

    update() {
      this.updated = true;
    }
  }
  PZ.layer = { scene: Scene };
  const Twist = _test.createTwistClass(PZ, THREE);
  const twist = new Twist();
  setProperty(twist, "angle", Math.PI / 2);
  const mesh = makeMesh([1, -1, 0, 1, 1, 0]);
  twist.objects = [{ threeObj: mesh }];
  twist.threeObj = { matrixWorld: { elements: identity() }, children: [] };
  const scene = new Scene();
  scene.objects.push(twist);

  const support = _test.createDeformationSupport(PZ, THREE);
  scene.update(0);
  assert.notDeepEqual(Array.from(mesh.geometry.attributes.position.array), [1, -1, 0, 1, 1, 0]);
  support.deactivate();
  assert.equal(Scene.prototype.__zoidiumEffectorDeformPatch, undefined);
});

test("legacy numeric effector types migrate to the namespaced classes", () => {
  const migrate = _test.migrateLegacyEffectorRecord;
  assert.equal(migrate({ type: 7 }).type, "zoidium:repeater/twist");
  assert.equal(migrate({ type: 8 }).type, "zoidium:repeater/warp");
  assert.equal(migrate({ type: 9 }).type, "zoidium:repeater/voronoi-fracture");
  assert.equal(migrate({ type: "zoidium:repeater/warp" }).type, "zoidium:repeater/warp");
  assert.equal(migrate({ type: 0 }).type, 0, "CM3 core numeric types are not remapped");
});

test("activation registers Voronoi Fracture beside the other effectors, each with a legacy migration", () => {
  const PZ = createHarness();
  class Scene {}
  Scene.prototype.update = function () {};
  PZ.layer = { scene: Scene };
  const registered = [];
  const object3d = {
    registerClass(definition) {
      registered.push(definition);
      return () => {};
    },
  };
  const context = { PZ, window: { THREE }, object3d, getAsset: () => null };
  const plugin = require("../plugins/scene-plus/scene-plus.js");
  const state = {};
  plugin.activate.call(state, context);
  const types = registered.map((definition) => definition.type);
  for (const type of [
    "zoidium:repeater/twist",
    "zoidium:repeater/warp",
    "zoidium:repeater/voronoi-fracture",
  ]) {
    assert.ok(types.includes(type), type);
  }
  for (const definition of registered.filter((d) => /twist|warp|voronoi/.test(d.type))) {
    assert.equal(typeof definition.migrate, "function", "migrate is installed");
    assert.equal(definition.migrate({ type: 9 }).type !== 9, true);
  }
  plugin.deactivate.call(state);
});

test("the bundled library evaluates through the asset loader with sibling requires", () => {
  const getAsset = (kind, url) => {
    const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
    return fs.readFileSync(path.join(projectRoot, key), "utf8");
  };
  const loaded = _test.loadLibraryFromAssets(getAsset);
  assert.equal(typeof loaded.core.twistPositions, "function");
  assert.equal(typeof loaded.fracture.buildVoronoiFracture, "function");
  assert.equal(typeof loaded.mesh.createMeshDeformer, "function");
  const stage = loaded.fracture.buildVoronoiFracture({ positions: Float32Array.from(cubePositions()) }, { cells: 4, seed: 1, closed: true });
  assert.equal(stage.error, undefined);
});

function controlledJobs() {
  const entries = new Map(), users = new Map();
  return {
    entries,
    request(mesh, key, input) {
      let entry = entries.get(key);
      if (!entry) { entry = { status: "queued", input }; entries.set(key, entry); }
      users.set(mesh, entry); return entry;
    },
    release(mesh) { users.delete(mesh); },
    complete() {
      const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
      for (const entry of entries.values()) if (entry.status === "queued") {
        entry.value = evaluateMesh(entry.input); entry.status = "done";
      }
    },
    pending(meshes) { return Array.from(meshes).filter(mesh => users.get(mesh)?.status === "queued"); },
    dispose() { entries.clear(); users.clear(); },
  };
}

test("pending fracture renders the source, then publishes the exact completed input", () => {
  const jobs = controlledJobs();
  const deformer = require("../plugins/scene-plus/effector-mesh.js").createMeshDeformer(THREE, jobs);
  const Voronoi = _test.createVoronoiClass(createHarness(), THREE), effector = new Voronoi();
  setProperty(effector, "cells", 8); setProperty(effector, "seed", 3);
  const mesh = makeMesh(cubePositions()), source = mesh.geometry, originalMaterial = mesh.material;
  const chain = [{ effector, node: nodeAt(identity()) }];
  deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(mesh.geometry, source);
  assert.equal(mesh.material, originalMaterial);
  jobs.complete(); deformer.deformMesh(mesh, chain, 0, 1);
  assert.ok(mesh.geometry.attributes.position.count > source.attributes.position.count);
  const completed = mesh.geometry, clone = mesh.material;
  setProperty(effector, "seed", 9);
  deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(mesh.geometry, source, "changed input never shows stale fractured geometry");
  assert.equal(mesh.material, originalMaterial);
  assert.equal(clone.disposeCount, 0, "the pending build retains its compiled material");
  jobs.complete(); deformer.deformMesh(mesh, chain, 0, 1);
  assert.notEqual(mesh.geometry, completed);
  assert.equal(mesh.material, clone);
  assert.equal(completed.disposeCount, 1);
  const latest = mesh.geometry;
  setProperty(effector, "seed", 17);
  deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(mesh.geometry, source);
  setProperty(effector, "seed", 9);
  deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(mesh.geometry, latest, "returning to the completed key restores its geometry immediately");
  deformer.dispose();
  assert.equal(mesh.geometry, source); assert.equal(mesh.material, originalMaterial);
  assert.equal(clone.disposeCount, 1);
});

test("source replacement retains the fracture material while awaiting new geometry", () => {
  const jobs = controlledJobs();
  const deformer = require("../plugins/scene-plus/effector-mesh.js").createMeshDeformer(THREE, jobs);
  const Voronoi = _test.createVoronoiClass(createHarness(), THREE), effector = new Voronoi();
  setProperty(effector, "cells", 4);
  const mesh = makeMesh(cubePositions()), chain = [{ effector, node: nodeAt(identity()) }];
  deformer.deformMesh(mesh, chain, 0, 1);jobs.complete();deformer.deformMesh(mesh, chain, 0, 1);
  const clone = mesh.material;
  const replacement = makeMesh(cubePositions().map(value => value * 2)).geometry;
  mesh.geometry = replacement;
  deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(mesh.geometry, replacement); assert.equal(clone.disposeCount, 0);
  jobs.complete();deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(mesh.material, clone);
  deformer.restoreMesh(mesh);assert.equal(mesh.geometry, replacement);
});

test("source attribute revisions invalidate queued topology inputs without mutating their snapshots", () => {
  const jobs = controlledJobs();
  const deformer = require("../plugins/scene-plus/effector-mesh.js").createMeshDeformer(THREE, jobs);
  const Voronoi = _test.createVoronoiClass(createHarness(), THREE), effector = new Voronoi();
  const mesh = makeMesh(cubePositions()), chain = [{ effector, node: nodeAt(identity()) }];
  const uv = new BufferAttribute(new Float32Array(24 * 3).fill(0.25), 2);mesh.geometry.addAttribute("uv", uv);
  deformer.deformMesh(mesh, chain, 0, 1);
  const old = Array.from(jobs.entries.values())[0].input;
  uv.array.fill(0.75);uv.needsUpdate = true;
  deformer.deformMesh(mesh, chain, 0, 1);
  assert.equal(jobs.entries.size, 2);
  assert.equal(old.base.attributes.uv.array[0], 0.25);
  assert.equal(Array.from(jobs.entries.values())[1].input.base.attributes.uv.array[0], 0.75);
  deformer.dispose();
});

test("indexed smooth meshes respect the 400k triangle cap before worker dispatch", () => {
  const jobs = controlledJobs();
  const deformer = require("../plugins/scene-plus/effector-mesh.js").createMeshDeformer(THREE, jobs);
  const Twist = _test.createTwistClass(createHarness(), THREE), effector = new Twist();
  const mesh = makeMesh([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  mesh.geometry.setIndex(new BufferAttribute(new Uint16Array(60000).map((_, i) => i % 3), 1));
  deformer.deformMesh(mesh, [{ effector, node: nodeAt(identity()) }], 0, 50);
  const entry = Array.from(jobs.entries.values())[0];
  assert.equal(entry.input.polygonCount, 20);
  assert.equal(entry.input.base.index.length / 3 * entry.input.polygonCount, 400000);
  deformer.dispose();
});
