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
