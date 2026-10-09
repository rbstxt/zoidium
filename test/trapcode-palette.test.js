"use strict";

// Coverage for the Rowbyte & Red Giant Suite color palettes: the shared
// registry in trapcode-common.js is well-formed, targets are detected,
// and applying a scheme writes gradients and flat colors.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function loadCommon() {
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins/trapcode-suite/trapcode-common.js"),
    "utf8"
  );
  const PZ = {};
  const THREE = {};
  new Function("PZ", "THREE", source)(PZ, THREE);
  return PZ.trapcode;
}

function fakeSetProp() {
  return {
    got: undefined,
    frames: [],
    set(value, frame) {
      this.got = value;
      this.frames.push(frame);
    },
  };
}

function fakeParticular() {
  const calls = { updatePalettes: 0 };
  const target = {
    properties: {
      particle: {
        colorGradient: fakeSetProp(),
        color: fakeSetProp(),
      },
    },
    updatePalettes() {
      calls.updatePalettes++;
    },
  };
  return { target, calls };
}

function fakeForm() {
  const calls = { updatePalettes: 0 };
  const target = {
    properties: {
      particle: {
        colorOver: fakeSetProp(),
        color: fakeSetProp(),
      },
    },
    updatePalettes() {
      calls.updatePalettes++;
    },
  };
  return { target, calls };
}

function fakePlexusEffector() {
  const target = {
    properties: {
      effector: { color: fakeSetProp(), color2: fakeSetProp() },
    },
  };
  return { target };
}

function fakePlexusRenderer() {
  const target = {
    properties: {
      renderer: { color: fakeSetProp() },
    },
  };
  return { target };
}

test("palette registry is well-formed", () => {
  const T = loadCommon();
  assert.ok(Array.isArray(T.palettes));
  assert.ok(T.palettes.length >= 8, "several schemes, got " + T.palettes.length);
  const names = new Set();
  for (const scheme of T.palettes) {
    assert.equal(typeof scheme.name, "string");
    assert.ok(scheme.name.length > 0);
    assert.ok(!names.has(scheme.name), "duplicate scheme " + scheme.name);
    names.add(scheme.name);
    assert.ok(Array.isArray(scheme.stops) && scheme.stops.length >= 2);
    let prev = -1;
    for (const stop of scheme.stops) {
      assert.equal(typeof stop.position, "number");
      assert.ok(stop.position >= prev, "stops ascend");
      prev = stop.position;
      const c = T.parseColor(stop.color);
      assert.equal(c.length, 4);
      for (const v of c) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
    }
    assert.equal(scheme.stops[0].position, 0);
    assert.equal(scheme.stops[scheme.stops.length - 1].position, 1);
    assert.ok(Array.isArray(scheme.colors) && scheme.colors.length >= 2);
    for (const col of scheme.colors) {
      assert.equal(col.length, 3);
      for (const v of col) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
    }
  }
});

test("supportsPalette detects the three families", () => {
  const T = loadCommon();
  assert.equal(T.supportsPalette(fakeParticular().target), true);
  assert.equal(T.supportsPalette(fakeForm().target), true);
  assert.equal(T.supportsPalette(fakePlexusEffector().target), true);
  assert.equal(T.supportsPalette(fakePlexusRenderer().target), true);
  assert.equal(T.supportsPalette({ properties: {} }), false);
  assert.equal(T.supportsPalette({}), false);
  assert.equal(T.supportsPalette(null), false);
});

test("applyPalette writes Particular gradients and base color", () => {
  const T = loadCommon();
  const scheme = T.palettes[0];
  const { target, calls } = fakeParticular();
  assert.equal(T.applyPalette(target, scheme), true);
  assert.deepEqual(target.properties.particle.colorGradient.got, scheme.stops);
  assert.deepEqual(target.properties.particle.color.got, scheme.colors[0]);
  assert.equal(calls.updatePalettes, 1);
});

test("applyPalette writes Form gradients and base color", () => {
  const T = loadCommon();
  const scheme = T.palettes[1];
  const { target, calls } = fakeForm();
  assert.equal(T.applyPalette(target, scheme), true);
  assert.deepEqual(target.properties.particle.colorOver.got, scheme.stops);
  assert.deepEqual(target.properties.particle.color.got, scheme.colors[0]);
  assert.equal(calls.updatePalettes, 1);
});

test("applyPalette writes Plexus effector and renderer colors", () => {
  const T = loadCommon();
  const scheme = T.palettes[2];
  const eff = fakePlexusEffector();
  assert.equal(T.applyPalette(eff.target, scheme), true);
  assert.deepEqual(eff.target.properties.effector.color.got, scheme.colors[0]);
  assert.deepEqual(eff.target.properties.effector.color2.got, scheme.colors[1]);
  const ren = fakePlexusRenderer();
  assert.equal(T.applyPalette(ren.target, scheme), true);
  assert.deepEqual(ren.target.properties.renderer.color.got, scheme.colors[0]);
});

test("applyPalette refuses junk without throwing", () => {
  const T = loadCommon();
  const scheme = T.palettes[0];
  assert.equal(T.applyPalette(null, scheme), false);
  assert.equal(T.applyPalette({}, scheme), false);
  assert.equal(T.applyPalette(fakeParticular().target, null), false);
  // An empty scheme still applies the default white base color.
  assert.equal(T.applyPalette(fakeParticular().target, {}), true);
});

test("paletteCSS previews the gradient", () => {
  const T = loadCommon();
  const css = T.paletteCSS(T.palettes[0]);
  assert.ok(css.indexOf("linear-gradient(90deg,") === 0);
  for (const stop of T.palettes[0].stops) {
    assert.ok(css.indexOf(stop.color) >= 0, "stop color in preview");
  }
  assert.equal(T.paletteCSS(null), "linear-gradient(90deg,#fff,#fff)");
});
