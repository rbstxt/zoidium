"use strict";
// Signed-distance mask expansion (P1.8).
//
// Consumes evaluated layer-space mask geometry ({ vertices, closed }) and an
// expansion in layer pixels, and outputs per-pixel coverage in the 0..1 range
// BEFORE feather, opacity, invert and ordered combination run. P1.9 wires this
// output into mask-raster.js (CPU) and mask-gpu.js (GPU); P1.7 wires the
// persisted `expansion` field through mask-render.js, mask-api.js and the
// property view. This module owns the distance convention both paths share.
//
// Convention (see design.md "Mask data and coverage"):
// - Expansion is a signed distance in layer pixels: positive grows coverage,
//   negative shrinks it. The value scales with coverage resolution, so callers
//   pass the layer-space value and the coverage scale; this module converts.
// - The expanded boundary is the half-coverage contour: a pixel center
//   exactly on the offset boundary reads 0.5, half a pixel inside reads 1,
//   half a pixel outside reads 0 (linear ramp between). The GPU path
//   implements the same formula, so CPU and GPU agree by construction.
// - At exactly 0 this module takes the old rendering path exactly: it calls
//   the same fillPolygon scanline the raster uses, so zero-expansion output
//   is pixel-identical to projects saved before expansion existed.
// - Out-of-range values are rejected visibly (RangeError), never silently
//   clamped, so persisted values survive a load unchanged for a later pass
//   with a wider supported range.
//
// Cost model: the zero fast path costs one scanline fill. A nonzero offset
// recomputes only the band of pixels within |expansion| + 1 px of an edge
// (everywhere else the fill result already equals the saturated ramp), so
// cost scales with perimeter x |expansion|, not with the full target. See
// report-P1.8.md for measurements against the 1024-pixel coverage budget.
const { flattenPath } = require("./path.js");
const { fillPolygon, closeContour } = require("./mask-raster.js");

// Supported expansion range in layer pixels. Old projects default to 0, so
// this bound only gates values a user explicitly edits. Measured against a
// 1024 x 1024 coverage target (the shader-side long-side cap): band cost
// stays well under one fill for typical masks through +/-128 px; beyond that
// a full-frame band on a 256-vertex path approaches seconds in JS, so larger
// magnitudes stay rejected until a faster (GPU-side) path lands in P1.9.
const MIN_EXPANSION = -128;
const MAX_EXPANSION = 128;
const DEFAULT_EXPANSION = 0;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// True for values this module renders, including the default. Anything else
// (non-numbers, NaN, infinities, out-of-range magnitudes) must be rejected
// visibly by normalizeExpansion, never clamped.
function isSupportedExpansion(value) {
  return isFiniteNumber(value) && value >= MIN_EXPANSION && value <= MAX_EXPANSION;
}

// Missing fields on old projects default to 0. Returns the validated value;
// throws a descriptive Error otherwise so callers can surface it instead of
// changing persisted data behind the user's back.
function normalizeExpansion(value) {
  if (value === undefined || value === null) return DEFAULT_EXPANSION;
  if (!isFiniteNumber(value)) throw Error("Layer mask expansion must be a finite number");
  if (value < MIN_EXPANSION || value > MAX_EXPANSION)
    throw Error("Layer mask expansion " + value + " px is outside the supported range " +
      MIN_EXPANSION + ".." + MAX_EXPANSION + " px");
  return value;
}

// Layer pixels to coverage pixels. The coverage scale is <= 1 (long-side
// caps), so a supported layer-space value always stays supported in coverage
// space; no second range check is needed downstream.
function scaleExpansion(expansionLayerPx, scale) {
  if (!isFiniteNumber(expansionLayerPx)) throw Error("Layer mask expansion must be a finite number");
  if (!isFiniteNumber(scale) || !(scale > 0)) throw Error("Layer mask expansion needs a positive scale");
  return expansionLayerPx * scale;
}

// Shortest distance from a pixel center to one segment.
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const squared = dx * dx + dy * dy;
  let t = 0;
  if (squared > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / squared));
  const cx = ax + dx * t, cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy);
}

// Signed distance of a pixel center to a flattened polygon: positive inside,
// negative outside, using the same even-odd rule as the fillPolygon
// scanline so far-field pixels agree with the fill exactly. `points` are
// [x, y] pairs in coverage pixels; the center sampled is (x + 0.5, y + 0.5),
// the same convention fillPolygon uses.
function signedDistance(px, py, points, closed) {
  let inside = false;
  let nearest = Infinity;
  const n = points.length;
  const segments = closed ? n : Math.max(0, n - 1);
  for (let i = 0; i < segments; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const distance = segmentDistance(px, py, a[0], a[1], b[0], b[1]);
    if (distance < nearest) nearest = distance;
    // Even-odd ray cast along +x, matching the scanline's half-open edges.
    if ((a[1] > py) !== (b[1] > py)) {
      const crossing = a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      if (crossing > px) inside = !inside;
    }
  }
  if (!Number.isFinite(nearest)) return -Infinity;
  return inside ? nearest : -nearest;
}

// Flattened coverage-space polygon for one evaluated mask, or null when the
// path covers nothing (fewer than 3 flattened points). Degenerate paths stay
// empty at any expansion: there is no boundary to offset, and the old path
// renders them empty too.
function flattenForExpansion(vertices, closed) {
  const contour = closeContour(vertices || [], !!closed);
  if (contour.length < 2) return null;
  const flat = flattenPath({ vertices: contour, closed: true });
  if (!flat.points || flat.points.length < 3) return null;
  // Zero-area (collinear) contours have no interior to offset: the scanline
  // fill renders them empty, earcut triangulates nothing, and expanding them
  // would invent a stroke the old path never drew. Stay empty instead.
  let area = 0;
  for (let i = 0; i < flat.points.length; i++) {
    const a = flat.points[i], b = flat.points[(i + 1) % flat.points.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1e-9) return null;
  return flat.points;
}

// Pre-feather coverage (Float32Array, row-major, 0..1) for one evaluated
// mask. `entry` is { vertices, closed, expansion } with expansion in LAYER
// pixels; `scale` converts layer pixels to coverage pixels for `width` by
// `height`. At expansion 0 this is exactly fillPolygon output (same call the
// raster makes); otherwise pixels near an edge take clamp(0.5 +
// signedDistance + expansion), the half-coverage boundary both render paths
// share. Only cells near an edge are recomputed: a coarse grid registers
// every segment in the cells its pad-expanded bounding box touches, and a
// pixel keeps its fill value unless its own cell holds a segment. The sign
// comes from the fill (same even-odd rule) while the magnitude is the exact
// minimum over the cell's nearby segments, so cost scales with edge length
// x |expansion| instead of the full target.
function expandCoverage(entry, width, height, scale) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1)
    throw Error("Layer mask expansion needs a positive integer size");
  if (!isFiniteNumber(scale) || !(scale > 0)) throw Error("Layer mask expansion needs a positive scale");
  const expansion = normalizeExpansion(entry ? entry.expansion : undefined);
  const points = flattenForExpansion(entry ? entry.vertices : [], entry ? entry.closed : false);
  const coverage = new Float32Array(width * height);
  if (!points) return coverage;
  const offset = expansion * scale;
  if (offset === 0) {
    fillPolygon(points, width, height, coverage);
    return coverage;
  }
  fillPolygon(points, width, height, coverage);
  const pad = Math.abs(offset) + 1;
  const cell = Math.max(8, Math.min(64, pad));
  const cellsX = Math.max(1, Math.ceil(width / cell));
  const cellsY = Math.max(1, Math.ceil(height / cell));
  const grid = new Map();
  const segments = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    segments.push(a[0], a[1], b[0], b[1]);
  }
  const segmentCount = points.length;
  for (let s = 0; s < segmentCount; s++) {
    const ax = segments[s * 4], ay = segments[s * 4 + 1];
    const bx = segments[s * 4 + 2], by = segments[s * 4 + 3];
    const fromX = Math.max(0, Math.floor((Math.min(ax, bx) - pad) / cell));
    const toX = Math.min(cellsX - 1, Math.floor((Math.max(ax, bx) + pad) / cell));
    const fromY = Math.max(0, Math.floor((Math.min(ay, by) - pad) / cell));
    const toY = Math.min(cellsY - 1, Math.floor((Math.max(ay, by) + pad) / cell));
    for (let cy = fromY; cy <= toY; cy++) {
      for (let cx = fromX; cx <= toX; cx++) {
        const key = cy * cellsX + cx;
        let list = grid.get(key);
        if (!list) {
          list = [];
          grid.set(key, list);
        }
        list.push(s);
      }
    }
  }
  for (const [key, list] of grid) {
    const cx = key % cellsX, cy = (key - cx) / cellsX;
    const fromX = Math.max(0, Math.floor(cx * cell));
    const toX = Math.min(width - 1, Math.ceil((cx + 1) * cell) - 1);
    const fromY = Math.max(0, Math.floor(cy * cell));
    const toY = Math.min(height - 1, Math.ceil((cy + 1) * cell) - 1);
    for (let y = fromY; y <= toY; y++) {
      for (let x = fromX; x <= toX; x++) {
        const px = x + 0.5, py = y + 0.5;
        let nearestSquared = Infinity;
        for (const s of list) {
          const ax = segments[s * 4], ay = segments[s * 4 + 1];
          const bx = segments[s * 4 + 2], by = segments[s * 4 + 3];
          const dx = bx - ax, dy = by - ay;
          const squared = dx * dx + dy * dy;
          let t = 0;
          if (squared > 0) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / squared));
          const ex = ax + dx * t - px, ey = ay + dy * t - py;
          const candidate = ex * ex + ey * ey;
          if (candidate < nearestSquared) nearestSquared = candidate;
        }
        const magnitude = Math.sqrt(nearestSquared);
        const signed = coverage[y * width + x] === 1 ? magnitude : -magnitude;
        let value = 0.5 + signed + offset;
        if (value < 0) value = 0;
        else if (value > 1) value = 1;
        coverage[y * width + x] = value;
      }
    }
  }
  return coverage;
}

// Stable cache-signature fragment for the expansion input. Callers building
// a coverage signature (mask-gpu.js signatureOf in P1.9) append this so two
// masks that differ only in expansion never share a cached texture. Uses the
// SCALED offset so a resolution change that rescales coverage invalidates
// the entry even when the layer-space value is unchanged.
function expansionSignature(entry, scale) {
  const expansion = normalizeExpansion(entry ? entry.expansion : undefined);
  if (!isFiniteNumber(scale) || !(scale > 0)) throw Error("Layer mask expansion needs a positive scale");
  return "expansion:" + (expansion * scale);
}

module.exports = {
  MIN_EXPANSION, MAX_EXPANSION, DEFAULT_EXPANSION,
  isSupportedExpansion, normalizeExpansion, scaleExpansion,
  signedDistance, flattenForExpansion, expandCoverage, expansionSignature,
};
