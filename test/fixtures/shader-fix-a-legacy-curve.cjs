// Frozen Zoidium-owned curve sampler from 2a7cb26.
"use strict";
const clamp = v => Math.min(1, Math.max(0, Number(v) || 0));
const bezier = (a, b, c, d, t) => (1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*c+t**3*d;
function pointsWithHandles(raw, curves) {
  const points = curves.parseState({ composite: raw }).composite;
  return points.map(p => {
    const original = Array.isArray(raw) && raw.find(q => Array.isArray(q) && Math.abs(Number(q[0])-p[0]) < .00005);
    const handles = original?.[3];
    const valid = v => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
    if (handles && (valid(handles.in) || valid(handles.out))) {
      p[2] = original[2] ?? null; p[3] = {};
      for (const key of ["in", "out"]) if (valid(handles[key])) p[3][key] = handles[key].map(clamp);
    }
    return p;
  });
}
// These automatic slopes match Color Curves. Displaying handles never writes
// them into the project, and segments without explicit handles use its sampler.
function automaticSlopes(points) {
  const widths = [], slopes = [], tangents = new Array(points.length).fill(0), count = points.length;
  for (let i = 0; i < count-1; i++) { widths[i] = Math.max(points[i+1][0]-points[i][0], .0001); slopes[i] = (points[i+1][1]-points[i][1])/widths[i]; }
  tangents[0] = slopes[0]; tangents[count-1] = slopes[count-2];
  for (let i = 1; i < count-1; i++) {
    const a = slopes[i-1], b = slopes[i];
    if (a === 0 || b === 0 || a*b <= 0) tangents[i] = 0;
    else { const w1 = 2*widths[i]+widths[i-1], w2 = widths[i]+2*widths[i-1]; tangents[i] = (w1+w2)/(w1/a+w2/b); }
  }
  return tangents;
}
function segmentHandles(points, index, slopes = automaticSlopes(points)) {
  const a = points[index], b = points[index+1], dx = (b[0]-a[0])/3;
  const out = a[3]?.out || [a[0]+dx, a[1]+dx*slopes[index]], inside = b[3]?.in || [b[0]-dx, b[1]-dx*slopes[index+1]];
  // x handles stay ordered within a segment, giving a unique x -> y mapping.
  const x1 = Math.max(a[0], Math.min(b[0], out[0])), x2 = Math.max(x1, Math.min(b[0], inside[0]));
  return [[x1, out[1]], [x2, inside[1]]];
}
function createGraphSampler(raw, curves) {
  const automatic = curves.createSampler(raw);
  if (!Array.isArray(raw) || !raw.some(p => p?.[3]?.in || p?.[3]?.out)) return automatic;
  const points = pointsWithHandles(raw, curves), slopes = automaticSlopes(points);
  return x => {
    x = clamp(x); let i = 0; while (i < points.length-2 && x > points[i+1][0]) i++;
    const a = points[i], b = points[i+1];
    if (!a[3]?.out && !b[3]?.in) return automatic(x);
    if (x <= a[0]) return a[1]; if (x >= b[0]) return b[1];
    const [out, inside] = segmentHandles(points, i, slopes);
    let lo = 0, hi = 1;
    for (let n = 0; n < 32; n++) { const t = (lo+hi)/2; if (bezier(a[0], out[0], inside[0], b[0], t) < x) lo = t; else hi = t; }
    return clamp(bezier(a[1], out[1], inside[1], b[1], (lo+hi)/2));
  };
}
const PRESETS = {
  "Linear up": [[0, 0], [1, 1]], "Linear down": [[0, 1], [1, 0]],
  "Fade in-out": [[0, 0], [.25, 1], [.75, 1], [1, 0]],
  Bell: [[0, 0], [.5, 1], [1, 0]], Constant: [[0, 1], [1, 1]], Spike: [[0, 0], [.48, 0], [.5, 1], [.52, 0], [1, 0]],
};
module.exports = { pointsWithHandles, automaticSlopes, segmentHandles, createGraphSampler, PRESETS, clamp };
