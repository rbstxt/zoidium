#!/usr/bin/env node

/*
 * Build the procedural, monochrome sprite set used by Particles+.
 *
 * The source images are deliberately generated from equations rather than
 * copied from the CM3 resource cache or from any reference preset. Every
 * output pixel is white; opacity is the only carrier of tone.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const WIDTH = 128;
const HEIGHT = 128;
const SUPER_SAMPLE = 32;
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "plugins", "particles-plus", "sprites");

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

function makeBasicFields() {
  const fields = new Map();
  const polygon = (sides, radius = 0.73, rotation = -Math.PI / 2) => polygonField(regularPolygonVertices(sides, radius, rotation));
  const outlinePolygon = (sides, radius = 0.73, rotation = -Math.PI / 2) => outlinePolygonField(regularPolygonVertices(sides, radius, rotation));

  fields.set("circle", (x, y) => coverageFromDistance(Math.hypot(x, y) - 0.74, 0.014));
  fields.set("square", (x, y) => coverageFromDistance(distanceToBox(x, y, 0.70), 0.014));
  fields.set("triangle", polygon(3, 0.79));
  fields.set("pentagon", polygon(5, 0.75));
  fields.set("hexagon", polygon(6, 0.75, -Math.PI / 2));
  fields.set("octagon", polygon(8, 0.75));
  fields.set("diamond", polygon(4, 0.79, 0));
  fields.set("ring_outline", (x, y) => ringField(Math.hypot(x, y), 0.64, 0.035));
  fields.set("ring_double", (x, y) => union(
    ringField(Math.hypot(x, y), 0.49, 0.028, 0.95),
    ringField(Math.hypot(x, y), 0.72, 0.025, 0.84),
  ));
  fields.set("triangle_outline", outlinePolygon(3, 0.79));
  fields.set("square_outline", (x, y) => gaussian(Math.abs(distanceToBox(x, y, 0.69)), 0.030));
  fields.set("rounded_square", (x, y) => coverageFromDistance(sdRoundedBox(x, y, 0.72, 0.72, 0.13), 0.014));
  fields.set("rounded_square_outline", (x, y) => gaussian(Math.abs(sdRoundedBox(x, y, 0.70, 0.70, 0.13)), 0.030));
  fields.set("hexagon_outline", outlinePolygon(6, 0.77, -Math.PI / 2));

  const plusBar = (x, y) => union(
    coverageFromDistance(distanceToBox(x, y, 0.18, 0.73), 0.013),
    coverageFromDistance(distanceToBox(x, y, 0.73, 0.18), 0.013),
  );
  fields.set("plus", plusBar);
  fields.set("plus_cut_square", (x, y) => {
    const plus = plusBar(x, y);
    const cutout = 1 - coverageFromDistance(distanceToBox(x, y, 0.34, 0.34), 0.018);
    return plus * cutout;
  });

  const crossBar = (x, y) => {
    const diagonalA = (x + y) / Math.SQRT2;
    const diagonalB = (x - y) / Math.SQRT2;
    return union(
      coverageFromDistance(distanceToBox(diagonalA, diagonalB, 0.18, 0.73), 0.013),
      coverageFromDistance(distanceToBox(diagonalA, diagonalB, 0.73, 0.18), 0.013),
    );
  };
  fields.set("cross", crossBar);
  fields.set("cross_outline", (x, y) => {
    const distanceA = Math.abs((x + y) / Math.SQRT2);
    const distanceB = Math.abs((x - y) / Math.SQRT2);
    const alongA = Math.abs((x - y) / Math.SQRT2);
    const alongB = Math.abs((x + y) / Math.SQRT2);
    return union(
      lineBand(distanceA - 0.18, 0.028) * (1 - smoothstep(0.68, 0.76, alongA)),
      lineBand(distanceB - 0.18, 0.028) * (1 - smoothstep(0.68, 0.76, alongB)),
    );
  });

  fields.set("line_horizontal", (x, y) => lineBand(y, 0.020) * (1 - smoothstep(0.77, 0.86, Math.abs(x))));
  fields.set("line_vertical", (x, y) => lineBand(x, 0.020) * (1 - smoothstep(0.77, 0.86, Math.abs(y))));

  fields.set("grid", (x, y) => {
    const spacing = 0.27;
    const gridX = periodicDistance(x, spacing);
    const gridY = periodicDistance(y, spacing);
    const edge = Math.max(Math.abs(x), Math.abs(y));
    return union(lineBand(gridX, 0.012), lineBand(gridY, 0.012)) * (1 - smoothstep(0.78, 0.86, edge));
  });

  fields.set("dot_grid", (x, y) => {
    let value = 0;
    for (let ix = -3; ix <= 3; ix += 1) {
      for (let iy = -3; iy <= 3; iy += 1) {
        value = Math.max(value, radialGaussian(Math.hypot(x - ix * 0.23, y - iy * 0.23), 0.040));
      }
    }
    return value * (1 - smoothstep(0.78, 0.88, Math.max(Math.abs(x), Math.abs(y))));
  });

  const radialLine = (x, y, angle, width = 0.012) => {
    const radius = Math.hypot(x, y);
    const distance = Math.abs(x * Math.sin(angle) - y * Math.cos(angle));
    return lineBand(distance, width) * smoothstep(0.04, 0.15, radius) * (1 - smoothstep(0.78, 0.86, radius));
  };
  fields.set("radial_lines", (x, y) => {
    let value = 0;
    for (let index = 0; index < 12; index += 1) value = Math.max(value, radialLine(x, y, (TAU * index) / 12));
    return value;
  });

  fields.set("spiral", (x, y) => {
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const turns = angle - radius * 9.4;
    const distance = Math.abs(Math.sin(turns / 2));
    return gaussian(distance, 0.065) * smoothstep(0.08, 0.18, radius) * (1 - smoothstep(0.76, 0.86, radius));
  });

  const snowflakeSegments = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (TAU * index) / 6;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    snowflakeSegments.push([0, 0, ux * 0.80, uy * 0.80]);
    for (const distance of [0.30, 0.50]) {
      for (const side of [-1, 1]) {
        const branchAngle = angle + side * Math.PI / 5;
        const bx = ux * distance;
        const by = uy * distance;
        snowflakeSegments.push([bx, by, bx + Math.cos(branchAngle) * 0.18, by + Math.sin(branchAngle) * 0.18]);
      }
    }
  }
  fields.set("snowflake", (x, y) => snowflakeSegments.reduce(
    (maximum, [ax, ay, bx, by]) => Math.max(maximum, lineBand(segmentDistance(x, y, ax, ay, bx, by), 0.015)),
    0,
  ));

  fields.set("lattice", (x, y) => {
    const spacing = 0.34;
    const diagonalOne = periodicDistance(x + y, spacing);
    const diagonalTwo = periodicDistance(x - y, spacing);
    return union(lineBand(diagonalOne, 0.012), lineBand(diagonalTwo, 0.012))
      * (1 - smoothstep(0.80, 0.88, Math.max(Math.abs(x), Math.abs(y))));
  });

  fields.set("concentric_rings", ringSetField([0.20, 0.39, 0.58, 0.77], 0.014, 0.92));
  fields.set("broken_ring", polarRingField([[0.65, 0.026, 0.98]], [0, Math.PI * 2 / 3, Math.PI * 4 / 3]));
  fields.set("star_5", polygonField(starVertices(5, 0.80, 0.35)));
  fields.set("star_6", polygonField(starVertices(6, 0.79, 0.39, 0)));
  fields.set("star_8", polygonField(starVertices(8, 0.79, 0.47, Math.PI / 8)));

  return fields;
}

function makeFlareFields() {
  const fields = new Map();
  const combine = (...parts) => (x, y) => union(...parts.map((part) => part(x, y)));
  const randomRays = (count, seed, minLength, maxLength, minWidth, maxWidth, options = {}) => raySetField(
    deterministicRays(count, seed, minLength, maxLength, minWidth, maxWidth),
    options,
  );

  const glowPoint = flareCore({
    core: 0.038,
    coreStrength: 1.04,
    middle: 0.120,
    middleStrength: 0.45,
    halo: 0.24,
    haloStrength: 0.10,
  });
  fields.set("flare_blob", (x, y) => union(
    glowPoint(x, y),
    powerGlow(Math.hypot(x, y), 0.95, 0.17, 1.30),
  ));

  const glowRing = flareCore({
    core: 0.030,
    coreStrength: 1.04,
    middle: 0.074,
    middleStrength: 0.50,
    halo: 0.24,
    haloStrength: 0.08,
  });
  fields.set("flare_glow_ring", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      glowRing(x, y),
      radialGaussian(radius, 0.13) * 0.24,
      powerGlow(radius, 0.95, 0.12, 1.30),
      ringField(radius, 0.176, 0.018, 0.25),
    );
  });

  fields.set("flare_halo", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      radialGaussian(radius, 0.030) * 1.28,
      radialGaussian(radius, 0.30) * 0.22,
      ringField(radius, 0.43, 0.023, 0.74),
    );
  });

  fields.set("flare_double_halo", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      radialGaussian(radius, 0.030) * 1.28,
      radialGaussian(radius, 0.20) * 0.18,
      ringField(radius, 0.29, 0.019, 0.76),
      ringField(radius, 0.57, 0.023, 0.54),
    );
  });

  fields.set("flare_orb_soft", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      1 - smoothstep(0.25, 0.47, radius),
      radialGaussian(radius, 0.11) * 0.94,
      ringField(radius, 0.40, 0.030, 0.30),
    );
  });

  const burstRays = raySetField(explicitRays([
    [9, 0.82, 0.0060, 0.23], [21, 0.78, 0.0065, 0.24], [28, 0.86, 0.0048, 0.22],
    [36, 0.75, 0.0070, 0.21], [44, 0.90, 0.0062, 0.29], [54, 0.77, 0.0055, 0.23],
    [62, 0.84, 0.0048, 0.22], [76, 0.70, 0.0060, 0.18], [85, 0.89, 0.0050, 0.23],
    [98, 0.83, 0.0058, 0.24], [105, 0.76, 0.0064, 0.26], [112, 0.92, 0.0046, 0.22],
    [122, 0.78, 0.0060, 0.20], [127, 0.86, 0.0052, 0.23], [136, 0.74, 0.0068, 0.19],
    [146, 0.82, 0.0052, 0.20], [155, 0.91, 0.0058, 0.25], [169, 0.78, 0.0060, 0.24],
    [182, 0.86, 0.0058, 0.28], [198, 0.80, 0.0066, 0.21], [207, 0.93, 0.0050, 0.25],
    [215, 0.78, 0.0058, 0.21], [225, 0.84, 0.0048, 0.18], [235, 0.76, 0.0068, 0.22],
    [249, 0.82, 0.0056, 0.20], [259, 0.74, 0.0060, 0.19], [266, 0.90, 0.0050, 0.21],
    [282, 0.80, 0.0058, 0.21], [291, 0.88, 0.0050, 0.23], [309, 0.76, 0.0062, 0.20],
    [328, 0.84, 0.0056, 0.22], [351, 0.80, 0.0060, 0.21],
  ]), { composite: "max" });
  const burstLongRays = raySetField(
    explicitRays([
      [9, 0.94, 0.0020, 0.11], [28, 0.95, 0.0018, 0.10], [44, 0.98, 0.0020, 0.12],
      [62, 0.96, 0.0017, 0.10], [85, 0.97, 0.0018, 0.11], [105, 0.95, 0.0018, 0.12],
      [127, 0.98, 0.0017, 0.10], [155, 0.96, 0.0019, 0.11], [182, 0.98, 0.0018, 0.13],
      [207, 0.95, 0.0018, 0.11], [235, 0.97, 0.0018, 0.10], [266, 0.98, 0.0017, 0.10],
      [291, 0.96, 0.0018, 0.12], [328, 0.95, 0.0018, 0.10],
    ]).map((ray) => ({ ...ray, intensity: ray.intensity * 1.45, fadeStart: 0.20, fadeEnd: 0.98 })),
    { composite: "screen" },
  );
  const burstSoftRays = raySetField(explicitRays([
    [21, 0.70, 0.022, 0.11], [44, 0.76, 0.026, 0.13], [76, 0.64, 0.030, 0.09],
    [105, 0.72, 0.024, 0.12], [136, 0.68, 0.028, 0.10], [169, 0.76, 0.024, 0.12],
    [207, 0.80, 0.026, 0.13], [249, 0.70, 0.028, 0.10], [291, 0.74, 0.024, 0.12],
    [328, 0.72, 0.026, 0.11],
  ]), { composite: "max" });
  const burstDetailRays = raySetField(explicitRays([
    [4, 0.92, 0.0022, 0.15], [17, 0.88, 0.0025, 0.14], [30, 0.86, 0.0020, 0.13],
    [38, 0.90, 0.0024, 0.12], [54, 0.92, 0.0022, 0.14], [68, 0.86, 0.0020, 0.12],
    [75, 0.90, 0.0024, 0.11], [87, 0.92, 0.0020, 0.12], [97, 0.88, 0.0022, 0.13],
    [113, 0.90, 0.0020, 0.12], [123, 0.94, 0.0024, 0.14], [128, 0.86, 0.0020, 0.11],
    [136, 0.90, 0.0022, 0.12], [155, 0.88, 0.0020, 0.13], [169, 0.94, 0.0022, 0.12],
    [189, 0.90, 0.0024, 0.14], [200, 0.92, 0.0020, 0.12], [214, 0.88, 0.0022, 0.13],
    [230, 0.92, 0.0020, 0.12], [236, 0.86, 0.0024, 0.11], [258, 0.90, 0.0022, 0.13],
    [274, 0.88, 0.0020, 0.12], [279, 0.92, 0.0022, 0.13], [285, 0.86, 0.0020, 0.11],
    [302, 0.90, 0.0024, 0.12], [315, 0.92, 0.0020, 0.13], [327, 0.88, 0.0022, 0.12],
    [335, 0.92, 0.0020, 0.11], [340, 0.86, 0.0024, 0.12], [346, 0.90, 0.0020, 0.11],
  ]).map((ray) => ({ ...ray, fadeStart: 0.16, fadeEnd: 0.99 })), { composite: "screen" });
  const softBurstRays = randomRays(22, 19, 0.32, 0.89, 0.019, 0.050, { intensity: 0.68, spread: 2.5 });
  const needleRaySet = explicitRays([
    [5, 0.86, 0.0050, 0.15], [17, 0.82, 0.0044, 0.14], [33, 0.90, 0.0052, 0.19],
    [44, 0.78, 0.0046, 0.16], [58, 0.86, 0.0050, 0.15], [72, 0.92, 0.0042, 0.19],
    [89, 0.84, 0.0048, 0.16], [98, 0.76, 0.0042, 0.14], [105, 0.90, 0.0048, 0.16],
    [119, 0.82, 0.0044, 0.18], [136, 0.94, 0.0048, 0.22], [151, 0.80, 0.0046, 0.15],
    [159, 0.92, 0.0042, 0.20], [172, 0.76, 0.0048, 0.14], [185, 0.90, 0.0046, 0.18],
    [198, 0.82, 0.0048, 0.16], [204, 0.75, 0.0040, 0.14], [219, 0.88, 0.0050, 0.17],
    [230, 0.80, 0.0046, 0.15], [242, 0.91, 0.0044, 0.19], [252, 0.84, 0.0048, 0.16],
    [262, 0.76, 0.0040, 0.14], [275, 0.90, 0.0048, 0.18], [288, 0.82, 0.0046, 0.16],
    [306, 0.88, 0.0044, 0.16], [314, 0.94, 0.0048, 0.18], [324, 0.78, 0.0042, 0.14],
    [333, 0.86, 0.0048, 0.15], [356, 0.90, 0.0046, 0.17],
  ]);
  const needleRays = raySetField(needleRaySet, { composite: "max" });
  const needleLongRays = raySetField(
    explicitRays([
      [5, 0.97, 0.0016, 0.07], [33, 0.99, 0.0015, 0.08], [58, 0.98, 0.0015, 0.07],
      [72, 0.97, 0.0016, 0.08], [105, 0.99, 0.0015, 0.07], [136, 0.98, 0.0015, 0.10],
      [159, 0.99, 0.0014, 0.09], [185, 0.98, 0.0015, 0.09], [219, 0.99, 0.0015, 0.08],
      [242, 0.98, 0.0016, 0.09], [275, 0.99, 0.0014, 0.08], [306, 0.98, 0.0015, 0.07],
      [314, 0.99, 0.0015, 0.09], [356, 0.98, 0.0016, 0.08],
    ]).map((ray) => ({
      ...ray,
      intensity: ray.intensity * 2.30,
      fadeStart: 0.38,
      fadeEnd: 0.99,
    })),
    { composite: "screen" },
  );
  const fineRaySet = explicitRays([
    [1, 0.76, 0.014, 0.24], [11, 0.78, 0.016, 0.27], [25, 0.72, 0.014, 0.23],
    [36, 0.82, 0.018, 0.22], [47, 0.76, 0.014, 0.27], [66, 0.86, 0.016, 0.30],
    [95, 0.72, 0.014, 0.22], [104, 0.80, 0.017, 0.27], [119, 0.88, 0.015, 0.32],
    [135, 0.82, 0.016, 0.31], [152, 0.78, 0.014, 0.28], [166, 0.74, 0.015, 0.25],
    [179, 0.84, 0.016, 0.22], [188, 0.76, 0.014, 0.28], [202, 0.88, 0.016, 0.30],
    [219, 0.80, 0.015, 0.26], [237, 0.70, 0.014, 0.21], [249, 0.84, 0.016, 0.28],
    [256, 0.75, 0.014, 0.23], [284, 0.80, 0.015, 0.26], [294, 0.88, 0.016, 0.30],
    [310, 0.76, 0.014, 0.27], [319, 0.73, 0.013, 0.21], [333, 0.90, 0.017, 0.32],
    [346, 0.74, 0.014, 0.22], [358, 0.82, 0.015, 0.23],
  ]);
  const fineBurstRays = raySetField(fineRaySet, { composite: "max", intensity: 0.78 });
  const fineNearRays = raySetField(
    fineRaySet.map((ray) => ({ ...ray, fadeStart: 0.02, fadeEnd: 0.38 })),
    { composite: "max", intensity: 0.80 },
  );
  const fineLongRays = raySetField(
    explicitRays([
      [11, 0.97, 0.0022, 0.11], [47, 0.95, 0.0020, 0.10], [66, 0.98, 0.0022, 0.11],
      [104, 0.96, 0.0020, 0.10], [119, 0.99, 0.0022, 0.12], [135, 0.97, 0.0020, 0.11],
      [152, 0.96, 0.0021, 0.10], [188, 0.98, 0.0020, 0.11], [202, 0.99, 0.0021, 0.12],
      [219, 0.97, 0.0020, 0.10], [249, 0.96, 0.0021, 0.10], [284, 0.98, 0.0020, 0.11],
      [294, 0.99, 0.0022, 0.12], [333, 0.98, 0.0021, 0.13],
    ]).map((ray) => ({ ...ray, intensity: ray.intensity * 1.35 })), { composite: "screen" },
  );
  const fineSoftRays = raySetField(explicitRays([
    [25, 0.70, 0.030, 0.16], [66, 0.76, 0.034, 0.18], [104, 0.72, 0.030, 0.16],
    [135, 0.74, 0.032, 0.18], [166, 0.70, 0.028, 0.14], [202, 0.78, 0.032, 0.18],
    [237, 0.68, 0.030, 0.15], [294, 0.76, 0.034, 0.18], [333, 0.80, 0.032, 0.19],
  ]), { composite: "max" });
  const dustRays = randomRays(42, 71, 0.31, 0.95, 0.0028, 0.0078, { intensity: 0.35, spread: 1.25 });
  const dustLongRays = raySetField(
    deterministicRays(96, 181, 0.37, 0.97, 0.0014, 0.0040),
    { intensity: 0.13, spread: 1.05, composite: "screen" },
  );

  fields.set("flare_burst", combine(
    flareCore({
      core: 0.050,
      coreStrength: 1.05,
      middle: 0.100,
      middleStrength: 0.48,
      halo: 0.25,
      haloStrength: 0.17,
    }),
    (x, y) => powerGlow(Math.hypot(x, y), 0.95, 0.080, 1.10),
    burstRays,
    burstLongRays,
    burstSoftRays,
    burstDetailRays,
  ));
  fields.set("flare_burst_soft", combine(
    flareCore({ core: 0.050, halo: 0.32, haloStrength: 0.28 }),
    softBurstRays,
  ));
  fields.set("flare_needles", combine(
    flareCore({
      core: 0.032,
      coreStrength: 1.28,
      middle: 0.060,
      middleStrength: 0.72,
      halo: 0.26,
      haloStrength: 0.10,
    }),
    (x, y) => radialGaussian(Math.hypot(x, y), 0.130) * 0.25,
    needleRays,
    needleLongRays,
  ));
  fields.set("flare_starburst_fine", combine(
    flareCore({
      core: 0.034,
      coreStrength: 1.28,
      middle: 0.120,
      middleStrength: 0.70,
      halo: 0.30,
      haloStrength: 0.18,
    }),
    (x, y) => additive(fineBurstRays(x, y), fineNearRays(x, y)),
    fineLongRays,
    fineSoftRays,
  ));

  const dustPoints = [
    [0.14, -0.29, 0.38], [-0.25, -0.22, 0.30], [0.40, 0.09, 0.24], [-0.45, 0.20, 0.21],
    [0.18, 0.49, 0.20], [-0.10, -0.56, 0.17], [0.57, -0.20, 0.14], [-0.60, 0.04, 0.14],
    [0.34, 0.34, 0.13], [-0.36, -0.36, 0.13], [0.05, 0.65, 0.10], [-0.04, -0.70, 0.08],
  ];
  fields.set("flare_starburst_dust", combine(
    flareCore({ core: 0.022, coreStrength: 1.28, middle: 0.065, middleStrength: 0.30, halo: 0.22, haloStrength: 0.18 }),
    dustRays,
    dustLongRays,
    satelliteField(dustPoints, 0.016),
  ));

  const eightRays = explicitRays([
    [14, 0.72, 0.030, 0.27, 2.0], [48, 0.78, 0.036, 0.31, 2.1],
    [79, 0.84, 0.042, 0.37, 2.2], [105, 0.86, 0.045, 0.40, 2.2],
    [151, 0.86, 0.044, 0.39, 2.2], [216, 0.82, 0.038, 0.33, 2.1],
    [253, 0.88, 0.046, 0.39, 2.2], [311, 0.80, 0.038, 0.31, 2.1],
    [352, 0.74, 0.028, 0.25, 1.9], [191, 0.70, 0.028, 0.24, 1.9],
  ]);
  const eightNearRays = raySetField(
    eightRays.map((ray) => ({ ...ray, spread: 0.85, fadeStart: 0.03, fadeEnd: 0.42 })),
    { intensity: 1.50, spread: 2.15 },
  );
  const eightMidRays = raySetField(
    eightRays.map((ray) => ({ ...ray, spread: 0.85, fadeStart: 0.04, fadeEnd: 0.72 })),
    { intensity: 1.00, spread: 1.85 },
  );
  const eightLongRays = raySetField(
    eightRays.map((ray) => ({
      ...ray,
      length: 0.99,
      width: 0.004,
      intensity: 0.13,
      fadeStart: 0.38,
      fadeEnd: 0.99,
    })),
    { composite: "screen" },
  );
  fields.set("flare_eight_ray", combine(
    flareCore({
      core: 0.040,
      coreStrength: 1.28,
      middle: 0.100,
      middleStrength: 0.56,
      halo: 0.34,
      haloStrength: 0.11,
    }),
    (x, y) => radialGaussian(Math.hypot(x, y), 0.11) * 0.28,
    raySetField(eightRays.map((ray) => ({ ...ray, spread: 0.85 })), { intensity: 0.38, spread: 1.85 }),
    eightNearRays,
    eightMidRays,
    eightLongRays,
  ));

  const centeredThinStreak = (x, y) => union(
    radialGaussian(Math.hypot(x * 0.52, y * 5.0), 0.11) * 0.46,
    horizontalBand(x, y, 0.014, 0.13, 0.26, 0.52, 0.23),
    lineBand(y, 0.014) * gaussian(x, 0.60) * 0.10 * smoothstep(0.04, 0.13, Math.abs(x)),
    gaussian(y, 0.048) * gaussian(x, 0.50) * 0.10,
    gaussian(x, 0.050) * gaussian(y, 0.024) * 0.17,
  );
  const thinStreak = (x, y) => union(
    additive(
      radialGaussian(Math.hypot((x + 0.17) * 0.52, y * 5.0), 0.11) * 0.46,
      radialGaussian(Math.hypot((x + 0.17) * 0.75, y * 6.0), 0.050) * 0.28,
    ),
    horizontalBand(x + 0.17, y, 0.014, 0.13, 0.26, 0.52, 0.23),
    lineBand(y, 0.014) * gaussian(x, 0.60) * 0.10 * smoothstep(0.04, 0.13, Math.abs(x)),
    gaussian(y, 0.048) * gaussian(x + 0.17, 0.50) * 0.10,
    gaussian(x + 0.17, 0.050) * gaussian(y, 0.024) * 0.17,
    coverageFromDistance(distanceToBox(x - 0.60, y, 0.050, 0.026), 0.010) * 0.30,
  );
  fields.set("flare_streak_thin", thinStreak);

  const wideSideBand = (x, y, offset) => {
    const band = lineBand(y - offset, 0.014);
    const near = band * gaussian(x, 0.085) * 0.94;
    const tail = band * gaussian(x, 0.36) * 0.65 * smoothstep(0.015, 0.09, Math.abs(x));
    return Math.max(near, tail);
  };
  fields.set("flare_streak_wide", (x, y) => union(
    radialGaussian(Math.hypot(x, y), 0.275) * 0.055,
    gaussian(y, 0.058) * gaussian(x, 0.234) * 0.50,
    gaussian(y, 0.054) * gaussian(x, 0.064) * 0.50,
    powerGlow(Math.hypot(x, y), 0.95, 0.045, 1.59),
    horizontalBand(x, y, 0.056, 0.047, 0.32, 0.488, 0.40),
    wideSideBand(x, y, 0.020),
    wideSideBand(x, y, -0.020),
    radialGaussian(Math.hypot(x, y), 0.024) * 1.10,
  ));

  fields.set("flare_streak_glow", (x, y) => union(
    radialGaussian(Math.hypot(x, y), 0.30) * 0.10,
    powerGlow(Math.hypot(x, y), 0.95, 0.12, 1.45),
    radialGaussian(Math.hypot(x, y), 0.13) * 0.22,
    horizontalBand(x, y, 0.009, 0.18, 0.72, 0.55, 0.14),
    radialGaussian(Math.hypot(x, y), 0.025) * 1.24,
    radialGaussian(Math.hypot(x, y), 0.080) * 0.42,
    radialGaussian(Math.hypot(x * 0.58, y * 1.9), 0.12) * 0.12,
  ));

  fields.set("flare_vertical_streak", (x, y) => centeredThinStreak(y, x));

  fields.set("flare_crossbeam", (x, y) => union(
    radialGaussian(Math.hypot(x, y), 0.171) * 0.14,
    powerGlow(Math.hypot(x, y), 0.95, 0.050, 1.80),
    powerGlow(Math.hypot(x, y), 0.95, 0.025, 0.85),
    horizontalBand(x, y, 0.020, 0.044, 0.493, 0.422, 0.565),
    horizontalBand(y, x, 0.008, 0.030, 1.05, 0.219, 0.338),
    radialGaussian(Math.hypot(x, y), 0.030) * 1.06,
    radialGaussian(Math.hypot(x, y), 0.073) * 0.34,
  ));

  const fourDots = [[0.055, 0.055, 0.92], [-0.055, 0.055, 0.92], [0.055, -0.055, 0.92], [-0.055, -0.055, 0.92]];
  fields.set("flare_fourdot", combine(
    (x, y) => union(
      radialGaussian(Math.hypot(x, y), 0.29) * 0.25,
      powerGlow(Math.hypot(x, y), 0.95, 0.090, 0.85),
      radialGaussian(Math.hypot(x, y), 0.075) * 0.50,
    ),
    satelliteField(fourDots, 0.036, 1.22),
  ));
  fields.set("flare_fourdot_soft", combine(
    (x, y) => union(
      radialGaussian(Math.hypot(x, y), 0.31) * 0.23,
      powerGlow(Math.hypot(x, y), 0.95, 0.070, 0.85),
    ),
    satelliteField(fourDots, 0.042, 0.76),
  ));

  const sixDots = [
    [-0.105, 0.055, 0.87], [0, 0.055, 0.76], [0.105, 0.055, 0.87],
    [-0.105, -0.055, 0.87], [0, -0.055, 0.76], [0.105, -0.055, 0.87],
  ];
  fields.set("flare_sixdot", combine(
    (x, y) => union(
      radialGaussian(Math.hypot(x, y), 0.29) * 0.25,
      powerGlow(Math.hypot(x, y), 0.95, 0.045, 0.85),
    ),
    satelliteField(sixDots, 0.030, 1.00),
  ));

  fields.set("flare_ring_streak", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      radialGaussian(radius, 0.032) * 1.28,
      ringField(radius, 0.43, 0.021, 0.70),
      gaussian(y, 0.010) * gaussian(x, 0.56) * 0.66,
    );
  });

  fields.set("flare_ripple", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      radialGaussian(radius, 0.032) * 1.28,
      ringField(radius, 0.20, 0.016, 0.75),
      ringField(radius, 0.40, 0.016, 0.54),
      ringField(radius, 0.60, 0.018, 0.37),
      ringField(radius, 0.78, 0.019, 0.24),
    );
  });

  // Kept as a stable id; the color-bearing reference is represented here by
  // separated monochrome rings so the output remains white plus alpha only.
  fields.set("flare_spectral", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      radialGaussian(radius, 0.032) * 1.28,
      ringField(radius, 0.16, 0.009, 0.78),
      ringField(radius, 0.23, 0.010, 0.63),
      ringField(radius, 0.31, 0.011, 0.50),
      ringField(radius, 0.40, 0.012, 0.39),
      ringField(radius, 0.50, 0.013, 0.29),
      ringField(radius, 0.62, 0.015, 0.20),
    );
  });

  fields.set("flare_glint", (x, y) => {
    const radius = Math.hypot(x, y);
    return union(
      radialGaussian(radius, 0.032) * 1.28,
      gaussian(y, 0.009) * gaussian(x, 0.44),
      gaussian(x, 0.009) * gaussian(y, 0.44),
      gaussian((x + y) / Math.SQRT2, 0.014) * gaussian((x - y) / Math.SQRT2, 0.25) * 0.42,
      gaussian((x - y) / Math.SQRT2, 0.014) * gaussian((x + y) / Math.SQRT2, 0.25) * 0.42,
    );
  });

  return fields;
}

const BASIC_FIELDS = makeBasicFields();
const FLARE_FIELDS = makeFlareFields();

const SPRITE_IDS = [
  "circle",
  "square",
  "triangle",
  "pentagon",
  "hexagon",
  "octagon",
  "diamond",
  "ring_outline",
  "ring_double",
  "triangle_outline",
  "square_outline",
  "rounded_square",
  "rounded_square_outline",
  "hexagon_outline",
  "plus",
  "plus_cut_square",
  "cross",
  "cross_outline",
  "line_horizontal",
  "line_vertical",
  "grid",
  "dot_grid",
  "radial_lines",
  "spiral",
  "snowflake",
  "lattice",
  "concentric_rings",
  "broken_ring",
  "star_5",
  "star_6",
  "star_8",
  "flare_glow_ring",
  "flare_halo",
  "flare_double_halo",
  "flare_blob",
  "flare_orb_soft",
  "flare_burst",
  "flare_burst_soft",
  "flare_needles",
  "flare_starburst_fine",
  "flare_starburst_dust",
  "flare_eight_ray",
  "flare_streak_thin",
  "flare_streak_wide",
  "flare_streak_glow",
  "flare_vertical_streak",
  "flare_crossbeam",
  "flare_fourdot",
  "flare_fourdot_soft",
  "flare_sixdot",
  "flare_ring_streak",
  "flare_ripple",
  "flare_spectral",
  "flare_glint",
];

function fieldForSprite(id) {
  return BASIC_FIELDS.get(id) || FLARE_FIELDS.get(id);
}

function renderSprite(field, optical = false) {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4);
  const samples = SUPER_SAMPLE * SUPER_SAMPLE;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let alpha = 0;
      for (let sy = 0; sy < SUPER_SAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPER_SAMPLE; sx += 1) {
          const normalizedX = ((x + (sx + 0.5) / SUPER_SAMPLE) / WIDTH) * 2 - 1;
          const normalizedY = ((y + (sy + 0.5) / SUPER_SAMPLE) / HEIGHT) * 2 - 1;
          const edge = Math.max(Math.abs(normalizedX), Math.abs(normalizedY));
          // Keep the outer 5% of the square transparent without imposing a
          // visible circular mask on the broad optical halos. The previous
          // optical start at 0.78 clipped the low-energy falloff into a hard
          // disk when the sprite was viewed on black.
          const safetyFade = 1 - smoothstep(optical ? 0.86 : 0.875, 0.94, edge);
          const coverage = clamp01(field(normalizedX, normalizedY)) * safetyFade;
          alpha += optical ? opticalTone(coverage) : coverage;
        }
      }
      const offset = (y * WIDTH + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round((alpha / samples) * 255);
    }
  }
  return data;
}

const CRC_TABLE = (() => {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, payload]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  return Buffer.concat([length, body, checksum]);
}

function encodePng(rgba) {
  const raw = Buffer.alloc((WIDTH * 4 + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    const rowOffset = y * (WIDTH * 4 + 1);
    raw[rowOffset] = 0;
    rgba.copy(raw, rowOffset + 1, y * WIDTH * 4, (y + 1) * WIDTH * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodePng(buffer) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
    } else if (type === "IDAT") {
      idat.push(payload);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error("PNG is not 8-bit RGBA");
  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let rawOffset = 0;
  let outputOffset = 0;
  let previous = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset++];
    const row = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const current = raw[rawOffset++];
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const above = previous[x] || 0;
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] || 0 : 0;
      if (filter === 0) row[x] = current;
      else if (filter === 1) row[x] = (current + left) & 0xff;
      else if (filter === 2) row[x] = (current + above) & 0xff;
      else if (filter === 3) row[x] = (current + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        const p = left + above - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - above);
        const pc = Math.abs(p - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft;
        row[x] = (current + predictor) & 0xff;
      } else throw new Error(`unsupported PNG filter ${filter}`);
    }
    row.copy(rgba, outputOffset);
    outputOffset += rowBytes;
    previous = row;
  }
  return { width, height, rgba };
}

function assertManifestMatches() {
  const manifestPath = path.join(ROOT, "plugins", "particles-plus", "manifest.json");
  if (!fs.existsSync(manifestPath)) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const manifestIds = manifest.resources
    .filter((resource) => resource.type === "image")
    .map((resource) => resource.id.replace(/^sprite-/, ""))
    .sort();
  const catalogIds = [...SPRITE_IDS].sort();
  if (JSON.stringify(manifestIds) !== JSON.stringify(catalogIds)) {
    throw new Error(`manifest image resources do not match sprite catalog (${manifestIds.length} vs ${catalogIds.length})`);
  }
}

function validateSprites({ checkManifest = true } = {}) {
  if (new Set(SPRITE_IDS).size !== SPRITE_IDS.length) throw new Error("sprite ids are not unique");
  for (const id of SPRITE_IDS) {
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(id)) throw new Error(`invalid sprite id: ${id}`);
  }
  if (checkManifest) assertManifestMatches();
  if (!fs.existsSync(OUTPUT_DIR)) throw new Error(`missing sprite directory: ${OUTPUT_DIR}`);
  const expectedFiles = new Set(SPRITE_IDS.map((id) => `${id}.png`));
  const actualFiles = new Set(fs.readdirSync(OUTPUT_DIR).filter((name) => name.endsWith(".png")));
  for (const file of expectedFiles) if (!actualFiles.has(file)) throw new Error(`missing sprite: ${file}`);
  for (const file of actualFiles) if (!expectedFiles.has(file)) throw new Error(`unexpected sprite: ${file}`);

  for (const id of SPRITE_IDS) {
    const { width, height, rgba } = decodePng(fs.readFileSync(path.join(OUTPUT_DIR, `${id}.png`)));
    if (width !== WIDTH || height !== HEIGHT) throw new Error(`${id}: expected ${WIDTH}x${HEIGHT}, got ${width}x${height}`);
    let visible = 0;
    let minX = WIDTH;
    let minY = HEIGHT;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (rgba[offset] !== 255 || rgba[offset + 1] !== 255 || rgba[offset + 2] !== 255) {
          throw new Error(`${id}: non-white RGB at ${x},${y}`);
        }
        if (rgba[offset + 3] > 0) {
          visible += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (visible === 0) throw new Error(`${id}: sprite is fully transparent`);
    if (minX < 4 || minY < 4 || maxX > WIDTH - 5 || maxY > HEIGHT - 5) {
      throw new Error(`${id}: visible bounds ${minX},${minY}..${maxX},${maxY} violate safety margin`);
    }
  }
}

function generateSprites(spriteIds = SPRITE_IDS) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const id of spriteIds) {
    const field = fieldForSprite(id);
    if (!field) throw new Error(`no field registered for ${id}`);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${id}.png`),
      encodePng(renderSprite(withFade(field), id.startsWith("flare_"))),
    );
  }
  validateSprites({ checkManifest: false });
}

function writeContactSheet(filePath) {
  const columns = 6;
  const cellSize = 160;
  const rows = Math.ceil(SPRITE_IDS.length / columns);
  const sheetWidth = columns * cellSize;
  const sheetHeight = rows * cellSize;
  const sheet = Buffer.alloc(sheetWidth * sheetHeight * 4);
  for (let index = 0; index < sheet.length; index += 4) {
    sheet[index] = 0;
    sheet[index + 1] = 0;
    sheet[index + 2] = 0;
    sheet[index + 3] = 255;
  }
  SPRITE_IDS.forEach((id, index) => {
    const { rgba } = decodePng(fs.readFileSync(path.join(OUTPUT_DIR, `${id}.png`)));
    const cellX = (index % columns) * cellSize + 16;
    const cellY = Math.floor(index / columns) * cellSize + 16;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const sourceOffset = (y * WIDTH + x) * 4;
        const targetOffset = ((cellY + y) * sheetWidth + cellX + x) * 4;
        const alpha = rgba[sourceOffset + 3] / 255;
        sheet[targetOffset] = Math.round(255 * alpha);
        sheet[targetOffset + 1] = Math.round(255 * alpha);
        sheet[targetOffset + 2] = Math.round(255 * alpha);
        sheet[targetOffset + 3] = 255;
      }
    }
  });

  const raw = Buffer.alloc((sheetWidth * 4 + 1) * sheetHeight);
  for (let y = 0; y < sheetHeight; y += 1) {
    const rowOffset = y * (sheetWidth * 4 + 1);
    raw[rowOffset] = 0;
    sheet.copy(raw, rowOffset + 1, y * sheetWidth * 4, (y + 1) * sheetWidth * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(sheetWidth, 0);
  header.writeUInt32BE(sheetHeight, 4);
  header[8] = 8;
  header[9] = 6;
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(path.resolve(filePath), Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

function main() {
  const args = process.argv.slice(2);
  const sheetIndex = args.indexOf("--sheet");
  const sheetPath = sheetIndex >= 0 ? args[sheetIndex + 1] : null;
  if (sheetIndex >= 0 && (!sheetPath || sheetPath.startsWith("--"))) throw new Error("--sheet requires a file path");

  const onlyIndex = args.indexOf("--only");
  let selectedIds = SPRITE_IDS;
  if (onlyIndex >= 0) {
    const onlyValue = args[onlyIndex + 1];
    if (!onlyValue || onlyValue.startsWith("--")) throw new Error("--only requires a comma-separated sprite id list");
    selectedIds = onlyValue.split(",").map((id) => id.trim()).filter(Boolean);
    for (const id of selectedIds) {
      if (!SPRITE_IDS.includes(id)) throw new Error(`unknown sprite id in --only: ${id}`);
    }
  }

  if (!args.includes("--check")) generateSprites(selectedIds);
  validateSprites({ checkManifest: true });
  if (sheetPath) writeContactSheet(sheetPath);
  process.stdout.write(`Particles+ sprites valid: ${SPRITE_IDS.length} x ${WIDTH}x${HEIGHT}\n`);
  if (sheetPath) process.stdout.write(`Contact sheet: ${path.resolve(sheetPath)}\n`);
  process.stdout.write(`${SPRITE_IDS.join(" ")}\n`);
}

main();
