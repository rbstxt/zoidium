"use strict";
const { lengthTable, mix, distance, flattenPath } = require("./path.js");
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const wrap = (v, period = 1) => ((v % period) + period) % period;
const MAX_FRAGMENTS = 2048;
function at(path, length, table = lengthTable(path.points, path.closed)) {
  const s = clamp(length, 0, table.total), points = path.points;
  let i = 1;
  while (i < table.lengths.length - 1 && table.lengths[i] < s) i++;
  const start = table.lengths[i - 1], end = table.lengths[i];
  return end > start ? mix(points[(i - 1) % points.length], points[i % points.length], (s - start) / (end - start)) : points[0]?.slice() || [0, 0];
}
function slice(path, start, end) {
  const table = lengthTable(path.points, path.closed), points = [at(path, start, table)], distances = [start];
  for (let i = 1; i < table.lengths.length; i++) if (table.lengths[i] > start + 1e-9 && table.lengths[i] < end - 1e-9) {
    points.push(path.points[i % path.points.length].slice()); distances.push(table.lengths[i]);
  }
  points.push(at(path, end, table)); distances.push(end);
  return { ...path, points, closed: false, distances, totalLength: table.total };
}
function intervals(start, end, offset) {
  const span = clamp(Math.abs(end - start) / 100);
  if (span >= 1 - 1e-10) return [[0, 1]];
  if (span < 1e-10) return [];
  const a = wrap(Math.min(start, end) / 100 + offset / 360), b = a + span;
  return b > 1 ? [[a, 1], [0, b - 1]] : [[a, b]];
}
function trim(paths, p) {
  const ranges = intervals(p.start, p.end, p.offset), lengths = paths.map(path => lengthTable(path.points, path.closed).total);
  const total = lengths.reduce((a, b) => a + b, 0), individual = p.mode === "individual";
  let cursor = 0;
  const result = [];
  paths.forEach((path, i) => {
    const length = lengths[i], domain = individual ? total : length, origin = individual ? cursor : 0, pieces = [];
    for (const [a, b] of ranges) {
      const start = Math.max(0, a * domain - origin), end = Math.min(length, b * domain - origin);
      if (end - start > 1e-9) pieces.push(start === 0 && end === length ? { ...path } : slice(path, start, end));
    }
    if (path.closed && pieces.length === 2 && pieces[0].points.at(-1) && distance(pieces[0].points.at(-1), pieces[1].points[0]) < 1e-8) {
      pieces[0] = { ...pieces[0], points: [...pieces[0].points, ...pieces[1].points.slice(1)] }; pieces.pop();
    }
    // A trim defines a fresh width-profile domain, before dash fragmentation.
    for (const piece of pieces) { delete piece.distances; delete piece.totalLength; }
    result.push(...pieces); cursor += length;
  });
  return result;
}
function dash(paths, style) {
  const pairs = clamp(Math.round(style.dashPairs || 0), 0, 3);
  if (!pairs) return paths;
  const pattern = Array.from({ length: pairs }, (_, i) => [Math.max(0, style["dash" + (i + 1)] || 0), Math.max(0, style["gap" + (i + 1)] || 0)]).flat();
  const period = pattern.reduce((a, b) => a + b, 0);
  if (period < 1e-6) throw Error("Shape+ dash pattern must have a positive length");
  const result = [];
  for (const path of paths) {
    const total = lengthTable(path.points, path.closed).total, pieces = [];
    let phase = wrap(style.dashOffset || 0, period), index = 0;
    while (phase >= pattern[index] && index < pattern.length - 1) { phase -= pattern[index]; index++; }
    let cursor = 0, visits = 0;
    while (cursor < total - 1e-9) {
      if (++visits > MAX_FRAGMENTS * 8) throw Error("Shape+ dash fragment budget exceeded");
      const end = Math.min(total, cursor + pattern[index] - phase);
      if (index % 2 === 0 && end > cursor + 1e-9) pieces.push(slice(path, cursor, end));
      cursor = end; phase = 0; index = (index + 1) % pattern.length;
      if (pieces.length + result.length > MAX_FRAGMENTS) throw Error("Shape+ dash fragment budget exceeded");
    }
    if (path.closed && pieces.length && pieces[0].distances[0] === 0 && pieces.at(-1).distances.at(-1) === total) {
      if (pieces.length === 1) pieces[0] = { ...path };
      else {
        const first = pieces.shift(), last = pieces.pop();
        pieces.unshift({ ...last, points: [...last.points, ...first.points.slice(1)], distances: [...last.distances, ...first.distances.slice(1).map(s => s + total)] });
      }
    }
    result.push(...pieces);
  }
  return result;
}
function widthAt(s, total, p) {
  if (!(total > 0)) return Math.max(0, p.width);
  const start = clamp((p.startLength || 0) / 100) * total, end = clamp((p.endLength || 0) / 100) * total;
  const ease = (t, e) => Math.pow(clamp(t), Math.pow(2, clamp(e || 0, -100, 100) / 50));
  let width = 1;
  if (start && s < start) width *= (p.startWidth ?? 100) / 100 + (1 - (p.startWidth ?? 100) / 100) * ease(s / start, p.startEase);
  if (end && s > total - end) width *= (p.endWidth ?? 100) / 100 + (1 - (p.endWidth ?? 100) / 100) * ease((total - s) / end, p.endEase);
  const cycles = p.waveUnits === "length" ? total / Math.max(.01, p.wavelength || 100) : p.waveCycles || 1;
  width *= Math.max(0, 1 + (p.waveAmount || 0) / 100 * Math.sin(2 * Math.PI * (cycles * s / total + (p.wavePhase || 0) / 360)));
  return Math.max(0, p.width * width);
}
function roundCorners(path, radius, tolerance) {
  if (!(radius > 0) || !path.vertices) return path;
  const vertices = [], n = path.vertices.length;
  for (let i = 0; i < n; i++) {
    const v = path.vertices[i], previous = path.vertices[(i + n - 1) % n], next = path.vertices[(i + 1) % n];
    if ((!path.closed && (i === 0 || i === n - 1)) || Math.hypot(...v.in, ...v.out) > 1e-9) { vertices.push(v); continue; }
    const a = distance(v.point, previous.point), b = distance(v.point, next.point);
    if (a < 1e-9 || b < 1e-9) { vertices.push(v); continue; }
    const u = previous.point.map((x, k) => (x - v.point[k]) / a), w = next.point.map((x, k) => (x - v.point[k]) / b);
    const angle = Math.acos(clamp(u[0] * w[0] + u[1] * w[1], -1, 1));
    if (angle < 1e-6 || Math.PI - angle < 1e-6) { vertices.push(v); continue; }
    const cut = Math.min(radius / Math.tan(angle / 2), a / 2, b / 2), actual = cut * Math.tan(angle / 2);
    const handle = 4 / 3 * Math.tan((Math.PI - angle) / 4) * actual;
    vertices.push({ point: v.point.map((x, k) => x + u[k] * cut), in: [0, 0], out: u.map(x => -x * handle) });
    vertices.push({ point: v.point.map((x, k) => x + w[k] * cut), in: w.map(x => -x * handle), out: [0, 0] });
  }
  return { ...path, ...flattenPath({ ...path, vertices }, tolerance), vertices };
}
module.exports = { clamp, wrap, at, slice, intervals, trim, dash, widthAt, roundCorners, MAX_FRAGMENTS };
