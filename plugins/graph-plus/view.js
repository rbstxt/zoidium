"use strict";

// Graph units per CSS pixel. Fit and wheel input share both endpoints.
const ZOOM = { x: { min: 0.0001, max: 500 }, y: { min: 0.000001, max: 10000 } };
function clampZoom(value, axis) {
  const bounds = ZOOM[axis];
  return Math.max(bounds.min, Math.min(bounds.max, value));
}
function ticks(zoom) {
  const target = zoom * 64;
  const power = Math.pow(10, Math.floor(Math.log10(target)));
  const factor = [1, 2, 5, 10].find(value => value * power >= target);
  const major = factor * power;
  return { major, minor: major / 5 };
}
function tickLabel(value) {
  return String(Number(value.toPrecision(12)));
}
module.exports = { ZOOM, clampZoom, ticks, tickLabel };
