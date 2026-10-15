"use strict";

// fx-trans Native FX effects: spec shape, defaults, shader text, and the
// Card Wipe CPU random texture matching the shared math module.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const math = require("../plugins/native-fx/effects/fxtrans-math.js");

const PZ_TYPES = { NUMBER: 0, OPTION: 10, VECTOR2: 5, COLOR: 3, TEXT: 7 };

function makeThree() {
  class Vector2 {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
    }
    copy(v) {
      this.x = v.x;
      this.y = v.y;
    }
  }
  class Vector3 {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
    set(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }
  const api = {
    Vector2,
    Vector3,
    RGBAFormat: 1,
    FloatType: 2,
    NearestFilter: 3,
    lastTexture: null,
    DataTexture: null,
  };
  api.DataTexture = class DataTexture {
    constructor(data, w, h) {
      this.data = data;
      this.width = w;
      this.height = h;
      this.disposed = false;
      api.lastTexture = this;
    }
    dispose() {
      this.disposed = true;
    }
  };
  return api;
}

// Evaluate an effect source file with `this` bound to fakeEffect.
// Returns { spec } for defineFilter effects (the captured spec object).
function loadFilterEffect(file, fakeEffect) {
  let spec = null;
  const sandbox = {
    __effect: fakeEffect,
    PZ: { property: { type: PZ_TYPES } },
    THREE: makeThree(),
    ZoidiumPluginApis: {
      defineFilter(value) {
        spec = value;
      },
      modules: {
        createRequire() {
          return () => math;
        },
      },
    },
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/effects", file), "utf8");
  const wrapped = "(function __fxTransEffect(){\n" + source + "\n}).call(__effect);";
  new vm.Script(wrapped, { filename: file }).runInContext(sandbox);
  return { spec };
}

test("CC Page Turn spec keeps EffectCraft names and defaults", () => {
  const { spec } = loadFilterEffect("ccpageturn.js", {});
  assert.equal(spec.displayName, "CC Page Turn");
  const p = spec.properties;
  assert.equal(p.foldDirection.value, 315);
  assert.equal(p.foldRadius.value, 20);
  assert.equal(p.lightDirection.value, -45);
  assert.equal(p.render.value, 0);
  assert.match(p.render.items, /Front & Back Page/);
  assert.equal(p.backPageOpacity.value, 75);
  assert.equal(JSON.stringify(p.paperColor.value), "[1,1,1]");
  assert.equal(p.backSource.value, 0);
  assert.match(p.backSource.items, /Mirrored Layer/);
});

test("CC Page Turn shader samples through uvScale and shades the curl", () => {
  const shader = fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/shaders/fx_ccpageturn.glsl"), "utf8");
  assert.match(shader, /texture2D\(tDiffuse, luv \* uvScale\)/);
  assert.match(shader, /asin\(clamp\(d \/ r/);
  assert.match(shader, /0\.6 \+ 0\.4 \* cos\(a\)/);
});

test("Card Wipe spec keeps transition names and defaults", () => {
  const { spec } = loadFilterEffect("cardwipe.js", { _zoidiumGetAsset: () => { throw new Error("unused"); } });
  assert.equal(spec.displayName, "Card Wipe");
  const p = spec.properties;
  assert.equal(p.completion.value, 0);
  assert.equal(p.transitionWidth.value, 50);
  assert.equal(p.rows.value, 8);
  assert.equal(p.columns.value, 8);
  assert.equal(p.cardScale.value, 1);
  assert.match(p.flipAxis.items, /Random/);
  assert.match(p.flipDirection.items, /Random/);
  assert.match(p.flipOrder.items, /Gradient/);
  assert.equal(p.randomSeed.value, 1);
  assert.equal(p.backLayer.value, 1, "backs default to transparent like the reference");
  assert.equal(p.cameraDistance.value, 2);
  assert.equal(p.lightIntensity.value, 1);
  assert.equal(p.ambientLight.value, 0.25);
});

test("Card Wipe update() uploads the math-module random texture", () => {
  const three = makeThree();
  let spec = null;
  const sandbox = {
    __effect: { _zoidiumGetAsset: () => { throw new Error("unused"); }, pass: null },
    PZ: { property: { type: PZ_TYPES } },
    THREE: three,
    ZoidiumPluginApis: {
      defineFilter(value) {
        spec = value;
      },
      modules: {
        createRequire() {
          return () => math;
        },
      },
    },
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/effects/cardwipe.js"), "utf8");
  new vm.Script("(function __fxTransEffect(){\n" + source + "\n}).call(__effect);", { filename: "cardwipe.js" }).runInContext(sandbox);
  const values = {
    enabled: 1, completion: 0, transitionWidth: 50, rows: 4, columns: 4,
    cardScale: 1, flipAxis: 0, flipDirection: 0, flipOrder: 0,
    timingRandomness: 0, randomSeed: 1, backLayer: 1, backColor: [0, 0, 0],
    cameraDistance: 2, lightIntensity: 1, ambientLight: 0.25,
  };
  const uniforms = {};
  for (const name of Object.keys(spec.uniforms)) uniforms[name] = { value: undefined };
  uniforms.backColor = { value: { set() {} } };
  const bound = {
    pass: { enabled: true, uniforms, material: { uniforms } },
    properties: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { get: () => v }])),
  };
  spec.update.call(bound, 0);
  assert.equal(uniforms.rows.value, 4);
  assert.equal(uniforms.columns.value, 4);
  assert.equal(uniforms.completion.value, 0);
  assert.equal(uniforms.transitionWidth.value, 0.5);
  // The uploaded texture must equal the math module output (float32 rounding).
  const seed = math.foldSeed(1);
  const data = three.lastTexture.data;
  assert.equal(three.lastTexture.width, 4);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const rnd = math.cardRandoms(j * 4 + i, j, seed);
      const o = (j * 4 + i) * 4;
      assert.ok(Math.abs(data[o] - rnd.axis) < 1e-6, `axis ${i},${j}`);
      assert.ok(Math.abs(data[o + 1] - rnd.dir) < 1e-6, `dir ${i},${j}`);
      assert.ok(Math.abs(data[o + 2] - rnd.jit) < 1e-6, `jit ${i},${j}`);
    }
  }
});

test("Card Wipe shader passes the layer through exactly at 0%", () => {
  const shader = fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/shaders/fx_cardwipe.glsl"), "utf8");
  assert.match(shader, /if \(p <= 0\.0\) \{\s*gl_FragColor = texture2D\(tDiffuse, vUv \* uvScale\);\s*return;\s*\}/);
  assert.match(shader, /texture2D\(tRand, \(id \+ 0\.5\) \/ grid\)/);
});

test("Radial Shadow shader projects, blurs and composites in one pass", () => {
  const shader = fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/shaders/fx_radialshadow.glsl"), "utf8");
  assert.match(shader, /lightSource \+ \(luv - lightSource\) \/ k/);
  assert.match(shader, /sa \* \(1\.0 - sa\) \* 4\.0/);
  assert.match(shader, /for \(int j = -2; j <= 2; j\+\+\)/);
  assert.match(shader, /original \+ shadow \* \(1\.0 - original\.a\)/);
});

test("Radial Shadow and Pixel Polly specs keep parameter names", () => {
  let filterSpec = null;
  const sandbox = {
    PZ: { property: { type: PZ_TYPES } },
    THREE: makeThree(),
    ZoidiumPluginApis: {
      defineFilter(value) {
        filterSpec = value;
      },
      gl: {},
      modules: { createRequire: () => () => math },
    },
  };
  vm.createContext(sandbox);
  const seen = {};
  for (const file of ["radialshadow.js", "ccpixelpolly.js"]) {
    filterSpec = null;
    const effect = {
      _zoidiumGetAsset: () => { throw new Error("unused"); },
      properties: { addAll() {} },
    };
    sandbox.__effect = effect;
    const source = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/effects", file), "utf8");
    new vm.Script("(function __fx(){\n" + source + "\n}).call(__effect);", { filename: file }).runInContext(sandbox);
    seen[file] = { effect, filterSpec };
  }
  const shadow = seen["radialshadow.js"].filterSpec;
  assert.ok(shadow, "radialshadow uses defineFilter");
  assert.equal(shadow.displayName, "Radial Shadow");
  assert.equal(shadow.properties.projectionDistance.value, 10);
  assert.equal(shadow.properties.opacity.value, 50);
  assert.match(shadow.properties.render.items, /Glass Edge/);
  assert.equal(shadow.properties.shadowOnly.value, 0);
  const polly = seen["ccpixelpolly.js"].effect.propertyDefinitions;
  assert.equal(polly.force.value, 100);
  assert.equal(polly.gravity.value, 1);
  assert.equal(polly.gridSpacing.value, 10);
  assert.match(polly.object.items, /Textured Square/);
});

test("native-fx manifest retains the four effects after the temporal compatibility update", () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/manifest.json"), "utf8"));
  assert.ok(Number(manifest.version) >= 15);
  const ids = manifest.nativeEffects.map((e) => e.id);
  for (const id of ["ccpageturn", "cardwipe", "ccpixelpolly", "radialshadow"]) {
    assert.ok(ids.includes(id), `manifest lists ${id}`);
  }
  assert.ok(!manifest.nativeEffects.some((e) => e.id === "ccpageturn" && !e.source.includes(`?v=${manifest.version}`)));
  const resources = manifest.resources.map((r) => r.id);
  for (const id of ["ccpageturn-shader", "cardwipe-shader", "radialshadow-shader", "fxtrans-math"]) {
    assert.ok(resources.includes(id), `manifest resources list ${id}`);
  }
});
