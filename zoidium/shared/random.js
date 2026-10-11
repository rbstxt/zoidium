// Zoidium shared seeded random and hash helpers.
//
// Deterministic 0-1 hashes of (seed, index, channel): the same inputs always
// give the same value, so renders never depend on Math.random, the clock,
// playback direction, or earlier frames. Each variant below reproduces one
// existing implementation bit-for-bit; variants are kept under separate names
// because their integer math differs. Load order: before zoidium/plugin-apis.js
// (see postInitScripts in zoidium/runtime-config.js). plugin-apis.js exposes
// this table as ZoidiumPluginApis.random.
(function (global) {
  "use strict";

  // Datamosh and VHS setup windows share this exact (seed, index) hash; both
  // sources are character-identical. A stored seed reproduces the same
  // randomizer result on every machine.
  function legacyHash01(seed, index) {
    var h = (Math.imul(seed | 0, 374761393) + Math.imul(index | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Seed advance shared by the Datamosh and VHS setup windows: one click
  // stores the next seed, so bursts stay reproducible and undoable.
  function nextSeed(seed) {
    return ((Math.round(Number(seed)) || 0) + 7919) % 10000;
  }

  // Scene+ seeded random over integer seeds (plugins/scene-plus/scene-plus.js).
  function sceneSeededRandom(seed, index, channel) {
    var value = (Math.trunc(seed) | 0) ^ Math.imul(index + 1, 0x45d9f3b);
    value ^= Math.imul(channel + 1, 0x27d4eb2d);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
  }

  // Text+ seed folding (plugins/text-plus/text-plus.js). Integer seeds keep
  // their truncated identity; fractional seeds fold every float64 bit into the
  // state so animated values such as 1.1 and 1.9 never share random output.
  var seedBits = typeof DataView !== "undefined" ? new DataView(new ArrayBuffer(8)) : null;

  function textSeedHash(seed) {
    var numericSeed = typeof seed === "number" && Number.isFinite(seed) ? seed : 1;
    if (Number.isInteger(numericSeed)) return Math.trunc(numericSeed) | 0;
    if (!seedBits) return Math.trunc(numericSeed) | 0;
    seedBits.setFloat64(0, numericSeed, true);
    var value = seedBits.getUint32(0, true) ^
      Math.imul(seedBits.getUint32(4, true), 0x9e3779b9);
    value ^= value >>> 16;
    value = Math.imul(value, 0x45d9f3b);
    value ^= value >>> 16;
    return value | 0;
  }

  function textSeededRandom(seed, index, channel) {
    var value = textSeedHash(seed) ^ Math.imul(index + 1, 0x45d9f3b);
    value ^= Math.imul(channel + 1, 0x27d4eb2d);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
  }

  // Effector core hash (plugins/scene-plus/effector-core.js). Non-finite seeds
  // collapse to zero before the integer mix.
  function effectorFiniteOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function effectorHash01(seed, index, channel) {
    var value = (Math.trunc(effectorFiniteOr(seed, 0)) | 0) ^ Math.imul((index | 0) + 1, 0x45d9f3b);
    value ^= Math.imul((channel | 0) + 1, 0x27d4eb2d);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
  }

  function effectorHashUnitVector(seed, index, channel) {
    var x = 2 * effectorHash01(seed, index, channel) - 1;
    var y = 2 * effectorHash01(seed, index, channel + 1) - 1;
    var z = 2 * effectorHash01(seed, index, channel + 2) - 1;
    var length = Math.sqrt(x * x + y * y + z * z);
    if (!(length > 1e-9)) return [0, 0, 1];
    return [x / length, y / length, z / length];
  }

  // Particular simulation hash (plugins/trapcode-suite/particular.js): integer
  // hash of (seed, event key, channel) for per-particle random values.
  function particularSimHash(seed, key, channel) {
    var h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(key | 0, 0x85ebca77) ^ Math.imul(channel | 0, 0xc2b2ae3d);
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // Plexus spatial hash and value noise (plugins/trapcode-suite/plexus.js).
  function plexusRand(seed) {
    return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  }

  function plexusHash2(x, y, seed) {
    var n = Math.sin(x * 127.1 + y * 311.7 + seed * 13.37) * 43758.5453;
    return n - Math.floor(n);
  }

  function plexusSmoothNoise2(x, y, seed) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var xf = x - xi;
    var yf = y - yi;
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var c00 = plexusHash2(xi, yi, seed);
    var c10 = plexusHash2(xi + 1, yi, seed);
    var c01 = plexusHash2(xi, yi + 1, seed);
    var c11 = plexusHash2(xi + 1, yi + 1, seed);
    var a = c00 + (c10 - c00) * u;
    var b = c01 + (c11 - c01) * u;
    return (a + (b - a) * v) * 2 - 1;
  }

  function plexusFbm2(x, y, seed) {
    var sum = 0;
    var amp = 1;
    var freq = 1;
    var norm = 0;
    for (var o = 0; o < 3; o++) {
      sum += plexusSmoothNoise2(x * freq, y * freq, seed + o * 17.3) * amp;
      norm += amp;
      amp *= 0.45;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }

  // Form string-network hash and 3D value noise
  // (plugins/trapcode-suite/form.js).
  function formSrand(i) {
    var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return v - Math.floor(v);
  }

  function formHash3(x, y, z, seed) {
    var n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37) * 43758.5453;
    return n - Math.floor(n);
  }

  function formLerp(a, b, t) {
    return a + (b - a) * t;
  }

  function formSmoothNoise(x, y, z, seed) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var zi = Math.floor(z);
    var xf = x - xi;
    var yf = y - yi;
    var zf = z - zi;
    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);
    var w = zf * zf * (3 - 2 * zf);
    var c000 = formHash3(xi, yi, zi, seed);
    var c100 = formHash3(xi + 1, yi, zi, seed);
    var c010 = formHash3(xi, yi + 1, zi, seed);
    var c110 = formHash3(xi + 1, yi + 1, zi, seed);
    var c001 = formHash3(xi, yi, zi + 1, seed);
    var c101 = formHash3(xi + 1, yi, zi + 1, seed);
    var c011 = formHash3(xi, yi + 1, zi + 1, seed);
    var c111 = formHash3(xi + 1, yi + 1, zi + 1, seed);
    var x00 = formLerp(c000, c100, u);
    var x10 = formLerp(c010, c110, u);
    var x01 = formLerp(c001, c101, u);
    var x11 = formLerp(c011, c111, u);
    var y0 = formLerp(x00, x10, v);
    var y1 = formLerp(x01, x11, v);
    return formLerp(y0, y1, w) * 2 - 1;
  }

  // Camera+ vibrate noise (plugins/camera-plus/vibrate.js): a sine hash in
  // [-1, 1] with smooth or stepped value-noise interpolation over time.
  function vibrateHashNoise(index, seed) {
    var r = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return (r - Math.floor(r)) * 2 - 1;
  }

  function vibrateSampleNoise(x, seed, stepped) {
    var i = Math.floor(x);
    var a = x - i;
    if (stepped) a = Math.floor(a + 0.5);
    a = a * a * (3 - 2 * a);
    return vibrateHashNoise(i, seed) * (1 - a) + vibrateHashNoise(i + 1, seed) * a;
  }

  // The matching GLSL hash chunk, shared verbatim by the Form and Particular
  // point shaders: per-id brightness, jitter, and size variation.
  var GLSL_RAND = "float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }";

  global.ZoidiumSharedRandom = {
    legacyHash01: legacyHash01,
    nextSeed: nextSeed,
    sceneSeededRandom: sceneSeededRandom,
    textSeedHash: textSeedHash,
    textSeededRandom: textSeededRandom,
    effectorHash01: effectorHash01,
    effectorHashUnitVector: effectorHashUnitVector,
    particularSimHash: particularSimHash,
    plexusRand: plexusRand,
    plexusHash2: plexusHash2,
    plexusSmoothNoise2: plexusSmoothNoise2,
    plexusFbm2: plexusFbm2,
    formSrand: formSrand,
    formHash3: formHash3,
    formSmoothNoise: formSmoothNoise,
    vibrateHashNoise: vibrateHashNoise,
    vibrateSampleNoise: vibrateSampleNoise,
    GLSL_RAND: GLSL_RAND,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
