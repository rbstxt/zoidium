"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const fracture = require("../plugins/scene-plus/effector-fracture.js");
const { FRACTURE_LIMITS } = require("../plugins/scene-plus/scene-values.js");

function harness() {
  let requests = 0;
  const jobs = {
    request() { requests++; return { status: "queued" }; },
    latest() { throw new Error("A different frame cannot supply preview geometry"); },
    release() {}, forget() {}, dispose() {}, pending: () => [],
  };
  const mesh = new THREE.Mesh(new THREE.BoxBufferGeometry(4, 5, 6), new THREE.MeshStandardMaterial());
  const deformer = createMeshDeformer(THREE, jobs);
  const base = deformer.sourceStage(mesh);
  const node = new THREE.Object3D();
  const command = frame => ({ kind: "fracture", topology: { cells: 8, seed: 3, closed: true },
    limits: FRACTURE_LIMITS, motion: { distance: frame / 10, spin: frame / 100 }, relation: { identity: true } });
  const effector = {
    workerCommand: command, surfaceOptions: () => ({ vertexColors: false }),
    produceStage() { throw new Error("Built-in effectors use the command evaluator"); },
    deformPositions() { throw new Error("Built-in effectors use the command evaluator"); },
  };
  return { mesh, deformer, base, node, command, effector, requests: () => requests };
}

function assertFrame(h, frame, chain = [{ effector: h.effector, node: h.node }], commands = [h.command(frame)]) {
  h.deformer.deformMesh(h.mesh, chain, frame, 1);
  const expected = evaluateMesh({ base: h.base, sourceId: h.base.sourceId, polygonCount: 1, commands });
  assert.deepEqual(h.mesh.geometry.attributes.position.array, expected.positions);
  assert.deepEqual(h.mesh.geometry.attributes.normal.array, expected.attributes.normal.array);
  assert.deepEqual(h.mesh.geometry.groups, expected.groups);
  assert.equal(h.requests(), 0, "rendering never queues an incomplete frame");
  assert.deepEqual(h.deformer.pending([h.mesh]), []);
}

test("the first preview draw and every seek publish exactly the requested fracture frame", () => {
  const h = harness(), source = h.mesh.geometry;
  for (const frame of [0, 8, 2, 9, 0, 2]) {
    assertFrame(h, frame);
    assert.notEqual(h.mesh.geometry, source, "there is no pristine-source placeholder");
  }
  h.deformer.dispose();
  assert.equal(h.mesh.geometry, source);
});

test("small and large built-in chains keep the same evaluator when the chain changes", () => {
  const h = harness();
  const twist = { workerCommand: frame => ({ kind: "twist", angle: frame / 10, axis: 1, offset: 0, relation: { identity: true } }),
    deformPositions() { throw new Error("A small mesh cannot switch to a second evaluator"); } };
  assertFrame(h, 2);
  assertFrame(h, 3, [{ effector: twist, node: h.node }], [twist.workerCommand(3)]);
  assertFrame(h, 2);
  h.deformer.dispose();
});

test("fracture defaults and runtime commands share relaxed bounded limits", () => {
  assert.deepEqual(FRACTURE_LIMITS, fracture.DEFAULT_LIMITS);
  assert.deepEqual(FRACTURE_LIMITS, { maxSourceTriangles: 160000, maxOutputTriangles: 1600000,
    maxCapVertices: 4096, maxClipOperations: 80000000 });
});
