"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");

test("identical native UV conversions reuse topology while every changed attribute invalidates it", () => {
  const geometry = new THREE.BoxGeometry(2, 3, 4);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const deformer = createMeshDeformer(THREE);
  let previous = deformer.sourceStage(mesh);
  for (let i = 1; i <= 3; i++) {
    geometry.__zoidiumUvRevision = i;
    const current = deformer.sourceStage(mesh);
    assert.equal(current.sourceId, previous.sourceId);
    assert.equal(current.positions, previous.positions);
    assert.notEqual(current.attributes.uv.ref, previous.attributes.uv.ref);
    previous = current;
  }
  geometry.faceVertexUvs[0][0][0].x += 0.25;
  geometry.__zoidiumUvRevision++;
  const edited = deformer.sourceStage(mesh);
  assert.notEqual(edited.sourceId, previous.sourceId);
  assert.notDeepEqual(edited.uvs, previous.uvs);
  deformer.dispose();
});

test("same-byte attribute replacement preserves every evaluated byte and updates source refs", () => {
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 3, 4), new THREE.MeshStandardMaterial());
  const deformer = createMeshDeformer(THREE);
  const first = deformer.sourceStage(mesh);
  const command = { kind: "fracture", topology: { cells: 8, seed: 7, closed: true }, motion: { distance: 0.4 } };
  const evaluate = base => evaluateMesh({ base, sourceId: base.sourceId, polygonCount: 1, commands: [command] });
  const expected = evaluate(first);
  for (const name of ["position", "normal", "uv"]) {
    const old = mesh.geometry.attributes[name];
    mesh.geometry.addAttribute(name, new THREE.BufferAttribute(new old.array.constructor(old.array), old.itemSize, old.normalized));
  }
  const next = deformer.sourceStage(mesh);
  assert.equal(next.sourceId, first.sourceId);
  assert.deepEqual(evaluate(next), expected);
  assert.equal(next.attributes.uv.ref, mesh.geometry.attributes.uv);
  for (const name of ["position", "normal", "uv"]) {
    const before = deformer.sourceStage(mesh), attribute = mesh.geometry.attributes[name];
    attribute.array[0] += 0.125; attribute.needsUpdate = true;
    assert.notEqual(deformer.sourceStage(mesh).sourceId, before.sourceId);
  }
  const beforeGroup = deformer.sourceStage(mesh);
  mesh.geometry.groups[0].materialIndex++;
  assert.notEqual(deformer.sourceStage(mesh).sourceId, beforeGroup.sourceId);
  deformer.dispose();
});

test("signed zero changes invalidate snapshots despite numeric equality", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()), deformer = createMeshDeformer(THREE);
  const previous = deformer.sourceStage(mesh);
  geometry.attributes.position.array[0] = -0;
  geometry.attributes.position.needsUpdate = true;
  const next = deformer.sourceStage(mesh);
  assert.notEqual(next.sourceId, previous.sourceId);
  assert.ok(Object.is(next.positions[0], -0));
  assert.ok(Object.is(previous.positions[0], 0));
  deformer.dispose();
});

test("recreated source meshes with identical bytes share topology without sharing mutable geometry", () => {
  const deformer = createMeshDeformer(THREE);
  const a = new THREE.Mesh(new THREE.BoxBufferGeometry(2, 3, 4), new THREE.MeshStandardMaterial());
  const b = new THREE.Mesh(a.geometry.clone(), a.material);
  const first = deformer.sourceStage(a), repeated = deformer.sourceStage(b);
  assert.equal(first.sourceId, repeated.sourceId);
  assert.equal(first.positions, repeated.positions);
  assert.equal(repeated.attributes.normal.ref, b.geometry.attributes.normal);
  assert.notEqual(first.attributes.normal.ref, repeated.attributes.normal.ref);
  b.geometry.attributes.position.array[0] += 0.1;
  b.geometry.attributes.position.needsUpdate = true;
  assert.notEqual(deformer.sourceStage(b).sourceId, first.sourceId);
  assert.equal(deformer.sourceStage(a), first);
  deformer.dispose();
});
