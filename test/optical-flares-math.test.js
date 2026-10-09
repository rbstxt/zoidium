"use strict";

// Projection and layout math of the Optical Flares source. The matrices below
// follow three.js conventions (column-major elements, cameras look down -Z),
// so the results match what the flare object receives from a render pass.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function loadMath() {
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins", "optical-flares", "optflares-math.js"),
    "utf8"
  );
  const PZ = {};
  new Function("PZ", source)(PZ);
  return PZ.opticalflares.math;
}

const math = loadMath();

// THREE.Matrix4.makePerspective equivalent, column-major.
function perspective(fovYDegrees, aspect, near, far) {
  const top = near * Math.tan((fovYDegrees * Math.PI) / 360);
  const right = top * aspect;
  const x = (2 * near) / (2 * right);
  const y = (2 * near) / (2 * top);
  const c = -(far + near) / (far - near);
  const d = (-2 * far * near) / (far - near);
  return [x, 0, 0, 0, 0, y, 0, 0, 0, 0, c, -1, 0, 0, d, 0];
}

// THREE.Matrix4.makeOrthographic equivalent, column-major.
function orthographic(halfWidth, halfHeight, near, far) {
  return [
    1 / halfWidth, 0, 0, 0,
    0, 1 / halfHeight, 0, 0,
    0, 0, -2 / (far - near), 0,
    0, 0, -(far + near) / (far - near), 1,
  ];
}

// World matrix of a camera at `position` with yaw (about Y) then pitch (about
// X), returned as its inverse, the matrixWorldInverse a three.js camera keeps.
function viewMatrix(position, yawDegrees, pitchDegrees) {
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  // Rotation = Ry(yaw) * Rx(pitch); its transpose is the view rotation.
  const r = [
    [cy, sy * sx, sy * cx],
    [0, cx, -sx],
    [-sy, cy * sx, cy * cx],
  ];
  // Rotation matrix rows r; view rotation V = R^T.
  const v = [
    [r[0][0], r[1][0], r[2][0]],
    [r[0][1], r[1][1], r[2][1]],
    [r[0][2], r[1][2], r[2][2]],
  ];
  const t = [
    -(v[0][0] * position[0] + v[0][1] * position[1] + v[0][2] * position[2]),
    -(v[1][0] * position[0] + v[1][1] * position[1] + v[1][2] * position[2]),
    -(v[2][0] * position[0] + v[2][1] * position[1] + v[2][2] * position[2]),
  ];
  return [
    v[0][0], v[1][0], v[2][0], 0,
    v[0][1], v[1][1], v[2][1], 0,
    v[0][2], v[1][2], v[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const PROJ = perspective(50, 16 / 9, 0.1, 5000);

test("a source straight ahead projects to the screen centre", () => {
  const view = viewMatrix([0, 0, 0], 0, 0);
  const state = math.screenState({
    world: [0, 0, -10],
    view,
    proj: PROJ,
    aspect: 16 / 9,
    margin: 0.25,
    reference: 10,
    falloff: 0,
  });
  assert.ok(state, "visible");
  assert.ok(Math.abs(state.source[0]) < 1e-9);
  assert.ok(Math.abs(state.source[1]) < 1e-9);
  assert.equal(state.fade, 1);
  assert.equal(state.scale, 1);
  assert.ok(state.depth > -1 && state.depth < 1, "depth inside the NDC range");
});

test("moving the camera moves the flare on screen", () => {
  const world = [0, 0, -10];
  const still = math.screenState({ world, view: viewMatrix([0, 0, 0], 0, 0), proj: PROJ, aspect: 16 / 9, margin: 0.25 });
  const movedRight = math.screenState({ world, view: viewMatrix([1, 0, 0], 0, 0), proj: PROJ, aspect: 16 / 9, margin: 0.25 });
  const movedUp = math.screenState({ world, view: viewMatrix([0, 1, 0], 0, 0), proj: PROJ, aspect: 16 / 9, margin: 0.25 });
  assert.ok(movedRight.source[0] < 0, "camera to the right moves the source left");
  assert.ok(Math.abs(movedRight.source[0] - still.source[0]) > 0.05);
  assert.ok(movedUp.source[1] < 0, "camera raised moves the source down");
});

test("rotating the camera moves the flare on screen, monotonically", () => {
  const world = [0, 0, -10];
  const xs = [0, 5, 10, 15].map((yaw) => {
    const state = math.screenState({
      world,
      view: viewMatrix([0, 0, 0], yaw, 0),
      proj: PROJ,
      aspect: 16 / 9,
      margin: 0.25,
    });
    return state ? state.source[0] : null;
  });
  assert.ok(xs.every((x) => x !== null), "all four yaw angles keep the source visible");
  // Positive yaw turns the camera to the left, so the source drifts right.
  for (let i = 1; i < xs.length; i += 1) {
    assert.ok(xs[i] > xs[i - 1], "turning left moves the source right on screen");
  }
});

test("a source behind the camera is hidden", () => {
  const view = viewMatrix([0, 0, 0], 0, 0);
  assert.equal(math.projectPoint([0, 0, 10], view, PROJ), null);
  assert.equal(
    math.screenState({ world: [0, 0, 10], view, proj: PROJ, aspect: 16 / 9, margin: 0.25 }),
    null
  );
  // Turning around makes the same point visible again.
  const turned = viewMatrix([0, 0, 0], 180, 0);
  assert.notEqual(
    math.screenState({ world: [0, 0, 10], view: turned, proj: PROJ, aspect: 16 / 9, margin: 0.25 }),
    null
  );
});

test("a source at the camera plane is hidden, not projected to infinity", () => {
  const view = viewMatrix([0, 0, 0], 0, 0);
  assert.equal(math.projectPoint([5, 0, 0], view, PROJ), null);
});

test("sources beyond the edge margin fade out and then disappear", () => {
  const view = viewMatrix([0, 0, 0], 0, 0);
  const fadeAt = (x) => {
    const ndc = math.projectPoint([x, 0, -10], view, PROJ);
    return math.sourceFade(ndc, 0.5);
  };
  assert.equal(fadeAt(3), 1, "inside the frame");
  const partial = fadeAt(12);
  assert.ok(partial > 0 && partial < 1, "partial fade inside the margin");
  assert.equal(fadeAt(16), 0, "hidden past the margin");
  assert.equal(math.sourceFade({ x: 1.2, y: 0, z: 0 }, 0), 0, "no margin means a hard edge");
  assert.equal(math.sourceFade({ x: 0.2, y: -0.9, z: 1.5 }, 0.5), 0, "outside the depth range");
});

test("depth grows with distance, so nearer geometry occludes the flare plane", () => {
  const view = viewMatrix([0, 0, 0], 0, 0);
  const near = math.projectPoint([0, 0, -2], view, PROJ);
  const far = math.projectPoint([0, 0, -200], view, PROJ);
  assert.ok(near.z < far.z, "nearer source has the smaller NDC depth");
  assert.ok(near.z > -1 && far.z < 1);
});

test("orthographic cameras project without perspective", () => {
  const ortho = orthographic(2, 2, 0.1, 100);
  const view = viewMatrix([0, 0, 0], 0, 0);
  const a = math.projectPoint([1, 0, -5], view, ortho);
  const b = math.projectPoint([1, 0, -50], view, ortho);
  assert.ok(Math.abs(a.x - 0.5) < 1e-9, "x scaled by the half width");
  assert.ok(Math.abs(b.x - a.x) < 1e-9, "distance does not change orthographic position");
});

test("distance falloff scales size around the reference distance", () => {
  assert.equal(math.distanceScale(10, 10, 0), 1, "falloff 0 disables the effect");
  assert.equal(math.distanceScale(10, 10, 1), 1, "at the reference distance");
  assert.ok(Math.abs(math.distanceScale(20, 10, 1) - 0.5) < 1e-9, "twice as far, half size");
  assert.ok(math.distanceScale(5, 10, 2) > 1, "closer grows");
  assert.ok(math.distanceScale(1e-9, 10, 1) <= 20, "clamped near zero");
});

test("layout units keep the screen height at 2 and scale x by aspect", () => {
  const center = math.offsetToLayout([0, 0], 1080);
  assert.deepEqual(center, [0, 0]);
  const ndc = math.toLayout(0.5, 0.5, 16 / 9);
  assert.ok(Math.abs(ndc[0] - 0.5 * (16 / 9)) < 1e-12);
  assert.equal(ndc[1], 0.5);
  // A positive stored Center Y moves the centre down the screen.
  const down = math.offsetToLayout([0, 100], 1080);
  assert.ok(down[1] < 0);
  assert.ok(Math.abs(down[1] + (2 * 100) / 1080) < 1e-12);
});

test("elements sit on the line from the source through the centre", () => {
  const source = [-0.6, 0.3];
  const center = [0, 0];
  const onLine = (p) => {
    // Cross product with the source-to-centre direction is zero on the line.
    const dx = center[0] - source[0];
    const dy = center[1] - source[1];
    return Math.abs((p[0] - source[0]) * dy - (p[1] - source[1]) * dx) < 1e-9;
  };
  assert.deepEqual(math.elementAnchor(source, center, 0, 0), source, "distance 0 is the source");
  const mid = math.elementAnchor(source, center, 0.5, 0);
  assert.ok(Math.abs(mid[0] - -0.3) < 1e-9 && Math.abs(mid[1] - 0.15) < 1e-9, "half way");
  const far = math.elementAnchor(source, center, 1, 0);
  assert.ok(Math.abs(far[0]) < 1e-9 && Math.abs(far[1]) < 1e-9, "distance 1 is the centre");
  for (const distance of [-0.4, 0.2, 0.9, 1.5]) {
    assert.ok(onLine(math.elementAnchor(source, center, distance, 0)), "distance " + distance);
  }
});

test("a source exactly at the centre keeps every element at the source", () => {
  const anchor = math.elementAnchor([0, 0], [0, 0], 0.7, 0.3);
  assert.deepEqual(anchor, [0, 0]);
});

test("screen state is a pure function of its inputs", () => {
  const options = {
    world: [1, 2, -20],
    view: viewMatrix([0.5, 0.2, 3], 12, -4),
    proj: PROJ,
    aspect: 16 / 9,
    margin: 0.25,
    reference: 10,
    falloff: 1,
  };
  const first = JSON.stringify(math.screenState(options));
  math.screenState({ ...options, world: [9, 9, -5] });
  assert.equal(JSON.stringify(math.screenState(options)), first);
});

test("the axis fade is zero when the source and centre coincide and smooth beyond 0.02", () => {
  assert.equal(math.axisFade(0), 0, "coincident source and centre");
  assert.ok(math.axisFade(0.000001) < 1e-6, "effectively coincident");
  assert.equal(math.axisFade(0.02), 1);
  assert.equal(math.axisFade(0.67), 1, "the default layout is fully visible");
  const mid = math.axisFade(0.01);
  assert.ok(mid > 0 && mid < 1, "smooth in between");
  let last = -1;
  for (let i = 0; i <= 40; i += 1) {
    const value = math.axisFade(i * 0.0005);
    assert.ok(value >= last, "monotonic");
    last = value;
  }
});
