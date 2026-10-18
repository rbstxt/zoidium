"use strict";

// Pure math for the Track To constraint. No THREE dependency, so node:test
// can pin the results. Vectors are [x, y, z]; quaternions are [x, y, z, w]
// (THREE order); 3x3 matrices are row-major arrays of nine numbers.
//
// Axis options follow the native property rows:
//   track axis: 0 +X, 1 +Y, 2 +Z, 3 -X, 4 -Y, 5 -Z
//   up axis:    0 X,  1 Y,  2 Z

const EPSILON = 1e-9;
const TRACK_AXIS_ITEMS = "+X;+Y;+Z;-X;-Y;-Z";
const UP_AXIS_ITEMS = "X;Y;Z";
const TRACK_NEGATIVE_Z = 5;
const TRACK_POSITIVE_Z = 2;
const UP_Y = 1;
const WORLD_UP = [0, 1, 0];
// Deterministic fallbacks when the direction is parallel to the world up.
const UP_FALLBACKS = [[0, 0, -1], [1, 0, 0]];

function finite(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function trackAxisInfo(option) {
  const index = Math.trunc(finite(option, TRACK_POSITIVE_Z));
  const safe = index >= 0 && index <= 5 ? index : TRACK_POSITIVE_Z;
  return { axis: safe % 3, sign: safe < 3 ? 1 : -1 };
}

function upAxisIndex(option) {
  const index = Math.trunc(finite(option, UP_Y));
  return index >= 0 && index <= 2 ? index : UP_Y;
}

// The up axis may not equal the track axis. Resolve a conflict the same way
// the UI does: Y becomes Z, any other axis becomes Y.
function resolveUpAxis(trackOption, upOption) {
  const track = trackAxisInfo(trackOption).axis;
  const up = upAxisIndex(upOption);
  if (up !== track) return up;
  return track === 1 ? 2 : 1;
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(v) {
  return Math.sqrt(dot(v, v));
}

function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function normalize(v) {
  const len = length(v);
  if (!(len > EPSILON) || !Number.isFinite(len)) return null;
  return scale(v, 1 / len);
}

function isFiniteVector(v) {
  return Array.isArray(v) && v.length >= 3 &&
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function multiplyMatrix3Vector(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

// Inverse of a row-major 3x3 matrix, or null when it is singular.
function invertMatrix3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

// Upper-left 3x3 of a column-major THREE Matrix4 elements array, row-major.
function linearPartOfMatrix4(elements) {
  const e = elements;
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

// Rotation (row-major 3x3, columns = local axes) that points the chosen
// track axis along `direction` and turns the chosen up axis as close to `up`
// as possible. Returns null for a degenerate direction.
function trackRotationMatrix(direction, up, trackOption, upOption) {
  if (!isFiniteVector(direction)) return null;
  const forward = normalize(direction);
  if (!forward) return null;
  const track = trackAxisInfo(trackOption);
  const upAxis = resolveUpAxis(trackOption, upOption);
  const axes = [null, null, null];
  axes[track.axis] = scale(forward, track.sign);

  const candidates = [isFiniteVector(up) ? up : WORLD_UP].concat(UP_FALLBACKS);
  let upDirection = null;
  for (const candidate of candidates) {
    const unit = normalize(candidate);
    if (!unit) continue;
    const along = dot(unit, axes[track.axis]);
    const projected = normalize(subtract(unit, scale(axes[track.axis], along)));
    if (projected && Math.abs(along) < 1 - 1e-6) {
      upDirection = projected;
      break;
    }
  }
  if (!upDirection) return null;
  axes[upAxis] = upDirection;
  const third = 3 - track.axis - upAxis;
  // Right-handed basis: X = Y x Z, Y = Z x X, Z = X x Y.
  axes[third] = cross(axes[(third + 1) % 3], axes[(third + 2) % 3]);
  return [
    axes[0][0], axes[1][0], axes[2][0],
    axes[0][1], axes[1][1], axes[2][1],
    axes[0][2], axes[1][2], axes[2][2],
  ];
}

// Quaternion of a pure rotation matrix (row-major), as THREE computes it.
function quaternionFromMatrix3(m) {
  const m11 = m[0], m12 = m[1], m13 = m[2];
  const m21 = m[3], m22 = m[4], m23 = m[5];
  const m31 = m[6], m32 = m[7], m33 = m[8];
  const trace = m11 + m22 + m33;
  let x, y, z, w, s;
  if (trace > 0) {
    s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }
  return normalizeQuaternion([x, y, z, w]);
}

// THREE.Quaternion.setFromEuler for every CM3 rotation order.
function quaternionFromEuler(x, y, z, order) {
  const c1 = Math.cos(finite(x, 0) / 2), c2 = Math.cos(finite(y, 0) / 2), c3 = Math.cos(finite(z, 0) / 2);
  const s1 = Math.sin(finite(x, 0) / 2), s2 = Math.sin(finite(y, 0) / 2), s3 = Math.sin(finite(z, 0) / 2);
  switch (order) {
    case "YXZ":
      return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    case "ZXY":
      return [s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
    case "ZYX":
      return [s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    case "YZX":
      return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3,
        c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
    case "XZY":
      return [s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
    default: // XYZ
      return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
  }
}

function normalizeQuaternion(q) {
  const len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
  if (!(len > EPSILON) || !Number.isFinite(len)) return [0, 0, 0, 1];
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function multiplyQuaternions(a, b) {
  return [
    a[0] * b[3] + a[3] * b[0] + a[1] * b[2] - a[2] * b[1],
    a[1] * b[3] + a[3] * b[1] + a[2] * b[0] - a[0] * b[2],
    a[2] * b[3] + a[3] * b[2] + a[0] * b[1] - a[1] * b[0],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function conjugateQuaternion(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

// Shortest-path spherical interpolation; t is clamped to [0, 1].
function slerpQuaternions(a, b, t) {
  const amount = Math.min(1, Math.max(0, finite(t, 0)));
  if (amount === 0) return a.slice();
  if (amount === 1) return b.slice();
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let cosHalf = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cosHalf < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
    cosHalf = -cosHalf;
  }
  if (cosHalf >= 1 - 1e-9) {
    return normalizeQuaternion([
      a[0] + (bx - a[0]) * amount, a[1] + (by - a[1]) * amount,
      a[2] + (bz - a[2]) * amount, a[3] + (bw - a[3]) * amount,
    ]);
  }
  const halfAngle = Math.acos(Math.min(1, cosHalf));
  const sinHalf = Math.sqrt(1 - cosHalf * cosHalf);
  const ra = Math.sin((1 - amount) * halfAngle) / sinHalf;
  const rb = Math.sin(amount * halfAngle) / sinHalf;
  return normalizeQuaternion([
    a[0] * ra + bx * rb, a[1] * ra + by * rb,
    a[2] * ra + bz * rb, a[3] * ra + bw * rb,
  ]);
}

function rotateVector(q, v) {
  const p = multiplyQuaternions(multiplyQuaternions(q, [v[0], v[1], v[2], 0]), conjugateQuaternion(q));
  return [p[0], p[1], p[2]];
}

// Influence is stored in percent (0-100).
function influenceWeight(percent) {
  return Math.min(1, Math.max(0, finite(percent, 100) / 100));
}

// Local rotation for a constrained object.
//   direction: target minus object position, in world space
//   parentLinear: row-major 3x3 linear part of the parent world matrix
//   own: the object's own evaluated local quaternion
// Returns the blended local quaternion, or null when nothing should change.
function solveTrackTo(options) {
  const weight = influenceWeight(options.influence);
  if (weight <= 0) return null;
  const parentInverse = invertMatrix3(options.parentLinear || [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  if (!parentInverse) return null;
  const localDirection = multiplyMatrix3Vector(parentInverse, options.direction);
  const localUp = multiplyMatrix3Vector(parentInverse, options.up || WORLD_UP);
  const rotation = trackRotationMatrix(localDirection, localUp, options.trackAxis, options.upAxis);
  if (!rotation) return null;
  const tracked = quaternionFromMatrix3(rotation);
  const own = normalizeQuaternion(options.own || [0, 0, 0, 1]);
  const result = slerpQuaternions(own, tracked, weight);
  return result.every(Number.isFinite) ? result : null;
}

// Aim point for spot and directional lights, which have no rotation. The
// light shines from `origin` toward `aim`; the direction is spherically
// blended between the light's own aim and the target by influence.
function solveLightAim(origin, ownAim, targetPoint, influence) {
  const weight = influenceWeight(influence);
  if (weight <= 0 || !isFiniteVector(origin) || !isFiniteVector(targetPoint)) return null;
  const toTarget = subtract(targetPoint, origin);
  const targetDistance = length(toTarget);
  if (!(targetDistance > EPSILON)) return null;
  if (weight >= 1 || !isFiniteVector(ownAim)) return targetPoint.slice(0, 3);
  const toOwn = subtract(ownAim, origin);
  const ownDistance = length(toOwn);
  if (!(ownDistance > EPSILON)) return null;
  const a = scale(toOwn, 1 / ownDistance);
  const b = scale(toTarget, 1 / targetDistance);
  const cosAngle = Math.min(1, Math.max(-1, dot(a, b)));
  const angle = Math.acos(cosAngle);
  let direction;
  if (angle < 1e-9) {
    direction = b;
  } else if (Math.PI - angle < 1e-6) {
    // Opposite directions: rotate around a deterministic perpendicular axis.
    let axis = normalize(cross(a, WORLD_UP)) || normalize(cross(a, [1, 0, 0]));
    const half = angle * weight / 2;
    const q = [axis[0] * Math.sin(half), axis[1] * Math.sin(half), axis[2] * Math.sin(half), Math.cos(half)];
    direction = rotateVector(q, a);
  } else {
    const sinAngle = Math.sin(angle);
    const ra = Math.sin((1 - weight) * angle) / sinAngle;
    const rb = Math.sin(weight * angle) / sinAngle;
    direction = [a[0] * ra + b[0] * rb, a[1] * ra + b[1] * rb, a[2] * ra + b[2] * rb];
  }
  const distance = ownDistance + (targetDistance - ownDistance) * weight;
  const point = [
    origin[0] + direction[0] * distance,
    origin[1] + direction[1] * distance,
    origin[2] + direction[2] * distance,
  ];
  return isFiniteVector(point) ? point : null;
}

module.exports = {
  EPSILON,
  TRACK_AXIS_ITEMS,
  UP_AXIS_ITEMS,
  TRACK_NEGATIVE_Z,
  TRACK_POSITIVE_Z,
  UP_Y,
  WORLD_UP,
  trackAxisInfo,
  upAxisIndex,
  resolveUpAxis,
  dot,
  cross,
  length,
  normalize,
  subtract,
  multiplyMatrix3Vector,
  invertMatrix3,
  linearPartOfMatrix4,
  trackRotationMatrix,
  quaternionFromMatrix3,
  quaternionFromEuler,
  normalizeQuaternion,
  multiplyQuaternions,
  conjugateQuaternion,
  slerpQuaternions,
  rotateVector,
  influenceWeight,
  solveTrackTo,
  solveLightAim,
};
