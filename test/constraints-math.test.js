"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../plugins/constraints/track-to-math.js");

const EPS = 1e-9;

function close(actual, expected, tolerance = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `index ${i}: ${actual[i]} vs ${expected[i]}`);
  }
}

function axisOf(rotation, index) {
  return [rotation[index], rotation[3 + index], rotation[6 + index]];
}

function sameRotation(a, b, tolerance = 1e-9) {
  // q and -q are the same rotation.
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  assert.ok(Math.abs(dot - 1) <= tolerance, `rotations differ: ${a} vs ${b}`);
}

test("track axis options map to signed axes", () => {
  assert.deepEqual(math.trackAxisInfo(0), { axis: 0, sign: 1 });
  assert.deepEqual(math.trackAxisInfo(4), { axis: 1, sign: -1 });
  assert.deepEqual(math.trackAxisInfo(5), { axis: 2, sign: -1 });
  assert.deepEqual(math.trackAxisInfo(99), { axis: 2, sign: 1 });
  assert.deepEqual(math.trackAxisInfo(Number.NaN), { axis: 2, sign: 1 });
});

test("an up axis equal to the track axis is resolved", () => {
  assert.equal(math.resolveUpAxis(1, 1), 2); // +Y track, Y up -> Z
  assert.equal(math.resolveUpAxis(4, 1), 2); // -Y track, Y up -> Z
  assert.equal(math.resolveUpAxis(2, 2), 1); // +Z track, Z up -> Y
  assert.equal(math.resolveUpAxis(0, 0), 1); // +X track, X up -> Y
  assert.equal(math.resolveUpAxis(5, 1), 1); // no conflict
});

test("the track axis points along the direction for every option", () => {
  const direction = [3, -2, 5];
  const unit = math.normalize(direction);
  for (let track = 0; track < 6; track += 1) {
    for (let up = 0; up < 3; up += 1) {
      const rotation = math.trackRotationMatrix(direction, [0, 1, 0], track, up);
      const info = math.trackAxisInfo(track);
      const axis = axisOf(rotation, info.axis).map((v) => v * info.sign);
      close(axis, unit, 1e-12);
      // Orthonormal and right-handed.
      const x = axisOf(rotation, 0), y = axisOf(rotation, 1), z = axisOf(rotation, 2);
      close(math.cross(x, y), z, 1e-12);
      assert.ok(Math.abs(math.length(x) - 1) < 1e-12);
      // The up axis stays on the world-up side of the plane.
      const upAxis = math.resolveUpAxis(track, up);
      assert.ok(math.dot(axisOf(rotation, upAxis), [0, 1, 0]) > 0);
    }
  }
});

test("a camera tracking with -Z and Y up matches lookAt conventions", () => {
  // Camera at the origin looking at +X: -Z must point to +X, +Y stays up.
  const rotation = math.trackRotationMatrix([10, 0, 0], [0, 1, 0], math.TRACK_NEGATIVE_Z, math.UP_Y);
  close(axisOf(rotation, 2), [-1, 0, 0]);
  close(axisOf(rotation, 1), [0, 1, 0]);
  close(axisOf(rotation, 0), [0, 0, 1]);
  const q = math.quaternionFromMatrix3(rotation);
  sameRotation(q, [0, Math.sin(-Math.PI / 4), 0, Math.cos(-Math.PI / 4)]);
});

test("degenerate directions return null and never NaN", () => {
  assert.equal(math.trackRotationMatrix([0, 0, 0], [0, 1, 0], 2, 1), null);
  assert.equal(math.trackRotationMatrix([Number.NaN, 0, 1], [0, 1, 0], 2, 1), null);
  // Direction parallel to world up falls back deterministically.
  const straightUp = math.trackRotationMatrix([0, 5, 0], [0, 1, 0], 2, 1);
  assert.ok(straightUp.every(Number.isFinite));
  close(axisOf(straightUp, 2), [0, 1, 0]);
  const again = math.trackRotationMatrix([0, 5, 0], [0, 1, 0], 2, 1);
  assert.deepEqual(straightUp, again);
  assert.equal(math.solveTrackTo({ direction: [0, 0, 0], own: [0, 0, 0, 1], influence: 100, trackAxis: 2, upAxis: 1 }), null);
});

test("Euler conversion matches THREE for every rotation order", () => {
  // Reference values computed with THREE r91 Quaternion.setFromEuler.
  const cases = {
    XYZ: [0.2343036929, 0.2824198196, 0.3234397888, 0.8721969548],
    YXZ: [0.2343036929, 0.2824198196, 0.2255330688, 0.9024830524],
    ZXY: [0.0339129570, 0.3653889522, 0.3234397888, 0.8721969548],
    ZYX: [0.0339129570, 0.3653889522, 0.2255330688, 0.9024830524],
    YZX: [0.2343036929, 0.3653889522, 0.2255330688, 0.8721969548],
    XZY: [0.0339129570, 0.2824198196, 0.3234397888, 0.9024830524],
  };
  for (const [order, expected] of Object.entries(cases)) {
    close(math.quaternionFromEuler(0.3, 0.7, 0.6, order), expected, 1e-9);
  }
  for (const order of ["XYZ", "YZX", "ZXY", "XZY", "YXZ", "ZYX"]) {
    const q = math.quaternionFromEuler(0.1, -0.4, 1.2, order);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-12);
  }
});

test("slerp is shortest path and clamps its amount", () => {
  const a = [0, 0, 0, 1];
  const b = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]; // 90 deg about Y
  const half = math.slerpQuaternions(a, b, 0.5);
  sameRotation(half, [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]);
  sameRotation(math.slerpQuaternions(a, b.map((v) => -v), 0.5), half);
  assert.deepEqual(math.slerpQuaternions(a, b, -1), a);
  assert.deepEqual(math.slerpQuaternions(a, b, 2), b);
});

test("influence blends between own and tracked rotation", () => {
  const own = math.quaternionFromEuler(0, 0, 0, "XYZ");
  const full = math.solveTrackTo({ direction: [10, 0, 0], own, influence: 100, trackAxis: 2, upAxis: 1 });
  const half = math.solveTrackTo({ direction: [10, 0, 0], own, influence: 50, trackAxis: 2, upAxis: 1 });
  assert.equal(math.solveTrackTo({ direction: [10, 0, 0], own, influence: 0, trackAxis: 2, upAxis: 1 }), null);
  // +Z to +X is 90 degrees about Y; half influence is 45 degrees.
  sameRotation(full, [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)]);
  sameRotation(half, [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]);
  assert.equal(math.influenceWeight(150), 1);
  assert.equal(math.influenceWeight(-3), 0);
  assert.equal(math.influenceWeight("x"), 1);
});

test("parent rotation and non-uniform scale still aim the track axis at the target", () => {
  // Parent: rotate 90 deg about Z, then scale (2, 0.5, 3) in its local frame.
  const c = 0, s = 1;
  const rotation = [c, -s, 0, s, c, 0, 0, 0, 1];
  const scaleDiag = [2, 0.5, 3];
  const parent = rotation.map((v, i) => v * scaleDiag[i % 3]);
  const direction = [4, 1, -2];
  const q = math.solveTrackTo({ direction, parentLinear: parent, own: [0, 0, 0, 1], influence: 100, trackAxis: 2, upAxis: 1 });
  const localZ = math.rotateVector(q, [0, 0, 1]);
  const worldZ = math.multiplyMatrix3Vector(parent, localZ);
  close(math.normalize(worldZ), math.normalize(direction), 1e-12);
  assert.equal(math.solveTrackTo({ direction, parentLinear: [0, 0, 0, 0, 1, 0, 0, 0, 1], own: [0, 0, 0, 1], influence: 100, trackAxis: 2, upAxis: 1 }), null);
});

test("matrix helpers invert and extract linear parts", () => {
  const m = [2, 0, 1, 0, 3, 0, 1, 0, 1];
  const inv = math.invertMatrix3(m);
  const product = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) =>
    m[row * 3] * inv[col] + m[row * 3 + 1] * inv[3 + col] + m[row * 3 + 2] * inv[6 + col]));
  close(product, [1, 0, 0, 0, 1, 0, 0, 0, 1], EPS);
  // THREE Matrix4 elements are column-major.
  const elements = [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 1];
  assert.deepEqual(math.linearPartOfMatrix4(elements), [1, 4, 7, 2, 5, 8, 3, 6, 9]);
});

test("light aim blends direction and distance", () => {
  const origin = [0, 0, 0];
  assert.deepEqual(math.solveLightAim(origin, [0, 0, -10], [10, 0, 0], 100), [10, 0, 0]);
  const half = math.solveLightAim(origin, [0, 0, -10], [10, 0, 0], 50);
  close(half, [10 * Math.SQRT1_2, 0, -10 * Math.SQRT1_2], 1e-9);
  const opposite = math.solveLightAim(origin, [0, 0, -10], [0, 0, 10], 50);
  assert.ok(opposite.every(Number.isFinite));
  assert.ok(Math.abs(math.length(opposite) - 10) < 1e-9);
  assert.equal(math.solveLightAim(origin, [0, 0, -10], [0, 0, 0], 100), null);
  assert.equal(math.solveLightAim(origin, [0, 0, -10], [1, 0, 0], 0), null);
});
