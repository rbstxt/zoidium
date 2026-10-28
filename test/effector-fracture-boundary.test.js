"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const THREE = require(path.join(process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources"), "three.r91.min.js"));
const fracture = require("../plugins/scene-plus/effector-fracture.js");

// Exhaustive boundary restoration before the spatial search optimization.
const legacyCapContours = String.raw`function capContours(loops, plane, epsilon, maxVertices) {
  const normal = [plane.nx, plane.ny, plane.nz];
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize3(cross3(normal, helper), [0, 0, 1]), v = cross3(normal, u);
  const projected = loops.map(loop => loop.map(p => [dot3(p, u), dot3(p, v)]));
  const inside = (p, loop) => {
    let hit = false;
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const a = loop[i], b = loop[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  };
  const depths = projected.map((loop, i) => projected.reduce((n, other, j) => n + Number(i !== j && inside(loop[0], other)), 0));
  const polygons = [];
  for (let i = 0; i < loops.length; i++) {
    if (depths[i] % 2) continue;
    const holes = loops.map((_, j) => j).filter(j => depths[j] === depths[i] + 1 && inside(projected[j][0], projected[i]));
    let loop = loops[i];
    let area = [0, 0, 0];
    for (let k = 0; k < loop.length; k++) { const c = cross3(loop[k], loop[(k + 1) % loop.length]); area = area.map((a, axis) => a + c[axis]); }
    if (dot3(area, normal) < 0) loop = loop.slice().reverse();
    if (!holes.length && convexLoop(loop, normal, 1)) { polygons.push(loop); continue; }
    const points = loop.slice(), starts = [];
    for (const j of holes) { starts.push(points.length); points.push(...loops[j]); }
    if (points.length > maxVertices) return null;
    const flat = points.flatMap(p => [dot3(p, u), dot3(p, v)]);
    const indices = earcut(flat, starts, 2);
    if (!indices.length || earcut.deviation(flat, starts, 2, indices) > 1e-5) return null;
    for (let k = 0; k < indices.length; k += 3) {
      const triple = [points[indices[k]], points[indices[k + 1]], points[indices[k + 2]]];
      const ab = triple[1].map((x, a) => x - triple[0][a]), ac = triple[2].map((x, a) => x - triple[0][a]);
      if (dot3(cross3(ab, ac), normal) < 0) triple.reverse();
      // Earcut drops collinear boundary vertices. Put them back so cap edges
      // match the clipped source triangles and remain watertight.
      const boundary = [];
      for (let e = 0; e < 3; e++) {
        const a = triple[e], b = triple[(e + 1) % 3], d = b.map((x, axis) => x - a[axis]), length = dot3(d, d);
        boundary.push(a);
        const along = [];
        for (const p of points) {
          const delta = p.map((x, axis) => x - a[axis]), t = dot3(delta, d) / length;
          const endpointTolerance = epsilon / Math.sqrt(length);
          if (t <= endpointTolerance || t >= 1 - endpointTolerance) continue;
          if (distanceSquared3(p, a.map((x, axis) => x + t * d[axis])) <= epsilon * epsilon * 4) along.push({ t, p });
        }
        along.sort((a, b) => a.t - b.t); boundary.push(...along.map(item => item.p));
      }
      polygons.push(boundary);
    }
  }
  return polygons;
}
`;

const legacyClipRecords = String.raw`function clipRecords(polygon, plane, eps) {
  const count = polygon.length;
  const signed = new Float64Array(count);
  let allInside = true;
  for (let index = 0; index < count; index += 1) {
    const point = polygon[index].p;
    signed[index] = plane.nx * point[0] + plane.ny * point[1] + plane.nz * point[2] - plane.d;
    if (signed[index] > eps) allInside = false;
  }
  if (allInside) return polygon;
  const output = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const si = signed[index];
    const sj = signed[next];
    if (si <= eps) output.push(polygon[index]);
    if ((si > eps && sj < -eps) || (si < -eps && sj > eps)) {
      output.push(intersectRecords(polygon[index], polygon[next], si, sj));
    }
  }
  return output;
}
`;

const legacyBuild = String.raw`function buildVoronoiFracture(source, options, limits) {
  const limit = Object.assign({}, DEFAULT_LIMITS, limits || {});
  const cells = clampCells(options.cells);
  const seed = Math.trunc(core.finiteOr(options.seed, 1));
  const closed = options.closed !== false;
  const positions = source.positions;
  if (!positions) return { error: "invalid" };
  for (const value of positions) if (!Number.isFinite(value)) return { error: "invalid" };
  const index = source.index || null;
  const uvs = source.uvs || null;
  const normals = source.normals || null;
  const triangleCount = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
  if (!triangleCount) return { error: "empty" };
  if (triangleCount > limit.maxSourceTriangles) return { error: "source-limit" };

  const vertexAt = (triangle, corner) => (index ? Number(index[triangle * 3 + corner]) : triangle * 3 + corner);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = vertexAt(triangle, corner);
      if (!(vertex >= 0 && vertex * 3 + 2 < positions.length)) return { error: "invalid" };
    }
  }

  const bounds = core.boundsOf(positions);
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];
  const maxExtent = Math.max(size[0], size[1], size[2]);
  if (!(maxExtent > 0) || !Number.isFinite(maxExtent)) return { error: "degenerate" };
  const padding = 0.1 * maxExtent;
  const planeEpsilon = maxExtent * 1e-9;
  const weldEpsilon = maxExtent * 1e-7;

  const distribution = core.clampIndex(options.distribution, 3);
  const cellScale = options.cellScale || [100, 100, 100];
  const metric = cellScale.map(v => 1 / Math.max(Math.abs(core.finiteOr(v, 100)) / 100, 0.0001) ** 2);
  const areas = [];
  let totalArea = 0;
  if (distribution === 1) for (let t = 0; t < triangleCount; t++) {
    const points = [0, 1, 2].map(c => Array.from(positions.slice(vertexAt(t, c) * 3, vertexAt(t, c) * 3 + 3)));
    const a = points[1].map((v, i) => v - points[0][i]), b = points[2].map((v, i) => v - points[0][i]);
    totalArea += Math.hypot(...cross3(a, b)) / 2;
    areas.push(totalArea);
  }
  const sites = [];
  for (let cell = 0; cell < cells; cell += 1) {
    let unit = [0, 1, 2].map(i => core.hash01(seed, cell, i));
    if (distribution === 1 && totalArea > 0) {
      const target = core.hash01(seed, cell, 3) * totalArea;
      let lo = 0, hi = areas.length - 1;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (areas[mid] < target) lo = mid + 1; else hi = mid; }
      const u = Math.sqrt(unit[0]), v = unit[1], weights = [1 - u, u * (1 - v), u * v];
      sites.push([0, 1, 2].map(i => weights.reduce((sum, w, c) => sum + w * positions[vertexAt(lo, c) * 3 + i], 0)));
      continue;
    }
    if (distribution === 2) unit = unit.map(v => 0.5 + Math.sign(v - 0.5) * 0.5 * (2 * Math.abs(v - 0.5)) ** 2);
    if (distribution === 3) unit = unit.map(v => 0.5 + Math.sign(v - 0.5) * 0.5 * Math.sqrt(2 * Math.abs(v - 0.5)));
    sites.push(unit.map((v, i) => bounds.min[i] + size[i] * v));
  }
  const low = bounds.min.map((value) => value - padding);
  const high = bounds.max.map((value) => value + padding);
  const cellInfo = buildCells(sites, low, high, planeEpsilon, metric);

  // Clip a closed surface one plane at a time. Caps made on an earlier plane
  // participate in the next cut, so cell ridges join two planar caps. Capping
  // only the final source boundary would incorrectly fill a non-planar loop
  // and lose cells entirely inside the source volume.
  const sourcePolygons = [];
  const materialIds = new Uint16Array(triangleCount);
  for (const group of source.groups || []) {
    const end = Math.min(triangleCount, Math.floor((group.start + group.count) / 3));
    for (let t = Math.ceil(group.start / 3); t < end; t++) materialIds[t] = group.materialIndex || 0;
  }
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const points = [];
    for (let local = 0; local < 3; local += 1) {
      const vertex = vertexAt(triangle, local);
      points.push({
        p: [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]],
        uv: uvs ? [uvs[vertex * 2], uvs[vertex * 2 + 1]] : null,
        normal: normals ? Array.from(normals.subarray(vertex * 3, vertex * 3 + 3)) : null,
      });
    }
    sourcePolygons.push({ points, cap: false, materialIndex: materialIds[triangle] });
  }
  const fragmentPositions = [];
  const fragmentNormals = [];
  const capNormals = [];
  const fragmentUvs = [];
  const fragmentPiece = [];
  const fragmentMaterials = [];
  const capPositions = [];
  const capPieces = [];
  let capTriangleCount = 0;
  const maxOutput = limit.maxOutputTriangles;

  let clipOperations = 0;
  for (let piece = 0; piece < cells; piece += 1) {
    let surface = sourcePolygons;
    for (const plane of cellInfo[piece].planes) {
      clipOperations += surface.length;
      if (clipOperations > limit.maxClipOperations) return { error: "work-limit" };
      const next = [];
      const cuts = [];
      for (const polygon of surface) {
        const points = clipRecords(polygon.points, plane, planeEpsilon);
        if (points.length < 3) continue;
        next.push({ points, cap: polygon.cap, materialIndex: polygon.materialIndex });
        if (!closed || points === polygon.points) continue;
        for (let i = 0; i < points.length; i += 1) {
          const a = points[i].p;
          const b = points[(i + 1) % points.length].p;
          const onPlane = (p) => Math.abs(plane.nx * p[0] + plane.ny * p[1] + plane.nz * p[2] - plane.d) <= planeEpsilon * 4;
          if (onPlane(a) && onPlane(b)) cuts.push([a, b]);
        }
      }
      if (closed && cuts.length) {
        const caps = capContours(cutLoops(cuts, weldEpsilon), plane, weldEpsilon, limit.maxCapVertices);
        if (!caps) {
          // Keep the source surface visible when concave caps cannot be built.
          // Rebuild without caps using the same sites and clipping order.
          const open = buildVoronoiFracture(source, { ...options, closed: false }, limit);
          if (!open.error) open.warning = "cap-invalid";
          return open;
        }
        for (const loop of caps) next.push({ cap: true, points: loop.map(p => ({ p, uv: null })) });
      }

      surface = next;
      if (!surface.length) break;
      if (surface.length > maxOutput) return { error: "output-limit" };
    }
    for (const polygon of surface) {
      let triples;
      if (polygon.cap) {
        triples = triangulateLoop(polygon.points.map((point) => point.p), limit.maxCapVertices)
          .map((triple) => triple.map((p) => ({ p, uv: null })));
      } else {
        triples = [];
        for (let fan = 1; fan + 1 < polygon.points.length; fan += 1) {
          triples.push([polygon.points[0], polygon.points[fan], polygon.points[fan + 1]]);
        }
      }
      for (const triple of triples) {
        const a = triple[0].p;
        const b = triple[1].p;
        const c = triple[2].p;
        const area = cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
        if (!(dot3(area, area) > 1e-28 * maxExtent ** 4)) continue;
        for (const point of triple) {
          const target = polygon.cap ? capPositions : fragmentPositions;
          target.push(...point.p);
          if (normals) (polygon.cap ? capNormals : fragmentNormals).push(...(point.normal || normalize3(area, [0, 0, 1])));
          if (!polygon.cap) {
            fragmentPiece.push(piece);
            fragmentMaterials.push(polygon.materialIndex || 0);
            if (uvs) fragmentUvs.push(...(point.uv || [0, 0]));
          }
        }
        if (polygon.cap) {
          capPieces.push(piece);
          capTriangleCount += 1;
        }
        if (fragmentPiece.length / 3 + capTriangleCount > maxOutput) return { error: "output-limit" };
      }
    }
  }
  if (!fragmentPiece.length && !capTriangleCount) return { error: "empty" };

  return assembleStage({
    cells,
    seed,
    closed,
    sites,
    bounds,
    fragmentPositions,
    fragmentNormals, capNormals, hasNormals: Boolean(normals),
    fragmentUvs,
    fragmentPiece,
    fragmentMaterials, materialCount: source.materialCount || 1,
    capPositions,
    capPieces,
    capTriangleCount,
    hasUvs: Boolean(uvs),
  });
}
`;

function oracle() {
  let source = fs.readFileSync(require.resolve("../plugins/scene-plus/effector-fracture.js"), "utf8");
  source = source.replace(/if \(!prepared.classify[^\n]+/, "").replace("const classify = prepared.classify;", "const classify = null;");
  const buildStart = source.indexOf("function buildVoronoiFracture(");
  const buildEnd = source.indexOf("\nfunction assembleStage(", buildStart);
  source = source.slice(0, buildStart) + legacyBuild + source.slice(buildEnd);
  const clipStart = source.indexOf("function clipRecords(");
  const clipEnd = source.indexOf("\nfunction intersectRecords(", clipStart);
  source = source.slice(0, clipStart) + legacyClipRecords + source.slice(clipEnd);
  const start = source.indexOf("function capContours(");
  const end = source.indexOf("\nfunction pieceColor(", start);
  const module = { exports: {} };
  vm.runInNewContext(source.slice(0, start) + legacyCapContours + source.slice(end), {
    module, ZoidiumPluginApis: global.ZoidiumPluginApis,
    Float32Array, Float64Array, Uint16Array, Uint32Array, Uint8Array,
    require: id => require("../plugins/scene-plus/" + id.replace("./", "")),
  });
  return module.exports;
}

function exact(actual, expected) {
  if (ArrayBuffer.isView(actual)) {
    assert.equal(actual.constructor.name, expected.constructor.name);
    assert.deepEqual(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength),
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength));
  } else if (actual && typeof actual === "object") {
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of Object.keys(actual)) exact(actual[key], expected[key]);
  } else assert.equal(actual, expected);
}

function extrusion(open = false) {
  const shape = new THREE.Shape();
  // Curved walls, a counter, and bevel rings exercise collinear restoration.
  shape.moveTo(-3, -2); shape.lineTo(3, -2); shape.bezierCurveTo(4, 0, 2, 3, 0, 2);
  shape.bezierCurveTo(-2, 3, -4, 0, -3, -2);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, 0.8, 0.7, 0, Math.PI * 2, true, 0); shape.holes.push(hole);
  const geometry = new THREE.BufferGeometry().fromGeometry(new THREE.ExtrudeGeometry(shape, {
    amount: 1.3, steps: 3, bevelEnabled: true, bevelThickness: 0.15,
    bevelSize: 0.1, bevelSegments: 3, curveSegments: 16,
  }));
  const positions = geometry.attributes.position.array;
  const end = open ? positions.length - 90 : positions.length;
  return { positions: positions.slice(0, end), normals: geometry.attributes.normal.array.slice(0, end),
    uvs: geometry.attributes.uv.array.slice(0, end / 3 * 2), materialCount: 3,
    groups: [{ start: 0, count: end / 6, materialIndex: 2 },
      { start: Math.ceil(end / 18) * 3, count: end, materialIndex: 1 }] };
}

test("cap boundary search preserves every stage byte on bevelled, open, and multi-material meshes", () => {
  const previous = oracle();
  for (const open of [false, true]) {
    const source = extrusion(open);
    for (const closed of [true, false]) for (let distribution = 0; distribution < 4; distribution++) {
      const options = { cells: 12 + distribution * 3, seed: 7 + distribution * 11,
        closed, distribution, cellScale: distribution % 2 ? [70, 130, 90] : [100, 100, 100] };
      const current = fracture.buildVoronoiFracture(source, options);
      assert.equal(current.error, undefined);
      exact(current, previous.buildVoronoiFracture(source, options));
    }
  }
});

test("cap boundary search preserves collinear ties, duplicate points, and translated thin cuts", () => {
  const previous = oracle();
  for (const scale of [1e-5, 1, 1e5]) for (const offset of [0, 1e8 * scale]) {
    const loop = [];
    // A concave, densely subdivided boundary forces the Earcut restoration path.
    const corners = [[0, 0], [5, 0], [5, 4], [3, 2], [0, 4]];
    for (let edge = 0; edge < corners.length; edge++) for (let step = 0; step < 20; step++) {
      const a = corners[edge], b = corners[(edge + 1) % corners.length], t = step / 20;
      loop.push([offset + (a[0] + t * (b[0] - a[0])) * scale,
        -offset + (a[1] + t * (b[1] - a[1])) * scale, offset + scale * 0.3]);
    }
    loop.splice(7, 0, loop[7].slice());
    const plane = { nx: 0, ny: 0, nz: 1, d: offset + scale * 0.3 };
    exact(fracture.capContours([loop], plane, scale * 1e-7, 4096),
      previous.capContours([loop], plane, scale * 1e-7, 4096));
  }
});

test("edge bounds retain candidates within the exact distance tolerance", () => {
  const { createEdgePointIndex } = require("../plugins/scene-plus/effector-fracture-index.js");
  for (const scale of [1e-8, 1, 1e8]) {
    const epsilon = scale * 1e-7;
    const points = Array.from({ length: 100 }, (_, i) => [i / 99 * scale, (i % 3 - 1) * epsilon * 2, scale]);
    const query = createEdgePointIndex(points, epsilon);
    for (const [a, b] of [[[0, 0, scale], [scale, 0, scale]],
      [[scale, 0, scale], [0, 0, scale]], [[0, 0, scale], [0, scale, scale]]]) {
      const candidates = new Set(query(a, b));
      const d = b.map((v, axis) => v - a[axis]), length = d.reduce((s, v) => s + v * v, 0);
      points.forEach((p, id) => {
        const t = p.reduce((s, v, axis) => s + (v - a[axis]) * d[axis], 0) / length;
        const tolerance = epsilon / Math.sqrt(length);
        const distance = p.reduce((s, v, axis) => s + (v - (a[axis] + t * d[axis])) ** 2, 0);
        if (t > tolerance && t < 1 - tolerance && distance <= epsilon * epsilon * 4) assert.ok(candidates.has(id));
      });
    }
  }
});

test("short optional source attributes retain the previous output bytes", () => {
  const previous = oracle(), source = extrusion();
  source.normals = source.normals.slice(0, 5);
  source.uvs = source.uvs.slice(0, 3);
  const options = { cells: 3, seed: 7, closed: true };
  exact(fracture.buildVoronoiFracture(source, options), previous.buildVoronoiFracture(source, options));
});
