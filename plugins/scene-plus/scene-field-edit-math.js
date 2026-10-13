"use strict";

const { invertMatrix, rotateXYZ } = require("./effector-core.js");
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const normalize = a => { const length = Math.hypot(...a); return length > 1e-10 ? a.map(v => v / length) : null; };

function transformPoint(matrix, point) {
  const p = [...point, 1];
  const q = [0, 1, 2, 3].map(row => p.reduce((sum, v, col) => sum + matrix[col * 4 + row] * v, 0));
  return q.slice(0, 3).map(v => v / q[3]);
}

// Unproject through the camera that draws the helper, intersect the frozen
// view plane, then convert points through the effector's full world inverse.
function viewPlanePoint(screen, rect, cameraWorld, projectionInverse, center, normal) {
  if (!rect.width || !rect.height) return null;
  const x = (screen[0] - rect.left) / rect.width * 2 - 1;
  const y = 1 - (screen[1] - rect.top) / rect.height * 2;
  const near = transformPoint(cameraWorld, transformPoint(projectionInverse, [x, y, -1]));
  const far = transformPoint(cameraWorld, transformPoint(projectionInverse, [x, y, 1]));
  const direction = subtract(far, near), denominator = dot(direction, normal);
  if (Math.abs(denominator) < 1e-10) return null;
  const distance = dot(subtract(center, near), normal) / denominator;
  const point = near.map((v, i) => v + direction[i] * distance);
  return point.every(Number.isFinite) ? point : null;
}

function localDelta(start, end, worldMatrix) {
  const inverse = invertMatrix(worldMatrix);
  return inverse ? subtract(transformPoint(inverse, end), transformPoint(inverse, start)) : null;
}

function localViewAxis(normal, worldMatrix) {
  const inverse = invertMatrix(worldMatrix);
  if (!inverse) return null;
  const origin = transformPoint(inverse, [0, 0, 0]);
  return normalize(subtract(transformPoint(inverse, normal), origin));
}

function screenAngle(start, end, center) {
  const a = subtract(start, center), b = subtract(end, center);
  if (Math.hypot(...a) < 8 || Math.hypot(...b) < 8) return 0;
  // Screen Y points down; the view normal points toward the camera.
  return Math.atan2(a[1] * b[0] - a[0] * b[1], dot(a, b));
}

function rotateField(rotation, axis, angle) {
  if (Math.abs(angle) < 1e-12) return rotation.slice();
  const c = Math.cos(angle), s = Math.sin(angle);
  const spin = v => {
    const cross = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
    return v.map((n, i) => n * c + cross[i] * s + axis[i] * dot(axis, v) * (1 - c));
  };
  const [x, y, z] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => spin(rotateXYZ(v, rotation)));
  const pitch = Math.asin(Math.max(-1, Math.min(1, -x[2])));
  const regular = Math.abs(Math.cos(pitch)) > 1e-8;
  return [regular ? Math.atan2(y[2], z[2]) : 0, pitch,
    regular ? Math.atan2(x[1], x[0]) : Math.atan2(-y[0], y[1])].map(v => v * 180 / Math.PI);
}

function resizeField(scale, delta) {
  const factor = Math.exp(Math.max(-12, Math.min(12, (delta[0] - delta[1]) / 150)));
  return scale.map(value => Math.max(0.01, value * factor));
}

module.exports = { transformPoint, viewPlanePoint, localDelta, localViewAxis, screenAngle, rotateField, resizeField };
