"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PATCH_MARKER,
  DEPTH_POLYGON_OFFSET_FACTOR,
  DEPTH_POLYGON_OFFSET_UNITS,
  install,
  installSceneMode,
} = require("../plugins/core/shadow-quality");

function createTHREE() {
  class Object3D {}
  class Mesh extends Object3D {}
  class MeshDepthMaterial {
    constructor(options) {
      Object.assign(this, options);
    }
  }
  return { Mesh, MeshDepthMaterial, RGBADepthPacking: 3201 };
}

test("the shared depth material is an offset RGBA depth material", () => {
  const THREE = createTHREE();
  assert.equal(install(THREE), true);

  const mesh = new THREE.Mesh();
  const depth = mesh.customDepthMaterial;
  assert.ok(depth instanceof THREE.MeshDepthMaterial);
  assert.equal(depth.depthPacking, THREE.RGBADepthPacking);
  assert.equal(depth.polygonOffset, true);
  assert.equal(depth.polygonOffsetFactor, DEPTH_POLYGON_OFFSET_FACTOR);
  assert.equal(depth.polygonOffsetUnits, DEPTH_POLYGON_OFFSET_UNITS);
});

test("every mesh shares one depth material", () => {
  const THREE = createTHREE();
  install(THREE);

  const a = new THREE.Mesh();
  const b = new THREE.Mesh();
  assert.equal(a.customDepthMaterial, b.customDepthMaterial);
});

test("a value set on a mesh wins over the shared material", () => {
  const THREE = createTHREE();
  install(THREE);

  const mesh = new THREE.Mesh();
  const other = new THREE.Mesh();
  const own = new THREE.MeshDepthMaterial({ polygonOffset: false });
  mesh.customDepthMaterial = own;

  assert.equal(mesh.customDepthMaterial, own);
  assert.notEqual(other.customDepthMaterial, own);
  assert.equal(other.customDepthMaterial.polygonOffset, true);
});

test("undefined and null restore the shared material", () => {
  const THREE = createTHREE();
  install(THREE);

  const mesh = new THREE.Mesh();
  const shared = mesh.customDepthMaterial;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({});
  mesh.customDepthMaterial = undefined;
  assert.equal(mesh.customDepthMaterial, shared);

  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({});
  mesh.customDepthMaterial = null;
  assert.equal(mesh.customDepthMaterial, shared);
});

test("copying another mesh's depth material keeps the shared default", () => {
  const THREE = createTHREE();
  install(THREE);

  const source = new THREE.Mesh();
  const target = new THREE.Mesh();
  target.customDepthMaterial = source.customDepthMaterial;
  assert.equal(target.customDepthMaterial, source.customDepthMaterial);
});

test("install is idempotent and does not redefine the accessor", () => {
  const THREE = createTHREE();
  assert.equal(install(THREE), true);
  const first = Object.getOwnPropertyDescriptor(THREE.Mesh.prototype, "customDepthMaterial");

  assert.equal(install(THREE), false);
  const second = Object.getOwnPropertyDescriptor(THREE.Mesh.prototype, "customDepthMaterial");
  assert.equal(second.get, first.get);
  assert.equal(second.set, first.set);
  assert.equal(THREE.Mesh.prototype[PATCH_MARKER], true);
});

test("install refuses to run without a usable THREE", () => {
  assert.equal(install(null), false);
  assert.equal(install(undefined), false);
  assert.equal(install({}), false);
});

test("the depth shader offsets the RGBA value sampled by spot/directional shadows", () => {
  const THREE = createTHREE();
  install(THREE);
  const depth = new THREE.Mesh().customDepthMaterial;
  assert.equal(depth.extensions.derivatives, true);
  const shader = { fragmentShader: 'gl_FragColor = packDepthToRGBA( gl_FragCoord.z );' };
  depth.onBeforeCompile(shader);
  assert.match(shader.fragmentShader, /dFdx\( gl_FragCoord.z \)/);
  assert.match(shader.fragmentShader, /dFdy\( gl_FragCoord.z \)/);
  assert.doesNotMatch(shader.fragmentShader, /packDepthToRGBA\( gl_FragCoord.z \)/);
  assert.match(shader.fragmentShader, /2\.0 \* max/);
});

test("the offset patch preserves alpha clipping and leaves distance shaders alone", () => {
  const { offsetPackedDepth } = require('../plugins/core/shadow-quality');
  const shader = { fragmentShader: '#include <alphatest_fragment>\ngl_FragColor = packDepthToRGBA( gl_FragCoord.z );' };
  offsetPackedDepth(shader);
  assert.ok(shader.fragmentShader.startsWith('#include <alphatest_fragment>'));
  const distance = { fragmentShader: 'gl_FragColor = packDepthToRGBA( dist );' };
  offsetPackedDepth(distance);
  assert.equal(distance.fragmentShader, 'gl_FragColor = packDepthToRGBA( dist );');
});

test("scene modes preserve native 17e05e6^ depth selection, current packing and mesh overrides", () => {
  const { migrateProject } = require("../zoidium/project-compatibility.js");
  const THREE = createTHREE();
  class Scene {
    load() { this.threeObj = new THREE.Mesh(); }
    toJSON() { return { type: 4 }; }
  }
  install(THREE);
  assert.equal(installSceneMode({ layer: { scene: Scene } }), true);
  assert.equal(installSceneMode({ layer: { scene: Scene } }), false);
  const fresh = new Scene(); fresh.load();
  assert.equal(fresh.toJSON().zoidiumShadowMode, "current");
  const shared = new THREE.Mesh().customDepthMaterial;
  for (const explicit of [undefined, "legacy", "current"]) {
    const data = { type: 4, ...(explicit ? { zoidiumShadowMode: explicit } : {}) };
    const migrated = migrateProject({ sequence: { videoTracks: [{ clips: [{ object: data }] }] } });
    const scene = new Scene(); scene.load(migrated.sequence.videoTracks[0].clips[0].object);
    const copy = new Scene(); copy.load(JSON.parse(JSON.stringify(scene)));
    const mode = explicit || "legacy";
    assert.equal(copy.toJSON().zoidiumShadowMode, mode);
    const group = { parent: scene.threeObj }, mesh = new THREE.Mesh(); mesh.parent = group;
    // Before 17e05e6 Mesh.customDepthMaterial was undefined. Three r91 then
    // selected its own RGBA MeshDepthMaterial, with no polygon or packed offset.
    assert.equal(mesh.customDepthMaterial, mode === "legacy" ? undefined : shared);
    const native = new THREE.MeshDepthMaterial({ depthPacking: 3201, polygonOffset: false });
    const depth = mesh.customDepthMaterial || native;
    assert.equal(depth.depthPacking, 3201);
    assert.equal(depth.polygonOffset, mode === "current");
    const shader = { fragmentShader: "packDepthToRGBA( gl_FragCoord.z )" };
    depth.onBeforeCompile?.(shader);
    assert.equal(shader.fragmentShader.includes("dFdx"), mode === "current");
    const own = new THREE.MeshDepthMaterial({ depthPacking: 3200, polygonOffset: false });
    mesh.customDepthMaterial = own;
    assert.equal(mesh.customDepthMaterial, own, "explicit mesh material wins in both modes");
    mesh.customDepthMaterial = null;
    assert.equal(mesh.customDepthMaterial, mode === "legacy" ? undefined : shared);
    mesh.parent = fresh.threeObj;
    assert.equal(mesh.customDepthMaterial, shared, "newly generated or reparented meshes follow their scene");
    mesh.parent = scene.threeObj;
    scene.load(fresh.toJSON());
    mesh.parent = scene.threeObj;
    assert.equal(mesh.customDepthMaterial, shared);
    scene.load(copy.toJSON()); mesh.parent = scene.threeObj;
    assert.equal(mesh.customDepthMaterial, mode === "legacy" ? undefined : shared, "history reload restores the mode");
  }
});
