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
//  3. For each piece, the boundary edges that come from cell cuts (not from the
//     open border of the source mesh) form closed loops. Each loop is capped by
//     an ear-clipped polygon in its Newell plane, with a centroid fan fallback.

const core = require("./effector-core.js");

const MAX_CELLS = 200;
const MIN_TRIANGLE_LENGTH = 1e-12;
const LOOP_LIMIT = 4096;

const DEFAULT_LIMITS = Object.freeze({
  maxSourceTriangles: 40000,
  maxOutputTriangles: 400000,
  maxCapVertices: 512,
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
function buildCells(sites, low, high, eps) {
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
    const siteSquared = dot3(site, site);
    for (let other = 0; other < sites.length; other += 1) {
      if (other === cellIndex) continue;
      const target = sites[other];
      const delta = [target[0] - site[0], target[1] - site[1], target[2] - site[2]];
      const length = Math.sqrt(dot3(delta, delta));
      if (!(length > MIN_TRIANGLE_LENGTH)) continue;
      const plane = {
        nx: delta[0] / length,
        ny: delta[1] / length,
        nz: delta[2] / length,
        d: (dot3(target, target) - siteSquared) / (2 * length),
      };
      const clipped = clipFaces(faces, plane, eps);
      if (clipped.cut) {
        faces = clipped.faces;
        planes.push(plane);
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
    return { planes, min, max };
  });
}

// Source triangle corners carry position, optional uv, and the source edge ids
// they lie on. An edge id is 3 * triangle + local edge, so a fragment edge that
// lies on a source edge can be classified as open border or interior.
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

function sharedEdge(a, b) {
  for (const edge of a.e) {
    if (edge >= 0 && (b.e[0] === edge || b.e[1] === edge)) return edge;
  }
  return -1;
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
  const edge = sharedEdge(a, b);
  return { p: point, uv, e: [edge, -1] };
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

function pointInTriangle2(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const d2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const d3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
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
      if (!(cross > 0)) continue;
      let blocked = false;
      for (const other of remaining) {
        if (other === previous || other === current || other === next) continue;
        if (pointInTriangle2(px[other], py[other], px[previous], py[previous], px[current], py[current], px[next], py[next])) {
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
// clipping is preferred. A centroid fan is used when the loop is too large or
// not simple in its plane. Fan triangles are oriented to the loop normal, so
// a non-star-shaped loop still yields a closed, consistently facing cap.
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
  if (!(dot3(area, area) > MIN_TRIANGLE_LENGTH)) return [];
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
    indexTriples = earClip(points, normal);
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
    if (!(dot3(triangleNormal, triangleNormal) > MIN_TRIANGLE_LENGTH)) continue;
    triangles.push(dot3(triangleNormal, normal) < 0 ? [centroid, b, a] : [centroid, a, b]);
  }
  return triangles;
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
// {positions, index?, uvs?}; `options` is {cells, seed, closed}. Returns a stage
// (kind "fracture") or {error} when a limit is hit or the input is unusable.
function buildVoronoiFracture(source, options, limits) {
  const limit = Object.assign({}, DEFAULT_LIMITS, limits || {});
  const cells = clampCells(options.cells);
  const seed = Math.trunc(core.finiteOr(options.seed, 1));
  const closed = options.closed !== false;
  const positions = source.positions;
  const index = source.index || null;
  const uvs = source.uvs || null;
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

  const sites = [];
  for (let cell = 0; cell < cells; cell += 1) {
    sites.push([
      bounds.min[0] + size[0] * core.hash01(seed, cell, 0),
      bounds.min[1] + size[1] * core.hash01(seed, cell, 1),
      bounds.min[2] + size[2] * core.hash01(seed, cell, 2),
    ]);
  }
  const low = bounds.min.map((value) => value - padding);
  const high = bounds.max.map((value) => value + padding);
  const cellInfo = buildCells(sites, low, high, planeEpsilon);

  // Welding: exact-position identity with a quantized key. Cut points on the
  // same source edge are computed from identical endpoints, so they match.
  const weldMap = new Map();
  const weldPoints = [];
  const weld = (x, y, z) => {
    const key = Math.round(x / weldEpsilon) + "," + Math.round(y / weldEpsilon) + "," + Math.round(z / weldEpsilon);
    let id = weldMap.get(key);
    if (id === undefined) {
      id = weldPoints.length / 3;
      weldMap.set(key, id);
      weldPoints.push(x, y, z);
    }
    return id;
  };

  // Open source edges (count 1) are the mesh border. Their fragment edges are
  // not cap edges.
  const sourceEdgeCounts = new Map();
  const sourceEdgeWelds = new Int32Array(triangleCount * 3 * 2);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = vertexAt(triangle, corner);
      sourceEdgeWelds[(triangle * 3 + corner) * 2] = weld(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]);
    }
  }
  const weldCount = () => weldPoints.length / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = sourceEdgeWelds[(triangle * 3 + edge) * 2];
      const b = sourceEdgeWelds[(triangle * 3 + ((edge + 1) % 3)) * 2];
      const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
      sourceEdgeCounts.set(key, (sourceEdgeCounts.get(key) || 0) + 1);
    }
  }
  const openEdge = new Uint8Array(triangleCount * 3);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = sourceEdgeWelds[(triangle * 3 + edge) * 2];
      const b = sourceEdgeWelds[(triangle * 3 + ((edge + 1) % 3)) * 2];
      const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
      openEdge[triangle * 3 + edge] = sourceEdgeCounts.get(key) === 1 ? 1 : 0;
    }
  }

  const corner = (triangle, local) => {
    const vertex = vertexAt(triangle, local);
    return {
      p: [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]],
      uv: uvs ? [uvs[vertex * 2], uvs[vertex * 2 + 1]] : null,
      e: [triangle * 3 + local, triangle * 3 + ((local + 2) % 3)],
    };
  };

  // Fragment output: positions, welded ids, open-edge flags, piece per triangle.
  const fragmentPositions = [];
  const fragmentUvs = [];
  const fragmentWelds = [];
  const fragmentOpen = [];
  const fragmentPiece = [];
  const maxOutput = limit.maxOutputTriangles;
  const emitPolygon = (polygon, piece) => {
    for (let fan = 1; fan + 1 < polygon.length; fan += 1) {
      const triple = [polygon[0], polygon[fan], polygon[fan + 1]];
      const edgeA = [triple[1].p[0] - triple[0].p[0], triple[1].p[1] - triple[0].p[1], triple[1].p[2] - triple[0].p[2]];
      const edgeB = [triple[2].p[0] - triple[0].p[0], triple[2].p[1] - triple[0].p[1], triple[2].p[2] - triple[0].p[2]];
      const area = cross3(edgeA, edgeB);
      if (!(dot3(area, area) > 0)) continue;
      for (let k = 0; k < 3; k += 1) {
        const point = triple[k].p;
        fragmentPositions.push(point[0], point[1], point[2]);
        fragmentWelds.push(weld(point[0], point[1], point[2]));
        if (uvs) fragmentUvs.push(triple[k].uv ? triple[k].uv[0] : 0, triple[k].uv ? triple[k].uv[1] : 0);
        fragmentPiece.push(piece);
      }
      for (let k = 0; k < 3; k += 1) {
        const a = triple[k];
        const b = triple[(k + 1) % 3];
        const shared = sharedEdge(a, b);
        fragmentOpen.push(shared >= 0 && openEdge[shared] === 1 ? 1 : 0);
      }
    }
  };

  // Clip every triangle by every cell whose bounding box it touches.
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const corners = [corner(triangle, 0), corner(triangle, 1), corner(triangle, 2)];
    const low3 = [Infinity, Infinity, Infinity];
    const high3 = [-Infinity, -Infinity, -Infinity];
    for (const item of corners) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (item.p[axis] < low3[axis]) low3[axis] = item.p[axis];
        if (item.p[axis] > high3[axis]) high3[axis] = item.p[axis];
      }
    }
    for (let cell = 0; cell < cells; cell += 1) {
      const info = cellInfo[cell];
      if (!info || info.min[0] > info.max[0]) continue;
      if (high3[0] < info.min[0] - planeEpsilon || low3[0] > info.max[0] + planeEpsilon) continue;
      if (high3[1] < info.min[1] - planeEpsilon || low3[1] > info.max[1] + planeEpsilon) continue;
      if (high3[2] < info.min[2] - planeEpsilon || low3[2] > info.max[2] + planeEpsilon) continue;
      let polygon = corners;
      for (const plane of info.planes) {
        polygon = clipRecords(polygon, plane, planeEpsilon);
        if (polygon.length < 3) break;
      }
      if (polygon.length >= 3) emitPolygon(polygon, cell);
      if (fragmentPiece.length / 3 > maxOutput) return { error: "output-limit" };
    }
  }

  const fragmentTriangles = fragmentPiece.length / 3;
  if (!fragmentTriangles) return { error: "empty" };

  // Group fragment triangles by piece, then cap each piece's cut loops.
  const pieceTriangles = Array.from({ length: cells }, () => []);
  for (let triangle = 0; triangle < fragmentTriangles; triangle += 1) {
    pieceTriangles[fragmentPiece[triangle * 3]].push(triangle);
  }
  const capPositions = [];
  const capPieces = [];
  let capTriangleCount = 0;
  const weldStride = Math.max(1, weldCount());
  if (closed) {
    for (let piece = 0; piece < cells; piece += 1) {
      const triangles = pieceTriangles[piece];
      if (!triangles.length) continue;
      const edgeMap = new Map();
      const edges = [];
      for (const triangle of triangles) {
        for (let edge = 0; edge < 3; edge += 1) {
          const a = fragmentWelds[triangle * 3 + edge];
          const b = fragmentWelds[triangle * 3 + ((edge + 1) % 3)];
          const key = a < b ? a * weldStride + b : b * weldStride + a;
          const record = edgeMap.get(key);
          if (record) {
            record.count += 1;
          } else {
            const created = { a, b, count: 1, open: fragmentOpen[triangle * 3 + edge] };
            edgeMap.set(key, created);
            edges.push(created);
          }
        }
      }
      const boundary = [];
      for (const edge of edges) {
        if (edge.count === 1 && !edge.open) boundary.push([edge.a, edge.b]);
      }
      for (const loop of extractLoops(boundary)) {
        // The walk follows each boundary edge in its fragment direction. A cap
        // must traverse those edges the other way round, so the loop is reversed.
        const points = loop
          .map((id) => [weldPoints[id * 3], weldPoints[id * 3 + 1], weldPoints[id * 3 + 2]])
          .reverse();
        for (const triple of triangulateLoop(points, limit.maxCapVertices)) {
          for (const point of triple) capPositions.push(point[0], point[1], point[2]);
          capPieces.push(piece);
          capTriangleCount += 1;
          if (fragmentTriangles + capTriangleCount > maxOutput) return { error: "output-limit" };
        }
      }
    }
  }

  return assembleStage({
    cells,
    seed,
    closed,
    sites,
    bounds,
    fragmentPositions,
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
// scale all four terms. `matrix` maps the stage's local frame to the deformer's
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
  const fieldType = field ? core.clampIndex(field.type, 3) : 0;
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
    const weight = fieldType
      ? core.fieldWeight(local[0], local[1], local[2], fieldType, field.position, field.scale)
      : 1;
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
    shift[piece * 3] = (outward[0] * distance + scatterDirection[0] * scatterMagnitude * scatter) * weight;
    shift[piece * 3 + 1] = (outward[1] * distance + scatterDirection[1] * scatterMagnitude * scatter) * weight;
    shift[piece * 3 + 2] = (outward[2] * distance + scatterDirection[2] * scatterMagnitude * scatter) * weight;
    scale[piece] = Math.max(0, 1 - (offset / 100) * weight);
    rotation.set([
      cosine + x * x * oneMinus, x * y * oneMinus - z * sine, x * z * oneMinus + y * sine,
      y * x * oneMinus + z * sine, cosine + y * y * oneMinus, y * z * oneMinus - x * sine,
      z * x * oneMinus - y * sine, z * y * oneMinus + x * sine, cosine + z * z * oneMinus,
    ], piece * 9);
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
  clampCells,
  extractLoops,
  pieceColor,
  triangulateLoop,
};
