"use strict";

// Pure math behind the procedural Particles+ sprites: tone curves, signed
// distances, and composable field builders. No I/O, no dependencies.

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function opticalTone(value) {
  // Alpha is the actual optical intensity. Keep the transfer linear so the
  // procedural falloff remains faithful to the reference alpha profiles and
  // does not lift the barely-visible safety fade into a square edge.
  return clamp01(value);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function gaussian(value, sigma) {
  return Math.exp(-((value * value) / (2 * sigma * sigma)));
}

function radialGaussian(radius, sigma) {
  return gaussian(radius, sigma);
}

function powerGlow(radius, limit, strength, exponent = 1.4) {
  const remaining = clamp01(1 - radius / Math.max(limit, 0.001));
  return Math.pow(remaining, exponent) * strength;
}

function union(...values) {
  let result = 0;
  for (const value of values) result = Math.max(result, clamp01(value));
  return result;
}

function additive(...values) {
  let result = 0;
  for (const value of values) result += clamp01(value);
  return clamp01(result);
}

function withFade(field) {
  return (x, y) => field(x, y);
}

function distanceToBox(x, y, halfWidth, halfHeight = halfWidth) {
  const dx = Math.abs(x) - halfWidth;
  const dy = Math.abs(y) - halfHeight;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside;
}

function coverageFromDistance(distance, feather = 0.012) {
  return 1 - smoothstep(-feather, feather, distance);
}

function lineBand(distance, width) {
  return gaussian(distance, width);
}

function periodicDistance(value, spacing) {
  const wrapped = ((value + spacing / 2) % spacing + spacing) % spacing - spacing / 2;
  return Math.abs(wrapped);
}

function segmentDistance(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : clamp01(((x - ax) * dx + (y - ay) * dy) / lengthSquared);
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

function segmentField(ax, ay, bx, by, width = 0.014, intensity = 1) {
  return (x, y) => lineBand(segmentDistance(x, y, ax, ay, bx, by), width) * intensity;
}

function regularPolygonVertices(sides, radius, rotation = -Math.PI / 2) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (TAU * index) / sides;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function convexPolygonDistance(x, y, vertices) {
  let minimum = Infinity;
  let inside = false;
  for (let index = 0; index < vertices.length; index += 1) {
    const [ax, ay] = vertices[index];
    const [bx, by] = vertices[(index + 1) % vertices.length];
    minimum = Math.min(minimum, segmentDistance(x, y, ax, ay, bx, by));
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -minimum : minimum;
}

function polygonField(vertices, feather = 0.012) {
  return (x, y) => coverageFromDistance(convexPolygonDistance(x, y, vertices), feather);
}

function outlinePolygonField(vertices, width = 0.024) {
  return (x, y) => {
    const distance = Math.abs(convexPolygonDistance(x, y, vertices));
    return gaussian(distance, width);
  };
}

function starVertices(points, outerRadius, innerRadius, rotation = -Math.PI / 2) {
  return Array.from({ length: points * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + (TAU * index) / (points * 2);
    return [Math.cos(angle) * radius, Math.sin(angle) * radius];
  });
}

function sdRoundedBox(x, y, halfWidth, halfHeight, radius) {
  const qx = Math.abs(x) - halfWidth + radius;
  const qy = Math.abs(y) - halfHeight + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
    + Math.min(Math.max(qx, qy), 0)
    - radius;
}

function ringField(radius, ringRadius, width, intensity = 1) {
  return intensity * gaussian(radius - ringRadius, width);
}

function ringSetField(rings, width = 0.014, intensity = 1) {
  return (x, y) => {
    const radius = Math.hypot(x, y);
    return rings.reduce(
      (maximum, ringRadius) => Math.max(maximum, ringField(radius, ringRadius, width, intensity)),
      0,
    );
  };
}

function rayField(
  angle,
  length,
  width,
  intensity = 1,
  start = 0.015,
  spread = 1.8,
  rayFadeStart = null,
  rayFadeEnd = null,
) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  return (x, y) => {
    const along = x * ux + y * uy;
    if (along < start) return 0;
    const progress = clamp01(along / Math.max(length, 0.001));
    // Optical rays are broadest close to the saturated source and resolve into
    // fine, low-energy tails. This is closer to a diffraction/blur profile
    // than a constant-width line and keeps the far field from becoming a
    // triangular wedge after the 128px reduction.
    const taperedWidth = width * (0.98 + 0.48 * spread * (1 - progress));
    const lengthFade = 1 - smoothstep(
      length * (rayFadeStart == null ? 0.16 : rayFadeStart),
      length * (rayFadeEnd == null ? 0.88 : rayFadeEnd),
      along,
    );
    const startFade = smoothstep(start, start + 0.05, along);
    const perpendicular = Math.abs(x * uy - y * ux);
    return lineBand(perpendicular, taperedWidth) * lengthFade * startFade * intensity;
  };
}

function raySetField(rays, options = {}) {
  const {
    width = 0.012,
    intensity = 1,
    start = 0.018,
    spread = 1.8,
    composite = "max",
  } = options;
  const fields = rays.map((ray) => rayField(
    ray.angle,
    ray.length,
    ray.width || width,
    ray.intensity == null ? intensity : ray.intensity * intensity,
    start,
    ray.spread || spread,
    ray.fadeStart,
    ray.fadeEnd,
  ));
  if (composite === "screen") {
    return (x, y) => {
      let transparency = 1;
      for (const field of fields) transparency *= 1 - clamp01(field(x, y));
      return 1 - transparency;
    };
  }
  return (x, y) => fields.reduce(
    (maximum, field) => Math.max(maximum, field(x, y)),
    0,
  );
}

function flareCore(options = {}) {
  const {
    core = 0.075,
    halo = 0.31,
    haloStrength = 0.22,
    coreStrength = 1.28,
    middle = null,
    middleStrength = 0,
    coreBloom = null,
    coreBloomStrength = 0,
    ring = null,
    ringWidth = 0.018,
  } = options;
  return (x, y) => {
    const radius = Math.hypot(x, y);
    const coreGlow = coreBloom === null
      ? radialGaussian(radius, core) * coreStrength
      : additive(
        radialGaussian(radius, core) * coreStrength,
        radialGaussian(radius, coreBloom) * coreBloomStrength,
      );
    const middleGlow = middle === null
      ? 0
      : radialGaussian(radius, middle) * middleStrength;
    const haloGlow = radialGaussian(radius, halo) * haloStrength;
    const ringGlow = ring === null ? 0 : ringField(radius, ring, ringWidth, 0.5);
    return union(coreGlow, middleGlow, haloGlow, ringGlow);
  };
}

function longitudinalDecay(position, nearSigma, nearStrength, farSigma, farStrength) {
  return additive(
    gaussian(position, nearSigma) * nearStrength,
    gaussian(position, farSigma) * farStrength,
  );
}

function horizontalBand(x, y, width, nearSigma, nearStrength, farSigma, farStrength) {
  return lineBand(y, width) * longitudinalDecay(
    x,
    nearSigma,
    nearStrength,
    farSigma,
    farStrength,
  );
}

function satelliteField(points, sigma = 0.045, intensity = 1) {
  return (x, y) => points.reduce(
    (maximum, [px, py, strength = intensity]) => Math.max(maximum, radialGaussian(Math.hypot(x - px, y - py), sigma) * strength),
    0,
  );
}

function deterministicRays(count, seed = 1, minLength = 0.45, maxLength = 0.85, minWidth = 0.006, maxWidth = 0.015) {
  let value = seed >>> 0;
  const next = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
  return Array.from({ length: count }, (_, index) => ({
    angle: (TAU * index) / count + (next() - 0.5) * (TAU / count) * 0.22,
    length: minLength + next() * (maxLength - minLength),
    intensity: 0.35 + next() * 0.48,
    width: minWidth + next() * (maxWidth - minWidth),
    spread: 1.35 + next() * 0.85,
  }));
}

function explicitRays(specifications) {
  return specifications.map(([degrees, length, width, intensity, spread = 1.5, fadeStart = null, fadeEnd = null]) => ({
    angle: (degrees * Math.PI) / 180,
    length,
    width,
    intensity,
    spread,
    fadeStart,
    fadeEnd,
  }));
}

function angleDistance(a, b) {
  let distance = Math.abs(a - b) % TAU;
  if (distance > Math.PI) distance = TAU - distance;
  return distance;
}

function polarRingField(rings, angularGaps = []) {
  return (x, y) => {
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    let value = rings.reduce(
      (maximum, [ringRadius, width, strength = 1]) => Math.max(maximum, ringField(radius, ringRadius, width, strength)),
      0,
    );
    if (angularGaps.length > 0) {
      const gap = angularGaps.reduce((minimum, gapAngle) => Math.min(minimum, angleDistance(angle, gapAngle)), Math.PI);
      value *= smoothstep(0.04, 0.10, gap);
    }
    return value;
  };
}

module.exports = { TAU, clamp01, opticalTone, smoothstep, gaussian, radialGaussian, powerGlow, union, additive, withFade, distanceToBox, coverageFromDistance, lineBand, periodicDistance, segmentDistance, segmentField, regularPolygonVertices, convexPolygonDistance, polygonField, outlinePolygonField, starVertices, sdRoundedBox, ringField, ringSetField, rayField, raySetField, flareCore, longitudinalDecay, horizontalBand, satelliteField, deterministicRays, explicitRays, angleDistance, polarRingField };
