"use strict";

// Shared props/color/json/windows/gl helpers: each test pins the shared
// implementation against a verbatim copy of the original it replaces, so the
// later migration round cannot change behavior.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadShared(relative) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), sandbox, { filename: relative });
  return sandbox;
}

const Props = loadShared("zoidium/shared/props.js").ZoidiumSharedProps;
const Color = loadShared("zoidium/shared/color.js").ZoidiumSharedColor;
const Json = loadShared("zoidium/shared/json.js").ZoidiumSharedJson;
const Windows = loadShared("zoidium/shared/windows.js").ZoidiumSharedWindows;
const Gl = loadShared("zoidium/shared/gl.js").ZoidiumSharedGl;

test("plugin-apis.js exposes every shared table on ZoidiumPluginApis", () => {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const relative of [
    "zoidium/shared/random.js",
    "zoidium/shared/props.js",
    "zoidium/shared/color.js",
    "zoidium/shared/gl.js",
    "zoidium/shared/json.js",
    "zoidium/shared/windows.js",
    "zoidium/plugin-apis.js",
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, relative), "utf8"), sandbox, { filename: relative });
  }
  const apis = sandbox.ZoidiumSharedRandom && sandbox.ZoidiumPluginApis;
  assert.ok(apis, "plugin-apis.js defines the global");
  for (const key of ["random", "props", "color", "gl", "json", "windows"]) {
    assert.ok(apis[key], `ZoidiumPluginApis.${key} is attached`);
  }
  assert.strictEqual(apis.random.legacyHash01(7, 3), R_legacyHash01(7, 3));
  function R_legacyHash01(seed, index) {
    let h = (Math.imul(seed | 0, 374761393) + Math.imul(index | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
});

// Values returned from the vm sandbox carry the sandbox realm's prototypes,
// so deepStrictEqual against test-realm literals fails on prototype identity.
// canon() re-roots a value in this realm before comparing.
function canon(value) {
  if (value === undefined) return { none: true };
  if (typeof value === "function") return { function: true };
  const text = JSON.stringify(value);
  if (text === undefined) return { unserializable: true };
  return JSON.parse(text);
}

function assertSame(actual, expected, message) {
  assert.deepStrictEqual(canon(actual), canon(expected), message || "shared value differs");
}

// ---- props ----

function cameraReadNumberOrig(property, time, fallback) {
  try {
    const value = property.get(time);
    return typeof value === "number" && isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function particleCloneOrig(value) {
  if (value === undefined || typeof value === "function") return undefined;
  if (value === null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}

function registryCloneOrig(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return value;
  }
}

function prop(getter) {
  return { get: getter };
}

test("readNumber matches the Camera+ reader on values, garbage, and throws", () => {
  const cases = [
    [prop(() => 36), 0, 7],
    [prop(() => 0), 0, 7],
    [prop(() => NaN), 0, 7],
    [prop(() => Infinity), 0, 7],
    [prop(() => "36"), 0, 7],
    [prop(() => undefined), 0, 7],
    [prop(() => { throw new Error("broken expression"); }), 0, 7],
    [null, 0, 7],
  ];
  for (const [property, time, fallback] of cases) {
    assert.strictEqual(Props.readNumber(property, time, fallback), cameraReadNumberOrig(property, time, fallback));
  }
  assert.strictEqual(Props.readNumber(prop(() => 36), 3.25, 0), 36);
});

test("cloneJson variants match particle-defaults and object3d-registry", () => {
  const fn = function () {};
  const values = [undefined, null, 0, "x", [1, 2, { a: 3 }], { a: [1], b: { c: null } }, fn];
  for (const value of values) {
    assertSame(Props.cloneJsonValue(value), particleCloneOrig(value), `cloneJsonValue ${String(value)}`);
    assertSame(Props.cloneJson(value), registryCloneOrig(value), `cloneJson ${String(value)}`);
  }
  const frozen = Object.freeze({ a: 1 });
  assertSame(Props.cloneJson(frozen), { a: 1 });
  // Clones detach: mutating the clone never touches the source.
  const source = { list: [1, 2] };
  const clone = Props.cloneJson(source);
  clone.list.push(3);
  assertSame(source, { list: [1, 2] });
});

test("readVector/readColor fall back per component and never mutate the fallback", () => {
  const fallback = Object.freeze([10, 20, 30]);
  assertSame(Props.readVector(prop(() => [1, 2, 3]), 0, fallback), [1, 2, 3]);
  assertSame(Props.readVector(prop(() => [1, NaN, 3]), 0, fallback), [1, 20, 3]);
  assertSame(Props.readVector(prop(() => "nope"), 0, fallback), [10, 20, 30]);
  assertSame(Props.readVector(prop(() => { throw new Error("x"); }), 0, fallback), [10, 20, 30]);
  assertSame(Props.readColor(prop(() => [1, 0, 0.5, 0.8]), 0, [0, 0, 0]), [1, 0, 0.5]);
  assertSame(Props.readColor(prop(() => [NaN, 0, 0]), 0, [0.1, 0.2, 0.3]), [0.1, 0, 0]);
  assertSame(fallback, [10, 20, 30]);
});

test("forEachProp visits every own entry in key order", () => {
  const seen = [];
  Props.forEachProp({ b: 1, a: 2 }, (value, key) => seen.push([key, value]));
  assertSame(seen, [["b", 1], ["a", 2]]);
  assert.doesNotThrow(() => Props.forEachProp(null, () => { throw new Error("must not run"); }));
});

// ---- color ----

function looksHsvToRgbOrig(h, s, v) {
  function clamp(vv, lo, hi) { return vv < lo ? lo : vv > hi ? hi : vv; }
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  v = clamp(v, 0, 1);
  var c = v * s;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = v - c;
  var r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

function fractureHslToRgbOrig(hue, saturation, lightness) {
  function hueToRgb(p, q, value) {
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  }
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [hueToRgb(p, q, hue + 1 / 3), hueToRgb(p, q, hue), hueToRgb(p, q, hue - 1 / 3)];
}

function windowsHexToRgbOrig(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

test("clamp/lerp/clampUnit match the settings and effector originals", () => {
  function settingsClampOrig(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  for (const [v, lo, hi] of [[5, 0, 10], [-3, 0, 10], [30, 0, 10], [0, -180, 180], [-200, -180, 180]]) {
    assert.strictEqual(Color.clamp(v, lo, hi), settingsClampOrig(v, lo, hi));
  }
  for (const [a, b, t] of [[0, 10, 0.25], [5, -5, 0.5], [1, 2, 3]]) {
    assert.strictEqual(Color.lerp(a, b, t), a + (b - a) * t);
  }
  function clampUnitOrig(value) {
    if (!(value > 0)) return 0;
    return value < 1 ? value : 1;
  }
  for (const v of [0, -1, 0.4, 1, 2, NaN, Infinity]) {
    assert.strictEqual(Color.clampUnit(v), clampUnitOrig(v), `clampUnit ${String(v)}`);
  }
  // clampUnit collapses NaN to 0 while clamp passes NaN through: kept apart.
  assert.strictEqual(Color.clampUnit(NaN), 0);
  assert.ok(Number.isNaN(Color.clamp01(NaN)));
});

test("hsv/hsl/hex helpers match their donor files", () => {
  for (const [h, s, v] of [[0, 1, 1], [120, 0.5, 0.8], [359.9, 1, 1], [-30, 2, -1], [240, 0, 0.5]]) {
    assertSame(Color.hsvToRgb(h, s, v), looksHsvToRgbOrig(h, s, v), `hsv ${h},${s},${v}`);
  }
  for (const [h, s, l] of [[0, 0, 0.5], [0.3, 0.55, 0.6], [0.9, 1, 0.1]]) {
    assertSame(Color.hslToRgb(h, s, l), fractureHslToRgbOrig(h, s, l));
  }
  for (const hex of ["#ffffff", "#000000", "#7e8fb9", "ff0000", "not-a-color", "#12345", ""]) {
    assertSame(Color.hexToRgb(hex), windowsHexToRgbOrig(hex), `hex ${hex}`);
  }
  assertSame(Color.rgbToHex([1, 0, 0]), "#ff0000");
  // Round trip through hex stays within 8-bit rounding.
  for (const rgb of [[1, 1, 1], [0, 0, 0], [0.2, 0.4, 0.6]]) {
    const back = Color.hexToRgb(Color.rgbToHex(rgb));
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - rgb[i]) < 1 / 255 + 1e-12);
  }
});

test("01-hue variants match the graph-runtime originals", () => {
  function hsv01Orig(h, s, v) {
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }
  for (const [h, s, v] of [[0, 0, 0], [0.25, 0.5, 1], [0.999, 1, 1], [1.5, 0.3, 0.7]]) {
    assertSame(Color.hsvToRgb01(h, s, v), hsv01Orig(h, s, v));
  }
  // The degree and 01 variants agree on primary hues.
  assertSame(Color.hsvToRgb(0, 1, 1), Color.hsvToRgb01(0, 1, 1));
  assertSame(Color.hsvToRgb(120, 1, 1), Color.hsvToRgb01(1 / 3, 1, 1));
});

// ---- json ----

test("parseJsonSafe never throws and safeAssign drops dangerous keys", () => {
  assert.strictEqual(Json.parseJsonSafe("", "fb"), "fb");
  assert.strictEqual(Json.parseJsonSafe(null, "fb"), "fb");
  assert.strictEqual(Json.parseJsonSafe("{bad", "fb"), "fb");
  assertSame(Json.parseJsonSafe('{"a":1}'), { a: 1 });
  assert.strictEqual(Json.parseJsonSafe("null"), null);

  const out = Json.safeAssign({}, JSON.parse('{"layout":"videoeditor","__proto__":{"polluted":true}}'));
  assertSame(out, { layout: "videoeditor" });
  assert.strictEqual({}.polluted, undefined, "prototype must not be polluted");
  assertSame(
    Json.safeAssign({ a: 1 }, { b: 2 }, null, { constructor: 1, prototype: 1, c: 3 }),
    { a: 1, b: 2, c: 3 }
  );

  const cleaned = Json.parseJsonClean('{"a":{"__proto__":{"x":1},"b":2},"constructor":0}');
  assertSame(cleaned, { a: { b: 2 } });
});

test("settings readSettings stays equivalent under safeAssign", () => {
  const DEFAULTS = { layout: "clipmaker", theme: "panzoid" };
  function readOrig(storageText) {
    let parsed = null;
    try {
      parsed = JSON.parse(storageText || "null");
    } catch (_error) {
      parsed = null;
    }
    return Object.assign({}, DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
  }
  function readShared(storageText) {
    const parsed = Json.parseJsonSafe(storageText || "null", null);
    return Json.safeAssign({}, DEFAULTS, parsed && typeof parsed === "object" ? parsed : {});
  }
  for (const text of [null, "", "{bad", "null", "[]", '{"layout":"videoeditor"}', '{"theme":"gray","hue":12}']) {
    assertSame(readShared(text), readOrig(text), `storage ${String(text)}`);
  }
  // Malicious payloads no longer reach the prototype chain.
  readShared('{"__proto__":{"polluted":true}}');
  assert.strictEqual({}.polluted, undefined);
});

// ---- windows ----

test("escape helpers mirror the ui-kit close path", () => {
  assert.strictEqual(Windows.isEscapeKey({ key: "Escape" }), true);
  assert.strictEqual(Windows.isEscapeKey({ key: "Enter" }), false);
  assert.strictEqual(Windows.isEscapeKey(null), false);
  assert.strictEqual(Windows.shouldCloseOnEscape({ key: "Escape", defaultPrevented: false }), true);
  assert.strictEqual(Windows.shouldCloseOnEscape({ key: "Escape", defaultPrevented: true }), false);

  const added = [];
  const removed = [];
  const target = {
    addEventListener: (type, listener) => added.push([type, listener]),
    removeEventListener: (type, listener) => removed.push([type, listener]),
  };
  let calls = 0;
  const dispose = Windows.onEscape(target, () => { calls += 1; });
  assert.strictEqual(added.length, 1);
  added[0][1]({ key: "Escape", defaultPrevented: false });
  added[0][1]({ key: "Escape", defaultPrevented: true });
  added[0][1]({ key: "a", defaultPrevented: false });
  assert.strictEqual(calls, 1);
  dispose();
  assert.strictEqual(removed.length, 1);

  assert.strictEqual(Windows.GEOMETRY_KEY, "zoidium.ui.windows.v1");
  const store = {};
  const storage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
  };
  assertSame(Windows.readWindowGeometries(storage), {});
  Windows.writeWindowGeometry(storage, "vhs-setup-v2", { x: 10, y: 20 });
  assertSame(Windows.readWindowGeometries(storage), { "vhs-setup-v2": { x: 10, y: 20 } });
  assertSame(Windows.readWindowGeometries({ getItem: () => "{bad" }), {});
});

// ---- gl ----

test("gl helpers create, match, resize, and dispose render targets", () => {
  const seen = [];
  const fakeTHREE = {
    LinearFilter: "linear",
    NearestFilter: "nearest",
    RGBAFormat: "rgba",
    WebGLRenderTarget: function (width, height, options) {
      seen.push([width, height, options]);
      this.width = width;
      this.height = height;
      this.options = options;
      this.texture = {};
      this.disposed = false;
      this.setSize = (w, h) => { this.width = w; this.height = h; };
      this.dispose = () => { this.disposed = true; };
    },
  };
  const target = Gl.createRenderTarget(fakeTHREE, 320, 180, {
    minFilter: fakeTHREE.LinearFilter,
    magFilter: fakeTHREE.LinearFilter,
    format: fakeTHREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  assert.strictEqual(target.width, 320);
  assertSame(seen[0][2], {
    minFilter: "linear",
    magFilter: "linear",
    format: "rgba",
    depthBuffer: false,
    stencilBuffer: false,
  });
  assert.strictEqual(target.texture.generateMipmaps, false);
  // Unspecified entries pass through untouched (each site keeps its depth).
  const plain = Gl.createRenderTarget(fakeTHREE, 8, 8, { format: fakeTHREE.RGBAFormat });
  assertSame(seen[1][2], { format: "rgba" });

  assert.strictEqual(Gl.sameSize(target, 320, 180), true);
  assert.strictEqual(Gl.sameSize(target, 640, 360), false);
  assert.strictEqual(Gl.ensureSize(target, 320, 180), false);
  assert.strictEqual(Gl.ensureSize(target, 640, 360), true);
  assert.strictEqual(target.width, 640);

  const target2 = Gl.createRenderTarget(fakeTHREE, 8, 8, {});
  assertSame(seen[2][2], {});
  Gl.disposeAll({ a: target, b: target2, c: null });
  assert.strictEqual(target.disposed, true);
  assert.strictEqual(target2.disposed, true);
  assert.doesNotThrow(() => Gl.disposeTarget(null));
  assert.doesNotThrow(() => Gl.disposePass(null));

  // createCopyPass mirrors the motion-blur pass factory exactly.
  const passes = [];
  const copyTHREE = {
    CopyShader: { uniforms: { opacity: { value: 1 } }, vertexShader: "v", fragmentShader: "f" },
    UniformsUtils: { clone: (uniforms) => Object.assign({}, uniforms) },
    ShaderMaterial: function (options) { this.options = options; },
    ShaderPass: function (material) { passes.push(material); this.material = material; },
  };
  const pass = Gl.createCopyPass(copyTHREE);
  assertSame(pass.material.options, {
    uniforms: { opacity: { value: 1 } },
    vertexShader: "v",
    fragmentShader: "f",
    depthTest: false,
    depthWrite: false,
  });
});
