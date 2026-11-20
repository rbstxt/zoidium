"use strict";

// Magic Looks Haze/Flare coverage: zero spillage is an exact passthrough, the
// entry from zero is continuous, the matte box shades the veil rather than
// the scene, and the shader and JS reference stay matched.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const packDir = path.resolve(__dirname, "../plugins/magic-looks");

function readPack(file) {
  return fs.readFileSync(path.join(packDir, file), "utf8");
}

function loadLooks(prefix) {
  const Looks = {};
  for (const file of ["looks-color.js", "looks-tools.js"]) {
    new Function("Looks", readPack(prefix + file))(Looks);
  }
  return Looks;
}

// The davidium files are frozen historical sources (pinned byte for byte in
// magic-looks-instances.test.js), so the fix applies to the current renderer.
const ENGINES = [
  { name: "current", prefix: "", color: "looks-color.js", glsl: "looks-grade.glsl" },
];

function flatImage(w, h, fn) {
  const data = new Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4;
      const c = fn((x + 0.5) / w, (y + 0.5) / h);
      data[k] = c[0] * 255;
      data[k + 1] = c[1] * 255;
      data[k + 2] = c[2] * 255;
      data[k + 3] = 255;
    }
  }
  return data;
}

function maxDrift(out, src) {
  let m = 0;
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(out[i + c] - src[i + c]) / 255);
  }
  return m;
}

function enOnly(Looks, ids) {
  const en = {};
  for (const k of Object.keys(Looks.tools.defaultState().tools)) en[k] = ids.includes(k) ? 1 : 0;
  return en;
}

function pixel(Looks, engine, c, uv, T, en, sample) {
  const g = Looks.grade;
  const luts = g.buildFrameLuts(T);
  const args = [c, uv, T, en, sample || (() => c), [16, 16], luts];
  if (!engine.prefix) args.push(undefined);
  return g.gradePixel(...args);
}

test("Spillage 0 with the tool enabled is an exact passthrough", () => {
  for (const engine of ENGINES) {
    const Looks = loadLooks(engine.prefix);
    const S = Looks.tools.defaultState();
    const src = flatImage(12, 12, (u, v) => [0.2 + u * 0.5, 0.1 + v * 0.4, 0.6]);
    const out = Looks.grade.gradeImage(src, 12, 12, S.tools, enOnly(Looks, ["haze-flare"]));
    assert.equal(maxDrift(out, src), 0, engine.name + " is an exact passthrough");
  }
});

test("Spillage 0 to 0.001 is continuous with no matte box step", () => {
  for (const engine of ENGINES) {
    const Looks = loadLooks(engine.prefix);
    const S = Looks.tools.defaultState();
    const src = flatImage(24, 24, (u, v) => {
      const d = Math.hypot(u - 0.5, v - 0.5);
      const glow = Math.max(0, 1 - d * 4);
      return [0.02 + glow, 0.03 + glow * 0.9, 0.04 + glow * 0.7];
    });
    const en = enOnly(Looks, ["haze-flare"]);
    const off = Looks.grade.gradeImage(src, 24, 24, S.tools, en);
    S.tools["haze-flare"].p.spillage = 0.001;
    const on = Looks.grade.gradeImage(src, 24, 24, S.tools, en);
    assert.ok(maxDrift(on, off) <= 2 / 255, engine.name + " entry drift " + maxDrift(on, off));
    for (let i = 0; i < off.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        assert.ok(on[i + c] <= off[i + c] + 1, engine.name + " no dark box at " + i);
      }
    }
  }
});

test("matte box shades the haze veil, not the scene", () => {
  for (const engine of ENGINES) {
    const Looks = loadLooks(engine.prefix);
    const S = Looks.tools.defaultState();
    const T = S.tools;
    const en = enOnly(Looks, ["haze-flare"]);
    const hz = T["haze-flare"];
    hz.p.spillage = 0.25;

    // A flat mid-gray scene. Shading can only pull the pixel toward the base
    // color, never below it. The old edge multiplier darkened the scene.
    const flat = () => [0.3, 0.3, 0.3];
    hz.p.matteBoxShade = 0;
    const unshaded = pixel(Looks, engine, [0.3, 0.3, 0.3], [0, 0], T, en, flat);
    hz.p.matteBoxShade = 1;
    const shaded = pixel(Looks, engine, [0.3, 0.3, 0.3], [0, 0], T, en, flat);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(unshaded[i] - 0.305) < 1e-9, engine.name + " unshaded veil " + unshaded[i]);
      assert.ok(Math.abs(shaded[i] - 0.30075) < 1e-9, engine.name + " shaded veil " + shaded[i]);
      assert.ok(shaded[i] >= 0.3 - 1e-12, engine.name + " matte box never darkens below the scene");
    }

    // A dark corner beside a bright center: shade reduces the haze at the
    // edge but never pushes the corner below the scene color.
    const bright = (uv) => (uv[0] > 0.35 && uv[0] < 0.65 && uv[1] > 0.35 && uv[1] < 0.65)
      ? [1, 1, 1] : [0, 0, 0];
    hz.p.spillage = 0.6;
    hz.p.matteBoxShade = 0;
    const hazeOnly = pixel(Looks, engine, [0, 0, 0], [0, 0], T, en, bright);
    hz.p.matteBoxShade = 0.75;
    const matted = pixel(Looks, engine, [0, 0, 0], [0, 0], T, en, bright);
    assert.ok(hazeOnly[0] > 0.001, engine.name + " spillage reaches the corner");
    assert.ok(matted[0] < hazeOnly[0] * 0.9, engine.name + " matte box attenuates the corner veil");
    assert.ok(matted[0] >= 0, engine.name + " matte box does not go negative");
  }
});

test("shader and JS reference keep the same haze math", () => {
  for (const engine of ENGINES) {
    const glsl = readPack(engine.glsl);
    const js = readPack(engine.color);
    assert.match(glsl, /float spill = clamp\(u_hazeSpillage, 0\.0, 1\.0\) \* \(1\.0 - hout \* u_hazeMatteBoxShade \* 0\.85\);/,
      engine.name + " shader spillage");
    assert.match(glsl, /vec3 r = mix\(c, hazed, spill\);/);
    assert.doesNotMatch(glsl, /u_hazeSpillage > 0\.0/, engine.name + " shader has no step gate");
    assert.match(js, /var spill = clamp\(hz\.spillage, 0, 1\) \* \(1 - hout \* hz\.matteBoxShade \* 0\.85\);/,
      engine.name + " JS spillage");
    assert.match(js, /gMix\(c, hazed, spill\)/);
    assert.doesNotMatch(js, /hz\.spillage > 0\b/, engine.name + " JS has no step gate");
    const shaderHaze = glsl.includes("fxHaze(")
      ? glsl.slice(glsl.indexOf("fxHaze("), glsl.indexOf("fxHaze(") + 900)
      : glsl.slice(glsl.indexOf("// 15. Haze/Flare."), glsl.indexOf("// 16."));
    const jsHaze = js.includes('FX["haze-flare"]')
      ? js.slice(js.indexOf('FX["haze-flare"]'), js.indexOf('FX["haze-flare"]') + 1200)
      : js.slice(js.indexOf("// 15. Haze/Flare."), js.indexOf("// 16."));
    for (const token of ["MatteBoxSize", "MatteBoxShade", "0.85", "0.08", "0.02"]) {
      assert.ok(shaderHaze.toLowerCase().includes(token.toLowerCase()), engine.name + " shader uses " + token);
      assert.ok(jsHaze.toLowerCase().includes(token.toLowerCase()), engine.name + " JS uses " + token);
    }
  }
});

// ---------- effect update path ----------

function loadEffect() {
  const source = readPack("looks-fx.js");
  const PZ = { asset: { type: { MISC: 5 } }, property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7, ASSET: 8 } } };
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = (a, b) => { this.x = a; this.y = b; }; },
    Vector3: function (x, y, z) {
      this.x = x; this.y = y; this.z = z;
      this.set = (a, b, c) => { this.x = a; this.y = b; this.z = c; };
    },
    ShaderMaterial: function (opts) { this.uniforms = opts.uniforms; this.dispose = () => {}; },
    ShaderPass: function (mat) { this.uniforms = mat.uniforms; this.enabled = true; this.material = mat; },
    DataTexture: function (data, w, h) { this.data = data; this.width = w; this.height = h; },
    RGBFormat: 1,
    LinearFilter: 1,
    ClampToEdgeWrapping: 1,
  };
  const store = {};
  function FakeProp(def) { this.def = def; this.v = def.value; }
  FakeProp.prototype.get = function () { return this.v; };
  FakeProp.prototype.set = function (v) { this.v = v; };
  const fakeThis = {
    _zoidiumGetAsset: (kind, url) => readPack(String(url).split("/").pop().split("?")[0]),
    properties: {
      addAll(defs) {
        for (const k of Object.keys(defs)) {
          if (!(k in store)) {
            store[k] = new FakeProp(defs[k]);
            this[k] = store[k];
          }
        }
      },
      load() {},
      store,
    },
  };
  new Function("PZ", "THREE", source).call(fakeThis, PZ, THREE);
  return { fakeThis, store };
}

test("Spillage edits reuse the compiled pass", async () => {
  const { fakeThis, store } = loadEffect();
  await fakeThis.load({});
  store.hazeSpillage.v = 0.001;
  fakeThis.update(0);
  const material = fakeThis.pass.material;
  assert.equal(fakeThis.pass.enabled, true);
  assert.equal(fakeThis.pass.uniforms.u_chainCount.value, 1, "haze joins the chain");
  for (const value of [0.25, 0.5, 0.9]) {
    store.hazeSpillage.v = value;
    fakeThis.update(0);
    assert.equal(fakeThis.pass.material, material, "value " + value + " does not rebuild the shader");
    assert.equal(fakeThis.pass.uniforms.u_hazeSpillage.value, value);
  }
});
