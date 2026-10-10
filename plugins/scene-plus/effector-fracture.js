"use strict";

// Voronoi Fracture for Effector. Pure geometry: no THREE or PZ access.
//
// Topology (cells, fragments, caps) is built once per source geometry, seed,
// cell count, and input positions, and is cached by the caller. Per-frame motion
// (distance, scatter, spin, offset, field) is a pure function of time applied
// to that cached topology, so animating motion never rebuilds the cells.
//
// Method:
//  1. Cell i is the convex region of points closer to site i than to any other
//     site. It is built exactly as a set of bisector half-spaces clipped to a
//     padded box. Only half-spaces that actually cut the cell are kept.
//  2. Every source triangle is clipped by each cell's half-spaces, so the
//     fragments of a triangle partition it exactly: no holes and no overlaps.
//  3. Clip each source surface one bisector plane at a time and cap its planar
//     cut loops before the next plane. Existing caps are clipped too, giving
//     watertight ridges and retaining cells inside the source volume.

const core = require("./effector-core.js");
// Earcut 2.2.4, ISC license, fetched from its npm package.
const earcut = require("./earcut.js");

const MAX_CELLS = 1000;
const MIN_TRIANGLE_LENGTH = 1e-12;
const LOOP_LIMIT = 4096;

const DEFAULT_LIMITS = Object.freeze({
  maxSourceTriangles: 40000,
  maxOutputTriangles: 400000,
  maxCapVertices: 512,
  maxClipOperations: 10000000,
});

function clampCells(value) {
  const number = Math.round(core.finiteOr(value, 24));
  return Math.min(MAX_CELLS, Math.max(1, number));
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(v, fallback) {
  const length = Math.sqrt(dot3(v, v));
  if (!(length > MIN_TRIANGLE_LENGTH) || !Number.isFinite(length)) return fallback.slice();
  return [v[0] / length, v[1] / length, v[2] / length];
}

function distanceSquared3(a, b) {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return x * x + y * y + z * z;
}

// Keeps the part of a convex polygon set inside plane.n . x <= plane.d.
// Faces are arrays of [x, y, z]. A cut is recorded by adding a cap polygon on
// the plane; `cut` is false when no vertex lay outside, so nothing changed.
function clipFaces(faces, plane, eps) {
  const output = [];
  const cutPoints = [];
  let changed = false;
  for (const face of faces) {
    const count = face.length;
    const signed = new Float64Array(count);
    for (let index = 0; index < count; index += 1) {
      const point = face[index];
      signed[index] = plane.nx * point[0] + plane.ny * point[1] + plane.nz * point[2] - plane.d;
      if (signed[index] > eps) changed = true;
    }
    const polygon = [];
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      const si = signed[index];
      const sj = signed[next];
      const current = face[index];
      if (si <= eps) {
        polygon.push(current);
        if (si >= -eps) cutPoints.push(current);
      }
      if ((si > eps && sj < -eps) || (si < -eps && sj > eps)) {
        const t = si / (si - sj);
        const other = face[next];
        const point = [
          current[0] + (other[0] - current[0]) * t,
          current[1] + (other[1] - current[1]) * t,
          current[2] + (other[2] - current[2]) * t,
        ];
        polygon.push(point);
        cutPoints.push(point);
      }
    }
    if (polygon.length >= 3) output.push(polygon);
  }
  if (!changed) return { faces, cut: false };
  const cap = capPolygon(cutPoints, plane, eps * 100);
  if (cap) output.push(cap);
  return { faces: output, cut: true };
}

// Orders points on a plane around their centroid. Duplicate points within
// `tolerance` are removed first.
function capPolygon(points, plane, tolerance) {
  const tolerance2 = tolerance * tolerance;
  const unique = [];
  for (const point of points) {
    let duplicate = false;
    for (const existing of unique) {
      if (distanceSquared3(point, existing) <= tolerance2) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) unique.push(point);
  }
  if (unique.length < 3) return null;
  const normal = [plane.nx, plane.ny, plane.nz];
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize3(cross3(normal, helper), [0, 0, 1]);
  const v = cross3(normal, u);
  const centroid = [0, 0, 0];
  for (const point of unique) {
    centroid[0] += point[0] / unique.length;
    centroid[1] += point[1] / unique.length;
    centroid[2] += point[2] / unique.length;
  }
  const angles = unique.map((point) => {
    const offset = [point[0] - centroid[0], point[1] - centroid[1], point[2] - centroid[2]];
    return Math.atan2(dot3(offset, v), dot3(offset, u));
  });
  const order = unique.map((_point, index) => index).sort((a, b) => angles[a] - angles[b]);
  return order.map((index) => unique[index]);
}

// Convex cells from bisector half-spaces, clipped to the padded box. Planes that
// never cut a cell are redundant and are dropped, which keeps per-triangle
// clipping cheap.
function buildCells(sites, low, high, eps, metric = [1, 1, 1]) {
  const squared = point => point.reduce((sum, v, i) => sum + v * v * metric[i], 0);
  const box = [
    [[low[0], low[1], low[2]], [high[0], low[1], low[2]], [high[0], high[1], low[2]], [low[0], high[1], low[2]]],
    [[low[0], low[1], high[2]], [high[0], low[1], high[2]], [high[0], high[1], high[2]], [low[0], high[1], high[2]]],
    [[low[0], low[1], low[2]], [high[0], low[1], low[2]], [high[0], low[1], high[2]], [low[0], low[1], high[2]]],
    [[low[0], high[1], low[2]], [high[0], high[1], low[2]], [high[0], high[1], high[2]], [low[0], high[1], high[2]]],
    [[low[0], low[1], low[2]], [low[0], high[1], low[2]], [low[0], high[1], high[2]], [low[0], low[1], high[2]]],
    [[high[0], low[1], low[2]], [high[0], high[1], low[2]], [high[0], high[1], high[2]], [high[0], low[1], high[2]]],
  ];
  return sites.map((site, cellIndex) => {
    let faces = box;
    const planes = [];
    const siteSquared = squared(site);
    // Nearby sites shrink the cell first. A site farther than twice its
    // farthest remaining vertex cannot cut it, by the triangle inequality in
    // the cell metric. This avoids clipping against every distant site.
    const neighbors = sites.map((target, other) => ({
      other,
      distance: target.reduce((sum, v, axis) => sum + (v - site[axis]) ** 2 * metric[axis], 0),
    })).filter(item => item.other !== cellIndex).sort((a, b) => a.distance - b.distance || a.other - b.other);
    let radiusSquared = Infinity;
    for (const neighbor of neighbors) {
      if (neighbor.distance > 4 * radiusSquared + eps * eps * 16) break;
      const target = sites[neighbor.other];
      const delta = target.map((v, i) => (v - site[i]) * metric[i]);
      const length = Math.sqrt(dot3(delta, delta));
      if (!(length > 1e-28)) continue;
      const plane = {
        nx: delta[0] / length,
        ny: delta[1] / length,
        nz: delta[2] / length,
        d: (squared(target) - siteSquared) / (2 * length),
      };
      const clipped = clipFaces(faces, plane, eps);
      if (clipped.cut) {
        faces = clipped.faces;
        planes.push(plane);
        radiusSquared = 0;
        for (const face of faces) for (const point of face) {
          const distance = point.reduce((sum, v, axis) => sum + (v - site[axis]) ** 2 * metric[axis], 0);
          radiusSquared = Math.max(radiusSquared, distance);
        }
      }
    }
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const face of faces) {
      for (const point of face) {
        for (let axis = 0; axis < 3; axis += 1) {
          if (point[axis] < min[axis]) min[axis] = point[axis];
          if (point[axis] > max[axis]) max[axis] = point[axis];
        }
      }
    }
    // Earlier cuts can be made redundant by a later neighbor. Only retain
    // planes that still bound a face, avoiding needless cap subdivisions.
    const activePlanes = planes.filter((plane) => faces.some((face) =>
      face.length >= 3 && face.every((p) => Math.abs(plane.nx * p[0] + plane.ny * p[1] + plane.nz * p[2] - plane.d) < eps * 16)
    ));
    return { planes: activePlanes, min, max };
  });
}

// Source triangle corners carry position and optional UV coordinates.
function clipRecords(polygon, plane, eps) {
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

function intersectRecords(a, b, si, sj) {
  const t = si / (si - sj);
  const point = [
    a.p[0] + (b.p[0] - a.p[0]) * t,
    a.p[1] + (b.p[1] - a.p[1]) * t,
    a.p[2] + (b.p[2] - a.p[2]) * t,
  ];
  const uv = a.uv && b.uv
    ? [a.uv[0] + (b.uv[0] - a.uv[0]) * t, a.uv[1] + (b.uv[1] - a.uv[1]) * t]
    : null;
  const normal = a.normal && b.normal ? a.normal.map((v, i) => v + (b.normal[i] - v) * t) : null;
  return { p: point, uv, normal };
}

// Closed boundary loops from undirected edges. A loop must return to its start;
// open chains are dropped and left uncapped.
function extractLoops(edges) {
  const adjacency = new Map();
  edges.forEach((edge, index) => {
    for (const vertex of edge) {
      let list = adjacency.get(vertex);
      if (!list) {
        list = [];
        adjacency.set(vertex, list);
      }
      list.push(index);
    }
  });
  const used = new Uint8Array(edges.length);
  const loops = [];
  for (let start = 0; start < edges.length; start += 1) {
    if (used[start]) continue;
    used[start] = 1;
    const first = edges[start][0];
    const loop = [first];
    let current = edges[start][1];
    let closed = false;
    while (loop.length <= LOOP_LIMIT) {
      if (current === first) {
        closed = true;
        break;
      }
      loop.push(current);
      const candidates = adjacency.get(current) || [];
      let next = -1;
      for (const index of candidates) {
        if (!used[index]) {
          next = index;
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      current = edges[next][0] === current ? edges[next][1] : edges[next][0];
    }
    if (closed && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// Weld cut endpoints using neighboring buckets rather than rounded keys alone:
// two evaluations of a shared edge can fall on opposite sides of a bucket.
function cutLoops(cuts, epsilon) {
  const buckets = new Map();
  const points = [];
  function weld(point) {
    const cell = point.map((v) => Math.floor(v / epsilon));
    for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
      const list = buckets.get([cell[0] + x, cell[1] + y, cell[2] + z].join(","));
      for (const id of list || []) if (distanceSquared3(points[id], point) <= epsilon * epsilon) return id;
    }
    const key = cell.join(",");
    const list = buckets.get(key) || [];
    const id = points.length;
    points.push(point);
    list.push(id);
    buckets.set(key, list);
    return id;
  }
  const edges = new Map();
  for (const [a, b] of cuts) {
    const i = weld(a);
    const j = weld(b);
    if (i === j) continue;
    const key = Math.min(i, j) + ":" + Math.max(i, j);
    if (edges.has(key)) edges.delete(key);
    else edges.set(key, [i, j]);
  }
  return extractLoops(Array.from(edges.values())).map((loop) => loop.reverse().map((id) => points[id]));
}

function pointInTriangle2(px, py, ax, ay, bx, by, cx, cy, epsilon) {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return d1 >= -epsilon && d2 >= -epsilon && d3 >= -epsilon;
}

// Ear clipping in the loop's own plane. Returns index triples into `points`,
// or null when the loop is not simple in that plane (the caller then fans).
function earClip(points, normal) {
  const count = points.length;
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize3(cross3(normal, helper), [0, 0, 1]);
  const v = cross3(normal, u);
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    px[index] = dot3(points[index], u);
    py[index] = dot3(points[index], v);
  }
  const epsilon = Math.max(...px.map(Math.abs), ...py.map(Math.abs), 1) ** 2 * 1e-12;
  const remaining = [];
  for (let index = 0; index < count; index += 1) remaining.push(index);
  const triangles = [];
  while (remaining.length > 3) {
    let found = false;
    const size = remaining.length;
    for (let position = 0; position < size; position += 1) {
      const previous = remaining[(position + size - 1) % size];
      const current = remaining[position];
      const next = remaining[(position + 1) % size];
      const cross = (px[current] - px[previous]) * (py[next] - py[previous]) -
        (py[current] - py[previous]) * (px[next] - px[previous]);
      if (!(cross > epsilon)) continue;
      let blocked = false;
      for (const other of remaining) {
        if (other === previous || other === current || other === next) continue;
        if (pointInTriangle2(px[other], py[other], px[previous], py[previous], px[current], py[current], px[next], py[next], epsilon)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      triangles.push([previous, current, next]);
      remaining.splice(position, 1);
      found = true;
      break;
    }
    if (!found) return null;
  }
  triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

// Caps one closed loop. Returns triangles as triples of point arrays. Ear
// clipping handles concave planar loops. Convex loops use an interior centroid
// fan that retains collinear boundary subdivisions. The bounded fallback is
// used for oversized or non-planar loops; valid cell cuts are planar.
function convexLoop(points, normal, diameter) {
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length], c = points[(i + 2) % points.length];
    const turn = dot3(cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - b[0], c[1] - b[1], c[2] - b[2]]), normal);
    if (turn < -diameter * diameter * 1e-12) return false;
  }
  return true;
}

function triangulateLoop(points, maxCapVertices) {
  let area = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area = [
      area[0] + (a[1] - b[1]) * (a[2] + b[2]),
      area[1] + (a[2] - b[2]) * (a[0] + b[0]),
      area[2] + (a[0] - b[0]) * (a[1] + b[1]),
    ];
  }
  if (!(dot3(area, area) > 1e-28)) return [];
  const normal = normalize3(area, [0, 0, 1]);
  const centroid = [0, 0, 0];
  for (const point of points) {
    centroid[0] += point[0] / points.length;
    centroid[1] += point[1] / points.length;
    centroid[2] += point[2] / points.length;
  }
  // Ear clipping is exact only for a planar loop. A non-planar loop would give
  // diagonals that coincide with fragment edges in 3D, so those use the fan.
  let deviation = 0;
  for (const point of points) {
    deviation = Math.max(deviation, Math.abs(dot3([point[0] - centroid[0], point[1] - centroid[1], point[2] - centroid[2]], normal)));
  }
  const diameter = Math.sqrt(distanceSquared3(points[0], centroid)) * 2 || 1;
  let indexTriples = null;
  if (points.length === 3) {
    indexTriples = [[0, 1, 2]];
  } else if (points.length <= maxCapVertices && deviation <= diameter * 1e-4) {
    const convex = convexLoop(points, normal, diameter);
    if (!convex) indexTriples = earClip(points, normal);
  }
  if (indexTriples) {
    return indexTriples.map((triple) => triple.map((value) => points[value]));
  }
  const triangles = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const edgeA = [a[0] - centroid[0], a[1] - centroid[1], a[2] - centroid[2]];
    const edgeB = [b[0] - centroid[0], b[1] - centroid[1], b[2] - centroid[2]];
    const triangleNormal = cross3(edgeA, edgeB);
    if (!(dot3(triangleNormal, triangleNormal) > 1e-28)) continue;
    triangles.push(dot3(triangleNormal, normal) < 0 ? [centroid, b, a] : [centroid, a, b]);
  }
  return triangles;
}

// Triangulate the entire planar cut, including holes. Filling each loop alone
// seals counters in bevelled text and creates overlapping interior slabs.
function capContours(loops, plane, epsilon, maxVertices) {
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

function hueToRgb(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToRgb(hue, saturation, lightness) {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    hueToRgb(p, q, hue + 1 / 3),
    hueToRgb(p, q, hue),
    hueToRgb(p, q, hue - 1 / 3),
  ];
}

function pieceColor(seed, piece) {
  const hue = core.hash01(seed, piece, 40);
  const saturation = 0.45 + 0.2 * core.hash01(seed, piece, 41);
  const lightness = 0.55 + 0.15 * core.hash01(seed, piece, 42);
  return hslToRgb(hue, saturation, lightness);
}

// Builds the cached fracture stage for one input. `source` is
// {positions, index?, uvs?}; options includes cells, seed, closed, distribution,
// and cellScale. Returns a stage
// (kind "fracture") or {error} when a limit is hit or the input is unusable.
function buildVoronoiFracture(source, options, limits) {
  const limit = Object.assign({}, DEFAULT_LIMITS, limits || {});
  const cells = clampCells(options.cells);
  const seed = Math.trunc(core.finiteOr(options.seed, 1));
  const closed = options.closed !== false;
  const positions = source.positions;
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
    sourcePolygons.push({ points, cap: false });
  }
  const fragmentPositions = [];
  const fragmentNormals = [];
  const capNormals = [];
  const fragmentUvs = [];
  const fragmentPiece = [];
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
        next.push({ points, cap: polygon.cap });
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
        if (!caps) return { error: "cap-invalid" };
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
    capPositions,
    capPieces,
    capTriangleCount,
    hasUvs: Boolean(uvs),
  });
}

function assembleStage(parts) {
  const fragmentCount = parts.fragmentPiece.length;
  const triangleCount = fragmentCount / 3 + parts.capTriangleCount;
  const vertexCount = triangleCount * 3;
  const positions = new Float32Array(vertexCount * 3);
  const pieceIds = new Uint16Array(vertexCount);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = parts.hasUvs ? new Float32Array(vertexCount * 2) : null;
  positions.set(parts.fragmentPositions, 0);
  if (uvs && parts.fragmentUvs.length) uvs.set(parts.fragmentUvs, 0);
  const fragmentVertices = fragmentCount;
  for (let vertex = 0; vertex < fragmentVertices; vertex += 1) {
    pieceIds[vertex] = parts.fragmentPiece[vertex];
  }
  positions.set(parts.capPositions, fragmentVertices * 3);
  for (let vertex = fragmentVertices; vertex < vertexCount; vertex += 1) {
    pieceIds[vertex] = parts.capPieces[Math.floor((vertex - fragmentVertices) / 3)] || 0;
  }

  const palette = Array.from({ length: parts.cells }, (_value, piece) => pieceColor(parts.seed, piece));
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const color = palette[pieceIds[vertex]];
    colors[vertex * 3] = color[0];
    colors[vertex * 3 + 1] = color[1];
    colors[vertex * 3 + 2] = color[2];
  }

  const sums = new Float64Array(parts.cells * 3);
  const counts = new Uint32Array(parts.cells);
  for (let vertex = 0; vertex < fragmentVertices; vertex += 1) {
    const piece = pieceIds[vertex];
    sums[piece * 3] += positions[vertex * 3];
    sums[piece * 3 + 1] += positions[vertex * 3 + 1];
    sums[piece * 3 + 2] += positions[vertex * 3 + 2];
    counts[piece] += 1;
  }
  const centroids = new Float32Array(parts.cells * 3);
  for (let piece = 0; piece < parts.cells; piece += 1) {
    const site = parts.sites[piece];
    if (counts[piece] > 0) {
      centroids[piece * 3] = sums[piece * 3] / counts[piece];
      centroids[piece * 3 + 1] = sums[piece * 3 + 1] / counts[piece];
      centroids[piece * 3 + 2] = sums[piece * 3 + 2] / counts[piece];
    } else {
      centroids[piece * 3] = site[0];
      centroids[piece * 3 + 1] = site[1];
      centroids[piece * 3 + 2] = site[2];
    }
  }

  for (let index = 0; index < positions.length; index += 1) {
    if (!Number.isFinite(positions[index])) return { error: "invalid" };
  }

  const center = [0, 1, 2].map((axis) => 0.5 * (parts.bounds.min[axis] + parts.bounds.max[axis]));
  const attributes = { color: { array: colors, itemSize: 3, normalized: false } };
  if (parts.hasNormals) attributes.normal = { array: new Float32Array([...parts.fragmentNormals, ...parts.capNormals]), itemSize: 3, normalized: false };
  if (uvs) attributes.uv = { array: uvs, itemSize: 2, normalized: false };
  return {
    kind: "fracture",
    smooth: false,
    count: vertexCount,
    positions,
    attributes,
    uvs,
    index: null,
    indexRef: null,
    groups: [],
    pieceIds,
    pieceCount: parts.cells,
    pieceCentroids: centroids,
    center,
    seed: parts.seed,
    cells: parts.cells,
    closed: parts.closed,
    triangleCount,
    capTriangleCount: parts.capTriangleCount,
    ...core.boundsOf(positions),
  };
}

// Per-piece transform for the current motion properties. Each piece's motion is
// a function of (seed, piece index, property values): translation along the
// piece's direction from the fracture centre, seeded scatter, a seeded rotation
// about a seeded axis, and a shrink toward the piece centroid. Field weights
// scale every motion term. `matrix` maps the stage's local frame to the deformer's
// frame. The per-vertex positions are updated in place.
function applyFragmentMotion(positions, stage, motion, matrix) {
  if (!stage || !stage.pieceIds || !stage.pieceCentroids) return positions;
  const cells = stage.pieceCount;
  const seed = stage.seed;
  const distance = core.finiteOr(motion.distance, 0);
  const scatter = core.finiteOr(motion.scatter, 0);
  const offset = core.finiteOr(motion.offset, 0);
  const spin = core.finiteOr(motion.spin, 0);
  const field = motion.field || null;
  const preparedField = core.prepareField(field, stage.positions, matrix);
  const direction = motion.direction || [0, 0, 0];
  const explicitRotation = motion.rotation || [0, 0, 0];
  const fragmentScale = core.finiteOr(motion.fragmentScale, 100);
  const gravity = core.finiteOr(motion.gravity, 0);
  const randomness = core.clampUnit(core.finiteOr(motion.randomness, 0) / 100);
  const center = matrix ? core.transformPoint(stage.center, matrix) : stage.center.slice();
  const shift = new Float64Array(cells * 3);
  const centroid = new Float64Array(cells * 3);
  const scale = new Float64Array(cells);
  const rotation = new Float64Array(cells * 9);
  for (let piece = 0; piece < cells; piece += 1) {
    const rest = [
      stage.pieceCentroids[piece * 3],
      stage.pieceCentroids[piece * 3 + 1],
      stage.pieceCentroids[piece * 3 + 2],
    ];
    const local = matrix ? core.transformPoint(rest, matrix) : rest;
    centroid[piece * 3] = local[0];
    centroid[piece * 3 + 1] = local[1];
    centroid[piece * 3 + 2] = local[2];
    const fieldWeight = core.evaluateField(local[0], local[1], local[2], preparedField);
    const variation = 1 - randomness * core.hash01(seed, piece, 40);
    const weight = fieldWeight * variation;
    const outward = normalize3(
      [local[0] - center[0], local[1] - center[1], local[2] - center[2]],
      core.hashUnitVector(seed, piece, 10)
    );
    const scatterDirection = core.hashUnitVector(seed, piece, 21);
    const scatterMagnitude = 0.5 + core.hash01(seed, piece, 24);
    const spinSign = 2 * core.hash01(seed, piece, 30) - 1;
    const axis = core.hashUnitVector(seed, piece, 31);
    const angle = spin * spinSign * weight;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const oneMinus = 1 - cosine;
    const [x, y, z] = axis;
    shift[piece * 3] = (outward[0] * distance + scatterDirection[0] * scatterMagnitude * scatter + core.finiteOr(direction[0], 0)) * weight;
    shift[piece * 3 + 1] = (outward[1] * distance + scatterDirection[1] * scatterMagnitude * scatter + core.finiteOr(direction[1], 0)) * weight - gravity * fieldWeight * fieldWeight * variation;
    shift[piece * 3 + 2] = (outward[2] * distance + scatterDirection[2] * scatterMagnitude * scatter + core.finiteOr(direction[2], 0)) * weight;
    scale[piece] = Math.max(0, 1 - (offset / 100) * weight) * Math.max(0, 1 + (fragmentScale / 100 - 1) * weight);
    rotation.set([
      cosine + x * x * oneMinus, x * y * oneMinus - z * sine, x * z * oneMinus + y * sine,
      y * x * oneMinus + z * sine, cosine + y * y * oneMinus, y * z * oneMinus - x * sine,
      z * x * oneMinus - y * sine, z * y * oneMinus + x * sine, cosine + z * z * oneMinus,
    ], piece * 9);
    // Apply explicit XYZ rotation after the seeded spin, both about the centroid.
    const degrees = explicitRotation.map(v => core.finiteOr(v, 0) * weight);
    for (let column = 0; column < 3; column++) {
      const r = piece * 9;
      const rotated = core.rotateXYZ([rotation[r + column], rotation[r + 3 + column], rotation[r + 6 + column]], degrees);
      for (let row = 0; row < 3; row++) rotation[r + row * 3 + column] = rotated[row];
    }

  }

  for (let vertex = 0; vertex * 3 + 2 < positions.length && vertex < stage.pieceIds.length; vertex += 1) {
    const piece = stage.pieceIds[vertex];
    if (piece >= cells) continue;
    const cx = centroid[piece * 3];
    const cy = centroid[piece * 3 + 1];
    const cz = centroid[piece * 3 + 2];
    const qx = (positions[vertex * 3] - cx) * scale[piece];
    const qy = (positions[vertex * 3 + 1] - cy) * scale[piece];
    const qz = (positions[vertex * 3 + 2] - cz) * scale[piece];
    const r = piece * 9;
    positions[vertex * 3] = cx + rotation[r] * qx + rotation[r + 1] * qy + rotation[r + 2] * qz + shift[piece * 3];
    positions[vertex * 3 + 1] = cy + rotation[r + 3] * qx + rotation[r + 4] * qy + rotation[r + 5] * qz + shift[piece * 3 + 1];
    positions[vertex * 3 + 2] = cz + rotation[r + 6] * qx + rotation[r + 7] * qy + rotation[r + 8] * qz + shift[piece * 3 + 2];
  }
  return positions;
}

module.exports = {
  DEFAULT_LIMITS,
  MAX_CELLS,
  applyFragmentMotion,
  buildVoronoiFracture,
  capContours,
  clampCells,
  extractLoops,
  pieceColor,
  triangulateLoop,
};
