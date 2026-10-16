"use strict";
// Plain array math adapted from the owner's OpenPath handle/snapping behavior.
const { distance, evaluate, split, verticesToCubics } = require("./path.js");
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, n) => [a[0] * n, a[1] * n];
const vertices = values => Array.from({ length: values.length / 6 }, (_, i) => ({ point: values.slice(i*6, i*6+2), in: values.slice(i*6+2, i*6+4), out: values.slice(i*6+4, i*6+6) }));
const values = points => points.flatMap(v => [...v.point, ...v.in, ...v.out]);
function insert(points, index, t, closed) {
  if (!(t > 0 && t < 1) || index < 0 || index >= points.length - (closed ? 0 : 1)) throw Error("Invalid path split");
  const result = vertices(values(points)), next = (index + 1) % points.length;
  const [a, b] = split(verticesToCubics(points, closed)[index], t);
  result[index].out = sub(a[1], a[0]); result[next].in = sub(b[2], b[3]);
  result.splice(index + 1, 0, { point: a[3], in: sub(a[2], a[3]), out: sub(b[1], b[0]) });
  return result;
}
function constrain(vector) {
  const angle = Math.round(Math.atan2(vector[1], vector[0]) / (Math.PI / 4)) * Math.PI / 4;
  return mul([Math.cos(angle), Math.sin(angle)], Math.hypot(...vector));
}
function handle(vertex, side, vector, mode) {
  const result = vertices(values([vertex]))[0], opposite = side === "in" ? "out" : "in";
  result[side] = vector.slice();
  if (mode === "symmetric") result[opposite] = mul(vector, -1);
  if (mode === "smooth" && Math.hypot(...vector) > 1e-10) result[opposite] = mul(vector, -Math.hypot(...vertex[opposite]) / Math.hypot(...vector));
  return result;
}
function setMode(points, index, mode, closed) {
  const result = vertices(values(points)), v = result[index];
  if (mode === "corner") { v.in = [0, 0]; v.out = [0, 0]; }
  else if (mode !== "independent") {
    const prev = points[(index - 1 + points.length) % points.length], next = points[(index + 1) % points.length];
    const before = closed || index > 0 ? sub(v.point, prev.point) : [0, 0];
    const after = closed || index < points.length - 1 ? sub(next.point, v.point) : [0, 0];
    let direction = add(mul(before, 1 / (Math.hypot(...before) || 1)), mul(after, 1 / (Math.hypot(...after) || 1)));
    if (Math.hypot(...direction) < 1e-9) direction = [1, 0];
    direction = mul(direction, 1 / Math.hypot(...direction));
    const outLength = Math.hypot(...v.out) || Math.hypot(...after) / 3 || 30;
    const inLength = mode === "symmetric" ? outLength : Math.hypot(...v.in) || Math.hypot(...before) / 3 || 30;
    v.in = mul(direction, -inLength); v.out = mul(direction, outLength);
  }
  return result;
}
function snap(point, anchors, { enabled, spacing = 50, scale = 1, threshold = 8 } = {}) {
  if (!enabled) return point.slice();
  const radius = threshold / scale;
  let best = radius, result = point.slice();
  for (const anchor of anchors) {
    const d = distance(point, anchor);
    if (d < best) { best = d; result = anchor.slice(); }
  }
  if (best < radius) return result;
  if (spacing > 0) for (let i = 0; i < 2; i++) {
    const grid = Math.round(point[i] / spacing) * spacing;
    if (Math.abs(point[i] - grid) <= radius) result[i] = grid;
  }
  return result;
}
function nearest(curve, point) {
  // Multiple seeds avoid selecting the wrong side of a loop. Bounded search
  // refines each sampled local minimum without assuming a straight chord.
  const samples = 48, candidates = [];
  const ds = Array.from({ length: samples + 1 }, (_, i) => distance(evaluate(curve, i / samples), point));
  for (let i = 0; i <= samples; i++) if ((i === 0 || ds[i] <= ds[i-1]) && (i === samples || ds[i] <= ds[i+1])) candidates.push(i);
  let best = { t: 0, distance: Infinity };
  for (const seed of candidates) {
    let lo = Math.max(0, (seed - 1) / samples), hi = Math.min(1, (seed + 1) / samples);
    for (let i = 0; i < 24; i++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (distance(evaluate(curve, a), point) < distance(evaluate(curve, b), point)) hi = b; else lo = a;
    }
    const t = (lo + hi) / 2, d = distance(evaluate(curve, t), point);
    if (d < best.distance) best = { t, distance: d };
  }
  return best;
}
function hit(points, closed, point, scale, handles = true) {
  const radius = 8 / scale;
  if (handles) for (let i = points.length - 1; i >= 0; i--) for (const side of ["out", "in"]) {
    if (!closed && (side === "in" && i === 0 || side === "out" && i === points.length - 1)) continue;
    if (Math.hypot(...points[i][side]) > 1e-8 && distance(point, add(points[i].point, points[i][side])) <= radius) return { kind: "handle", index: i, side };
  }
  for (let i = points.length - 1; i >= 0; i--) if (distance(point, points[i].point) <= radius) return { kind: "anchor", index: i };
  let best = null;
  verticesToCubics(points, closed).forEach((c, index) => {
    const found = nearest(c, point);
    if (found.distance <= radius && (!best || found.distance < best.distance)) best = { kind: "segment", index, ...found };
  });
  return best;
}
function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function inverse(m) {
  const d = m[0]*m[3]-m[1]*m[2];
  if (Math.abs(d) < 1e-12) return null;
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
module.exports = { add, sub, mul, vertices, values, insert, constrain, handle, setMode, snap, nearest, hit, multiply, inverse };
