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

// This ring is authored here. It has no font or saved-project dependency.
function bevelledRing() {
  const shape = new THREE.Shape(), hole = new THREE.Path(), count = 160;
  for (let i = 0; i <= count; i++) {
    const angle = 2 * Math.PI * i / count;
    shape[i ? "lineTo" : "moveTo"](10 * Math.cos(angle), 10 * Math.sin(angle));
    hole[i ? "lineTo" : "moveTo"](7 * Math.cos(-angle), 7 * Math.sin(-angle));
  }
  shape.holes.push(hole);
  return new THREE.BufferGeometry().fromGeometry(new THREE.ExtrudeGeometry(shape, {
    amount: 3, bevelEnabled: true, bevelSize: 0.3, bevelThickness: 0.3, bevelSegments: 2, steps: 1,
  }));
}

test("bevelled counters exceeding the former cap budget remain closed and retain their holes", () => {
  const geometry = bevelledRing(), source = { positions: geometry.attributes.position.array };
  const topology = { cells: 2, seed: 3, closed: true, cellScale: [10000, 10000, 1] };
  const old = fracture.buildVoronoiFracture(source, topology, { maxCapVertices: 512 });
  assert.equal(old.warning, "cap-invalid");
  const closed = fracture.buildVoronoiFracture(source, topology);
  assert.equal(closed.error, undefined);
  assert.equal(closed.warning, undefined);
  assert.equal(closed.closed, true);
  assert.ok(closed.capTriangleCount > 0);
  assert.deepEqual(closed.positions.subarray(0, old.positions.length), old.positions, "the outer surface is unchanged");
  for (let i = closed.groups[1].start * 3; i < closed.positions.length; i += 9) {
    const x = (closed.positions[i] + closed.positions[i + 3] + closed.positions[i + 6]) / 3;
    const y = (closed.positions[i + 1] + closed.positions[i + 4] + closed.positions[i + 7]) / 3;
    assert.ok(Math.hypot(x, y) > 6.6, "caps leave the counter open");
  }
  geometry.dispose();
});

test("changing a fracture budget invalidates a cached fallback and retains cached diagnostics", () => {
  const { createStageCache } = require("../plugins/scene-plus/effector-evaluate.js");
  const h = harness(), cache = createStageCache();
  const command = h.command(0), input = { base: h.base, sourceId: h.base.sourceId, polygonCount: 1, commands: [command] };
  command.limits = { maxSourceTriangles: 1 };
  assert.deepEqual(evaluateMesh(input, cache).errors, ["source-limit"]);
  command.limits = FRACTURE_LIMITS;
  const fixed = evaluateMesh(input, cache);
  assert.deepEqual(fixed.errors, []);
  assert.equal(fixed.kind, "fracture");
  command.limits = { maxCapVertices: 3 };
  command.topology = { cells: 12, seed: 3, closed: true };
  const limited = evaluateMesh(input, cache);
  assert.deepEqual(evaluateMesh(input, cache).warnings, limited.warnings);
  h.deformer.dispose();
});

test("a multi-mesh topology cache retains more than four characters while enforcing its byte budget", () => {
  const { createStageCache } = require("../plugins/scene-plus/effector-evaluate.js");
  const cache = createStageCache(64, 64);
  let builds = 0;
  const build = () => { builds++; return new Uint8Array(4); };
  for (let i = 0; i < 12; i++) cache.get(String(i), build);
  for (let i = 0; i < 12; i++) cache.get(String(i), build);
  assert.equal(builds, 12);
  cache.get("oversized", () => new Uint8Array(65));
  cache.get("0", build);
  assert.equal(builds, 13, "oversized topology is not retained");
});

test("synchronous fracture status keeps another mesh's warning and clears repaired results", () => {
  const status = require("../plugins/scene-plus/effector-fracture-status.js");
  const h = harness(), owner = h.effector;
  owner.properties = { addAll(defs) { Object.assign(this, defs); } };
  status.installFractureStatus(owner, { property: { type: { TEXT: 3 } } });
  owner.setFractureJobStatus = (...args) => status.setFractureJobStatus(owner, ...args);
  owner.workerCommand = frame => ({ ...h.command(frame), limits: frame === 0 ? { maxSourceTriangles: 1 } : FRACTURE_LIMITS });
  const other = new THREE.Mesh(h.mesh.geometry, h.mesh.material), chain = [{ effector: owner, node: h.node }];
  h.deformer.deformMesh(h.mesh, chain, 0, 1);
  assert.match(owner._fractureStatus, /Warning:/);
  h.deformer.deformMesh(other, chain, 1, 1);
  assert.match(owner._fractureStatus, /Warning:/, "a successful mesh cannot erase another mesh's fallback");
  h.deformer.deformMesh(h.mesh, chain, 1, 1);
  assert.equal(owner._fractureStatus, "Ready");
  h.deformer.dispose();
  status.disposeFractureStatus(owner);
});

test("the command evaluator ignores incomplete trailing triangles when building normals", () => {
  const { normalsFor } = require("../plugins/scene-plus/effector-evaluate.js");
  const positions = new Float32Array([0, 0, 0, 1, 0, 0]);
  const normals = normalsFor({ attributes: {}, index: null }, positions);
  assert.equal(normals.length, positions.length);
  assert.ok(normals.every(Number.isFinite));
});
