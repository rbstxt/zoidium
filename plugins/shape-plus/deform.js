"use strict";
const { check } = require("./geometry-budget.js");
const {
  flattenPath,
  verticesToCubics,
  flatten,
  lengthTable,
} = require("./path.js");
const tau = 2 * Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function hash(x, y, seed) {
  let n =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 2147483647.5 - 1;
}
const ease = (t) => t * t * (3 - 2 * t);
function noise(space, time, seed, period = 0) {
  const x = Math.floor(space),
    y = Math.floor(time),
    u = ease(space - x),
    v = ease(time - y);
  const at = (i, j) =>
    hash(period ? ((i % period) + period) % period : i, j, seed);
  const a = at(x, y) * (1 - u) + at(x + 1, y) * u;
  const b = at(x, y + 1) * (1 - u) + at(x + 1, y + 1) * u;
  return a * (1 - v) + b * v;
}
function sampleNoise(p, space, channel, copy = 0, period = 0) {
  const time =
    (p.time || 0) * (p.frequency ?? 1) + (p.temporalPhase || 0) / 360;
  const seed = Math.round(p.seed ?? 1) + channel * 7919;
  const correlation = clamp((p.correlation ?? 50) / 100, 0, 1);
  const common = noise((p.spatialPhase || 0) / 360, time, seed);
  const independent = noise(
    space + (p.spatialPhase || 0) / 360,
    time,
    seed + copy * 104729,
    period,
  );
  return common * correlation + independent * (1 - correlation);
}
function geometry(path, points) {
  const {
    vertices,
    corners,
    distances,
    totalLength,
    widths,
    segments,
    ...rest
  } = path;
  return { ...rest, points, proceduralGeometry:true };
}
function resample(path, spacing = 8) {
  const points = [],
    source = path.points,
    count = path.closed ? source.length : source.length - 1;
  const segments = [];
  for (let i = 0; i < count; i++) {
    check();
    const a = source[i],
      b = source[(i + 1) % source.length];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing),
    );
    if (points.length + n + 1 > 32768)
      throw Error("Shape+ deformation point budget exceeded");
    for (let j = 0; j < n; j++) {
      points.push(a.map((v, k) => v + ((b[k] - v) * j) / n));
      segments.push([i, j / n]);
    }
  }
  if (!path.closed && source.length) {
    points.push(source[source.length - 1].slice());
    segments.push([Math.max(0, count - 1), 1]);
  }
  return { ...geometry(path, points), segments };
}
function smooth(path, tolerance) {
  const points = path.points,
    n = points.length;
  const get = (i) => points[path.closed ? (i + n) % n : clamp(i, 0, n - 1)];
  const vertices = points.map((point, i) => {
    const tangent = get(i + 1).map((v, k) => (v - get(i - 1)[k]) / 6);
    return { point, in: tangent.map((v) => -v), out: tangent };
  });
  const flattened = flattenPath({ vertices, closed: path.closed }, tolerance);
  return geometry(path, flattened.points);
}
function deform(path, kind, p, tolerance = 0.125) {
  if (path.points.length < 2) return path;
  if (kind === "zigZag") {
    const points = [],
      n = clamp(Math.round(p.ridges ?? 3), 1, 64) * 2 + 1;
    // Ridges are per authored span, rather than per adaptive flatten sample.
    const spans = path.vertices
      ? verticesToCubics(path.vertices, path.closed).map((c) =>
          flatten(c, tolerance),
        )
      : path.points
          .slice(0, path.closed ? undefined : -1)
          .map((a, i) => [a, path.points[(i + 1) % path.points.length]]);
    if (spans.length * n + 1 > 4096)
      throw Error("Shape+ zig zag point budget exceeded");
    for (const span of spans) {
      const table = lengthTable(span),
        total = table.total;
      let segment = 1;
      for (let j = 0; j < n; j++) {
        const distance = (total * j) / n;
        while (segment < span.length - 1 && table.lengths[segment] < distance)
          segment++;
        const a = span[segment - 1],
          b = span[segment],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          length = Math.hypot(dx, dy);
        const t = length ? (distance - table.lengths[segment - 1]) / length : 0;
        const d = j === 0 ? 0 : (j % 2 ? 1 : -1) * (p.size ?? 10);
        points.push([
          a[0] + dx * t - (length ? dy / length : 0) * d,
          a[1] + dy * t + (length ? dx / length : 0) * d,
        ]);
      }
    }
    if (!path.closed) points.push(path.points[path.points.length - 1].slice());
    const result = geometry(path, points);
    return p.points === "smooth" ? smooth(result, tolerance) : result;
  }
  const center =
    p.center ||
    path.points.reduce(
      (a, v) => a.map((x, k) => x + v[k] / path.points.length),
      [0, 0],
    );
  const radius = Math.max(
      ...path.points.map((v) => Math.hypot(v[0] - center[0], v[1] - center[1])),
    ),
    k = Math.abs(p.angle || 0) / 100;
  const spacing =
    kind === "wigglePaths"
      ? 100 / clamp(p.detail ?? 5, 1, 100)
      : kind === "twist" && k
        ? Math.min(4, Math.sqrt((8 * tolerance) / (2 * k + radius * k * k)))
        : 4;
  const sampled = resample(path, spacing);
  const n = sampled.points.length;
  const points = sampled.points.map((point, i) => {
    const dx = point[0] - center[0],
      dy = point[1] - center[1];
    if (kind === "twist") {
      const angle = ((p.angle || 0) * Math.hypot(dx, dy)) / 100,
        c = Math.cos(angle),
        s = Math.sin(angle);
      return [center[0] + c * dx - s * dy, center[1] + s * dx + c * dy];
    }
    if (kind === "puckerBloat") {
      // Positive bloat rounds each authored edge outward while drawing its
      // endpoints inward. Negative amount produces the opposite cusp.
      const vertices = path.vertices?.map((v) => v.point) || path.points;
      let best = Infinity,
        t = 0;
      for (
        let j = 0;
        j < (path.closed ? vertices.length : vertices.length - 1);
        j++
      ) {
        const a = vertices[j],
          b = vertices[(j + 1) % vertices.length],
          x = b[0] - a[0],
          y = b[1] - a[1],
          l = x * x + y * y;
        const u = l
          ? clamp(((point[0] - a[0]) * x + (point[1] - a[1]) * y) / l, 0, 1)
          : 0;
        const d =
          (point[0] - a[0] - u * x) ** 2 + (point[1] - a[1] - u * y) ** 2;
        if (d < best) {
          best = d;
          t = u;
        }
      }
      const factor =
        1 - clamp((p.amount || 0) / 100, -1, 1) * Math.cos(tau * t);
      return [center[0] + dx * factor, center[1] + dy * factor];
    }
    if (kind === "wigglePaths") {
      const detail = clamp(Math.round(p.detail ?? 5), 1, 100),
        space = (i / (path.closed ? n : Math.max(1, n - 1))) * detail;
      return point.map(
        (v, k) =>
          v +
          (p.size ?? 10) *
            sampleNoise(p, space, k, 0, path.closed ? detail : 0),
      );
    }
    throw Error("Unknown Shape+ deformation");
  });
  const result = geometry(sampled, points);
  return kind === "wigglePaths" && p.points === "smooth"
    ? smooth(result, tolerance)
    : result;
}
function wiggleTransform(p, copy = 0) {
  const offset = (value, channel) =>
    value.map(
      (v, k) => v * sampleNoise(p, copy + channel * 0.37, k + channel, copy),
    );
  return {
    anchor: offset(p.anchor || [0, 0], 1),
    position: offset(p.position || [0, 0], 3),
    scale: offset(p.scale || [0, 0], 5).map((v) => 1 + v / 100),
    rotation: (p.rotation || 0) * sampleNoise(p, copy + 7, 7, copy),
  };
}
module.exports = { noise, sampleNoise, resample, deform, wiggleTransform };
