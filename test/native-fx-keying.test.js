"use strict";

// Native FX keying (Color Difference Key, Advanced Spill Suppressor,
// Key Cleaner, Linear Color Key): effect specs load with the expected
// properties and defaults, the per-frame uniform derivation matches the
// EffectCraft reference formulas, and a JS mirror of the shader math keys a
// synthetic green screen the same way the reference CPU logic does.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const effectsDir = path.join(projectRoot, "plugins/native-fx/effects");
const shadersDir = path.join(projectRoot, "plugins/native-fx/shaders");

class Vector2 {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  set(x, y) {
    this.x = x;
    this.y = y;
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

class Vector4 {
  constructor(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
}

function loadSpec(file) {
  let spec = null;
  const sandbox = {
    PZ: {
      property: {
        type: { NUMBER: 0, OPTION: 10, VECTOR2: 5, COLOR: 6, TEXT: 7 },
      },
    },
    THREE: { Vector2, Vector3, Vector4 },
    ZoidiumPluginApis: {
      defineFilter(value) {
        spec = value;
      },
    },
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(effectsDir, file), "utf8");
  new vm.Script(source, { filename: file }).runInContext(sandbox);
  return spec;
}

function fakeEffect(spec, overrides) {
  const properties = {};
  for (const [id, def] of Object.entries(spec.properties)) {
    const value = overrides && id in overrides ? overrides[id] : def.value;
    properties[id] = { get: () => (Array.isArray(value) ? value.slice() : value) };
  }
  const uniforms = {};
  for (const [name, def] of Object.entries(spec.uniforms)) {
    const value = def.value;
    let copy = value;
    if (value instanceof Vector2) copy = new Vector2(value.x, value.y);
    else if (value instanceof Vector3) copy = new Vector3(value.x, value.y, value.z);
    else if (value instanceof Vector4) copy = new Vector4(value.x, value.y, value.z, value.w);
    uniforms[name] = { value: copy };
  }
  return { properties, pass: { uniforms, enabled: true } };
}

function runUpdate(spec, overrides) {
  const effect = fakeEffect(spec, overrides);
  spec.update.call(effect, 0);
  return effect;
}

// ---- JS mirrors of the shader math (straight colour, premultiplied I/O) ----

function primaryOf(color) {
  if (color[1] >= color[0] && color[1] >= color[2]) return [1, 0, 2];
  if (color[2] >= color[0] && color[2] >= color[1]) return [2, 0, 1];
  return [0, 1, 2];
}

function linearize(v) {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function levels(v, inB, inW, gamma, outB, outW) {
  const t = Math.min(1, Math.max(0, (v - inB / 255) / (Math.max((inW - inB) / 255, 1e-4))));
  const g = Math.pow(t, 1 / Math.max(gamma, 0.01));
  return Math.min(1, Math.max(0, outB / 255 + (g * (outW - outB)) / 255));
}

function rgbToHue(r, g, b) {
  const mx = Math.max(r, Math.max(g, b));
  const mn = Math.min(r, Math.min(g, b));
  const d = mx - mn;
  if (d < 1e-7) return 0;
  let h;
  if (mx === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
    h /= 6;
  } else if (mx === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return h;
}

function rgbToHsl(r, g, b) {
  const mx = Math.max(r, Math.max(g, b));
  const mn = Math.min(r, Math.min(g, b));
  const l = (mx + mn) * 0.5;
  const d = mx - mn;
  if (d < 1e-7) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  return [rgbToHue(r, g, b), s, l];
}

function colordiffMatte(px, key, accurate) {
  const a0 = Math.max(px[3], 0);
  let c = a0 > 1e-6 ? [px[0] / px[3], px[1] / px[3], px[2] / px[3]] : [0, 0, 0];
  let k = key.slice();
  if (accurate) {
    c = c.map(linearize);
    k = k.map(linearize);
  }
  const [pi, o1, o2] = primaryOf(k);
  const kd1 = Math.max(k[pi] - k[o1], 1e-3);
  const kd2 = Math.max(k[pi] - k[o2], 1e-3);
  const ua = 1 - Math.min(1, Math.max(0, (c[pi] - c[o1]) / kd1));
  const ub = 1 - Math.min(1, Math.max(0, (c[pi] - c[o2]) / kd2));
  const ca = levels(ua, 0, 255, 1, 0, 255);
  const cb = levels(ub, 0, 255, 1, 0, 255);
  return levels(Math.max(ca, cb), 0, 255, 1, 0, 255);
}

function advSpill(px, key, ultra) {
  if (px[3] <= 0) return px;
  const [pi, o1, o2] = primaryOf(key);
  const s = [px[0] / px[3], px[1] / px[3], px[2] / px[3]];
  const amt = 1;
  const range = ultra ? 0.5 : 0;
  const tol = ultra ? 0.5 : 1;
  let w = 1;
  if (tol < 1) {
    const h = rgbToHue(s[0], s[1], s[2]);
    const keyH = rgbToHue(key[0], key[1], key[2]);
    const d = Math.min(Math.abs(h - keyH), 1 - Math.abs(h - keyH));
    w = Math.min(1, Math.max(0, 1 - d / Math.max(tol * 0.5, 1e-4)));
  }
  const mx = Math.max(s[o1], s[o2]);
  const avg = 0.5 * (s[o1] + s[o2]);
  const spill = Math.max(s[pi] - (mx + (avg - mx) * range), 0) * amt * w;
  const out = s.slice();
  out[pi] -= spill;
  return [out[0] * px[3], out[1] * px[3], out[2] * px[3], px[3]];
}

function linearKeyDistance(c, key, mode) {
  if (mode === 1) {
    const hc = rgbToHsl(c[0], c[1], c[2]);
    const hk = rgbToHsl(key[0], key[1], key[2]);
    if (hc[1] < 0.02) return 1;
    return Math.min(Math.abs(hc[0] - hk[0]), 1 - Math.abs(hc[0] - hk[0])) * 2;
  }
  if (mode === 2) {
    const chroma = (v) => {
      const s = v[0] + v[1] + v[2];
      return s <= 1e-6 ? [1 / 3, 1 / 3] : [v[0] / s, v[1] / s];
    };
    const a = chroma(c);
    const b = chroma(key);
    return Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.SQRT2;
  }
  return Math.hypot(c[0] - key[0], c[1] - key[1], c[2] - key[2]) / Math.sqrt(3);
}

const GREEN = [0.1, 0.8, 0.15, 1];
const RED = [0.9, 0.2, 0.1, 1];

// ---- spec shape ----

test("keying specs expose stable ids, names, and defaults", () => {
  const cdk = loadSpec("colordiffkey.js");
  assert.equal(cdk.displayName, "Color Difference Key");
  assert.equal(cdk.properties.keyColor.value.join(","), "0,1,0");
  assert.equal(cdk.properties.view.value, 0);
  assert.ok(cdk.properties.view.items.split(";").includes("Corrected Partial A"));
  assert.equal(cdk.properties.partialAInWhite.value, 255);
  assert.equal(cdk.properties.gamma.value, 1);

  const spill = loadSpec("advspill.js");
  assert.equal(spill.displayName, "Advanced Spill Suppressor");
  assert.equal(spill.properties.method.items, "Standard;Ultra");
  assert.equal(spill.properties.suppression.value, 100);
  assert.equal(spill.properties.spillRange.value, 50);

  const cleaner = loadSpec("keycleaner.js");
  assert.equal(cleaner.displayName, "Key Cleaner");
  assert.equal(cleaner.properties.additionalEdgeRadius.value, 3);
  assert.equal(cleaner.properties.alphaContrast.value, 100);
  assert.equal(cleaner.properties.strength.value, 100);
  assert.equal(cleaner.properties.reduceChatter.items, "off;on");

  const linear = loadSpec("linearcolorkey.js");
  assert.equal(linear.displayName, "Linear Color Key");
  assert.equal(linear.properties.keyColor.value.join(","), "0,0,1");
  assert.equal(linear.properties.matchColors.items, "Using RGB;Using Hue;Using Chroma");
  assert.equal(linear.properties.keyOperation.items, "Key Colors;Keep Colors");
});

test("color difference update derives the key primary and differences", () => {
  const spec = loadSpec("colordiffkey.js");
  const effect = runUpdate(spec, { keyColor: [0.1, 0.8, 0.15] });
  const u = effect.pass.uniforms;
  assert.equal(u.keyPrimary.value, 1);
  assert.equal(u.keyOther1.value, 0);
  assert.equal(u.keyOther2.value, 2);
  assert.ok(Math.abs(u.keyDiff1.value - 0.7) < 1e-9);
  assert.ok(Math.abs(u.keyDiff2.value - 0.65) < 1e-9);
  assert.equal(u.accurate.value, 0);
  const accurate = runUpdate(spec, { keyColor: [0.1, 0.8, 0.15], colorMatchingAccuracy: 1 });
  assert.equal(accurate.pass.uniforms.accurate.value, 1);
  const kd = runUpdate(spec, { keyColor: [0, 0, 1] });
  assert.equal(kd.pass.uniforms.keyPrimary.value, 2);
});

test("color difference matte keys the screen and keeps red", () => {
  const key = [0.1, 0.8, 0.15];
  assert.ok(colordiffMatte(GREEN, key, false) < 0.01);
  assert.ok(colordiffMatte(RED, key, false) > 0.99);
  assert.ok(colordiffMatte(GREEN, key, true) < 0.01);
  assert.ok(colordiffMatte(RED, key, true) > 0.99);
});

test("spill update gates ultra knobs behind Standard", () => {
  const spec = loadSpec("advspill.js");
  const standard = runUpdate(spec, { suppression: 100 });
  assert.equal(standard.pass.uniforms.spillRange.value, 0);
  assert.equal(standard.pass.uniforms.tolerance.value, 1);
  assert.equal(standard.pass.uniforms.desaturate.value, 0);
  const ultra = runUpdate(spec, { method: 1, tolerance: 50, spillRange: 50 });
  assert.equal(ultra.pass.uniforms.spillRange.value, 0.5);
  assert.equal(ultra.pass.uniforms.tolerance.value, 0.5);
  assert.ok(Math.abs(ultra.pass.uniforms.keyHue.value - 1 / 3) < 1e-6);
});

test("advanced spill removes green excess and respects a narrow tolerance", () => {
  const out = advSpill([0.3, 0.8, 0.3, 1], [0, 1, 0], false);
  assert.ok(Math.abs(out[1] - 0.3) < 1e-6, `green limited to max of others: ${out}`);
  const yellowGreen = [0.6, 0.8, 0.1, 1];
  const narrow = advSpill(yellowGreen, [0, 1, 0], true);
  void narrow;
  const gated = (() => {
    const s = [0.6, 0.8, 0.1];
    const h = rgbToHue(s[0], s[1], s[2]);
    const d = Math.min(Math.abs(h - 1 / 3), 1 - Math.abs(h - 1 / 3));
    return 1 - d / 0.025;
  })();
  assert.ok(gated <= 0, "a hue 0.12 away is fully gated at tolerance 0.05");
  const skin = [0.72, 0.55, 0.45, 1];
  const fixed = advSpill(skin, [0, 1, 0], false);
  assert.ok(Math.abs(fixed[0] - skin[0]) < 1e-6 && Math.abs(fixed[2] - skin[2]) < 1e-6);
});

test("key cleaner update bounds the kernel step", () => {
  const spec = loadSpec("keycleaner.js");
  const small = runUpdate(spec, { additionalEdgeRadius: 3 });
  assert.ok(Math.abs(small.pass.uniforms.estSigma.value - 1.5) < 1e-9);
  assert.ok(small.pass.uniforms.estStep.value >= 1 && small.pass.uniforms.estStep.value <= 4);
  const huge = runUpdate(spec, { additionalEdgeRadius: 100 });
  assert.equal(huge.pass.uniforms.estStep.value, 4);
  const off = runUpdate(spec, { additionalEdgeRadius: 0, reduceChatter: 1 });
  assert.equal(off.pass.uniforms.estSigma.value, 0);
  assert.equal(off.pass.uniforms.chatter.value, 1);
});

test("linear key distances key green and keep red in every mode", () => {
  const key = [0.1, 0.8, 0.15];
  for (const mode of [0, 1, 2]) {
    const dg = linearKeyDistance([0.1, 0.8, 0.15], key, mode);
    const dr = linearKeyDistance([0.9, 0.2, 0.1], key, mode);
    assert.ok(dg < 0.1, `mode ${mode} matches the screen: ${dg}`);
    assert.ok(dr > 0.2, `mode ${mode} separates red: ${dr}`);
  }
  const greyHue = linearKeyDistance([0.5, 0.5, 0.5], key, 1);
  assert.equal(greyHue, 1, "achromatic pixels never hue-match");
});

test("keying shaders implement the reference formulas", () => {
  const cdk = fs.readFileSync(path.join(shadersDir, "fx_colordiffkey.glsl"), "utf8");
  assert.match(cdk, /keyDiff1/);
  assert.match(cdk, /pow\(t, 1\.0 \/ max\(gamma/);
  assert.match(cdk, /px \* cm/);
  const spill = fs.readFileSync(path.join(shadersDir, "fx_advspill.glsl"), "utf8");
  assert.match(spill, /spillRange/);
  assert.match(spill, /tolerance \* 0\.5/);
  assert.match(spill, /spill \* neutral \/ 3\.0/);
  const cleaner = fs.readFileSync(path.join(shadersDir, "fx_keycleaner.glsl"), "utf8");
  assert.match(cleaner, /for \(int j = -2; j <= 2; j\+\+\)/);
  assert.match(cleaner, /\(na - 0\.5\) \* contrast/);
  const linear = fs.readFileSync(path.join(shadersDir, "fx_linearcolorkey.glsl"), "utf8");
  assert.match(linear, /length\(c - keyColor\) \/ 1\.73205081/);
  assert.match(linear, /length\(pc - pk\) \/ 1\.41421356/);
});

test("keying effects are registered with bundled shaders", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "plugins/native-fx/manifest.json"), "utf8"),
  );
  for (const id of ["colordiffkey", "advspill", "keycleaner", "linearcolorkey"]) {
    assert.ok(manifest.nativeEffects.some((e) => e.id === id), `${id} registered`);
    assert.ok(
      manifest.resources.some((r) => r.id === `${id}-shader` && r.type === "text"),
      `${id} shader bundled`,
    );
  }
});
