"use strict";

// Coverage for the ASCII character-cell effect: property surface, glyph and
// color mapping math, lifecycle, and deterministic rendering. The setup
// window is covered by openzoid-legacy-windows.test.js.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");
const source = fs.readFileSync(path.join(legacyDir, "effects/ascii.js"), "utf8");

const PZ_TYPES = { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 };

function fakeProps() {
  const store = {};
  return {
    addAll(defs) {
      for (const k of Object.keys(defs)) {
        if (!(k in store)) store[k] = { def: defs[k] };
      }
    },
    load() {},
    store,
  };
}

function loadEffectThis() {
  const PZ = { property: { type: PZ_TYPES }, tween: {} };
  const THREE = {};
  THREE.Pass = function () {};
  THREE.Pass.prototype = {};
  THREE.ShaderMaterial = function (opts) {
    this.uniforms = opts.uniforms;
    this.dispose = () => {};
  };
  THREE.Vector2 = function (x, y) { this.x = x; this.y = y; };
  THREE.Scene = function () { this.add = () => {}; };
  THREE.OrthographicCamera = function () {};
  THREE.Mesh = function (geo, mat) { this.geometry = geo; this.material = mat; };
  THREE.PlaneBufferGeometry = function () { this.dispose = () => {}; };
  THREE.CanvasTexture = function () { this.dispose = () => {}; };
  THREE.WebGLRenderTarget = function () { this.dispose = () => {}; };
  const fakeThis = { properties: fakeProps() };
  new Function("PZ", "THREE", source).call(fakeThis, PZ, THREE);
  return { fakeThis, PZ, THREE };
}

// Property stubs whose value is the definition default, with overrides.
function constantProps(defs, overrides) {
  const props = { load() {} };
  for (const key of Object.keys(defs)) {
    const def = defs[key];
    let value = def.value;
    if (def.group) value = def.objects.map((o) => o.value);
    if (overrides && key in overrides) value = overrides[key];
    props[key] = { get: () => value };
  }
  return props;
}

// Recording 2D context and renderer, enough for the overlay pass.
function recordingEnvironment(footageAt) {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => { calls.push([prop, ...args.map(String)].join("|")); };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push("set " + String(prop) + "=" + String(value));
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const g = globalThis;
  const keep = { document: g.document };
  g.document = { createElement: () => canvas, fonts: undefined };
  const renderer = {
    autoClear: true,
    render() {},
    readRenderTargetPixels(target, x, y, w, h, pixels) {
      const frame = footageAt();
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = (i * 37 + frame * 11) & 255;
      }
    },
  };
  const readBuffer = { width: 160, height: 90, texture: {} };
  return {
    calls,
    renderer,
    readBuffer,
    restore() {
      if (keep.document === undefined) delete g.document;
      else g.document = keep.document;
    },
  };
}

test("ascii effect declares its full property surface", () => {
  const { fakeThis } = loadEffectThis();
  assert.equal(fakeThis.defaultName, "ASCII");
  const defs = fakeThis.propertyDefinitions;
  assert.equal(defs.enabled.items, "off;on");
  assert.deepEqual(defs.enabled.buttons, [
    { name: "ASCII Setup", title: "Open the ASCII setup window", action: "asciiSetup" },
  ]);
  assert.equal(defs.blockSize.min, 4);
  assert.equal(defs.blockSize.max, 64);
  assert.equal(defs.charSize.min, 8);
  for (const band of ["black", "white", "grey", "alpha"]) {
    assert.ok(defs[band + "Fill"], band + " fill");
    assert.ok(defs[band + "Stroke"], band + " stroke");
    assert.ok(defs[band + "Color"], band + " color");
    assert.ok(defs[band + "Opacity"], band + " opacity");
  }
  assert.equal(defs.noiseType.items, "perlin;simplex;fractal;turbulence");
  assert.equal(defs.scrollWaves.min, 1);
  assert.equal(defs.scrollWaves.max, 6);
  assert.equal(defs.charset.items, "standard;blocks;detailed;minimal;custom");
  assert.equal(defs.colorMode.items, "band colors;footage colors;duotone;mono;invert");
  assert.equal(defs.glitchAmount.min, 0);
  assert.ok(fakeThis.properties.store.blockSize, "definitions instantiated");
});

test("ascii fonts are limited to Source Code Pro and generic monospace", () => {
  const { fakeThis } = loadEffectThis();
  const defs = fakeThis.propertyDefinitions;
  assert.equal(defs.fontFamily.items, "source code pro;monospace");
  assert.equal(defs.fontFamily.value, 0);
  assert.ok(!source.includes("Inter"), "no Inter font");
  assert.ok(!source.includes("Georgia"), "no system serif fallback");
});

test("ascii character mapping math is sane", () => {
  const { fakeThis } = loadEffectThis();
  const map = fakeThis.asciiMap;
  assert.equal(map.luminanceBand(0.0), 3, "near-black is alpha");
  assert.equal(map.luminanceBand(0.1), 0);
  assert.equal(map.luminanceBand(0.5), 1);
  assert.equal(map.luminanceBand(0.9), 2);
  const h1 = map.hash(3, 5, 9);
  assert.ok(h1 >= 0 && h1 < 1);
  assert.equal(map.hash(3, 5, 9), h1, "deterministic");
  assert.notEqual(map.hash(4, 5, 9), h1, "varies by cell");
  const n = map.valueNoise(1.5, 2.5, 0);
  assert.ok(n >= 0 && n <= 1);
  const f = map.fbm(1.5, 2.5, 3, 0.9, 0, false);
  assert.ok(f >= 0 && f <= 1);
  const t = map.fbm(1.5, 2.5, 3, 0.9, 0, true);
  assert.ok(t >= 0 && t <= 1, "turbulent variant bounded");
});

test("ascii glyph and color modes select per cell", () => {
  const { fakeThis } = loadEffectThis();
  const map = fakeThis.asciiMap;
  const base = {
    randomCharacters: false, charset: 0, customChars: "@%#*+=-:. ",
    colorMode: 0, duotoneDark: [0, 0, 0], duotoneLight: [1, 1, 1], monoColor: [1, 1, 1],
  };
  const with_ = (extra) => Object.assign({}, base, extra);
  assert.equal(map.pickGlyph(0.9, base, 3, 5, 0, "@"), "@", "standard uses band fill");
  assert.equal(map.pickGlyph(0.9, with_({ charset: 1 }), 0, 0, 0, "@"), "█", "blocks ramps bright");
  assert.equal(map.pickGlyph(0.05, with_({ charset: 1 }), 0, 0, 0, "@"), " ", "blocks ramps dark");
  assert.equal(map.pickGlyph(0.9, with_({ charset: 2 }), 0, 0, 0, "@"), "@", "detailed ramps bright");
  assert.equal(map.pickGlyph(0.05, with_({ charset: 2 }), 0, 0, 0, "@"), " ", "detailed ramps dark");
  assert.equal(map.pickGlyph(0.9, with_({ charset: 3 }), 0, 0, 0, "@"), "@", "minimal bright");
  assert.equal(map.pickGlyph(0.1, with_({ charset: 3 }), 0, 0, 0, "@"), " ", "minimal dark");
  assert.equal(map.pickGlyph(0.9, with_({ charset: 4, customChars: "ABC" }), 0, 0, 0, "@"), "C", "custom ramp");
  assert.equal(map.pickGlyph(0.9, with_({ charset: 4, customChars: "" }), 0, 0, 0, "@"), "@", "empty custom falls back");
  const random = with_({ randomCharacters: true });
  const g1 = map.pickGlyph(0.5, random, 3, 5, 9, "@");
  assert.equal(map.pickGlyph(0.5, random, 3, 5, 9, "@"), g1, "random stable per seed");
  assert.deepEqual(map.pickColor(0.5, [0.2, 0.4, 0.6], base, [1, 1, 1]), [1, 1, 1], "band colors");
  assert.deepEqual(map.pickColor(0.5, [0.2, 0.4, 0.6], with_({ colorMode: 1 }), [1, 1, 1]), [0.2, 0.4, 0.6], "footage colors");
  assert.deepEqual(
    map.pickColor(0.5, [0, 0, 0], with_({ colorMode: 2, duotoneDark: [0, 0, 0], duotoneLight: [1, 1, 1] }), [1, 1, 1]),
    [0.5, 0.5, 0.5],
    "duotone midpoint"
  );
  assert.deepEqual(
    map.pickColor(0.5, [0, 0, 0], with_({ colorMode: 3, monoColor: [1, 0, 0] }), [1, 1, 1]),
    [1, 0, 0],
    "mono color"
  );
});

test("ascii source has no nondeterministic inputs", () => {
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(source));
  assert.ok(!/requestAnimationFrame/.test(source));
});

test("ascii effect loads, collects state, and toggles", async () => {
  const { fakeThis } = loadEffectThis();
  const inst = {
    type: "ascii",
    properties: constantProps(fakeThis.propertyDefinitions, { blockSize: 23 }),
  };
  await fakeThis.load.call(inst, {});
  assert.ok(inst.pass, "pass created on load");
  assert.equal(inst.pass.needsSwap, true, "chain-safe swap");
  assert.equal(typeof inst.pass.render, "function");
  assert.deepEqual(
    [inst.pass.gridFor(320, 180, 23).cols, inst.pass.gridFor(320, 180, 23).rows],
    [13, 7]
  );
  assert.equal(fakeThis.toJSON.call(inst).type, "ascii");
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, true);
  assert.ok(inst.pass.asciiState, "state collected");
  assert.equal(inst.pass.asciiState.blockSize, 23);
  inst.properties.enabled = { get: () => 0 };
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, false, "effect toggle disables the pass");
  assert.doesNotThrow(() => fakeThis.unload.call(inst, {}), "unload tolerates stubs");
  assert.equal(inst.pass, null);
});

test("ascii overlay depends only on the current frame and input", async () => {
  const { fakeThis } = loadEffectThis();
  let frame = 0;
  const env = recordingEnvironment(() => frame);
  try {
    const inst = {
      type: "ascii",
      properties: constantProps(fakeThis.propertyDefinitions, {
        randomCharacters: 1, noiseEnable: 1, scrollEnable: 1, sineEnable: 1,
      }),
    };
    await fakeThis.load.call(inst, {});
    const draw = (t) => {
      frame = t;
      env.calls.length = 0;
      fakeThis.update.call(inst, t);
      inst.pass.render(env.renderer, env.readBuffer, env.readBuffer);
      return env.calls.slice();
    };
    const first = draw(12);
    draw(40);
    draw(3);
    assert.deepEqual(draw(12), first, "same frame draws the same overlay after other frames");
    assert.ok(first.length > 0, "overlay drawn");
  } finally {
    env.restore();
  }
});

function near(a, b) {
  return Math.abs(a - b) < 1e-9;
}

// Draws one frame of an ASCII pass with the given property overrides and
// returns the glyphs and positions it wrote, in draw order.
async function drawGlyphs(fakeThis, env, overrides, frame, uvScale) {
  const inst = {
    type: "ascii",
    properties: constantProps(fakeThis.propertyDefinitions, overrides),
  };
  await fakeThis.load.call(inst, {});
  if (uvScale) {
    inst.pass.uniforms.uvScale.value.x = uvScale[0];
    inst.pass.uniforms.uvScale.value.y = uvScale[1];
  }
  env.calls.length = 0;
  fakeThis.update.call(inst, frame);
  inst.pass.render(env.renderer, env.readBuffer, env.readBuffer);
  const fills = env.calls.filter((c) => c.startsWith("fillText|")).map((c) => c.split("|").slice(1));
  return { pass: inst.pass, fills };
}

test("ascii noise changes the glyphs in every color mode", async () => {
  const { fakeThis } = loadEffectThis();
  // Constant footage, so only the noise seed (time and cell) varies.
  const env = recordingEnvironment(() => 0);
  try {
    for (const colorMode of [0, 1, 3]) {
      const clean = await drawGlyphs(fakeThis, env, { colorMode, noiseIntensity: 0 }, 12);
      const noisy = await drawGlyphs(fakeThis, env, { colorMode, noiseIntensity: 0.8 }, 12);
      assert.ok(clean.fills.length > 0, "clean overlay drawn for mode " + colorMode);
      assert.notDeepEqual(
        noisy.fills.map((f) => f[0]),
        clean.fills.map((f) => f[0]),
        "noise changes the glyph choice in color mode " + colorMode
      );
      const again = await drawGlyphs(fakeThis, env, { colorMode, noiseIntensity: 0.8 }, 12);
      assert.deepEqual(again.fills, noisy.fills, "noise is deterministic for a frame");
    }
    // The noise seed steps four times a second, so frames 12 and 13 share a
    // step while frame 42 (1.4 s) does not.
    const sameStep = await drawGlyphs(fakeThis, env, { noiseIntensity: 0.8 }, 13);
    const laterStep = await drawGlyphs(fakeThis, env, { noiseIntensity: 0.8 }, 42);
    const base = await drawGlyphs(fakeThis, env, { noiseIntensity: 0.8 }, 12);
    assert.deepEqual(sameStep.fills, base.fills, "noise holds within a step");
    assert.notDeepEqual(laterStep.fills, base.fills, "noise shimmers over time");
  } finally {
    env.restore();
  }
});

test("ascii grid is centred in the layer region of a shared buffer", async () => {
  const { fakeThis } = loadEffectThis();
  const env = recordingEnvironment(() => 0);
  try {
    // Layer covers the bottom-left half of a 160 x 90 buffer: 80 x 45 px.
    const half = await drawGlyphs(fakeThis, env, { blockSize: 23, colorMode: 3 }, 0, [0.5, 0.5]);
    assert.deepEqual(half.pass.layerRegion(160, 90), { width: 80, height: 45 });
    assert.ok(half.fills.length > 0, "overlay drawn");
    // Grid: 3 x 1 cells of 23 px, margins (80 - 69) / 2 and (45 - 23) / 2.
    const xs = new Set(half.fills.map((f) => Number(f[1])));
    const ys = new Set(half.fills.map((f) => Number(f[2])));
    for (const x of xs) assert.ok([17, 40, 63].some((cx) => near(cx, x)), "x on grid " + x);
    for (const y of ys) assert.ok(near(y, 67.5), "y in the layer's top row " + y);
    const u = half.pass.copyMaterial.uniforms;
    assert.ok(near(u.sampleOffset.value.x, 5.5 / 160), "sample offset x");
    assert.ok(near(u.sampleOffset.value.y, 11 / 90), "sample offset y");
    assert.ok(near(u.sampleScale.value.x, 69 / 160), "sample scale x");
    assert.ok(near(u.sampleScale.value.y, 23 / 90), "sample scale y");
    // Whole-buffer layer: 6 x 3 cells centred on the frame, top row included.
    const full = await drawGlyphs(fakeThis, env, { blockSize: 23, colorMode: 3 }, 0);
    assert.deepEqual(full.pass.layerRegion(160, 90), { width: 160, height: 90 });
    const fullYs = new Set(full.fills.map((f) => Number(f[2])));
    for (const y of fullYs) assert.ok([22, 45, 68].some((cy) => near(cy, y)), "full-frame y " + y);
    const fullXs = new Set(full.fills.map((f) => Number(f[1])));
    for (const x of fullXs) assert.ok([22.5, 45.5, 68.5, 91.5, 114.5, 137.5].some((cx) => near(cx, x)), "full-frame x " + x);
  } finally {
    env.restore();
  }
});

test("ascii layer region falls back to the whole buffer for invalid shares", () => {
  const { fakeThis } = loadEffectThis();
  const inst = { type: "ascii", properties: constantProps(fakeThis.propertyDefinitions, {}) };
  return fakeThis.load.call(inst, {}).then(() => {
    const pass = inst.pass;
    for (const value of [0, -1, 2, NaN, undefined]) {
      pass.uniforms.uvScale.value.x = value;
      pass.uniforms.uvScale.value.y = value;
      assert.deepEqual(pass.layerRegion(160, 90), { width: 160, height: 90 }, "share " + value);
    }
    pass.uniforms.uvScale.value.x = 0.25;
    pass.uniforms.uvScale.value.y = 1;
    assert.deepEqual(pass.layerRegion(160, 90), { width: 40, height: 90 });
  });
});
