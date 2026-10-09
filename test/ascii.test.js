"use strict";

// Coverage for the ASCII character-cell effect and its SaaS setup window:
// property surface, character-mapping math, effect lifecycle, presets,
// the setup action dispatcher, and style install/removal.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");

function loadEffectThis() {
  const source = fs.readFileSync(path.join(legacyDir, "effects/ascii.js"), "utf8");
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 } },
    tween: {},
  };
  const THREE = {};
  THREE.Pass = function () {};
  THREE.Pass.prototype = {};
  THREE.ShaderMaterial = function (opts) {
    this.uniforms = opts.uniforms;
    this.dispose = () => {};
  };
  THREE.Vector2 = function (x, y) { this.x = x; this.y = y; };
  THREE.Vector3 = function () { this.set = () => {}; };
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

test("ascii effect declares its full property surface", () => {
  const { fakeThis } = loadEffectThis();
  assert.equal(fakeThis.defaultName, "ASCII");
  const defs = fakeThis.propertyDefinitions;
  assert.equal(defs.enabled.items, "off;on");
  assert.deepEqual(defs.enabled.buttons, [
    { name: "Ascii Setup", title: "Open the ASCII setup window", action: "asciiSetup" },
  ]);
  assert.equal(defs.blockSize.min, 4);
  assert.equal(defs.blockSize.max, 64);
  assert.equal(defs.fontFamily.items, "consolas;courier;monospace;inter;serif");
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
  assert.ok(fakeThis.properties.store.blockSize, "definitions instantiated");
  assert.equal(defs.charset.items, "standard;blocks;detailed;minimal;custom");
  assert.equal(defs.colorMode.items, "band colors;footage colors;duotone;mono;invert");
  assert.equal(defs.glitchAmount.min, 0);
  assert.ok(defs.duotoneDark, "duotone dark");
  assert.ok(defs.monoColor, "mono color");
  assert.ok(defs.customChars, "custom characters");
});

test("ascii character mapping math is sane", () => {
  const { fakeThis } = loadEffectThis();
  const map = fakeThis.asciiMap;
  assert.ok(map);
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
  assert.equal(map.pickGlyph(0.9, base, 3, 5, 0, "@"), "@", "standard uses band fill");
  assert.equal(map.pickGlyph(0.9, Object.assign({}, base, { charset: 1 }), 0, 0, 0, "@"), "\u2588", "blocks ramps bright");
  assert.equal(map.pickGlyph(0.05, Object.assign({}, base, { charset: 1 }), 0, 0, 0, "@"), " ", "blocks ramps dark");
  assert.equal(map.pickGlyph(0.9, Object.assign({}, base, { charset: 2 }), 0, 0, 0, "@"), "@", "detailed ramps bright");
  assert.equal(map.pickGlyph(0.05, Object.assign({}, base, { charset: 2 }), 0, 0, 0, "@"), " ", "detailed ramps dark");
  assert.equal(map.pickGlyph(0.9, Object.assign({}, base, { charset: 3 }), 0, 0, 0, "@"), "@", "minimal bright");
  assert.equal(map.pickGlyph(0.1, Object.assign({}, base, { charset: 3 }), 0, 0, 0, "@"), " ", "minimal dark");
  assert.equal(map.pickGlyph(0.9, Object.assign({}, base, { charset: 4, customChars: "ABC" }), 0, 0, 0, "@"), "C", "custom ramp");
  assert.equal(map.pickGlyph(0.9, Object.assign({}, base, { charset: 4, customChars: "" }), 0, 0, 0, "@"), "@", "empty custom falls back");
  const g1 = map.pickGlyph(0.5, Object.assign({}, base, { randomCharacters: true }), 3, 5, 9, "@");
  assert.equal(map.pickGlyph(0.5, Object.assign({}, base, { randomCharacters: true }), 3, 5, 9, "@"), g1, "random stable per seed");
  assert.deepEqual(map.pickColor(0.5, [0.2, 0.4, 0.6], base, [1, 1, 1]), [1, 1, 1], "band colors");
  assert.deepEqual(map.pickColor(0.5, [0.2, 0.4, 0.6], Object.assign({}, base, { colorMode: 1 }), [1, 1, 1]), [0.2, 0.4, 0.6], "footage colors");
  assert.deepEqual(
    map.pickColor(0.5, [0, 0, 0], Object.assign({}, base, { colorMode: 2, duotoneDark: [0, 0, 0], duotoneLight: [1, 1, 1] }), [1, 1, 1]),
    [0.5, 0.5, 0.5],
    "duotone midpoint"
  );
  assert.deepEqual(
    map.pickColor(0.5, [0, 0, 0], Object.assign({}, base, { colorMode: 3, monoColor: [1, 0, 0] }), [1, 1, 1]),
    [1, 0, 0],
    "mono color"
  );
});

test("ascii effect loads, collects state, and toggles", () => {
  const { fakeThis } = loadEffectThis();
  const num = (v) => ({ get: () => v });
  const inst = {
    type: "ascii",
    properties: Object.assign(fakeProps(), {
      enabled: num(1),
      blockSize: num(23),
    }),
  };
  fakeThis.load.call(inst, {});
  assert.ok(inst.pass, "pass created on load");
  assert.equal(inst.pass.needsSwap, true, "chain-safe swap");
  assert.equal(typeof inst.pass.render, "function");
  assert.equal(typeof inst.pass.gridFor(320, 180, 23).cols, "number");
  assert.deepEqual(
    [inst.pass.gridFor(320, 180, 23).cols, inst.pass.gridFor(320, 180, 23).rows],
    [13, 7]
  );
  assert.equal(typeof fakeThis.toJSON, "function");
  assert.equal(fakeThis.toJSON.call(inst).type, "ascii");
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, true);
  assert.ok(inst.pass.asciiState, "overlay state collected");
  assert.equal(inst.pass.asciiState.blockSize, 23);
  inst.properties.enabled = num(0);
  fakeThis.update.call(inst, 0);
  assert.equal(inst.pass.enabled, false, "effect toggle disables the pass");
  assert.doesNotThrow(() => fakeThis.unload.call(inst, {}), "unload tolerates stubs");
});

// --- Setup window module ---

function fakeElement(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [],
    dataset: {},
    style: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) {
        if (f === undefined) f = !this._s.has(c);
        if (f) this._s.add(c);
        else this._s.delete(c);
      },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) {
      const at = el.children.indexOf(c);
      if (at >= 0) el.children.splice(at, 1);
      return c;
    },
    remove() {},
    setAttribute(k, v) { el[k] = v; },
    getAttribute(k) { return el[k] || null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._text || ""; },
    set(v) { el._text = String(v); },
    configurable: true,
  });
  Object.defineProperty(el, "innerHTML", {
    get() { return ""; },
    set(v) {},
    configurable: true,
  });
  return el;
}

function loadSetupModule() {
  const full = path.join(legacyDir, "ascii-setup.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

function stubDocument() {
  const doc = {
    head: { appendChild(c) { return c; } },
    body: { appendChild(c) { return c; } },
    createElement: (tag) => fakeElement(tag),
    getElementById: () => null,
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return doc;
}

function stubEditor() {
  return {
    playback: { currentFrame: 7, speed: 0 },
    project: { traverse() {} },
    timelineSelection: [],
    history: { startOperation() {}, finishOperation() {} },
  };
}

test("ascii setup activates, routes, and deactivates", () => {
  const g = globalThis;
  const keep = { document: g.document, PZ: g.PZ, CM: g.CM };
  g.document = stubDocument();
  const CM = stubEditor();
  g.CM = CM;
  const PZ = { ui: { controls: {} } };
  g.PZ = PZ;
  try {
    const mod = loadSetupModule();
    const context = {
      PZ,
      editor: CM,
      getAsset: () => "/*css*/",
    };
    mod.activate(context);
    assert.equal(typeof CM.openAsciiSetup, "function");
    assert.ok(CM.asciiPresets.redmatrix, "presets installed");
    assert.equal(Object.keys(CM.asciiPresets).length, 5);
    assert.ok(CM.asciiPresets.glitch, "glitch storm preset");
    assert.equal(typeof PZ.ui.controls.runPropertyAction, "function");
    assert.doesNotThrow(() => {
      PZ.ui.controls.runPropertyAction({}, { parentObject: "EFFECT" }, "nope", null);
    });
    mod.activate(context);
    mod.deactivate();
    assert.equal(CM.asciiWindow, undefined, "no window was opened");
  } finally {
    if (keep.document === undefined) delete g.document;
    else g.document = keep.document;
    if (keep.PZ === undefined) delete g.PZ;
    else g.PZ = keep.PZ;
    if (keep.CM === undefined) delete g.CM;
    else g.CM = keep.CM;
  }
});

test("ascii setup action opens the editor window entry", () => {
  const g = globalThis;
  const keep = { document: g.document, PZ: g.PZ, CM: g.CM };
  g.document = stubDocument();
  const CM = stubEditor();
  g.CM = CM;
  const opened = [];
  const PZ = { ui: { controls: {} } };
  g.PZ = PZ;
  try {
    const mod = loadSetupModule();
    mod.activate({
      PZ,
      editor: CM,
      getAsset: () => "/*css*/",
    });
    CM.openAsciiSetup = function (effect) { opened.push(effect || null); };
    PZ.ui.controls.runPropertyAction({}, { parentObject: "EFFECT" }, "asciiSetup", null);
    assert.deepEqual(opened, ["EFFECT"]);
    mod.deactivate();
  } finally {
    if (keep.document === undefined) delete g.document;
    else g.document = keep.document;
    if (keep.PZ === undefined) delete g.PZ;
    else g.PZ = keep.PZ;
    if (keep.CM === undefined) delete g.CM;
    else g.CM = keep.CM;
  }
});
