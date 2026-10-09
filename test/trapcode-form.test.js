"use strict";

// Coverage for Form: the frame output does not depend on frame history, the
// base lattice rebuilds when its inputs change, the point cap holds, no
// Math.random reaches the render path, and asset-backed bases settle through
// prepare() before a frame is final.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function makeForm() {
  const { PZ } = loadSuite(["trapcode-common.js", "form.js"]);
  const form = new PZ.object3d.form();
  form.load(null);
  return { PZ, form, instance: form.forms[0] };
}

function configure(instance) {
  instance.properties.disperse.disperse.set(20);
  instance.properties.disperse.twist.set(30);
  instance.properties.fractal.displace.set(40);
  instance.properties.fractal.randomSeed.set(3);
}

function positions(instance) {
  return Array.from(instance.points.geometry.attributes.position.array);
}

test("frame output does not depend on the frames rendered before it", () => {
  const direct = makeForm();
  configure(direct.instance);
  direct.instance.update(10);
  const expected = positions(direct.instance);

  const history = makeForm();
  configure(history.instance);
  for (const frame of [0, 5, 30, 2, 10]) history.instance.update(frame);
  assert.deepEqual(positions(history.instance), expected);
});

test("changing the base size rebuilds the lattice instead of reusing stale points", () => {
  const { instance } = makeForm();
  instance.update(0);
  let maxAbs = 0;
  for (const v of positions(instance)) maxAbs = Math.max(maxAbs, Math.abs(v));
  assert.ok(Math.abs(maxAbs - 250) < 1e-3, "default 500 size spans +/-250");

  instance.properties.base.baseFormSize.set([200, 200, 200]);
  instance.update(0);
  maxAbs = 0;
  for (const v of positions(instance)) maxAbs = Math.max(maxAbs, Math.abs(v));
  assert.ok(Math.abs(maxAbs - 100) < 1e-3, "rebuilt lattice spans +/-100, got " + maxAbs);
});

test("the particle grid is capped and reuses the geometry while the count holds", () => {
  const { instance } = makeForm();
  const base = instance.properties.base;
  base.particlesX.set(300);
  base.particlesY.set(300);
  base.particlesZ.set(300);
  const counts = instance.gridCounts();
  assert.ok(counts[0] * counts[1] * counts[2] <= 200000, "point cap");

  base.particlesX.set(70);
  base.particlesY.set(70);
  base.particlesZ.set(3);
  instance.update(0);
  const geometry = instance.points.geometry;
  instance.update(1);
  assert.equal(instance.points.geometry, geometry, "geometry kept between frames");
});

test("no Math.random reaches the render path", () => {
  const { instance } = makeForm();
  configure(instance);
  const original = Math.random;
  Math.random = function () {
    throw new Error("Math.random used in render");
  };
  try {
    instance.update(7);
    instance.update(8);
  } finally {
    Math.random = original;
  }
});

test("an asset-backed base settles through prepare() before the frame is final", async () => {
  const first = makeForm();
  first.instance.properties.base.baseFormType.set(6);
  first.instance.properties.base.modelAsset.set("sha-model-1");
  first.instance.update(0);
  await first.instance.prepare(0);
  const settled = positions(first.instance);

  const second = makeForm();
  second.instance.properties.base.baseFormType.set(6);
  second.instance.properties.base.modelAsset.set("sha-model-1");
  await second.instance.prepare(0);
  second.instance.update(0);
  assert.deepEqual(positions(second.instance), settled);
  for (const v of settled) assert.ok(Number.isFinite(v), "finite positions");
});
