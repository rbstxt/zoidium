"use strict";
// Pure-JS layer-mask coverage raster.
//
// The same code renders in the browser and runs in Node tests: no canvas, no
// DOM, no GPU. A flattened polygon fills by scanline (even-odd), feather
// applies as three separable box-blur passes (a Gaussian approximation whose
// cost is independent of radius), then opacity, invert and the AE-style mode
// combine run per pixel. Output is an 8-bit alpha plane in mask space
// (sequence pixels, origin top-left, y down).
const { flattenPath } = require("./path.js");
const { combineValue } = require("./mask-model.js");

function closeContour(vertices, closed) {
  if (closed || vertices.length < 2) return vertices;
  const first = vertices[0].point, last = vertices[vertices.length - 1].point;
  if (Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) return vertices;
  return [...vertices, { point: first.slice(), in: [0, 0], out: [0, 0] }];
}

// Even-odd scanline fill of the flattened polygon into `alpha` (Float32Array,
// row-major, 0..1). Edges are half-open [y0, y1) so shared vertices count once.
function fillPolygon(points, width, height, alpha) {
  if (points.length < 3) return;
  const edges = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (a[1] === b[1]) continue;
    const [top, bottom] = a[1] < b[1] ? [a, b] : [b, a];
    edges.push({ y0: top[1], y1: bottom[1], x: top[0], slope: (bottom[0] - top[0]) / (bottom[1] - top[1]) });
  }
  const buckets = new Map();
  for (const edge of edges) {
    const row = Math.max(0, Math.floor(edge.y0));
    if (row >= height) continue;
    if (!buckets.has(row)) buckets.set(row, []);
    buckets.get(row).push(edge);
  }
  const active = [];
  for (let y = 0; y < height; y++) {
    const starting = buckets.get(y);
    if (starting) active.push(...starting);
    for (let i = active.length - 1; i >= 0; i--) if (y >= active[i].y1) active.splice(i, 1);
    if (!active.length) continue;
    const crossings = [];
    for (const edge of active) crossings.push(edge.x + (y + 0.5 - edge.y0) * edge.slope);
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      let x0 = Math.max(0, Math.ceil(crossings[i] - 0.5));
      let x1 = Math.min(width - 1, Math.floor(crossings[i + 1] - 0.5));
      const row = y * width;
      for (let x = x0; x <= x1; x++) alpha[row + x] = 1;
    }
  }
}

// Sliding-window box blur, horizontal when `transpose` is false. Clamped
// edges (out-of-range samples repeat the edge value), so a fully covered
// plane stays fully covered.
function boxBlur(channel, width, height, radius, transpose) {
  if (!(radius > 0)) return channel;
  const major = transpose ? height : width, minor = transpose ? width : height;
  const window = 2 * radius + 1;
  const output = new Float32Array(channel.length);
  for (let m = 0; m < minor; m++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += getSample(channel, width, height, m, k, transpose);
    for (let i = 0; i < major; i++) {
      setSample(output, width, height, m, i, sum / window, transpose);
      sum += getSample(channel, width, height, m, i + radius + 1, transpose) - getSample(channel, width, height, m, i - radius, transpose);
    }
  }
  return output;
}

function getSample(channel, width, height, minor, major, transpose) {
  const size = transpose ? height : width;
  const clamped = major < 0 ? 0 : major >= size ? size - 1 : major;
  return transpose ? channel[clamped * width + minor] : channel[minor * width + clamped];
}

function setSample(channel, width, height, minor, major, value, transpose) {
  if (transpose) channel[major * width + minor] = value;
  else channel[minor * width + major] = value;
}

function featherAlpha(alpha, width, height, radius) {
  let channel = alpha;
  const clamped = Math.max(0, Math.min(Math.max(width, height), Math.round(radius)));
  for (let pass = 0; pass < 3; pass++) {
    channel = boxBlur(channel, width, height, clamped, false);
    channel = boxBlur(channel, width, height, clamped, true);
  }
  return channel;
}

// `masks` are evaluated geometries: { vertices, closed, mode, feather,
// opacity, invert, enabled }. Returns { data: Uint8Array, width, height }.
function rasterizeCoverage(masks, width, height) {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1)
    throw Error("Layer mask raster needs a positive integer size");
  if (width * height > 33554432) throw Error("Layer mask raster too large");
  const coverage = new Float32Array(width * height);
  let scratch = new Float32Array(width * height);
  let first = true;
  for (const mask of masks) {
    if (!mask || mask.enabled === false || mask.enabled === 0) continue;
    scratch.fill(0);
    const contour = closeContour(mask.vertices || [], !!mask.closed);
    if (contour.length >= 2) {
      const flat = flattenPath({ vertices: contour, closed: true });
      fillPolygon(flat.points, width, height, scratch);
    }
    let channel = scratch;
    if (mask.feather > 0) channel = featherAlpha(channel, width, height, mask.feather);
    const opacity = mask.opacity === undefined ? 1 : mask.opacity;
    const invert = !!mask.invert;
    const mode = mask.mode || "add";
    for (let i = 0; i < coverage.length; i++) {
      let alpha = channel[i] * opacity;
      if (invert) alpha = 1 - alpha;
      if (alpha < 0) alpha = 0;
      else if (alpha > 1) alpha = 1;
      coverage[i] = combineValue(coverage[i], alpha, mode, first);
    }
    first = false;
  }
  const data = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i++) {
    const value = Math.round(coverage[i] * 255);
    data[i] = value < 0 ? 0 : value > 255 ? 255 : value;
  }
  return { data, width, height };
}

module.exports = { rasterizeCoverage, fillPolygon, boxBlur, closeContour };
