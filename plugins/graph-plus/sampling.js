"use strict";
const { expressionOf, evaluatedValue } = require("./property-state.js");

// Subdivide in screen space. Seed intervals prevent symmetric oscillations
// from hiding between equal endpoints and midpoints.
function easingPoints(fn, width, height, tolerance = 0.35) {
  const start = fn(0), end = fn(1);
  const nearStart = fn(1e-10), nearEnd = fn(1 - 1e-10);
  const jumpStart = Math.abs(start - nearStart) * Math.abs(height) > tolerance;
  const jumpEnd = Math.abs(end - nearEnd) * Math.abs(height) > tolerance;
  const evaluate = u => u === 0 && jumpStart ? nearStart : u === 1 && jumpEnd ? nearEnd : fn(u);
  const result = [[0, start]];
  if (jumpStart) result.push([0, nearStart]);
  let remaining = 4096;
  function split(a, va, b, vb, depth) {
    const m = (a + b) / 2, vm = evaluate(m);
    const q = (3 * a + b) / 4, vq = evaluate(q);
    const r = (a + 3 * b) / 4, vr = evaluate(r);
    const error = Math.max(Math.abs(vm - (va + vb) / 2),
      Math.abs(vq - (3 * va + vb) / 4), Math.abs(vr - (va + 3 * vb) / 4)) * Math.abs(height);
    if (remaining > 1 && depth < 24 && (error > tolerance || (b - a) * width > 8)) {
      remaining--;
      split(a, va, m, vm, depth + 1);
      split(m, vm, b, vb, depth + 1);
    } else result.push([b, vb]);
  }
  for (let i = 0; i < 32; i++) split(i / 32, evaluate(i / 32), (i + 1) / 32, evaluate((i + 1) / 32), 0);
  if (jumpEnd) result.push([1, end]);
  return result;
}

// A redraw shares at most 1,024 host evaluations and 6 ms between tracks.
// Sampling resumes across redraws; a synchronous host call is not preemptible.
// Wide frames use finer spacing, capped at 64 samples per frame.
class ExpressionSamples {
  constructor(now = () => performance.now()) { this.now = now; this.cache = new WeakMap(); }
  invalidate() { this.cache = new WeakMap(); }
  sample(property, start, end, zoom, budget = { deadline: this.now() + 6, remaining: 1024 }) {
    const step = Math.min(1, Math.max(zoom * 2, 1 / 64));
    const first = Math.floor(start / step) * step;
    const last = Math.ceil(end / step) * step;
    const expression = expressionOf(property);
    const key = [expression?.source, first, last, step].join("|");
    const old = this.cache.get(property);
    if (old?.key === key && old.expression === expression && old.complete) return old;
    const record = old?.key === key && old.expression === expression ? old : {
      key, expression, points: [], next: first, complete: false, elapsedMs: 0,
    };
    const begin = this.now();
    while (record.next <= last && budget.remaining > 0 && this.now() < budget.deadline) {
      const frame = record.next;
      let value;
      try { value = evaluatedValue(property, frame); } catch (_error) { value = NaN; }
      record.points.push([frame, typeof value === "number" ? value : NaN]);
      record.next += step;
      budget.remaining--;
    }
    record.complete = record.next > last;
    record.elapsedMs += this.now() - begin;
    this.cache.set(property, record);
    return record;
  }
}
// Builds the SVG path of sampled expression values in screen pixels. When
// several samples fall in one pixel column (a fast expression seen zoomed
// out), that column becomes one vertical stroke from its lowest to its
// highest value, like an audio waveform. A zigzag through every sample made
// those columns look like noise. Returns dense: true when any column was
// reduced.
function expressionPath(points, toX, toY) {
  let d = "", connected = false, dense = false, group = [];
  const flush = () => {
    if (!group.length) return;
    if (group.length === 1) {
      d += (connected ? " L " : " M ") + group[0][0] + " " + group[0][1];
    } else {
      dense = true;
      const x = Math.floor(group[0][0]) + 0.5;
      let low = group[0][1], high = group[0][1];
      for (const point of group) { low = Math.min(low, point[1]); high = Math.max(high, point[1]); }
      const first = group[0][1], last = group[group.length - 1][1];
      // Enter at the first value and leave at the last, so neighbouring
      // columns connect where the samples do.
      d += (connected ? " L " : " M ") + x + " " + first + " L " + x + " " + low + " L " + x + " " + high + " L " + x + " " + last;
    }
    connected = true;
    group = [];
  };
  for (const point of points) {
    if (!Number.isFinite(point[1])) { flush(); connected = false; continue; }
    const screen = [toX(point[0]), toY(point[1])];
    if (group.length && Math.floor(group[0][0]) !== Math.floor(screen[0])) flush();
    group.push(screen);
  }
  flush();
  return { d, dense };
}
module.exports = { easingPoints, ExpressionSamples, expressionPath };
