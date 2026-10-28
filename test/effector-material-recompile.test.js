"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createFractureMaterials } = require("../plugins/scene-plus/effector-material.js");
const NodeMaterial = require("../plugins/material-plus/node-material.js");
const { harness } = require("./material-node-harness.js");

function adapter(source, capIndex) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), source), state = {};
  mesh.geometry.__zoidiumCapMaterialIndex = capIndex;
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

test("fracture caps do not change a character's source UV mask or restart its topology", () => {
  const fs = require("node:fs");
  const layout = new Function(fs.readFileSync(path.join(__dirname, "../plugins/material-plus/uv-layout.js"), "utf8"))()();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);shape.lineTo(4, 0);shape.lineTo(4, 4);shape.lineTo(0, 4);shape.lineTo(0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { amount: 2, bevelEnabled: false, steps: 2 });
  const sources = [new THREE.MeshPhysicalMaterial(), new THREE.MeshPhysicalMaterial()];
  for (const material of sources) material.__zoidiumUvLayout = true;
  layout.syncCharacterMesh({ material: sources }, geometry);
  const revision = geometry.__zoidiumUvRevision;
  const uvs = JSON.stringify(geometry.faceVertexUvs);
  const h = adapter(sources, 2);
  try {
    for (let frame = 0; frame < 4; frame++) {
      layout.syncCharacterMesh(h.mesh, geometry);
      assert.equal(geometry.__zoidiumUvFaceMask, 3, "caps have no faces in the pristine source geometry");
      assert.equal(geometry.__zoidiumUvRevision, revision, "material updates cannot invalidate the ready source stage");
      assert.equal(JSON.stringify(geometry.faceVertexUvs), uvs);
      layout.syncCharacterMesh({ material: sources }, geometry);
      h.update();
    }
    sources[1].__zoidiumUvLayout = false;
    h.update();
    layout.syncCharacterMesh(h.mesh, geometry);
    assert.equal(geometry.__zoidiumUvFaceMask, 1, "a real source face-material edit still updates its UV mask");
    assert.ok(geometry.__zoidiumUvRevision > revision);
  } finally { h.release();geometry.dispose();for (const material of sources) material.dispose(); }
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
