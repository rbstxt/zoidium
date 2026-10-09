"use strict";

// Coverage for the Magic Looks grading effect: the JS reference pipeline
// (identity defaults, chain order, gating), the generated effect property
// surface, the update/uniform sync path (dirty gating, chain and LUT upload
// caching), and shader/catalog agreement.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packDir = path.join(projectRoot, "plugins/magic-looks");

function readPack(file) {
  return fs.readFileSync(path.join(packDir, file), "utf8");
}

function loadLooks() {
  const Looks = {};
  for (const file of ["looks-color.js", "looks-tools.js"]) {
    new Function("Looks", readPack(file))(Looks);
  }
  return Looks;
}

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
    for (let c = 0; c < 3; c++) {
      m = Math.max(m, Math.abs(out[i + c] - src[i + c]) / 255);
    }
  }
  return m;
}

function enOnly(ids) {
  const Looks = loadLooks();
  const en = {};
  for (const k of Object.keys(Looks.tools.defaultState().tools)) en[k] = ids.includes(k) ? 1 : 0;
  return en;
}

function px(Looks, c, T, en, uv, order) {
  const g = Looks.grade;
  const luts = g.buildFrameLuts(T);
  return g.gradePixel(c, uv || [0.5, 0.5], T, en, () => c, [16, 16], luts, order);
}

test("default chain is an exact identity on the source", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const src = flatImage(16, 16, (u, v) => [u, v, 0.5]);
  const out = Looks.grade.gradeImage(src, 16, 16, S.tools, S.on);
  assert.ok(maxDrift(out, src) < 1e-3, "defaults pass the image through");
});

test("every tool is neutral at defaults when enabled on its own", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const src = flatImage(12, 12, (u, v) => [0.2 + u * 0.6, 0.2 + v * 0.6, 0.5]);
  for (const id of Object.keys(S.tools)) {
    if (id === "color-contrast") continue; // its fixed amount is the tool character when on
    const out = Looks.grade.gradeImage(src, 12, 12, S.tools, enOnly([id]));
    assert.ok(maxDrift(out, src) < 1e-6, id + " is neutral at defaults");
  }
});

test("contrast pivots, exposure doubles, lift raises blacks", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools.contrast.p.contrast = 1;
  S.tools.contrast.p.pivot = 0.5;
  assert.deepEqual(px(Looks, [0.5, 0.5, 0.5], S.tools, enOnly(["contrast"])).map((v) => Math.round(v * 1e6)), [500000, 500000, 500000]);
  S.tools.contrast.p.contrast = 0;
  S.tools["lift-gamma-gain"].p.exposure = 0;
  const dbl = px(Looks, [0.25, 0.5, 0.75], S.tools, enOnly(["lift-gamma-gain"]));
  S.tools["lift-gamma-gain"].p.exposure = 1;
  const dbl2 = px(Looks, [0.25, 0.5, 0.75], S.tools, enOnly(["lift-gamma-gain"]));
  assert.ok(Math.abs(dbl2[0] - dbl[0] * 2) < 1e-9, "exposure +1 doubles");
  S.tools["lift-gamma-gain"].p.exposure = 0;
  S.tools["lift-gamma-gain"].w.lift.rgb = [1.1, 1.1, 1.1];
  const lifted = px(Looks, [0, 0, 0], S.tools, enOnly(["lift-gamma-gain"]));
  assert.ok(lifted[0] > 0.09 && lifted[0] < 0.11, "lift adds to blacks");
});

test("vignette darkens corners, curves shape reds, LUT Hot warms", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const g = Looks.grade;
  const src = flatImage(24, 24, () => [0.6, 0.6, 0.6]);
  S.tools.vignette.p.strength = 1;
  S.tools.vignette.w.color.rgb = [0, 0, 0];
  const out = g.gradeImage(src, 24, 24, S.tools, enOnly(["vignette"]));
  assert.ok(out[0] < out[(12 * 24 + 12) * 4] * 0.7, "corner darker than center");
  S.tools.vignette.p.strength = 0;
  S.tools.curves.x.curves.channels.Red.push({ x: 0.5, y: 0.8 });
  const curved = px(Looks, [0.5, 0.5, 0.5], S.tools, enOnly(["curves"]));
  assert.ok(curved[0] > 0.75 && Math.abs(curved[1] - 0.5) < 0.01, "red curve lifts reds only");
  S.tools.curves.x.curves.channels.Red.pop();
  const plain = px(Looks, [0.5, 0.5, 0.5], S.tools, enOnly(["lut"]));
  assert.deepEqual(plain.map((v) => Math.round(v * 1e6)), [500000, 500000, 500000]);
  S.tools.lut.x.lut.name = "Hot";
  const hot = px(Looks, [0.5, 0.5, 0.5], S.tools, enOnly(["lut"]));
  assert.ok(hot[0] > hot[2] + 0.05, "Hot warms the pixel");
});

test("LUT gamma does nothing without a LUT selected", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools.lut.x.lut.gamma = "Input";
  const out = px(Looks, [0.5, 0.25, 0.8], S.tools, enOnly(["lut"]));
  assert.deepEqual(out.map((v) => Math.round(v * 1e6)), [500000, 250000, 800000], "name None is identity");
});

test("disabled chain passes through and alpha survives", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools.contrast.p.contrast = 0.9;
  S.tools.vignette.p.strength = 1;
  const src = flatImage(10, 10, (u, v) => [u, v, 0.3]);
  src[3] = 128;
  const off = {};
  for (const k of Object.keys(S.tools)) off[k] = 0;
  const out = Looks.grade.gradeImage(src, 10, 10, S.tools, off);
  assert.ok(maxDrift(out, src) < 1e-9, "all-off passes through");
  assert.equal(out[3], 128, "alpha preserved");
});

test("chain order changes the result of non-commuting tools", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools.contrast.p.contrast = 0.5;
  S.tools.contrast.p.pivot = 0.5;
  S.tools.crush.p.gamma = 2;
  const en = enOnly(["contrast", "crush"]);
  const a = px(Looks, [0.7, 0.7, 0.7], S.tools, en, null, ["contrast", "crush"]);
  const b = px(Looks, [0.7, 0.7, 0.7], S.tools, en, null, ["crush", "contrast"]);
  assert.ok(Math.abs(a[0] - b[0]) > 0.01, "order matters");
});

test("tools removed from the chain do not run", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools.contrast.p.contrast = 0.5;
  const en = enOnly(["contrast"]);
  const inChain = px(Looks, [0.7, 0.7, 0.7], S.tools, en, null, ["contrast"]);
  const removed = px(Looks, [0.7, 0.7, 0.7], S.tools, en, null, ["crush"]);
  assert.equal(removed[0], 0.7, "removed tool is skipped");
  assert.notEqual(inChain[0], 0.7, "same tool in the chain applies");
});

test("lens distortion is a pre-stage: it resamples only when in the chain", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const g = Looks.grade;
  S.tools["lens-distortion"].p.distortion = 0.5;
  const sample = (u, v) => [u, v, 0.5];
  const c0 = [0.9, 0.5, 0.5];
  const luts = g.buildFrameLuts(S.tools);
  const en = enOnly(["lens-distortion"]);
  const with_ = g.gradePixel(c0, [0.9, 0.5], S.tools, en, sample, [32, 32], luts, ["lens-distortion"]);
  const without = g.gradePixel(c0, [0.9, 0.5], S.tools, en, sample, [32, 32], luts, ["contrast"]);
  assert.ok(Math.abs(with_[0] - 0.9) > 1e-3, "lens resamples when listed");
  assert.equal(without[0], 0.9, "lens absent when not in the chain");
});

test("hsl red saturation and distortion center behave", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools["hsl-colors"].x.hsl[0].sat = 1;
  const red = px(Looks, [0.6, 0.2, 0.2], S.tools, enOnly(["hsl-colors"]));
  assert.ok(red[0] - red[1] > 0.5, "red saturation boosted separation");
  S.tools["hsl-colors"].x.hsl[0].sat = 0;
  S.tools["lens-distortion"].p.distortion = 0.5;
  const mid = px(Looks, [0.4, 0.4, 0.4], S.tools, enOnly(["lens-distortion"]));
  assert.ok(Math.abs(mid[0] - 0.4) < 0.05, "distortion keeps the center stable");
});

test("degenerate thresholds and extreme values stay finite", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  S.tools["ranged-saturation"].p.thresholdHighlight = 0.4;
  S.tools["ranged-saturation"].p.thresholdMidtone = 0.4;
  S.tools["ranged-saturation"].p.thresholdShadow = 0.4;
  S.tools["auto-shoulder"].p.strength = 1;
  const src = flatImage(8, 8, (u, v) => [u, v, 0.5]);
  const all = {};
  for (const k of Object.keys(S.tools)) all[k] = 1;
  const out = Looks.grade.gradeImage(src, 8, 8, S.tools, all);
  assert.ok(out.every((v) => Number.isFinite(v)), "no NaN from degenerate zones");
  const neg = px(Looks, [-0.18, 0, 0], S.tools, enOnly(["auto-shoulder"]));
  assert.ok(Number.isFinite(neg[0]), "auto shoulder guards negative input");
});

// ---------- effect surface ----------

function makeTexture(counter) {
  return function DataTexture(data, w, h) {
    this.data = data;
    this.width = w;
    this.height = h;
    let flag = false;
    Object.defineProperty(this, "needsUpdate", {
      get() { return flag; },
      set(v) { flag = v; if (v) counter.uploads++; },
    });
  };
}

function loadEffect() {
  const source = readPack("looks-fx.js");
  const PZ = { property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7 } } };
  const counter = { uploads: 0 };
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = (a, b) => { this.x = a; this.y = b; }; },
    Vector3: function (x, y, z) {
      this.x = x; this.y = y; this.z = z;
      this.set = (a, b, c) => { this.x = a; this.y = b; this.z = c; };
    },
    ShaderMaterial: function (opts) { this.uniforms = opts.uniforms; this.dispose = () => {}; },
    ShaderPass: function (mat) { this.uniforms = mat.uniforms; this.enabled = true; this.material = mat; },
    DataTexture: makeTexture(counter),
    RGBFormat: 1,
    LinearFilter: 1,
    ClampToEdgeWrapping: 1,
  };
  const store = {};
  function FakeProp(def) {
    this.def = def;
    this.v = def.value;
  }
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
  return { fakeThis, PZ, THREE, store, counter };
}

test("effect properties match the catalog prop map and the chain/enable surface", () => {
  const { fakeThis } = loadEffect();
  const Looks = fakeThis.looksTest.Looks;
  const map = Looks.tools.propMap();
  const defs = fakeThis.propertyDefinitions;
  assert.equal(fakeThis.defaultName, "Magic Looks");
  assert.equal(defs.enabled.magicLooksSetup.name, "Setup");
  assert.equal(defs.enabled.buttons, undefined, "setup button does not use the shared buttons renderer");
  const expected = new Set(["enabled", "chainOrder"]);
  for (const id of Object.keys(map)) {
    const rec = map[id];
    expected.add(rec.enable);
    for (const k of Object.keys(rec.params)) expected.add(rec.params[k]);
    for (const k of Object.keys(rec.wheels)) for (const key of rec.wheels[k]) expected.add(key);
    if (rec.custom.hsl) {
      for (const key of rec.custom.hsl.sat) expected.add(key);
      for (const key of rec.custom.hsl.light) expected.add(key);
    }
    if (rec.custom.curvesJson) expected.add(rec.custom.curvesJson);
    if (rec.custom.scurveJson) expected.add(rec.custom.scurveJson);
    if (rec.custom.fourwayPreview) expected.add(rec.custom.fourwayPreview);
    if (rec.custom.fourway) for (const slot of Object.keys(rec.custom.fourway)) for (const key of rec.custom.fourway[slot]) expected.add(key);
    if (rec.custom.lutName) {
      expected.add(rec.custom.lutName);
      expected.add(rec.custom.lutStrength);
      expected.add(rec.custom.lutGamma);
    }
  }
  assert.deepEqual(new Set(Object.keys(defs)), expected, "no drift between catalog and effect");
  assert.equal(defs.lutGamma.items, "Same As Input;Input;Output");
  assert.equal(defs.curvCurvesJson.type, 7, "curves travel as TEXT json");
  assert.equal(defs.chainOrder.value, JSON.stringify(Looks.tools.defaultChain()), "default chain is stored");
  assert.equal(defs.ccEnable.value, 0, "Color Contrast ships off");
});

test("effect update: pass disabled at defaults, enabled once a value changes", async () => {
  const { fakeThis, store } = loadEffect();
  await fakeThis.load({});
  fakeThis.update({});
  assert.equal(fakeThis.pass.enabled, false, "identity defaults skip the pass");
  store.conContrast.v = 0.4;
  fakeThis.update({});
  assert.equal(fakeThis.pass.enabled, true, "a changed value engages the pass");
  assert.equal(fakeThis.pass.uniforms.u_conContrast.value, 0.4);
  store.conContrast.v = 0;
  store.enabled.v = 0;
  fakeThis.update({});
  assert.equal(fakeThis.pass.enabled, false, "master bypass disengages the pass");
});

test("effect update: LUT and chain uploads happen only when their values change", async () => {
  const { fakeThis, store, counter } = loadEffect();
  await fakeThis.load({});
  fakeThis.update({});
  const baseline = counter.uploads;
  for (let i = 0; i < 5; i++) fakeThis.update({});
  assert.equal(counter.uploads, baseline, "no per-frame LUT upload");
  store.curvCurvesJson.v = JSON.stringify({
    RGB: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    Red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
    Green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    Blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  fakeThis.update({});
  assert.equal(counter.uploads, baseline + 1, "changed curves upload once");
  assert.equal(fakeThis._looksCurvesIdentity, false, "non-identity curves engage");
  assert.ok(fakeThis._looksCurvesBytes[128 * 3] > 200, "red curve lifted into the table");
  fakeThis.update({});
  assert.equal(counter.uploads, baseline + 1, "unchanged curves do not re-upload");
});

test("effect update: chain order uniform is filled and reordering needs no recompile", async () => {
  const { fakeThis, store } = loadEffect();
  await fakeThis.load({});
  const uniforms = fakeThis.pass.uniforms;
  const materialBefore = fakeThis.pass.material;
  store.chainOrder.v = JSON.stringify(["crush", "contrast"]);
  fakeThis.update({});
  assert.equal(uniforms.u_chainCount.value, 0, "reordering identity tools stays identity");
  assert.equal(fakeThis.pass.enabled, false);
  store.cruGamma.v = 1.2;
  store.conContrast.v = 0.3;
  fakeThis.update({});
  assert.equal(uniforms.u_chainCount.value, 2);
  assert.equal(uniforms.u_chain.value[0], 3, "crush dispatch index");
  assert.equal(uniforms.u_chain.value[1], 4, "contrast dispatch index");
  assert.equal(uniforms.u_chain.value[2], -1, "unused slots are cleared");
  assert.equal(fakeThis.pass.material, materialBefore, "same material, shader not rebuilt");
});

test("every shader uniform exists on the material", async () => {
  const { fakeThis } = loadEffect();
  await fakeThis.load({});
  const uniforms = fakeThis.pass.uniforms;
  const src = readPack("looks-grade.glsl");
  const missing = [];
  for (const m of src.matchAll(/uniform\s+(?:float|vec3|vec2|sampler2D)\s+(\w+)(?:\[\d+\])?\s*;/g)) {
    if (!(m[1] in uniforms)) missing.push(m[1]);
  }
  assert.deepEqual(missing, [], "shader/material agreement");
});

test("shader dispatch table matches the catalog order and every stage is wired", () => {
  const { fakeThis } = loadEffect();
  const Looks = fakeThis.looksTest.Looks;
  const src = readPack("looks-grade.glsl");
  const header = src.slice(src.indexOf("Tool dispatch index"), src.indexOf("uniform sampler2D tDiffuse"));
  const pairs = {};
  for (const m of header.matchAll(/(\d+) ([a-z][a-z-]*)/g)) pairs[m[1]] = m[2];
  Looks.tools.TOOLS.forEach((tool, i) => {
    assert.equal(pairs[String(i)], tool.id, "dispatch index " + i + " is " + tool.id);
  });
  const dispatch = src.slice(src.indexOf("vec3 lkApply("), src.indexOf("void main()"));
  for (let i = 0; i < 29; i++) {
    if (i === 24) continue;
    assert.ok(dispatch.includes("abs(id - " + i + ".0) < 0.5"), "dispatch branch " + i);
  }
  assert.ok(!dispatch.includes("abs(id - 24.0)"), "lens is handled before the chain");
});

test("shader keeps premultiplied alpha and guards the math", () => {
  const src = readPack("looks-grade.glsl");
  assert.ok(!/gl_FragColor\s*=\s*vec4\(c,\s*1\.0\)/.test(src), "alpha is not forced opaque");
  assert.ok(src.includes("gl_FragColor = vec4(c * a, a)"), "premultiplied output");
  assert.ok(src.includes("src.rgb / a"), "unpremultiplied input");
  assert.ok(src.includes("float lkSmooth("), "guarded smoothstep");
  assert.ok(src.includes("int hl = count / 2"), "line taps match the JS reference");
  assert.ok(src.includes("(clamp(x, 0.0, 1.0) * 255.0 + 0.5) / 256.0"), "LUT texel mapping");
});

test("setup binding markers are present", () => {
  const source = readPack("looks-setup.js");
  for (const fn of ["openSetup", "installPropertyButton", "createSession", "presetWrites", "chainSection", "buildCurves"]) {
    assert.ok(source.includes(fn), "setup references " + fn);
  }
});


test("effect update omits disabled and unchanged identity tools from the shader chain", async () => {
  const { fakeThis, store } = loadEffect();
  await fakeThis.load({});
  store.conContrast.v = 0.3;
  fakeThis.update({});
  assert.equal(fakeThis.pass.uniforms.u_chainCount.value, 1);
  assert.equal(fakeThis.pass.uniforms.u_chain.value[0], 4);
  store.conEnable.v = 0;
  fakeThis.update({});
  assert.equal(fakeThis.pass.uniforms.u_chainCount.value, 0);
  assert.equal(fakeThis.pass.enabled, false);
});
