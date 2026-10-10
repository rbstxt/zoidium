"use strict";

// Voronoi Fracture geometry: partition of the source surface, closure of the
// piece caps, determinism, limits, and per-frame motion as a pure function.

const assert = require("node:assert/strict");
const test = require("node:test");
const fracture = require("../plugins/scene-plus/effector-fracture.js");

// Unit cube as 12 outward-facing triangles, non-indexed (9 floats per triangle).
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const FACES = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];

function cubePositions() {
  const out = new Float32Array(FACES.length * 9);
  FACES.forEach((face, triangle) => {
    face.forEach((vertex, corner) => {
      for (let axis = 0; axis < 3; axis += 1) {
        out[triangle * 9 + corner * 3 + axis] = CORNERS[vertex][axis];
      }
    });
  });
  return out;
}

function triangleArea(stage, triangle) {
  const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => stage.positions[(triangle * 3 + k) * 3 + c]));
  const ab = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const ac = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  return Math.hypot(
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ) / 2;
}

function signedVolumeByPiece(stage) {
  const volumes = new Float64Array(stage.pieceCount);
  for (let triangle = 0; triangle < stage.count / 3; triangle += 1) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => stage.positions[(triangle * 3 + k) * 3 + c]));
    const value = p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) -
      p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) +
      p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0]);
    volumes[stage.pieceIds[triangle * 3]] += value / 6;
  }
  return volumes;
}

// Counts edges per piece on rounded coordinates. Every edge of a closed piece
// is shared by exactly two of its triangles.
function nonManifoldEdgeCount(stage) {
  const key = (triangle, corner) =>
    [0, 1, 2].map((c) => Math.round(stage.positions[(triangle * 3 + corner) * 3 + c] * 1e7)).join(",");
  const maps = Array.from({ length: stage.pieceCount }, () => new Map());
  for (let triangle = 0; triangle < stage.count / 3; triangle += 1) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = key(triangle, edge);
      const b = key(triangle, (edge + 1) % 3);
      const id = a < b ? a + "|" + b : b + "|" + a;
      const map = maps[stage.pieceIds[triangle * 3]];
      map.set(id, (map.get(id) || 0) + 1);
    }
  }
  let bad = 0;
  for (const map of maps) for (const count of map.values()) if (count !== 2) bad += 1;
  return bad;
}

test("a single cell reproduces the source surface without caps", () => {
  const stage = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 1, seed: 3, closed: true });
  assert.equal(stage.error, undefined);
  assert.equal(stage.capTriangleCount, 0);
  assert.equal(stage.pieceCount, 1);
  assert.equal(stage.count / 3, 12);
});

test("fragments tile the source surface exactly (area is conserved)", () => {
  for (const [cells, seed] of [[2, 3], [8, 3], [8, 9], [24, 11]]) {
    const stage = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells, seed, closed: false });
    let area = 0;
    for (let triangle = 0; triangle < stage.count / 3; triangle += 1) area += triangleArea(stage, triangle);
    assert.ok(Math.abs(area - 6) < 1e-4, `cells ${cells} seed ${seed}: area ${area}`);
  }
});

test("two cells cut a cube into two closed pieces whose volumes sum to the cube", () => {
  const stage = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 2, seed: 3, closed: true });
  assert.equal(nonManifoldEdgeCount(stage), 0);
  const volumes = signedVolumeByPiece(stage);
  assert.ok(Math.abs(volumes.reduce((a, b) => a + b, 0) - 1) < 1e-5);
  for (const volume of volumes) assert.ok(volume >= -1e-9, "no inverted piece");
});

test("every fragment of a closed cube is watertight with outward caps", () => {
  for (const [cells, seed] of [[8, 3], [8, 9], [24, 3], [60, 3], [60, 11]]) {
    const stage = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells, seed, closed: true });
    assert.equal(stage.error, undefined);
    assert.equal(nonManifoldEdgeCount(stage), 0, `cells ${cells} seed ${seed}`);
    const volumes = signedVolumeByPiece(stage);
    assert.ok(Math.abs(volumes.reduce((a, b) => a + b, 0) - 1) < 1e-5, "volume conserved");
    for (const volume of volumes) assert.ok(volume > 0, "all cells have outward oriented caps, including interior cells");
    // Opposite edge directions, not just incidence counts, prove consistent winding.
    const edges = new Map();
    const key = (v) => Array.from(stage.positions.slice(v * 3, v * 3 + 3), x => Math.round(x * 1e7)).join(",");
    for (let v = 0; v < stage.count; v += 3) for (let j = 0; j < 3; j += 1) {
      const a = key(v + j), b = key(v + (j + 1) % 3);
      const id = stage.pieceIds[v] + ":" + (a < b ? a + "|" + b : b + "|" + a);
      edges.set(id, (edges.get(id) || 0) + (a < b ? 1 : -1));
    }
    for (const winding of edges.values()) assert.equal(winding, 0, "each shared edge has opposite winding");
  }
});

test("identical inputs produce identical topology and a different seed changes it", () => {
  const first = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 12, seed: 5, closed: true });
  const second = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 12, seed: 5, closed: true });
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(first.pieceIds), Array.from(second.pieceIds));
  const other = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 12, seed: 6, closed: true });
  assert.notDeepEqual(Array.from(first.pieceCentroids), Array.from(other.pieceCentroids));
});

test("open mesh borders are not capped", () => {
  // A single triangle has three border edges and no cut loop closes around it.
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const stage = fracture.buildVoronoiFracture({ positions }, { cells: 3, seed: 2, closed: true });
  assert.equal(stage.error, undefined);
  assert.equal(stage.capTriangleCount, 0, "a flat triangle has no closed cut loop to cap");
});

test("limits return errors instead of freezing on large inputs", () => {
  const stage = fracture.buildVoronoiFracture(
    { positions: cubePositions() },
    { cells: 8, seed: 1, closed: true },
    { maxSourceTriangles: 4 }
  );
  assert.equal(stage.error, "source-limit");
  const output = fracture.buildVoronoiFracture(
    { positions: cubePositions() },
    { cells: 8, seed: 1, closed: true },
    { maxOutputTriangles: 20 }
  );
  assert.equal(output.error, "output-limit");
  const empty = fracture.buildVoronoiFracture({ positions: new Float32Array(0) }, { cells: 2 });
  assert.equal(empty.error, "empty");
});

test("cells are clamped to the supported range", () => {
  assert.equal(fracture.clampCells(0), 1);
  assert.equal(fracture.clampCells(10000), fracture.MAX_CELLS);
  assert.equal(fracture.clampCells(Number.NaN), 24);
});

test("ear clipping caps a planar loop and the fan caps a non-planar one", () => {
  const square = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
  const planar = fracture.triangulateLoop(square, 512);
  assert.equal(planar.length, 4);
  const area = planar.reduce((sum, [a, b, c]) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return sum + Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
  }, 0);
  assert.ok(Math.abs(area - 1) < 1e-9);

  const bent = [[0, 0, 0], [1, 0, 0], [1, 1, 0.5], [0, 1, 0]];
  const fan = fracture.triangulateLoop(bent, 512);
  assert.ok(fan.length >= 4);
  for (const triple of fan) for (const point of triple) assert.ok(point.every(Number.isFinite));
});

function fakeStage() {
  const stage = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 8, seed: 3, closed: true });
  assert.equal(stage.error, undefined);
  return stage;
}

test("fragment motion is a pure function of its inputs and matches on repeat", () => {
  const stage = fakeStage();
  const motion = { distance: 0.4, scatter: 0.2, offset: 10, spin: 0.7, field: { type: 0, position: [0, 0, 0], scale: [1, 1, 1] } };
  const a = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, motion, null);
  const b = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, motion, null);
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.ok(a.every(Number.isFinite));
});

test("zero motion returns the rest positions", () => {
  const stage = fakeStage();
  const out = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, {
    distance: 0, scatter: 0, offset: 0, spin: 0,
  }, null);
  for (let index = 0; index < out.length; index += 1) {
    assert.ok(Math.abs(out[index] - stage.positions[index]) < 1e-6);
  }
});

test("evaluation order does not change the motion of a later frame", () => {
  const stage = fakeStage();
  const at = (distance) => fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, {
    distance, scatter: 0, offset: 0, spin: 0,
  }, null);
  const forward = [0.1, 0.5, 0.9].map(at).map((array) => Array.from(array));
  const reverse = [0.9, 0.5, 0.1].map(at).map((array) => Array.from(array)).reverse();
  assert.deepEqual(forward, reverse);
});

test("fully shrunk pieces collapse to their centroids without NaN", () => {
  const stage = fakeStage();
  const out = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, {
    distance: 0, scatter: 0, offset: 100, spin: 0,
  }, null);
  assert.ok(out.every(Number.isFinite));
  for (let vertex = 0; vertex < stage.pieceIds.length; vertex += 1) {
    const piece = stage.pieceIds[vertex];
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = out[vertex * 3 + axis] - stage.pieceCentroids[piece * 3 + axis];
      assert.ok(Math.abs(delta) < 1e-6, "vertex sits on its piece centroid");
    }
  }
});

test("a deformer frame changes where pieces are pushed, not the topology", () => {
  const stage = fakeStage();
  const motion = { distance: 0.3, scatter: 0, offset: 0, spin: 0 };
  const plain = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, motion, null);
  const identityMatrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const withMatrix = fracture.applyFragmentMotion(new Float32Array(stage.positions), stage, motion, identityMatrix);
  assert.deepEqual(Array.from(plain), Array.from(withMatrix));
});

test("planar caps close a concave prism and disconnected closed components", () => {
  const polygon = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
  const faces = [[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]];
  const prism = [];
  for (const face of faces) {
    for (const i of face.slice().reverse()) prism.push(...polygon[i], 0);
    for (const i of face) prism.push(...polygon[i], 1);
  }
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    prism.push(...a, 0, ...b, 0, ...b, 1, ...a, 0, ...b, 1, ...a, 1);
  }
  const cube = cubePositions();
  const separate = new Float32Array([...cube, ...Array.from(cube, (v, i) => v + (i % 3 === 0 ? 2 : 0))]);
  for (const [positions, volume] of [[new Float32Array(prism), 3], [separate, 2]]) {
    for (const seed of [3, 11]) {
      const stage = fracture.buildVoronoiFracture({ positions }, { cells: 12, seed, closed: true });
      assert.equal(stage.error, undefined);
      assert.equal(nonManifoldEdgeCount(stage), 0);
      assert.ok(Math.abs(signedVolumeByPiece(stage).reduce((a, b) => a + b, 0) - volume) < 1e-5);
    }
  }
});

test("curved closed surfaces keep every edge shared by exactly two faces", () => {
  let triangles = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, -1, 0], [-1, 0, 0], [0, 0, -1]],
    [[1, 0, 0], [0, -1, 0], [0, 0, -1]],
  ];
  const midpoint = (a, b) => {
    const p = a.map((v, i) => v + b[i]);
    const length = Math.hypot(...p);
    return p.map(v => v / length);
  };
  for (let level = 0; level < 2; level++) triangles = triangles.flatMap(([a, b, c]) => {
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
    return [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]];
  });
  const positions = new Float32Array(triangles.flat(2));
  const source = fracture.buildVoronoiFracture({ positions }, { cells: 1, closed: true });
  const volume = signedVolumeByPiece(source)[0];
  for (const seed of [3, 11]) {
    const stage = fracture.buildVoronoiFracture({ positions }, { cells: 24, seed, closed: true });
    assert.equal(stage.error, undefined);
    assert.equal(nonManifoldEdgeCount(stage), 0);
    assert.ok(Math.abs(signedVolumeByPiece(stage).reduce((a, b) => a + b, 0) - volume) < 1e-5);
  }
});

test("all source distributions and anisotropic cells partition the original surface deterministically", () => {
  for (const distribution of [0, 1, 2, 3]) {
    const options = { cells: 8, seed: 7, closed: false, distribution, cellScale: [200, 70, 100] };
    const a = fracture.buildVoronoiFracture({ positions: cubePositions() }, options);
    const b = fracture.buildVoronoiFracture({ positions: cubePositions() }, options);
    assert.equal(a.error, undefined);
    assert.deepEqual(a.positions, b.positions);
    let area = 0;
    for (let t = 0; t < a.count / 3; t++) area += triangleArea(a, t);
    assert.ok(Math.abs(area - 6) < 1e-4);
  }
});

test("expanded motion and animated fields are deterministic in shuffled frame order and reuse topology", () => {
  const { evaluateMesh, createStageCache } = require("../plugins/scene-plus/effector-evaluate.js");
  const core = require("../plugins/scene-plus/effector-core.js");
  const base = { positions: cubePositions(), count: 36, attributes: {}, groups: [], index: null };
  const topology = { cells: 8, seed: 13, closed: true, distribution: 2, cellScale: [150, 100, 70] };
  const stage = fracture.buildVoronoiFracture(base, topology);
  const motion = t => ({ distance: t, scatter: t / 2, spin: t, offset: 10 * t, direction: [t, 2 * t, -t], rotation: [40 * t, 80 * t, 15 * t], fragmentScale: 100 - 30 * t, gravity: t * 2, randomness: 50,
    field: { type: 1, position: [0, 0, 0], scale: [100, 100, 100], rotation: [0, 0, 30], falloff: 40, sweep: 100 * t } });
  const cache = createStageCache(); let builds = 0;
  const tracked = { get(key, build) { return cache.get(key, () => { builds++; return build(); }); } };
  const run = t => evaluateMesh({ base, polygonCount: 1, sourceId: "expanded", commands: [{ kind: "fracture", topology, motion: motion(t), relation: { identity: true } }] }, tracked);
  const expected = new Map([0, 0.5, 1].map(t => [t, run(t).positions]));
  for (const t of [1, 0, 0.5, 1, 0.5, 0]) {
    const result = run(t);
    assert.deepEqual(result.positions, expected.get(t));
    const reference = new Float32Array(stage.positions);
    fracture.applyFragmentMotion(reference, stage, motion(t));
    assert.deepEqual(result.positions, reference, "worker evaluator and reference agree");
    assert.ok(Array.from(result.positions).every(Number.isFinite));
  }
  assert.equal(builds, 1, "motion and field changes do not rebuild topology");
  assert.deepEqual(expected.get(0), stage.positions, "Sweep zero keeps every piece pristine");
  const changed = run(1);
  assert.notDeepEqual(changed.positions, stage.positions);
  const hard = { ...motion(1), field: { ...motion(1).field, sweep: 50, falloff: 0 } };
  const work = new Float32Array(stage.positions); fracture.applyFragmentMotion(work, stage, hard);
  const prepared = core.prepareField(hard.field, stage.positions);
  for (let v = 0; v < stage.pieceIds.length; v++) {
    const piece = stage.pieceIds[v], centroid = stage.pieceCentroids.slice(piece * 3, piece * 3 + 3);
    if (!core.evaluateField(...centroid, prepared)) assert.deepEqual(work.slice(v * 3, v * 3 + 3), stage.positions.slice(v * 3, v * 3 + 3));
  }
});

test("anisotropic closed fragments conserve volume for all distributions", () => {
  for (const distribution of [0, 1, 2, 3]) {
    const stage = fracture.buildVoronoiFracture({ positions: cubePositions() }, { cells: 6, seed: 17, closed: true, distribution, cellScale: [220, 70, 100] });
    assert.equal(stage.error, undefined);
    const volume = Array.from(signedVolumeByPiece(stage)).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(volume - 1) < 1e-5, `${distribution}: ${volume}`);
  }
});

test("1000 cells build deterministic finite topology within the geometry limits", () => {
  assert.equal(fracture.clampCells(1000), 1000);
  assert.equal(fracture.clampCells(10000), 1000);
  const source = { positions: cubePositions() };
  const options = { cells: 1000, seed: 2, closed: true };
  const a = fracture.buildVoronoiFracture(source, options);
  const b = fracture.buildVoronoiFracture(source, options);
  assert.equal(a.error, undefined);
  assert.equal(a.pieceCount, 1000);
  assert.ok(a.triangleCount <= fracture.DEFAULT_LIMITS.maxOutputTriangles);
  assert.ok(Array.from(a.positions).every(Number.isFinite));
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.pieceIds, b.pieceIds);
});

test("fracture clipping stops at a deterministic work budget", () => {
  const source = { positions: cubePositions() };
  const options = { cells: 32, seed: 2, closed: true };
  const limits = { maxClipOperations: 1 };
  assert.deepEqual(fracture.buildVoronoiFracture(source, options, limits), { error: 'work-limit' });
  assert.deepEqual(fracture.buildVoronoiFracture(source, options, limits), { error: 'work-limit' });
});

test("infinite fields move every outer fragment for each motion control", () => {
  const positions = cubePositions().map(v => v * 400 - 200);
  const stage = fracture.buildVoronoiFracture({ positions }, { cells: 24, seed: 2, closed: true });
  const field = { type: 0, position: [0, 0, 0], scale: [100, 100, 100], falloff: 100 };
  const controls = [
    { distance: 50 }, { scatter: 50 }, { spin: 1 }, { direction: [10, 20, 30] },
    { rotation: [20, 30, 40] }, { fragmentScale: 50 }, { gravity: 50 },
    { distance: 50, randomness: 100 }, { offset: 10 },
  ];
  for (const motion of controls) {
    const moved = new Float32Array(stage.positions);
    fracture.applyFragmentMotion(moved, stage, { ...motion, field });
    const changed = new Set();
    for (let vertex = 0; vertex < stage.count; vertex++) {
      if ([0, 1, 2].some(axis => moved[vertex * 3 + axis] !== stage.positions[vertex * 3 + axis])) changed.add(stage.pieceIds[vertex]);
    }
    assert.equal(changed.size, new Set(stage.pieceIds).size, JSON.stringify(motion));
  }
  const sphere = { ...field, type: 3, legacy: true };
  const moved = new Float32Array(stage.positions);
  fracture.applyFragmentMotion(moved, stage, { scatter: 50, field: sphere });
  for (let vertex = 0; vertex < stage.count; vertex++) {
    const piece = stage.pieceIds[vertex];
    const radius = Math.hypot(...stage.pieceCentroids.slice(piece * 3, piece * 3 + 3));
    if (radius >= 100) assert.deepEqual(moved.slice(vertex * 3, vertex * 3 + 3), stage.positions.slice(vertex * 3, vertex * 3 + 3));
  }
});
