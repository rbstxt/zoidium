"use strict";
// Batch B (fix 4): the generic fill sweep must emit exactly the old arrays.
// The old pair-search implementation below is a verbatim copy of
// plugins/shape-plus/fill.js before the sweep change, kept as the test-only
// reference. Every case requires deepStrictEqual (same triangles, same
// emission order, same arithmetic) for both winding rules.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { check, used } = require("../plugins/shape-plus/geometry-budget.js");
const { area, triangulate } = require("../plugins/shape-plus/fill.js");
const { outlines, legacyStroke } = require("../plugins/shape-plus/stroke.js");
const { compile } = require("../plugins/shape-plus/compiler.js");

const oldCross = (a, b) => a[0] * b[1] - a[1] * b[0];
function oldTriangulate(contours, rule = "nonzero") {
  const edges = [], levels = [];
  for (const points of contours) {
    if (points.length < 3) continue;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (!a.concat(b).every(Number.isFinite)) throw Error("Shape+ nonfinite polygon");
      levels.push(a[1]);
      if (levels.length > 16384 || edges.length > 4096) throw Error("Shape+ polygon edge budget exceeded");
      if (a[1] !== b[1]) edges.push({ a, b, min: Math.min(a[1], b[1]), max: Math.max(a[1], b[1]), sign: b[1] > a[1] ? 1 : -1, index: edges.length });
    }
  }
  if (edges.length > 4096) throw Error("Shape+ polygon edge budget exceeded");
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    if ((j & 255) === 0) check();
    const e = edges[i], f = edges[j];
    if (Math.max(e.min, f.min) >= Math.min(e.max, f.max)) continue;
    if (Math.max(Math.min(e.a[0], e.b[0]), Math.min(f.a[0], f.b[0])) > Math.min(Math.max(e.a[0], e.b[0]), Math.max(f.a[0], f.b[0]))) continue;
    const r = [e.b[0] - e.a[0], e.b[1] - e.a[1]], s = [f.b[0] - f.a[0], f.b[1] - f.a[1]];
    const den = oldCross(r, s);
    if (Math.abs(den) < 1e-12) continue;
    const d = [f.a[0] - e.a[0], f.a[1] - e.a[1]], t = oldCross(d, s) / den, u = oldCross(d, r) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) levels.push(e.a[1] + r[1] * t);
    if (levels.length > 65536) throw Error("Shape+ crossing budget exceeded");
  }
  const ys = [...new Set(levels)].sort((a, b) => a - b), positions = [];
  const xAt = (edge, y) => edge.a[0] + (y - edge.a[1]) * (edge.b[0] - edge.a[0]) / (edge.b[1] - edge.a[1]);
  function triangle(a, b, c) {
    const signed = oldCross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]);
    if (Math.abs(signed) > 1e-10) positions.push(...a, 0, ...b, 0, ...c, 0);
    if (positions.length > 1800000) throw Error("Shape+ triangle budget exceeded");
  }
  let work = 0;
  for (let i = 0; i < ys.length - 1; i++) {
    check();
    const low = ys[i], high = ys[i + 1], mid = (low + high) / 2;
    if (high - low < 1e-10) continue;
    work += edges.length;
    if (work > 16000000) throw Error("Shape+ arrangement work budget exceeded");
    const active = edges.filter(e => e.min < mid && e.max > mid).sort((a, b) => xAt(a, mid) - xAt(b, mid) || a.index - b.index);
    let winding = 0, left = null;
    for (let j = 0; j < active.length;) {
      const edge = active[j], x = xAt(edge, mid), before = rule === "even-odd" ? Math.abs(winding) % 2 !== 0 : winding !== 0;
      do { winding += active[j].sign; j++; } while (j < active.length && Math.abs(xAt(active[j], mid) - x) < 1e-9);
      const inside = rule === "even-odd" ? Math.abs(winding) % 2 !== 0 : winding !== 0;
      if (!before && inside) left = edge;
      if (before && !inside && left) {
        const a = [xAt(left, low), low], b = [xAt(edge, low), low], c = [xAt(edge, high), high], d = [xAt(left, high), high];
        triangle(a, b, c); triangle(a, c, d); left = null;
      }
    }
  }
  return positions;
}

let seed = 0xC0FFEE;
const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32;
const point = scale => [random() * scale, random() * scale];
const polygon = (n, scale = 40) => Array.from({ length: n }, () => point(scale));
const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function checkExact(contours) {
  for (const rule of ["nonzero", "even-odd"]) {
    const before = used();
    const expected = oldTriangulate(contours, rule);
    const oldCharge = used() - before;
    const start = used();
    const actual = triangulate(contours, rule);
    assert.equal(used() - start, oldCharge, `work-budget charge differs (${rule})`);
    assert.deepStrictEqual(actual, expected, `triangle arrays differ (${rule})`);
  }
}

test("area export is unchanged", () => {
  assert.equal(area([[0, 0], [4, 0], [4, 3]]), 6);
});

test("seeded crossings, coincident edges, holes and touching contours match exactly", () => {
  for (let i = 0; i < 60; i++) checkExact(Array.from({ length: 3 }, () => polygon(6)));
  // Coincident and shared edges, touching corners, nested holes.
  const outer = rect(0, 0, 10, 10), inner = rect(3, 3, 4, 4);
  checkExact([outer, outer]);
  checkExact([outer, outer.map(p => p.slice())]);
  checkExact([outer, inner.slice().reverse()]);
  checkExact([outer, inner]);
  checkExact([outer, rect(10, 10, 5, 5)]);
  checkExact([outer, rect(10, 0, 5, 5)]);
  checkExact([outer, rect(2, 2, 3, 3)]);
  checkExact([[[0, 0], [10, 10], [0, 10], [10, 0]]]);
  checkExact([[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]]]);
  // Degenerate spans: duplicate points, collinear runs, horizontal edges.
  checkExact([[[0, 0], [0, 0], [5, 0], [5, 5], [0, 5]]]);
  checkExact([[[0, 0], [2, 0], [4, 0], [4, 4], [0, 4]]]);
  checkExact([[[0, 0], [10, 0], [10, 10], [5, 10], [5, 5], [0, 5]]]);
});

test("open paths, scales and boundary levels match exactly", () => {
  for (let i = 0; i < 40; i++) {
    const scale = [0.001, 1, 1000][i % 3];
    checkExact(Array.from({ length: 2 }, () => polygon(8, scale)));
  }
  // Contours sharing exact Y levels across edges.
  checkExact([rect(0, 0, 10, 10), rect(20, 0, 10, 10), rect(5, 10, 10, 10)]);
});

test("gradient fills route through the same sweep", () => {
  const paths = [polygon(8), polygon(6)];
  checkExact(paths);
  const paint = fill => ({ id: "g", kind: fill, properties: { enabled: 1, fillRule: "nonzero", color: [1, 0, 0], opacity: 1, gradientType: "linear", startPoint: [0, 0], endPoint: [10, 10], stops: [[0, [1, 0, 0, 1]], [1, [0, 0, 1, 1]]] } });
  const shape = id => ({ id, kind: "rectangle", properties: { enabled: 1, size: [10, 10], position: [0, 0], roundness: 0 } });
  // Gradient selection must not change triangulated positions.
  const flat = compile([shape("r"), paint("fill")]);
  const graded = compile([shape("r"), paint("gradientFill")]);
  assert.deepStrictEqual(graded.commands[0].positions, flat.commands[0].positions);
});

test("legacy stroke outlines match exactly", () => {
  const style = { width: 2, cap: "butt", join: "miter", miterLimit: 4 };
  const cases = [
    [{ points: [[0, 0], [10, 0]], closed: false }],
    [{ points: [[0, 0], [10, 0]], closed: false }, { points: [[5, -5], [5, 5]], closed: false }],
    [{ points: [[0, 0], [10, 0], [10, 10]], closed: false }],
    [{ points: rect(0, 0, 10, 10), closed: true }],
    [{ points: [[0, 0], [3, 7], [6, 2], [9, 9]], closed: false }],
  ];
  for (const paths of cases) {
    const polygons = outlines(paths, style);
    assert.deepStrictEqual(triangulate(polygons, "nonzero"), oldTriangulate(polygons, "nonzero"));
    assert.deepStrictEqual(legacyStroke(paths, style), oldTriangulate(polygons, "nonzero"));
  }
  // Dashed (profiled) outlines take the same triangulation route.
  const dashed = [{ points: [[0, 0], [12, 0]], closed: false }];
  const dashStyle = { ...style, dashPairs: 1, dash1: 3, gap1: 2, dashOffset: 0 };
  const polygons = outlines(require("../plugins/shape-plus/stroke-profile.js").profile(dashed, dashStyle), style);
  assert.deepStrictEqual(triangulate(polygons, "nonzero"), oldTriangulate(polygons, "nonzero"));
});

test("3,840-vertex case matches exactly", () => {
  const rings = Array.from({ length: 16 }, (_, j) => Array.from({ length: 240 }, (_, i) => {
    const t = i / 240 * 2 * Math.PI;
    return [(j % 4) * 220 + 80 * Math.cos(t), Math.floor(j / 4) * 140 + 55 * Math.sin(t)];
  }));
  assert.equal(rings.flat().length, 3840);
  checkExact(rings);
});
