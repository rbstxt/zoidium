"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const { buildVoronoiFracture, applyFragmentMotion } = require("../plugins/scene-plus/effector-fracture.js");
const characterMaterials = require("../plugins/text-plus/text-plus-materials.js");
const uvSource = fs.readFileSync(require.resolve("../plugins/material-plus/uv-layout.js"), "utf8");
const layout = new Function(uvSource)()();
characterMaterials.configure({ getAsset: () => uvSource });

// A bevelled L-shaped extrusion exercises cap planes, bevel creases, and walls
// without fonts or saved project data.
function extrusion() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (const [x, y] of [[0, 12], [4, 12], [4, 4], [9, 4], [9, 0], [0, 0]]) shape.lineTo(x, y);
  return new THREE.ExtrudeGeometry(shape, {
    amount: 3, bevelEnabled: true, bevelSize: 1, bevelThickness: 1, bevelSegments: 10, steps: 1,
  });
}

const command = {
  kind: "fracture", topology: { cells: 24, seed: 5, closed: true }, motion: {}, relation: { identity: true },
};

function fractureEffector() {
  return {
    workerCommand: () => command,
    surfaceOptions: () => ({ vertexColors: false }),
    produceStage(positions, stage) {
      return buildVoronoiFracture({ positions, normals: stage.attributes.normal.array, uvs: stage.uvs }, command.topology);
    },
    deformPositions: (positions, frame, { stage }) => applyFragmentMotion(positions, stage, {}),
  };
}

function sourceTriangles(base) {
  const triangles = [];
  for (let start = 0; start < base.count; start += 3) {
    const points = [0, 1, 2].map(c => new THREE.Vector3().fromArray(base.positions, (start + c) * 3));
    const normal = new THREE.Vector3().subVectors(points[1], points[0])
      .cross(new THREE.Vector3().subVectors(points[2], points[0])).normalize();
    triangles.push({ start, points, normal, triangle: new THREE.Triangle(...points) });
  }
  return triangles;
}

function assertOuterAttributes(base, result) {
  const triangles = sourceTriangles(base);
  const point = new THREE.Vector3(), bary = new THREE.Vector3(), delta = new THREE.Vector3();
  let checked = 0;
  for (let vertex = 0; vertex < result.groups[0].count; vertex++) {
    point.fromArray(result.positions, vertex * 3);
    const matched = triangles.some(({ start, points, normal, triangle }) => {
      if (Math.abs(normal.dot(delta.subVectors(point, points[0]))) > 2e-6) return false;
      triangle.getBarycoord(point, bary);
      if (Math.min(bary.x, bary.y, bary.z) < -2e-6) return false;
      const expectedNormal = new THREE.Vector3(), expectedUv = new THREE.Vector2();
      [bary.x, bary.y, bary.z].forEach((weight, corner) => {
        expectedNormal.addScaledVector(new THREE.Vector3().fromArray(base.attributes.normal.array, (start + corner) * 3), weight);
        expectedUv.addScaledVector(new THREE.Vector2().fromArray(base.uvs, (start + corner) * 2), weight);
      });
      // At creases either adjacent triangle contains the point. Match its
      // normal and UV together, rather than accepting the wrong side of a seam.
      return expectedNormal.normalize().distanceTo(new THREE.Vector3().fromArray(result.attributes.normal.array, vertex * 3)) < 2e-6 &&
        expectedUv.distanceTo(new THREE.Vector2().fromArray(result.attributes.uv.array, vertex * 2)) < 2e-6;
    });
    assert.ok(matched, "outer vertex retains its source normal and UV: " + vertex);
    checked++;
  }
  assert.ok(checked > base.count, "clipped vertices and source corners were checked");
}

for (const current of [false, true]) test(`resting bevelled fracture preserves ${current ? "Material+" : "native"} outer attributes in both evaluators`, () => {
  const source = extrusion();
  if (current) assert.equal(layout.applyToGeometry(source), true);
  const mesh = new THREE.Mesh(source, new THREE.MeshStandardMaterial());
  const deformer = createMeshDeformer(THREE);
  const base = deformer.sourceStage(mesh);
  const result = evaluateMesh({ base, sourceId: base.sourceId, polygonCount: 1, commands: [command] });
  assert.deepEqual(result.errors, []);
  assertOuterAttributes(base, result);
  deformer.deformMesh(mesh, [{ effector: fractureEffector(), node: new THREE.Object3D() }], 0, 1);
  assertOuterAttributes(base, { positions: mesh.geometry.attributes.position.array, attributes: mesh.geometry.attributes, groups: mesh.geometry.groups });
  deformer.restoreMesh(mesh);
  source.dispose();
  mesh.material.dispose();
});

test("new character meshes have the active UV layout before their first effector snapshot", () => {
  const geometry = extrusion(), originalUvs = JSON.stringify(geometry.faceVertexUvs);
  const material = new THREE.MeshStandardMaterial();
  material.__zoidiumUvLayout = true;
  const mesh = new THREE.Mesh(geometry, material), entry = { mesh };
  characterMaterials.apply(entry, material, null);
  assert.equal(geometry.__zoidiumUvNormalized, true);
  assert.notEqual(JSON.stringify(geometry.faceVertexUvs), originalUvs);
  const deformer = createMeshDeformer(THREE);
  const first = deformer.sourceStage(mesh);
  characterMaterials.apply(entry, material, null);
  assert.equal(deformer.sourceStage(mesh), first, "unchanged layout reuses the source snapshot");
  delete material.__zoidiumUvLayout;
  characterMaterials.apply(entry, material, null);
  assert.equal(JSON.stringify(geometry.faceVertexUvs), originalUvs, "native and legacy materials restore raw UVs");
  assert.notEqual(deformer.sourceStage(mesh), first, "restoring UVs invalidates the snapshot");
  geometry.dispose(); material.dispose();
});

test("fractured outer faces follow source sidedness on every frame", () => {
  const source = extrusion(), original = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(source, original), deformer = createMeshDeformer(THREE);
  const chain = [{ effector: fractureEffector(), node: new THREE.Object3D() }];
  for (const side of [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide, THREE.FrontSide]) {
    original.side = side;
    deformer.deformMesh(mesh, chain, 0, 1);
    assert.equal(mesh.material[0].side, side, "outer clone follows original");
    assert.equal(mesh.material[1].side, THREE.DoubleSide, "inner caps remain visible from either side");
  }
  deformer.restoreMesh(mesh);
  assert.equal(mesh.material, original);
  source.dispose(); original.dispose();
});
