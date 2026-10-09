"use strict";

// Coverage for the Magic Looks grading effect: the JS reference pipeline
// invariants, the generated effect property surface, the update/uniform
// sync path, and the shader/material agreement.

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
  const all = Object.keys(Looks.tools.defaultState().tools);
  const en = {};
  for (const k of all) en[k] = ids.includes(k) ? 1 : 0;
  return en;
}

test("default chain is neutral except the fixed Color Contrast character", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const src = flatImage(16, 16, (u, v) => [u, v, 0.5]);
  const out = Looks.grade.gradeImage(src, 16, 16, S.tools, S.on);
  // Only Color Contrast deviates (fixed 0.37 amount); everything else passes through.
  const solo = Looks.grade.gradeImage(src, 16, 16, S.tools, enOnly(["color-contrast"]));
  assert.deepEqual(out.map(Math.round), solo.map(Math.round));
  const drift = maxDrift(out, src);
  assert.ok(drift > 0.01 && drift < 0.4, "color-contrast character in range, drift=" + drift.toFixed(3));
});

test("every other tool is neutral at defaults", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const src = flatImage(12, 12, (u, v) => [0.2 + u * 0.6, 0.2 + v * 0.6, 0.5]);
  for (const id of Object.keys(S.tools)) {
    if (id === "color-contrast") continue;
    const out = Looks.grade.gradeImage(src, 12, 12, S.tools, enOnly([id]));
    assert.ok(maxDrift(out, src) < 1e-9, id + " is neutral at defaults");
  }
});

test("contrast pivots, exposure doubles, lift raises blacks", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const g = Looks.grade;
  const luts = g.buildFrameLuts(S.tools);
  const px = (c, T, en, uv) => g.gradePixel(c, uv || [0.5, 0.5], T, en, (u, v) => c, [16, 16], luts);
  S.tools.contrast.p.contrast = 1;
  S.tools.contrast.p.pivot = 0.5;
  assert.deepEqual(px([0.5, 0.5, 0.5], S.tools, enOnly(["contrast"])).map((v) => Math.round(v * 1e6)), [500000, 500000, 500000]);
  S.tools.contrast.p.contrast = 0;
  S.tools["lift-gamma-gain"].p.exposure = 0;
  const dbl = px([0.25, 0.5, 0.75], S.tools, enOnly(["lift-gamma-gain"]));
  S.tools["lift-gamma-gain"].p.exposure = 1;
  const dbl2 = px([0.25, 0.5, 0.75], S.tools, enOnly(["lift-gamma-gain"]));
  assert.ok(Math.abs(dbl2[0] - dbl[0] * 2) < 1e-9, "exposure +1 doubles");
  S.tools["lift-gamma-gain"].p.exposure = 0;
  S.tools["lift-gamma-gain"].w.lift.rgb = [1.1, 1.1, 1.1];
  const lifted = px([0, 0, 0], S.tools, enOnly(["lift-gamma-gain"]));
  assert.ok(lifted[0] > 0.09 && lifted[0] < 0.11, "lift adds to blacks");
});

test("vignette darkens corners, curves shape reds, LUT Hot warms", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const g = Looks.grade;
  const luts = () => g.buildFrameLuts(S.tools);
  const src = flatImage(24, 24, () => [0.6, 0.6, 0.6]);
  S.tools.vignette.p.strength = 1;
  S.tools.vignette.w.color.rgb = [0, 0, 0];
  const out = g.gradeImage(src, 24, 24, S.tools, enOnly(["vignette"]));
  const center = out[(12 * 24 + 12) * 4];
  const corner = out[0];
  assert.ok(corner < center * 0.7, "corner darker than center");
  S.tools.vignette.p.strength = 0;
  S.tools.curves.x.curves.channels.Red.push({ x: 0.5, y: 0.8 });
  const curved = g.gradePixel([0.5, 0.5, 0.5], [0.5, 0.5], S.tools, enOnly(["curves"]), (u, v) => [0.5, 0.5, 0.5], [16, 16], luts());
  assert.ok(curved[0] > 0.75 && Math.abs(curved[1] - 0.5) < 0.01, "red curve lifts reds only");
  S.tools.curves.x.curves.channels.Red.pop();
  S.tools.lut.x.lut.name = "None";
  const plain = g.gradePixel([0.5, 0.5, 0.5], [0.5, 0.5], S.tools, enOnly(["lut"]), (u, v) => [0.5, 0.5, 0.5], [16, 16], luts());
  assert.deepEqual(plain.map((v) => Math.round(v * 1e6)), [500000, 500000, 500000]);
  S.tools.lut.x.lut.name = "Hot";
  const hot = g.gradePixel([0.5, 0.5, 0.5], [0.5, 0.5], S.tools, enOnly(["lut"]), (u, v) => [0.5, 0.5, 0.5], [16, 16], luts());
  assert.ok(hot[0] > hot[2] + 0.05, "Hot warms the pixel");
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

test("hsl red saturation and distortion center behave", () => {
  const Looks = loadLooks();
  const S = Looks.tools.defaultState();
  const g = Looks.grade;
  const luts = g.buildFrameLuts(S.tools);
  const px = (c, uv) => g.gradePixel(c, uv, S.tools, enOnly(["hsl-colors", "lens-distortion"]), (u, v) => c, [32, 32], luts);
  S.tools["hsl-colors"].x.hsl[0].sat = 1;
  const red = px([0.6, 0.2, 0.2], [0.5, 0.5]);
  assert.ok(red[0] - red[1] > 0.4 - 0.2 + 0.1, "red saturation boosted separation");
  S.tools["hsl-colors"].x.hsl[0].sat = 0;
  S.tools["lens-distortion"].p.distortion = 0.5;
  const mid = px([0.4, 0.4, 0.4], [0.5, 0.5]);
  assert.ok(Math.abs(mid[0] - 0.4) < 0.05, "distortion keeps the center stable");
});

// ---------- effect surface ----------

function loadEffect() {
  const source = readPack("looks-fx.js");
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 } },
  };
  const vectors = [];
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = (a, b) => { this.x = a; this.y = b; }; },
    Vector3: function (x, y, z) {
      this.x = x; this.y = y; this.z = z;
      this.set = (a, b, c) => { this.x = a; this.y = b; this.z = c; vectors.push([a, b, c]); };
    },
    ShaderMaterial: function (opts) { this.uniforms = opts.uniforms; },
    ShaderPass: function (mat) { this.uniforms = mat.uniforms; this.enabled = true; },
    DataTexture: function (data, w, h) {
      this.data = data; this.width = w; this.height = h; this.needsUpdate = false;
    },
    RGBFormat: 1,
    LinearFilter: 1,
    ClampToEdgeWrapping: 1,
  };
  const store = {};
  const writes = [];
  function FakeProp(def) {
    this.def = def;
    this.v = def.value;
  }
  FakeProp.prototype.get = function () { return this.v; };
  FakeProp.prototype.set = function (v) { this.v = v; writes.push(v); };
  const fakeThis = {
    _zoidiumGetAsset: (kind, url) => {
      const base = String(url).split("/").pop().split("?")[0];
      return readPack(base);
    },
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
  return { fakeThis, PZ, THREE, store, writes, vectors };
}

test("effect properties match the catalog prop map exactly", () => {
  const { fakeThis } = loadEffect();
  const Looks = fakeThis.looksTest.Looks;
  const map = Looks.tools.propMap();
  const defs = fakeThis.propertyDefinitions;
  assert.equal(fakeThis.defaultName, "Magic Looks");
  assert.deepEqual(defs.enabled.buttons, [
    { name: "Magic Looks Setup", title: "Open the Magic Looks setup window", action: "magicLooksSetup" },
  ]);
  const expected = new Set(["enabled"]);
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
    if (rec.custom.fourway) {
      for (const slot of Object.keys(rec.custom.fourway)) {
        for (const key of rec.custom.fourway[slot]) expected.add(key);
      }
    }
    if (rec.custom.angle) expected.add(rec.custom.angle);
    if (rec.custom.lutName) {
      expected.add(rec.custom.lutName);
      expected.add(rec.custom.lutStrength);
      expected.add(rec.custom.lutGamma);
    }
  }
  assert.deepEqual(new Set(Object.keys(defs)), expected, "no drift between catalog and effect");
  assert.ok(Object.keys(defs).length > 200, "full tool surface declared (" + Object.keys(defs).length + " props)");
  assert.equal(defs.scvLog.items, "Off;On");
  assert.equal(defs.lutGamma.items, "Same As Input;Input;Output");
  assert.equal(defs.curvCurvesJson.type, 3, "curves travel as TEXT json");
});

test("effect update syncs uniforms and rebuilds the curves LUT", () => {
  const { fakeThis, store } = loadEffect();
  const T = fakeThis.looksTest;
  const uniforms = T.buildUniforms(T.propMap);
  fakeThis.pass = { uniforms, enabled: true };
  fakeThis._looksLutBytes = new Uint8Array(256 * 3);
  fakeThis._looksLutKeys = { curves: "", scurve: "" };
  fakeThis._looksLutTexture = { needsUpdate: false };
  store.conContrast.v = 0.4;
  store.lggGainR.v = 1.1;
  store.lggGainG.v = 1.0;
  store.lggGainB.v = 0.9;
  store.curvCurvesJson.v = JSON.stringify({
    Red: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
    Green: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    Blue: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
  });
  fakeThis.update({});
  assert.equal(uniforms.u_conContrast.value, 0.4);
  assert.deepEqual([uniforms.u_lggGainTint.value.x, uniforms.u_lggGainTint.value.y, uniforms.u_lggGainTint.value.z], [1.1, 1.0, 0.9]);
  assert.equal(fakeThis._looksLutTexture.needsUpdate, true, "LUT texture flagged");
  assert.ok(fakeThis._looksLutBytes[128 * 3] > 200, "red curve lifted into LUT bytes");
  assert.equal(fakeThis.pass.enabled, true, "chain engaged while tools are on");
  for (const k of Object.keys(store)) {
    if (/Enable$/.test(k)) store[k].v = 0;
  }
  store.enabled.v = 1;
  fakeThis.update({});
  assert.equal(fakeThis.pass.enabled, false, "chain disengages when every tool is off");
});

test("every shader uniform exists on the material", () => {
  const { fakeThis } = loadEffect();
  const T = fakeThis.looksTest;
  const uniforms = T.buildUniforms(T.propMap);
  const src = readPack("looks-grade.glsl");
  const missing = [];
  for (const m of src.matchAll(/uniform\s+(?:float|vec3|vec2|sampler2D)\s+(\w+)\s*;/g)) {
    if (!(m[1] in uniforms)) missing.push(m[1]);
  }
  assert.deepEqual(missing, [], "shader/material agreement");
});

test("setup binding markers are present", () => {
  const source = readPack("looks-setup.js");
  for (const fn of [
    "findLooks", "pullFromEffect", "pushFullState", "schedulePush",
    "openMagicLooks", "addLooksToSelection", "magicLooksSetup",
    "ensureDispatcher", "wrapDispatcher", "unpatchDispatcher",
    "lk-preview", "lk-screen", "mainViewport",
  ]) {
    assert.ok(source.includes(fn), "setup references " + fn);
  }
  const css = readPack("looks-setup.css");
  for (const cls of ["lk-preview", "lk-screen", "lk-screen-placeholder", "lk-preview-bar", "lk-status", "lk-time", "lk-mini-btn"]) {
    assert.ok(css.includes("." + cls), "missing style for " + cls);
  }
});
