"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function setup(data = null) {
  const { PZ } = loadSuite(["trapcode-common.js", "designer.js", "form.js"]);
  const root = new PZ.object3d.form();
  root.load(data);
  const form = root.forms[0], base = form.properties.base;
  base.particlesX.set(8);
  base.particlesY.set(7);
  base.particlesZ.set(3);
  return { PZ, root, form, base };
}

function lattice(form, frame = 0) {
  form.update(frame);
  return Array.from(form.basePositions);
}

// The pre-mode samplers, pinned independently of the new axis selection.
function legacyPoint(type, x, y, z, counts, size) {
  if (type === 1) {
    const i = z * counts[0] * counts[1] + y * counts[0] + x;
    const total = counts[0] * counts[1] * counts[2];
    const phi = Math.acos(1 - (2 * (i + 0.5)) / total);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = (size[0] + size[1] + size[2]) / 6;
    return [Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r];
  }
  if (type === 2) {
    const u = counts[0] > 1 ? x / (counts[0] - 1) : 0.5;
    const v = counts[1] > 1 ? y / (counts[1] - 1) : 0.5;
    const w = counts[2] > 1 ? z / (counts[2] - 1) : 0.5;
    const phi = v * Math.PI, theta = u * Math.PI * 2;
    const r = ((size[0] + size[1] + size[2]) / 6) * (0.6 + 0.4 * w);
    return [Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r];
  }
  if (type === 3) {
    const angle = (x / counts[0]) * Math.PI * 2;
    const radius = (size[0] + size[2]) / 4;
    const height = (counts[1] > 1 ? y / (counts[1] - 1) - 0.5 : 0) * size[1];
    return [Math.cos(angle) * radius, height, Math.sin(angle) * radius];
  }
  const angle = (y / counts[1]) * Math.PI * 2;
  const ring = counts[0] > 1 ? x / (counts[0] - 1) : 0;
  const radius = ((size[0] + size[1]) / 4) * ring;
  const depth = (counts[2] > 1 ? z / (counts[2] - 1) - 0.5 : 0) * size[2];
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, depth];
}

function legacyLattice(type, counts, size) {
  const result = [];
  for (let z = 0; z < counts[2]; z++) for (let y = 0; y < counts[1]; y++) {
    for (let x = 0; x < counts[0]; x++) result.push(...legacyPoint(type, x, y, z, counts, size));
  }
  return Array.from(new Float32Array(result));
}

test("Form size mode defaults new instances to per axis and missing saved modes to legacy", () => {
  const fresh = setup();
  assert.equal(fresh.base.baseSizeMode.get(), 0);
  assert.equal(fresh.base.baseSizeMode.definition.dynamic, false);
  assert.equal(setup({ forms: [{}] }).base.baseSizeMode.get(), 1);
  assert.equal(setup({ forms: [{ properties: { base: {} } }] }).base.baseSizeMode.get(), 1);
  for (const mode of [0, 1]) {
    const loaded = setup({ forms: [{ properties: { base: { baseSizeMode: mode } } }] });
    assert.equal(loaded.base.baseSizeMode.get(), mode);
    assert.equal(loaded.form.toJSON().properties.base.baseSizeMode.get(), mode);
  }
  fresh.form.load({ properties: {} });
  assert.equal(fresh.base.baseSizeMode.get(), 1, "reloading old data resets a previously new instance");
  fresh.form.load(null);
  assert.equal(fresh.base.baseSizeMode.get(), 0);
});

test("Form designer uses the same native mode row next to Base Form Size", () => {
  const { PZ, root, form, base } = setup();
  const keys = Object.keys(PZ.object3d.form.instance.baseDefinitions);
  assert.equal(keys[keys.indexOf("baseFormSize") + 1], "baseSizeMode");
  assert.equal(root.constructor.designer.groupFor(form, "base"), base);
  assert.equal(base.baseSizeMode.definition.items, "Per axis;Uniform (legacy)");
});

test("equal-size curved bases match the original floating-point positions exactly in both modes", () => {
  const { form, base } = setup();
  for (const type of [1, 2, 3, 4]) for (const value of [0, 0.1, 50, 123.456789]) {
    base.baseFormType.set(type);
    base.baseFormSize.set([value, value, value]);
    const expected = legacyLattice(type, form.gridCounts(), [value, value, value]);
    for (const mode of [0, 1]) {
      base.baseSizeMode.set(mode);
      assert.deepEqual(lattice(form), expected, "type " + type + ", size " + value + ", mode " + mode);
    }
  }
});

test("saved unequal curved bases retain their exact original positions", () => {
  const { form, base } = setup({ forms: [{ properties: { base: { baseFormSize: [50, 0, 30] } } }] });
  for (const type of [1, 2, 3, 4]) {
    base.baseFormType.set(type);
    assert.deepEqual(lattice(form), legacyLattice(type, form.gridCounts(), [50, 0, 30]));
  }
});

test("per-axis curved bases flatten each zero axis and preserve shell and depth factors", () => {
  const { form, base } = setup();
  for (const type of [1, 2, 3, 4]) {
    base.baseFormType.set(type);
    base.baseFormSize.set([50, 50, 50]);
    const round = lattice(form);
    for (const size of [[50, 0, 50], [0, 50, 30], [20, 40, 0]]) {
      base.baseFormSize.set(size);
      const actual = lattice(form);
      actual.forEach((value, i) => {
        if (size[i % 3] === 0) assert.equal(Math.abs(value), 0);
        assert.ok(Math.abs(value - round[i] * size[i % 3] / 50) < 2e-6,
          "only the corresponding axis scales for type " + type + " at " + i);
      });
    }
  }
});

test("switching size mode rebuilds the cached base without reallocating geometry", () => {
  const { form, base } = setup();
  base.baseFormType.set(2);
  base.baseFormSize.set([50, 0, 50]);
  const flat = lattice(form), signature = form._baseSig, geometry = form.points.geometry;
  base.baseSizeMode.set(1);
  const round = lattice(form);
  assert.notEqual(form._baseSig, signature);
  assert.notDeepEqual(round, flat);
  assert.equal(form.points.geometry, geometry);
  base.baseSizeMode.set(0);
  assert.deepEqual(lattice(form), flat);
  assert.equal(form._baseSig, signature);
});

test("animated base sizes evaluate the mode deterministically on shuffled seeks", () => {
  const { form, base } = setup();
  for (const type of [1, 2, 3, 4]) for (const mode of [0, 1]) {
    base.baseFormType.set(type);
    base.baseSizeMode.set(mode);
    base.baseFormSize.get = (t) => [50, t, 30];
    const expected = lattice(form, 0);
    if (mode === 0) expected.forEach((v, i) => { if (i % 3 === 1) assert.equal(Math.abs(v), 0); });
    else assert.deepEqual(expected, legacyLattice(type, form.gridCounts(), [50, 0, 30]));
    for (const frame of [10, 2, 40, 0]) lattice(form, frame);
    assert.deepEqual(lattice(form, 0), expected);
    base.baseFormSize.get = (t) => [t * 0.1, t * 0.1, t * 0.1];
    assert.deepEqual(lattice(form, 7), legacyLattice(type, form.gridCounts(), [0.7, 0.7, 0.7]));
  }
});

test("box, plane, model and mask samplers keep their existing size behavior in both modes", () => {
  const { form, base } = setup();
  base.baseFormSize.set([50, 0, 30]);
  const vertices = [1, 2, 3, -4, 5, 6];
  const mask = { width: 2, height: 2, data: new Uint8Array(16).fill(255) };
  for (const ready of [() => null, (kind) => kind === "model" ? vertices : mask]) {
    form._assets.ready = ready;
    for (const type of [0, 5, 6, 7]) {
      base.baseFormType.set(type);
      base.baseSizeMode.set(0);
      const axis = lattice(form);
      base.baseSizeMode.set(1);
      assert.deepEqual(lattice(form), axis);
    }
  }
});

test("strings follow the flattened lattice and later Y displacement can add thickness", () => {
  const { form, base } = setup();
  base.baseFormType.set(2);
  base.baseFormSize.set([50, 0, 50]);
  base.stringEnabled.set(1);
  lattice(form);
  assert.deepEqual(Array.from(form.strings.geometry.attributes.position.array), Array.from(form.outPositions));
  form.outPositions.forEach((value, i) => { if (i % 3 === 1) assert.equal(Math.abs(value), 0); });
  form.properties.fractal.displacementMode.set(1);
  form.properties.fractal.yDisplace.set(30);
  lattice(form);
  assert.ok(form.outPositions.some((value, i) => i % 3 === 1 && value !== 0));
  form.basePositions.forEach((value, i) => { if (i % 3 === 1) assert.equal(Math.abs(value), 0); });
});
