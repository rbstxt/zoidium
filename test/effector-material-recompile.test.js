"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createFractureMaterials } = require("../plugins/scene-plus/effector-material.js");
const NodeMaterial = require("../plugins/material-plus/node-material.js");
const { harness } = require("./material-node-harness.js");

function adapter(source) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source), state = {};
  mesh.geometry.addGroup(0, 3, 0);
  const materials = createFractureMaterials(THREE);
  const update = () => materials.syncMaterial(mesh, state, true, false);
  update();
  const disposals = new Map();
  for (const clone of mesh.material) {
    disposals.set(clone, 0);
    clone.addEventListener("dispose", () => disposals.set(clone, disposals.get(clone) + 1));
    clone.needsUpdate = false;
  }
  return { mesh, state, update, disposals, release: () => materials.releaseMaterial(mesh, state) };
}

test("replaced ShaderMaterial uniforms invalidate r91's retained shader table", () => {
  const source = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color(1, 0, 0) } } });
  const h = adapter(source), shown = h.mesh.material;
  source.uniforms = { tint: { value: new THREE.Color(0, 1, 0) } };
  h.update();
  assert.equal(h.mesh.material, shown);
  for (const clone of shown) {
    assert.equal(clone.uniforms, source.uniforms);
    assert.equal(h.disposals.get(clone), 1, "needsUpdate alone retains the old shader table for unchanged r91 program code");
  }
  source.uniforms.tint.value.setRGB(0, 0, 1);
  h.update();
  for (const clone of shown) assert.equal(h.disposals.get(clone), 1, "value animation keeps the existing program");
  h.release();
});

test("rebuilt Node Material hooks replace compiled fragment uniforms without discarding the material", async () => {
  const env = harness();
  env.context.window.THREE = THREE;
  NodeMaterial.activate(env.context);
  let material, h;
  try {
    material = env.material("nodes");
    (await env.PZ.material.fnList.nodes).call(material);
    material.load();
    h = adapter(material.threeObj);
    const shown = h.mesh.material;
    const compile = clone => {
      const shader = { uniforms: {}, vertexShader: "void main() {}", fragmentShader: "void main() {}" };
      clone.onBeforeCompile(shader);
      return shader;
    };
    const oldShaders = shown.map(compile);
    const oldUniform = material.pzUniforms.uPzColor;
    // Surface initialization can rebuild a hook and its captured uniform table
    // while retaining the physical material's identity and shader defines.
    material._surfaceInit();
    material.properties.color.set([0.2, 0.4, 0.8]);
    material.update(15);
    h.update();
    assert.equal(h.mesh.material, shown);
    assert.notEqual(material.pzUniforms.uPzColor, oldUniform);
    for (const [index, clone] of shown.entries()) {
      assert.notEqual(oldShaders[index].uniforms.uPzColor, material.pzUniforms.uPzColor);
      assert.equal(h.disposals.get(clone), 1, "r91 must rebuild the shader record before it invokes the replacement hook");
      assert.equal(compile(clone).uniforms.uPzColor, material.pzUniforms.uPzColor);
    }
    material.properties.color.set([0.8, 0.3, 0.1]);
    material.update(30);
    h.update();
    for (const clone of shown) assert.equal(h.disposals.get(clone), 1);
  } finally {
    h?.release();
    material?.unload();
    for (const dispose of env.dispose.reverse()) dispose();
  }
});
