"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../plugins/material-plus/uv-layout.js"), "utf8");
const layout = vm.runInNewContext(`(function () {${source.replace(
  "isEligibleGeometry: uvIsEligibleGeometry,",
  "buildOutlineIndex: uvBuildOutlineIndex, outlineCandidates: uvOutlineCandidates, isEligibleGeometry: uvIsEligibleGeometry,"
)}})()`)();

function extrusion(points, rings = [0, 3]) {
  const vertices = rings.flatMap(z => points.map(p => ({ x: p.x, y: p.y, z })));
  const faces = [];
  const n = points.length;
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = ring * n + i;
      const b = ring * n + (i + 1) % n;
      faces.push({ a, b, c: a + n }, { a: b, b: b + n, c: a + n });
    }
  }
  const faceVertexUvs = [faces.map(() => Array.from({ length: 3 }, () => ({
    x: -1, y: -2, set(x, y) { this.x = x; this.y = y; },
  })))];
  return { type: "ExtrudeGeometry", vertices, faces, faceVertexUvs };
}

function ring(n) {
  return Array.from({ length: n }, (_, i) => {
    const angle = i * Math.PI * 2 / n;
    const radius = 10 + Math.sin(angle * 7) * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

function fingerprint(geometry) {
  const values = geometry.faceVertexUvs.flat(2).flatMap(uv => [uv.x, uv.y]);
  return crypto.createHash("sha256").update(Buffer.from(new Float64Array(values).buffer)).digest("hex");
}

test("dense contours retain the exact legacy seam and wall UVs", () => {
  const geometry = extrusion(ring(4096), [0, .25, 1, 3]);
  layout.normalizeGeometry(geometry);
  assert.equal(fingerprint(geometry), "c9797dfffb628ae5601735ccaaaaf95e910df43242ab49b6048556d72da4cbc9");
});

test("nearest-segment work stays below a full contour scan for every wall", () => {
  let reads = 0;
  const points = ring(4096).map(p => ({
    get x() { reads += 1; return p.x; },
    get y() { reads += 1; return p.y; },
  }));
  const prepared = layout.prepareContours([points]);
  const index = layout.buildOutlineIndex(prepared);
  reads = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    layout.outlineCandidates(index, p.x, p.y, 20);
  }
  assert.ok(reads < 4_000_000, `Expected bounded neighborhood searches, got ${reads} coordinate reads`);
});

test("spatial searches prune contours whose serialized order overlaps their bounds", () => {
  let reads = 0;
  const contours = Array.from({ length: 1024 }, (_, index) => {
    const cell = index * 613 % 1024;
    const x = cell % 32 * 4, y = Math.floor(cell / 32) * 4;
    return [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([px, py]) => ({
      get x() { reads += 1; return px; },
      get y() { reads += 1; return py; },
    }));
  });
  const prepared = layout.prepareContours(contours);
  const index = layout.buildOutlineIndex(prepared);
  reads = 0;
  for (const points of contours) {
    layout.outlineCandidates(index, points[0].x + .5, points[0].y, 20);
  }
  assert.ok(reads < 200_000, `Expected spatially grouped searches, got ${reads} coordinate reads`);
});

// Exhaustive oracle for tie behavior, including the non-transitive epsilon
// transition where a farther segment can determine which nearest arc survives.
function exhaustive(prepared, x, y, scale) {
  let best = Infinity;
  const result = [];
  for (const contour of prepared) {
    for (let i = 0; i < contour.points.length; i += 1) {
      const a = contour.points[i];
      const b = contour.points[(i + 1) % contour.points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const squared = dx * dx + dy * dy;
      const projection = squared > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / squared : 0;
      const t = Math.max(0, Math.min(1, projection));
      const px = a.x + dx * t, py = a.y + dy * t;
      const distanceSquared = (x - px) * (x - px) + (y - py) * (y - py);
      if (distanceSquared < best - 1e-12) { best = distanceSquared; result.length = 0; }
      else if (distanceSquared > best + 1e-12) continue;
      const arc = contour.cumulative[i] + Math.sqrt(squared) * t;
      result.push({ arc, total: contour.total, u: arc / scale, distanceSquared });
    }
  }
  return result;
}

test("spatial queries preserve contour order, epsilon transitions and closing seam ties", () => {
  const contours = [ring(128), ring(35).map(p => ({ x: p.x / 10, y: p.y / 10 }))];
  for (const offset of [Math.sqrt(2.5e-12), Math.sqrt(1.9e-12), Math.sqrt(.99e-12), 0]) {
    contours.push([{ x: -1, y: offset }, { x: 1, y: offset }, { x: 1, y: 2 }]);
  }
  const prepared = layout.prepareContours(contours);
  const index = layout.buildOutlineIndex(prepared);
  const queries = [[0, 0], [10, 0], [-10, 0], [1e-8, 0]];
  for (let i = 0; i < 400; i += 1) queries.push([Math.sin(i * 3.7) * 15, Math.cos(i * 1.1) * 15]);
  for (const [x, y] of queries) {
    assert.equal(JSON.stringify(layout.outlineCandidates(index, x, y, 20)),
      JSON.stringify(exhaustive(prepared, x, y, 20)), `Query ${x},${y}`);
  }
});

test("normalization caches cannot survive changed geometry or scale after restoration", () => {
  const geometry = extrusion(ring(40));
  layout.applyToGeometry(geometry);
  const original = fingerprint(geometry);
  layout.restoreGeometry(geometry);
  geometry.vertices.forEach(v => { v.x *= 2; v.z *= 3; });
  layout.applyToGeometry(geometry);
  const fresh = extrusion(ring(40).map(p => ({ x: p.x * 2, y: p.y })), [0, 9]);
  layout.normalizeGeometry(fresh);
  assert.notEqual(fingerprint(geometry), original);
  assert.equal(fingerprint(geometry), fingerprint(fresh));
});
