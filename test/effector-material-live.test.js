"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");

function harness(material) {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(4, 4, 4), material);
  const deformer = createMeshDeformer(THREE);
  const chain = [{ node: new THREE.Object3D(), effector: {
    workerCommand: () => ({ kind: "fracture", topology: { cells: 4, seed: 3, closed: true }, motion: {} }),
    surfaceOptions: () => ({ vertexColors: false }),
  } }];
  const update = offset => deformer.deformMesh(mesh, chain, 0, 1, false, offset);
  update();
  return { mesh, deformer, update };
}

test("fracture materials follow source colors, uniform replacement, textures, defines, and compilation hooks", () => {
  const original = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color(1, 0, 0) }, gain: { value: 1 } } });
  const h = harness(original), shown = h.mesh.material;
  original.uniforms.tint.value.setRGB(0, 1, 0);
  original.uniforms.gain = { value: 0.3 };
  original.uniforms.image = { value: new THREE.Texture() };
  original.defines = { COLOR_MODE: 2 };
  original.onBeforeCompile = shader => { shader.uniforms.live = original.uniforms.gain; };
  for (const clone of shown) clone.needsUpdate = false;
  h.update();
  for (const clone of shown) {
    assert.equal(clone.uniforms, original.uniforms);
    assert.equal(clone.uniforms.gain.value, 0.3);
    assert.equal(clone.uniforms.image.value, original.uniforms.image.value);
    assert.equal(clone.onBeforeCompile, original.onBeforeCompile);
    assert.deepEqual(clone.defines, { COLOR_MODE: 2 });
    assert.equal(clone.needsUpdate, true, "shader changes invalidate the compiled clone on THREE r91");
    clone.needsUpdate = false;
  }
  original.uniforms.gain.value = 0.8;
  h.update();
  for (const clone of shown) {
    assert.equal(clone.uniforms.gain.value, 0.8);
    assert.equal(clone.needsUpdate, false, "uniform-only animation does not recompile");
  }
  const replacement = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color(0, 0, 1) } } });
  h.mesh.material = replacement;
  h.update();
  assert.notEqual(h.mesh.material, shown);
  assert.equal(h.mesh.material[0].uniforms, replacement.uniforms);
  h.deformer.dispose();
  assert.equal(h.mesh.material, replacement);
});

test("animated physical material colors reach both existing fragment clones", () => {
  const original = new THREE.MeshPhysicalMaterial({ color: 0xff0000 });
  const h = harness(original), shown = h.mesh.material;
  for (const color of [0x123456, 0xabcdef, 0xff0000]) {
    original.color.setHex(color);
    h.update();
    assert.equal(h.mesh.material, shown);
    for (const clone of shown) assert.equal(clone.color.getHex(), color);
  }
  h.deformer.dispose();
});

test("fracture retains every source material slot and tracks replacements inside a character material array", () => {
  const sources = Array.from({ length: 6 }, (_, i) => new THREE.MeshStandardMaterial({ color: (i + 1) * 0x202020 }));
  const h = harness(sources);
  assert.ok(h.mesh.geometry.groups.some(group => group.materialIndex === 6), "caps have a separate slot");
  for (let index = 0; index < 6; index++) {
    assert.ok(h.mesh.geometry.groups.some(group => group.materialIndex === index));
    assert.equal(h.mesh.material[index].color.getHex(), sources[index].color.getHex());
  }
  const old = h.mesh.material;
  sources[1] = new THREE.ShaderMaterial({ uniforms: { tint: { value: new THREE.Color(0, 1, 0) } } });
  h.update();
  assert.notEqual(h.mesh.material, old);
  assert.equal(h.mesh.material[1].uniforms, sources[1].uniforms);
  h.deformer.dispose();
  assert.equal(h.mesh.material, sources, "restore the complete source array");
});


test("opaque fragment order survives material changes and restores native priorities and transparency sorting", () => {
  const original = new THREE.MeshStandardMaterial(), h = harness(original);
  h.mesh.renderOrder = 7;
  h.update(0.0001);
  assert.equal(h.mesh.renderOrder, 7.0001);
  original.transparent = true;
  h.update(0.0002);
  assert.equal(h.mesh.renderOrder, 7, "transparent fragments retain the original render priority");
  original.transparent = false;
  h.mesh.renderOrder = 9;
  h.update(0.0002);
  assert.equal(h.mesh.renderOrder, 9.0002, "native priority edits remain authoritative");
  h.deformer.dispose();
  assert.equal(h.mesh.renderOrder, 9, "unload restores the last native render priority");
});
