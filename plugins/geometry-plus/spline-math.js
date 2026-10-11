"use strict";

// Geometry+ spline math: control-point sampling for every interpolation
// mode and the gradient-to-thickness mapping. Pure; depends only on the
// shared value helpers.

const { numberValue } = require("./geometry-helpers.js");

const SPLINE_MAX_POINTS = 32;
const SPLINE_DEFAULT_POINTS = 3;
// New splines start as a visible arch at the scale of the other Geometry+
// shapes (Helix radius 14, Corner radius 3). Only points beyond this list
// default to the origin. Loaded projects always carry their own values.
const SPLINE_DEFAULT_POINT_POSITIONS = [
  [-20, 0, 0],
  [0, 20, 0],
  [20, 0, 0],
];

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(value, fallback) {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 1e-9)) return fallback.slice();
  return [value[0] / length, value[1] / length, value[2] / length];
}

function isZero3(value) {
  return Math.hypot(value[0], value[1], value[2]) <= 1e-9;
}

// Gradient sampling mirrors the CM3 gradient rasterizer used by native
// particle size: colors are parsed from "rgba(...)", interpolated linearly
// between stops, and the scalar comes from the premultiplied red channel.
function parseRgbaColor(text) {
  const parts = String(text || "")
    .split("(")[1]
    .split(")")[0]
    .split(",");
  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    r: number(parseInt(parts[0], 10), 0),
    g: number(parseInt(parts[1], 10), 0),
    b: number(parseInt(parts[2], 10), 0),
    a: parts.length > 3 ? number(parseFloat(parts[3]), 1) : 1,
  };
}

function premultipliedRed(color) {
  return Math.min(1, Math.max(0, (color.r * color.a) / 255));
}

function sampleThicknessGradient(stops, position) {
  if (!Array.isArray(stops) || stops.length === 0) return 1;
  const parsed = stops
    .map((stop) => ({
      position: Math.min(1, Math.max(0, numberValue(stop.position, 0))),
      color: parseRgbaColor(stop.color),
    }))
    .sort((a, b) => a.position - b.position);
  const amount = Math.min(1, Math.max(0, numberValue(position, 0)));
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  if (amount <= first.position) return premultipliedRed(first.color);
  if (amount >= last.position) return premultipliedRed(last.color);
  for (let index = 0; index < parsed.length - 1; index++) {
    const lower = parsed[index];
    const upper = parsed[index + 1];
    if (amount >= lower.position && amount <= upper.position) {
      const span = upper.position - lower.position;
      const frac = span > 1e-9 ? (amount - lower.position) / span : 0;
      return premultipliedRed({
        r: lower.color.r + (upper.color.r - lower.color.r) * frac,
        a: lower.color.a + (upper.color.a - lower.color.a) * frac,
      });
    }
  }
  return premultipliedRed(last.color);
}

function sampleLinearSpline(points, amount, closed) {
  const count = points.length;
  const spans = closed ? count : count - 1;
  const scaled = Math.min(Math.max(amount, 0), 1) * spans;
  const index = Math.min(Math.floor(scaled), spans - 1);
  const t = scaled - index;
  const a = points[index % count];
  const b = points[(index + 1) % count];
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function sampleHermiteSpan(p0, p1, p2, p3, t, tension) {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const axis = (a, b, c, d) => {
    const m1 = (tension * (c - a)) / 2;
    const m2 = (tension * (d - b)) / 2;
    return h00 * b + h10 * m1 + h01 * c + h11 * m2;
  };
  return [
    axis(p0[0], p1[0], p2[0], p3[0]),
    axis(p0[1], p1[1], p2[1], p3[1]),
    axis(p0[2], p1[2], p2[2], p3[2]),
  ];
}

function sampleCatmullRomSpline(points, amount, closed, tension) {
  const count = points.length;
  const spans = closed ? count : count - 1;
  const scaled = Math.min(Math.max(amount, 0), 1) * spans;
  const index = Math.min(Math.floor(scaled), spans - 1);
  const t = scaled - index;
  const p1 = points[index % count];
  const p2 = points[(index + 1) % count];
  const p0 = closed
    ? points[(index - 1 + count) % count]
    : points[Math.max(index - 1, 0)];
  const p3 = closed
    ? points[(index + 2) % count]
    : points[Math.min(index + 2, count - 1)];
  return sampleHermiteSpan(p0, p1, p2, p3, t, tension);
}

function sampleAkimaSpline(points, amount, closed) {
  const count = points.length;
  const spans = closed ? count : count - 1;
  const scaled = Math.min(Math.max(amount, 0), 1) * spans;
  const index = Math.min(Math.floor(scaled), spans - 1);
  const t = scaled - index;
  const t2 = t * t;
  const t3 = t2 * t;
  const tangents = [];
  for (let axis = 0; axis < 3; axis++) {
    const values = points.map((point) => point[axis]);
    const pointTangents = [];
    if (closed) {
      // Cyclic slopes and tangents: neighbors wrap around the loop.
      const slopes = [];
      for (let k = 0; k < count; k++) {
        slopes.push(values[(k + 1) % count] - values[k]);
      }
      for (let k = 0; k < count; k++) {
        const s0 = slopes[(k - 2 + count) % count];
        const s1 = slopes[(k - 1 + count) % count];
        const s2 = slopes[k];
        const s3 = slopes[(k + 1) % count];
        const w1 = Math.abs(s3 - s2);
        const w2 = Math.abs(s1 - s0);
        pointTangents.push(
          w1 + w2 < 1e-12 ? (s1 + s2) / 2 : (w1 * s1 + w2 * s2) / (w1 + w2)
        );
      }
    } else {
      // Slopes s[k] = values[k + 1] - values[k], extended as s[-2], s[-1],
      // s[n - 1], s[n] following the classic Akima boundary handling.
      const slopes = new Array(count + 4).fill(0);
      for (let k = 0; k <= count - 2; k++) slopes[k + 2] = values[k + 1] - values[k];
      slopes[1] = 2 * slopes[2] - slopes[3];
      slopes[0] = 2 * slopes[1] - slopes[2];
      slopes[count + 1] = 2 * slopes[count] - slopes[count - 1];
      slopes[count + 2] = 2 * slopes[count + 1] - slopes[count];
      for (let k = 0; k < count; k++) {
        const w1 = Math.abs(slopes[k + 3] - slopes[k + 2]);
        const w2 = Math.abs(slopes[k + 1] - slopes[k]);
        pointTangents.push(
          w1 + w2 < 1e-12
            ? (slopes[k + 1] + slopes[k + 2]) / 2
            : (w1 * slopes[k + 1] + w2 * slopes[k + 2]) / (w1 + w2)
        );
      }
    }
    const y0 = values[index];
    const y1 = values[(index + 1) % count];
    const m0 = pointTangents[index];
    const m1 = pointTangents[(index + 1) % count];
    tangents.push(
      (2 * t3 - 3 * t2 + 1) * y0 +
        (t3 - 2 * t2 + t) * m0 +
        (-2 * t3 + 3 * t2) * y1 +
        (t3 - t2) * m1
    );
  }
  return tangents;
}

function sampleBSplineSpline(points, amount, closed) {
  const count = points.length;
  const degree = 3;
  if (closed) {
    // Cyclic uniform B-spline: control point access wraps around the loop
    // so the curve closes smoothly on itself.
    const spans = count;
    const scaled = Math.min(Math.max(amount, 0), 1) * spans;
    const index = Math.min(Math.floor(scaled), spans - 1);
    const t = scaled - index;
    const t2 = t * t;
    const t3 = t2 * t;
    const at = (offset) => points[(index + offset) % count];
    const axis = (a, b, c, d) =>
      ((1 - t) * (1 - t) * (1 - t) * a +
        (3 * t3 - 6 * t2 + 4) * b +
        (-3 * t3 + 3 * t2 + 3 * t + 1) * c +
        t3 * d) /
      6;
    return [
      axis(at(0)[0], at(1)[0], at(2)[0], at(3)[0]),
      axis(at(0)[1], at(1)[1], at(2)[1], at(3)[1]),
      axis(at(0)[2], at(1)[2], at(2)[2], at(3)[2]),
    ];
  }
  // Open-uniform knot vector: u_j = 0 for j <= degree, j - degree for
  // degree < j < count, spans for j >= count. The ends are clamped, so
  // the curve starts at the first point and ends at the last point.
  const knot = (j) => (j <= degree ? 0 : j >= count ? spans : j - degree);
  const spans = count - degree;
  let t = Math.min(Math.max(amount, 0), 1) * spans;
  if (t >= spans) t = spans - 1e-9;
  let span = degree;
  while (span < count - 1 && t >= knot(span + 1)) span += 1;
  const d = [];
  for (let j = 0; j <= degree; j++) d.push(points[j + span - degree].slice());
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = j + span - degree;
      const denom = knot(j + 1 + span - r) - knot(i);
      const alpha = denom > 1e-12 ? (t - knot(i)) / denom : 0;
      for (let axis = 0; axis < 3; axis++) {
        d[j][axis] = (1 - alpha) * d[j - 1][axis] + alpha * d[j][axis];
      }
    }
  }
  return d[degree];
}

function sampleSplineCurve(points, interpolation, amount, closed, tension) {
  if (!closed && points.length === 2) {
    return sampleLinearSpline(points, amount, false);
  }
  if (interpolation === "Linear") return sampleLinearSpline(points, amount, closed);
  if (interpolation === "Akima") return sampleAkimaSpline(points, amount, closed);
  if (interpolation === "B-Spline") return sampleBSplineSpline(points, amount, closed);
  return sampleCatmullRomSpline(points, amount, closed, tension);
}
module.exports = {
  SPLINE_MAX_POINTS,
  SPLINE_DEFAULT_POINTS,
  SPLINE_DEFAULT_POINT_POSITIONS,
  cross3,
  normalize3,
  isZero3,
  parseRgbaColor,
  premultipliedRed,
  sampleThicknessGradient,
  sampleLinearSpline,
  sampleHermiteSpan,
  sampleCatmullRomSpline,
  sampleAkimaSpline,
  sampleBSplineSpline,
  sampleSplineCurve,
};
