"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createContext, readPluginSource } = require("./camera-plus-harness.js");

function setup() {
  const { THREE } = createContext();
  THREE.AdditiveBlending = 2;
  THREE.NoBlending = 0;
  const parts = {};
  new Function("PZ", "THREE", "parts", readPluginSource("scene-dof.js"))(null, THREE, parts);
  return { THREE, dof: new (parts.dof.createSceneDofClass(THREE))() };
}
class PointMaterial {
  constructor() {
    this.type = "ShaderMaterial";
    this.vertexShader = "attribute float size; void main() { gl_PointSize = size; }";
    this.fragmentShader = "void main() { gl_FragColor = texture2D(image, gl_PointCoord); }";
    this.uniforms = { time: { value: 1 } };
    this.defines = { USE_CPU: 1 };
    this.visible = true;
    this.onBeforeCompile = shader => { shader.vertexShader += "\n// source hook"; };
  }
  clone() { return new PointMaterial().copy(this); }
  copy(source) {
    for (const key of ["type", "vertexShader", "fragmentShader", "defines", "visible", "size", "sizeAttenuation"]) this[key] = source[key];
    this.uniforms = structuredClone(source.uniforms);
    return this;
  }
  dispose() { this.disposed = true; }
}

test("point depth preserves animated vertex code, live uniforms and alpha coverage", () => {
  const { dof } = setup();
  const source = new PointMaterial();
  const depth = dof.pointDepthMaterial(source);
  const shader = { vertexShader: depth.vertexShader, fragmentShader: depth.fragmentShader };
  depth.onBeforeCompile(shader, {});
  assert.equal(shader.vertexShader, source.vertexShader + "\n// source hook");
  assert.match(shader.fragmentShader, /cameraPlusSpriteColor\(\);\s*if \(gl_FragColor.a < 0.004\) discard;/);
  assert.match(shader.fragmentShader, /texture2D\(image, gl_PointCoord\)/);
  assert.match(shader.fragmentShader, /gl_FragCoord.z/);
  assert.equal(depth.uniforms, source.uniforms);
  source.uniforms.time.value = 7;
  assert.equal(depth.uniforms.time.value, 7);
  assert.equal(depth.depthWrite, true);
  assert.equal(dof.pointDepthMaterial(source), depth, "reuse the program while uniforms change");
  depth.needsUpdate = false;
  source.defines.USE_CPU = 0;
  dof.pointDepthMaterial(source);
  assert.equal(depth.needsUpdate, true, "CPU/GPU shader variants invalidate the program");
});

test("additive depth tests the alpha coverage after the source-alpha blend", () => {
  const { THREE, dof } = setup();
  const source = new PointMaterial();
  source.blending = THREE.AdditiveBlending;
  const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader };
  dof.pointDepthMaterial(source).onBeforeCompile(shader, {});
  const cutoff = Number(shader.fragmentShader.match(/gl_FragColor.a < ([\d.]+)/)[1]);
  assert.ok(Math.abs(cutoff * cutoff - 0.004) < 1e-12);
  source.premultipliedAlpha = true;
  shader.fragmentShader = source.fragmentShader;
  dof.pointDepthMaterial(source).onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /gl_FragColor.a < 0.004/);
});

test("built-in PointsMaterial keeps native point size and attenuation refresh", () => {
  const { dof } = setup();
  const source = new PointMaterial();
  source.type = "PointsMaterial";
  source.size = 13;
  source.sizeAttenuation = false;
  const depth = dof.pointDepthMaterial(source);
  assert.equal(depth.type, "PointsMaterial");
  assert.equal(depth.size, 13);
  assert.equal(depth.sizeAttenuation, false);
  source.size = 27;
  source.sizeAttenuation = true;
  dof.pointDepthMaterial(source);
  assert.equal(depth.size, 27);
  assert.equal(depth.sizeAttenuation, true);
});

for (const fail of [false, true]) {
  test(`depth rendering restores materials and visibility${fail ? " after failure" : ""}`, () => {
    const { THREE, dof } = setup();
    const scene = new THREE.Scene();
    const point = new THREE.Object3D();
    point.isPoints = true;
    const source = point.material = new PointMaterial();
    const mesh = new THREE.Object3D();
    const meshSource = mesh.material = {};
    const flare = new THREE.Object3D();
    flare.__zoidiumOpticalFlareQuad = true;
    flare.visible = true;
    scene.add(point); scene.add(mesh); scene.add(flare);
    const previous = scene.overrideMaterial = {};
    const renderer = { render() {
      assert.equal(scene.overrideMaterial, null);
      assert.notEqual(point.material, source);
      assert.equal(mesh.material, dof.depthMaterial);
      assert.equal(flare.visible, false);
      if (fail) throw new Error("depth failed");
    } };
    if (fail) assert.throws(() => dof.renderDepth(renderer, {}, scene, {}, true), /depth failed/);
    else dof.renderDepth(renderer, {}, scene, {}, true);
    assert.equal(scene.overrideMaterial, previous);
    assert.equal(point.material, source);
    assert.equal(mesh.material, meshSource);
    assert.equal(flare.visible, true);
    const cached = dof.pointDepthMaterials.get(source);
    scene.remove(point);
    dof.renderDepth({ render() { assert.equal(scene.overrideMaterial, dof.depthMaterial); } }, {}, scene, {}, true);
    assert.equal(cached.disposed, true);
    assert.equal(dof.pointDepthMaterials.size, 0);
  });
}
