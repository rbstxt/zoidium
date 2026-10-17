"use strict";
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += cross(points[i], points[(i + 1) % points.length]);
  return sum / 2;
}
// Horizontal arrangement: split slabs at every vertex AND segment crossing.
// Within a slab edge order is fixed, so winding transitions bound disjoint
// trapezoids. This resolves holes, overlaps and self-intersections explicitly.
// No triangle overlaps another interior: alpha is applied once per paint.
function triangulate(contours, rule = "nonzero") {
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
    if ((j & 255) === 0) require("./geometry-budget.js").check();
    const e = edges[i], f = edges[j];
    if (Math.max(e.min, f.min) >= Math.min(e.max, f.max)) continue;
    if (Math.max(Math.min(e.a[0], e.b[0]), Math.min(f.a[0], f.b[0])) > Math.min(Math.max(e.a[0], e.b[0]), Math.max(f.a[0], f.b[0]))) continue;
    const r = [e.b[0] - e.a[0], e.b[1] - e.a[1]], s = [f.b[0] - f.a[0], f.b[1] - f.a[1]];
    const den = cross(r, s);
    if (Math.abs(den) < 1e-12) continue;
    const d = [f.a[0] - e.a[0], f.a[1] - e.a[1]], t = cross(d, s) / den, u = cross(d, r) / den;
    if (t > 0 && t < 1 && u > 0 && u < 1) levels.push(e.a[1] + r[1] * t);
    if (levels.length > 65536) throw Error("Shape+ crossing budget exceeded");
  }
  const ys = [...new Set(levels)].sort((a, b) => a - b), positions = [];
  const xAt = (edge, y) => edge.a[0] + (y - edge.a[1]) * (edge.b[0] - edge.a[0]) / (edge.b[1] - edge.a[1]);
  function triangle(a, b, c) {
    const signed = cross([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]]);
    if (Math.abs(signed) > 1e-10) positions.push(...a, 0, ...b, 0, ...c, 0);
    if (positions.length > 1800000) throw Error("Shape+ triangle budget exceeded");
  }
  let work = 0;
  for (let i = 0; i < ys.length - 1; i++) {
    require("./geometry-budget.js").check();
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
module.exports = { area, triangulate };
