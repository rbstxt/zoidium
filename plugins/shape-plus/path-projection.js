"use strict";
// Projected cubic picking and screen-to-plane inversion for shared path
// editing (design "Geometry and feedback"). All picking runs in CSS pixels:
// every cubic and its control points are projected through the complete
// host transform and viewport projection before any hit radius applies, so
// the 9 px radius is zoom-invariant. Segment hits use the closest point on
// a subdivided projected cubic, which also finds interior curve extrema.
//
// Consumed contracts (hosts supply these; this module never touches the DOM):
// - `path.matrix`: the path's combined host transform (parents already
//   folded in by the caller) as a 6-element affine `[a, b, c, d, e, f]`.
// - `projection`: the shared viewport projection as a 6-element affine, or
//   null/undefined for identity. The full mapping is
//   `multiply(projection, path.matrix)`.
// - Perspective callers supply `rayFor` (screen point to world-space ray)
//   plus the path's editing `plane` and its forward `worldFromLocal`
//   affine; see `screenToLocalOnPlane`.
//
// Provided (P2.2 consumes the projected coordinates and the inverse
// mapping documented here):
// - `projectVertices` / `projectCubic`: local geometry to CSS pixels.
// - `closestOnCubic`: closest screen point on one subdivided projected cubic.
// - `pickPaths`: one best target plus front-to-back candidates for the P1.4
//   overlap cycler. Tie order is handle, anchor, segment, frontmost path.
// - `screenToLocal`: affine inverse of the same full mapping used for drags.
// - `intersectRayPlane` / `screenToLocalOnPlane`: perspective placement.
//   Singular mappings and edge-on or degenerate planes return an explicit
//   `{ ok: false, reason, message }` failure in English and change nothing.
//
// Pure logic: runs in Node and the browser.
const { HIT_RADIUS_PX } = require("./path-selection.js");
const { evaluate, verticesToCubics } = require("./path.js");
const { multiply, inverse } = require("./editor-geometry.js");

// Screen samples per cubic before local refinement. Dense enough that every
// interior extremum brackets a sampled local minimum on typical editing
// curves; refinement below tightens it to sub-pixel accuracy.
const SEGMENT_SAMPLES = 64;
const REFINE_STEPS = 32;
// A ray this close to parallel with the editing plane counts as edge-on:
// the intersection would slide arbitrarily far from a tiny pointer move.
const EDGE_ON_EPSILON = 1e-9;
const PERSPECTIVE_EDIT_MESSAGE = "Path editing is unavailable in perspective view. Press C to switch to the composited view.";

function isPerspectiveView(viewport) {
  return !!(viewport?.renderMode && viewport.camera?.isPerspectiveCamera);
}

function isMapping(m) {
  return (
    Array.isArray(m) &&
    m.length === 6 &&
    m.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function applyMapping(point, m) {
  return [
    m[0] * point[0] + m[2] * point[1] + m[4],
    m[1] * point[0] + m[3] * point[1] + m[5],
  ];
}

// The full screen mapping for one path: viewport projection after the
// path's combined host transform. Null/undefined inputs mean identity.
// Returns null when either input is malformed or the product is not finite.
function composeMapping(hostMatrix, projection) {
  const host = hostMatrix === null || hostMatrix === undefined ? [1, 0, 0, 1, 0, 0] : hostMatrix;
  const view = projection === null || projection === undefined ? [1, 0, 0, 1, 0, 0] : projection;
  if (!isMapping(host) || !isMapping(view)) return null;
  const full = multiply(view, host);
  return isMapping(full) ? full : null;
}

function failure(reason, message) {
  return { ok: false, reason, message };
}

// Project one path's vertices to CSS pixels. Handle vectors are projected
// as offsets (anchor plus handle, minus projected anchor) so rotation and
// shear move them exactly like the cubic control points below.
function projectVertices(vertices, hostMatrix, projection) {
  if (!Array.isArray(vertices)) throw Error("Path projection needs a vertices array");
  const full = composeMapping(hostMatrix, projection);
  if (!full) throw Error("Path projection needs a finite host matrix and projection");
  return vertices.map((v) => {
    if (!Array.isArray(v?.point)) throw Error("Path projection needs a point per vertex");
    const anchor = applyMapping(v.point, full);
    const offset = (h) =>
      Array.isArray(h)
        ? [
            applyMapping([v.point[0] + h[0], v.point[1] + h[1]], full)[0] - anchor[0],
            applyMapping([v.point[0] + h[0], v.point[1] + h[1]], full)[1] - anchor[1],
          ]
        : [0, 0];
    return { point: anchor, in: offset(v.in), out: offset(v.out) };
  });
}

function projectCubic(cubic, mapping) {
  if (!isMapping(mapping)) throw Error("Path projection needs a finite mapping");
  return cubic.map((p) => applyMapping(p, mapping));
}

// Closest screen point on one projected cubic. Multi-seed search: every
// sampled local minimum is refined independently, so loops and S-curves
// report their true interior closest point instead of the nearest chord.
function closestOnCubic(projected, screen) {
  const samples = [];
  for (let i = 0; i <= SEGMENT_SAMPLES; i++) {
    const p = evaluate(projected, i / SEGMENT_SAMPLES);
    samples.push(Math.hypot(p[0] - screen[0], p[1] - screen[1]));
  }
  const seeds = [];
  for (let i = 0; i <= SEGMENT_SAMPLES; i++)
    if (
      (i === 0 || samples[i] <= samples[i - 1]) &&
      (i === SEGMENT_SAMPLES || samples[i] <= samples[i + 1])
    )
      seeds.push(i);
  let best = { t: 0, distance: Infinity, point: projected[0].slice() };
  for (const seed of seeds) {
    let lo = Math.max(0, (seed - 1) / SEGMENT_SAMPLES),
      hi = Math.min(1, (seed + 1) / SEGMENT_SAMPLES);
    for (let i = 0; i < REFINE_STEPS; i++) {
      const a = lo + ((hi - lo) / 3),
        b = hi - ((hi - lo) / 3);
      const pa = evaluate(projected, a),
        pb = evaluate(projected, b);
      if (
        Math.hypot(pa[0] - screen[0], pa[1] - screen[1]) <
        Math.hypot(pb[0] - screen[0], pb[1] - screen[1])
      )
        hi = b;
      else lo = a;
    }
    const t = (lo + hi) / 2,
      p = evaluate(projected, t),
      distance = Math.hypot(p[0] - screen[0], p[1] - screen[1]);
    if (distance < best.distance) best = { t, distance, point: p };
  }
  return best;
}

function hullOf(cubic) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of cubic) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, maxX, minY, maxY };
}

// Pick the best target at a screen point across paths given in draw order,
// frontmost first. `handlePathIds` (null means every path) limits which
// paths contribute handle/anchor hits; every projectable path contributes
// segment hits. Paths whose full mapping is singular cannot be projected
// and are skipped. Returns `{ target, candidates }`: `target` is the best
// `{ kind, pathId, distance, ... }` hit or null, ordered by handle, anchor,
// segment, then frontmost path; `candidates` are the hit path IDs ordered
// front to back for the P1.4 overlap cycler.
function pickPaths(paths, screen, options = {}) {
  if (!Array.isArray(paths)) throw Error("Path picking needs a paths array");
  if (!Array.isArray(screen) || screen.length < 2 || !screen.slice(0, 2).every(Number.isFinite))
    throw Error("Path picking needs a finite screen point");
  const radius = options.radius === undefined ? HIT_RADIUS_PX : options.radius;
  if (!(radius > 0) || !Number.isFinite(radius)) throw Error("Path picking needs a positive hit radius");
  const editable =
    options.handlePathIds === null ||
    options.handlePathIds === undefined
      ? null
      : new Set(options.handlePathIds);
  const hits = [],
    candidateIds = [];
  paths.forEach((path, order) => {
    if (!path || typeof path.id !== "string") throw Error("Path picking needs a string id per path");
    const full = composeMapping(path.matrix, options.projection);
    if (!full || !inverse(full)) return;
    const projected = projectVertices(path.vertices || [], path.matrix, options.projection);
    let hitPath = false;
    if (!editable || editable.has(path.id)) {
      projected.forEach((v, vertexIndex) => {
        for (const side of ["out", "in"]) {
          if (options.handleFilter && !options.handleFilter(path, vertexIndex, side)) continue;
          if (Math.hypot(v[side][0], v[side][1]) <= 1e-8) continue;
          const knob = [v.point[0] + v[side][0], v.point[1] + v[side][1]];
          const distance = Math.hypot(knob[0] - screen[0], knob[1] - screen[1]);
          if (distance <= radius) {
            hits.push({ kind: "handle", rank: 0, order, pathId: path.id, vertexIndex, side, distance, point: knob });
            hitPath = true;
          }
        }
      });
      projected.forEach((v, vertexIndex) => {
        const distance = Math.hypot(v.point[0] - screen[0], v.point[1] - screen[1]);
        if (distance <= radius) {
          hits.push({ kind: "anchor", rank: 1, order, pathId: path.id, vertexIndex, distance, point: v.point.slice() });
          hitPath = true;
        }
      });
    }
    verticesToCubics(projected, !!path.closed).forEach((cubic, segmentIndex) => {
      const hull = hullOf(cubic);
      if (
        screen[0] < hull.minX - radius ||
        screen[0] > hull.maxX + radius ||
        screen[1] < hull.minY - radius ||
        screen[1] > hull.maxY + radius
      )
        return;
      const found = closestOnCubic(cubic, screen);
      if (found.distance <= radius) {
        hits.push({ kind: "segment", rank: 2, order, pathId: path.id, segmentIndex, t: found.t, distance: found.distance, point: found.point });
        hitPath = true;
      }
    });
    if (hitPath) candidateIds.push(path.id);
  });
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order || a.distance - b.distance);
  const target = hits.length
    ? (({ rank, order, ...rest }) => rest)(hits[0])
    : null;
  return { target, candidates: candidateIds };
}

// Invert the same full mapping a drag started from: screen point back to
// path-local coordinates. A singular or malformed mapping returns an
// explicit failure instead of NaN coordinates; callers must not move data.
function screenToLocal(screen, { matrix, projection } = {}) {
  if (!Array.isArray(screen) || screen.length < 2 || !screen.slice(0, 2).every(Number.isFinite))
    return failure("invalid-point", "The pointer position is invalid, so it cannot be mapped to path coordinates.");
  const full = composeMapping(matrix, projection);
  if (!full)
    return failure(
      "singular-mapping",
      "The path transform is singular, so the pointer cannot be mapped back to path coordinates.",
    );
  const inv = inverse(full);
  if (!inv)
    return failure(
      "singular-mapping",
      "The path transform is singular, so the pointer cannot be mapped back to path coordinates.",
    );
  return { ok: true, local: applyMapping(screen.slice(0, 2), inv) };
}

function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length3 = (v) => Math.hypot(v[0], v[1], v[2]);

// Intersect a world-space screen ray with the path's editing plane. Returns
// `{ ok: true, point }` or an explicit failure: a zero-length normal or
// origin is degenerate, and a ray parallel to the plane is edge-on.
function intersectRayPlane(ray, plane) {
  if (!ray || !isVec3(ray.origin) || !isVec3(ray.direction) || length3(ray.direction) <= 1e-12)
    return failure(
      "invalid-ray",
      "The pointer ray is invalid, so the pointer cannot be placed on the path.",
    );
  if (!plane || !isVec3(plane.point) || !isVec3(plane.normal) || length3(plane.normal) <= 1e-12)
    return failure(
      "degenerate-plane",
      "The path editing plane is degenerate, so the pointer ray cannot meet it.",
    );
  const normal = plane.normal.map((n) => n / length3(plane.normal));
  const direction = ray.direction.map((n) => n / length3(ray.direction));
  const denom = dot3(normal, direction);
  if (Math.abs(denom) < EDGE_ON_EPSILON)
    return failure(
      "edge-on-plane",
      "The editing view is edge-on to the path plane, so the pointer cannot be placed on the path.",
    );
  const t = dot3(
    [plane.point[0] - ray.origin[0], plane.point[1] - ray.origin[1], plane.point[2] - ray.origin[2]],
    normal,
  ) / denom;
  return {
    ok: true,
    point: [ray.origin[0] + direction[0] * t, ray.origin[1] + direction[1] * t, ray.origin[2] + direction[2] * t],
  };
}

// Perspective placement: intersect the screen ray with the path's editing
// plane (both in the same world space as `worldFromLocal`), then apply the
// inverse world transform to the intersection's world x/y. Any failure
// leaves data untouched; the caller shows `message`.
function screenToLocalOnPlane(screen, { rayFor, plane, worldFromLocal } = {}) {
  if (!Array.isArray(screen) || screen.length < 2 || !screen.slice(0, 2).every(Number.isFinite))
    return failure("invalid-point", "The pointer position is invalid, so it cannot be mapped to path coordinates.");
  if (typeof rayFor !== "function")
    return failure("invalid-ray", "The pointer ray is invalid, so the pointer cannot be placed on the path.");
  let ray;
  try {
    ray = rayFor(screen.slice(0, 2));
  } catch (_error) {
    return failure("invalid-ray", "The pointer ray is invalid, so the pointer cannot be placed on the path.");
  }
  const hit = intersectRayPlane(ray, plane);
  if (!hit.ok) return hit;
  if (!isMapping(worldFromLocal))
    return failure(
      "singular-mapping",
      "The path transform is singular, so the pointer cannot be mapped back to path coordinates.",
    );
  const inv = inverse(worldFromLocal);
  if (!inv)
    return failure(
      "singular-mapping",
      "The path transform is singular, so the pointer cannot be mapped back to path coordinates.",
    );
  return { ok: true, local: applyMapping([hit.point[0], hit.point[1]], inv) };
}

module.exports = {
  HIT_RADIUS_PX,
  PERSPECTIVE_EDIT_MESSAGE,
  isPerspectiveView,
  SEGMENT_SAMPLES,
  composeMapping,
  projectVertices,
  projectCubic,
  closestOnCubic,
  pickPaths,
  screenToLocal,
  intersectRayPlane,
  screenToLocalOnPlane,
};
