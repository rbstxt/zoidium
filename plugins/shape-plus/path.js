"use strict";
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function split(c, t = .5) {
  const a = mix(c[0], c[1], t), b = mix(c[1], c[2], t), d = mix(c[2], c[3], t);
  const e = mix(a, b, t), f = mix(b, d, t), p = mix(e, f, t);
  return [[c[0].slice(), a, e, p], [p.slice(), f, d, c[3].slice()]];
}
function evaluate(c, t) { return split(c, t)[0][3]; }
function derivative(c, t) {
  const u = 1 - t;
  return [0, 1].map(k => 3 * (u * u * (c[1][k] - c[0][k]) + 2 * u * t * (c[2][k] - c[1][k]) + t * t * (c[3][k] - c[2][k])));
}
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return distance(p, mix(a, b, t));
}
// A cubic is inside its control hull. Distance to the finite chord (rather
// than the infinite line) also detects collinear overshoot and reversal.
// Budget exhaustion rejects the job instead of silently breaking tolerance.
function flatten(c, tolerance = .125, budget = 4096) {
  if (!(tolerance > 0) || !Number.isFinite(tolerance) || !c.flat().every(Number.isFinite)) throw Error("Invalid cubic or tolerance");
  if (!Number.isInteger(budget) || budget < 2 || budget > 4096) throw Error("Invalid Shape+ point budget");
  const points = [c[0].slice()], stack = [{ c, depth: 0 }];
  while (stack.length) {
    const item = stack.pop(), curve = item.c;
    const error = Math.max(segmentDistance(curve[1], curve[0], curve[3]), segmentDistance(curve[2], curve[0], curve[3]));
    if (error <= tolerance) points.push(curve[3].slice());
    else {
      if (item.depth >= 24 || points.length + stack.length + 2 > budget) throw Error("Shape+ curve subdivision budget exceeded");
      const halves = split(curve);
      stack.push({ c: halves[1], depth: item.depth + 1 }, { c: halves[0], depth: item.depth + 1 });
    }
  }
  return points;
}
function verticesToCubics(vertices, closed) {
  const out = [], n = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    out.push([a.point, [a.point[0] + a.out[0], a.point[1] + a.out[1]], [b.point[0] + b.in[0], b.point[1] + b.in[1]], b.point]);
  }
  return out;
}
function flattenPath(path, tolerance) {
  const points = [];
  for (const c of verticesToCubics(path.vertices, path.closed)) {
    const next = flatten(c, tolerance);
    if (points.length) next.shift();
    points.push(...next);
    if (points.length > 4096) throw Error("Shape+ path point budget exceeded");
  }
  if (path.closed && points.length && distance(points[0], points[points.length - 1]) < 1e-9) points.pop();
  return { points, closed: path.closed, id: path.id };
}
function lengthTable(points, closed = false) {
  const lengths = [0];
  for (let i = 1; i < points.length + (closed ? 1 : 0); i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i % points.length]));
  return { lengths, total: lengths[lengths.length - 1] };
}
module.exports = { mix, distance, split, evaluate, derivative, segmentDistance, flatten, verticesToCubics, flattenPath, lengthTable };
