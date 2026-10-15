"use strict";

// Shared random/hash modules reproduce every existing implementation
// bit-for-bit. Each test below compares the shared function against a verbatim
// copy of the original source over a grid of seeds (integer, fractional,
// negative, large), indices, and channels, and pins golden values so a later
// migration cannot silently change any render.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadShared() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "zoidium/shared/random.js"), "utf8"), sandbox, {
    filename: "random.js",
  });
  return sandbox.ZoidiumSharedRandom;
}

const R = loadShared();

// ---- Verbatim copies of the original implementations ----

function legacyHash01Orig(seed, index) {
  let h = (Math.imul(seed | 0, 374761393) + Math.imul(index | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function sceneSeededRandomOrig(seed, index, channel) {
  let value = (Math.trunc(seed) | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

const seedBitsOrig = new DataView(new ArrayBuffer(8));
function numberValueOrig(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function seedHashOrig(seed) {
  const numericSeed = numberValueOrig(seed, 1);
  if (Number.isInteger(numericSeed)) return Math.trunc(numericSeed) | 0;
  seedBitsOrig.setFloat64(0, numericSeed, true);
  let value =
    seedBitsOrig.getUint32(0, true) ^
    Math.imul(seedBitsOrig.getUint32(4, true), 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return value | 0;
}
function textSeededRandomOrig(seed, index, channel) {
  let value = seedHashOrig(seed) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function finiteOrOrig(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function effectorHash01Orig(seed, index, channel) {
  let value = (Math.trunc(finiteOrOrig(seed, 0)) | 0) ^ Math.imul((index | 0) + 1, 0x45d9f3b);
  value ^= Math.imul((channel | 0) + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function simHashOrig(seed, key, channel) {
  var h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(key | 0, 0x85ebca77) ^ Math.imul(channel | 0, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function plexusHash2Orig(x, y, seed) {
  var n = Math.sin(x * 127.1 + y * 311.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

function formSrandOrig(i) {
  var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function formHash3Orig(x, y, z, seed) {
  var n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

function vibrateHashNoiseOrig(index, seed) {
  const r = Math.sin((index + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return (r - Math.floor(r)) * 2 - 1;
}
function vibrateSampleNoiseOrig(x, seed, stepped) {
  const i = Math.floor(x);
  let a = x - i;
  if (stepped) a = Math.floor(a + 0.5);
  a = a * a * (3 - 2 * a);
  return vibrateHashNoiseOrig(i, seed) * (1 - a) + vibrateHashNoiseOrig(i + 1, seed) * a;
}

// ---- Grids ----

const SEEDS = [0, 1, 7, 42, 101, 202, -3, 9999, 100000, 1.1, 1.9, 0.5, -2.75, 2 ** 31 - 1, 2 ** 31];
const INDICES = [0, 1, 2, 5, 11, 40, 91, 100, 1000];
const CHANNELS = [0, 1, 2, 3, 7, 11, 30, 40];

test("legacyHash01 matches the datamosh/vhs setup hash bit-for-bit", () => {
  for (const seed of SEEDS) {
    for (const index of [...INDICES, 4, 6, 8, 9, 10, 27, 28, 29, 30, 31, 32]) {
      assert.strictEqual(R.legacyHash01(seed, index), legacyHash01Orig(seed, index), `seed=${seed} index=${index}`);
    }
  }
  assert.strictEqual(R.legacyHash01(7, 3), legacyHash01Orig(7, 3));
  assert.ok(R.legacyHash01(7, 3) >= 0 && R.legacyHash01(7, 3) < 1);
});

test("nextSeed advances by 7919 modulo 10000 like both setup windows", () => {
  assert.strictEqual(R.nextSeed(0), 7919);
  assert.strictEqual(R.nextSeed(42), 7961);
  assert.strictEqual(R.nextSeed(9999), 7918);
  assert.strictEqual(R.nextSeed("12"), 7931);
  assert.strictEqual(R.nextSeed(NaN), 7919);
});

test("sceneSeededRandom matches scene-plus bit-for-bit", () => {
  for (const seed of [0, 1, 5, 42, 100, 9999]) {
    for (const index of INDICES) {
      for (const channel of CHANNELS) {
        assert.strictEqual(
          R.sceneSeededRandom(seed, index, channel),
          sceneSeededRandomOrig(seed, index, channel),
          `seed=${seed} index=${index} channel=${channel}`
        );
      }
    }
  }
});

test("textSeedHash/textSeededRandom match text-plus bit-for-bit", () => {
  for (const seed of SEEDS) {
    assert.strictEqual(R.textSeedHash(seed), seedHashOrig(seed), `seedHash seed=${seed}`);
    for (const index of [0, 3, 11]) {
      for (const channel of [0, 1, 2, 11]) {
        assert.strictEqual(
          R.textSeededRandom(seed, index, channel),
          textSeededRandomOrig(seed, index, channel),
          `seed=${seed} index=${index} channel=${channel}`
        );
      }
    }
  }
  // Fractional seeds keep distinct identities (1.1 and 1.9 differ).
  assert.notStrictEqual(R.textSeedHash(1.1), R.textSeedHash(1.9));
});

test("effectorHash01 matches effector-core bit-for-bit", () => {
  for (const seed of [...SEEDS, NaN, Infinity, "7", null]) {
    for (const index of [0, 1, 24, 30, 40, 41, 42, 91]) {
      for (const channel of [0, 1, 2]) {
        assert.strictEqual(
          R.effectorHash01(seed, index, channel),
          effectorHash01Orig(seed, index, channel),
          `seed=${seed} index=${index} channel=${channel}`
        );
      }
    }
  }
  const unit = R.effectorHashUnitVector(3, 9, 5);
  assert.strictEqual(unit.length, 3);
  const length = Math.sqrt(unit[0] ** 2 + unit[1] ** 2 + unit[2] ** 2);
  assert.ok(Math.abs(length - 1) < 1e-12);
});

test("particularSimHash matches particular.js bit-for-bit", () => {
  for (const seed of [0, 101, 202, 9999]) {
    for (const key of [0, 1, 7, 12345]) {
      for (const channel of [1, 2, 3, 4, 11, 12, 13, 17, 19, 23, 29]) {
        assert.strictEqual(
          R.particularSimHash(seed, key, channel),
          simHashOrig(seed, key, channel),
          `seed=${seed} key=${key} channel=${channel}`
        );
      }
    }
  }
});

test("plexus/form/vibrate hashes match their originals bit-for-bit", () => {
  for (const seed of [0, 1, 42, 17.3, 13.37]) {
    for (const [x, y] of [[0, 0], [3, 5], [-2, 7], [10.5, -3.25]]) {
      assert.strictEqual(R.plexusHash2(x, y, seed), plexusHash2Orig(x, y, seed));
    }
    for (const i of [0, 1, 3.7, 11.1, 100.25]) {
      assert.strictEqual(R.formSrand(i), formSrandOrig(i));
    }
    for (const [x, y, z] of [[0, 0, 0], [1, 2, 3], [-1.5, 4.25, 0]]) {
      assert.strictEqual(R.formHash3(x, y, z, seed), formHash3Orig(x, y, z, seed));
    }
    for (const index of [0, 1, 5, -3]) {
      assert.strictEqual(R.vibrateHashNoise(index, seed), vibrateHashNoiseOrig(index, seed));
    }
    for (const x of [0, 0.25, 1.7, 3.25, -0.5]) {
      for (const stepped of [false, true]) {
        assert.strictEqual(R.vibrateSampleNoise(x, seed, stepped), vibrateSampleNoiseOrig(x, seed, stepped));
      }
    }
  }
  assert.strictEqual(R.plexusRand(3), Math.abs(Math.sin(3 * 12.9898) * 43758.5453) % 1);
});

test("noise aggregates match plexus/form originals", () => {
  function plexusSmoothOrig(x, y, seed) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var xf = x - xi;
    var yf = y - yi;
    var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    var c00 = plexusHash2Orig(xi, yi, seed);
    var c10 = plexusHash2Orig(xi + 1, yi, seed);
    var c01 = plexusHash2Orig(xi, yi + 1, seed);
    var c11 = plexusHash2Orig(xi + 1, yi + 1, seed);
    var a = c00 + (c10 - c00) * u;
    var b = c01 + (c11 - c01) * u;
    return (a + (b - a) * v) * 2 - 1;
  }
  for (const [x, y] of [[0.3, 0.7], [2.5, -1.25], [10, 10]]) {
    for (const seed of [0, 5, 17.3]) {
      assert.strictEqual(R.plexusSmoothNoise2(x, y, seed), plexusSmoothOrig(x, y, seed));
      assert.strictEqual(R.plexusFbm2(x, y, seed), (() => {
        var sum = 0, amp = 1, freq = 1, norm = 0;
        for (var o = 0; o < 3; o++) {
          sum += plexusSmoothOrig(x * freq, y * freq, seed + o * 17.3) * amp;
          norm += amp;
          amp *= 0.45;
          freq *= 2;
        }
        return norm > 0 ? sum / norm : 0;
      })());
    }
  }
  function formSmoothOrig(x, y, z, seed) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    function lerp(a, b, t) { return a + (b - a) * t; }
    return lerp(
      lerp(lerp(formHash3Orig(xi, yi, zi, seed), formHash3Orig(xi + 1, yi, zi, seed), u),
        lerp(formHash3Orig(xi, yi + 1, zi, seed), formHash3Orig(xi + 1, yi + 1, zi, seed), u), v),
      lerp(lerp(formHash3Orig(xi, yi, zi + 1, seed), formHash3Orig(xi + 1, yi, zi + 1, seed), u),
        lerp(formHash3Orig(xi, yi + 1, zi + 1, seed), formHash3Orig(xi + 1, yi + 1, zi + 1, seed), u), v), w) * 2 - 1;
  }
  for (const [x, y, z] of [[0.3, 0.7, 0.1], [2.5, -1.25, 3]]) {
    assert.strictEqual(R.formSmoothNoise(x, y, z, 4), formSmoothOrig(x, y, z, 4));
  }
});

test("GLSL_RAND matches the chunk embedded in form.js and particular.js", () => {
  const expected =
    "float rand(vec2 n) { return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453); }";
  assert.strictEqual(R.GLSL_RAND, expected);
  for (const relative of ["plugins/trapcode-suite/form.js", "plugins/trapcode-suite/particular.js"]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.ok(source.includes(expected), `${relative} still embeds the shared chunk`);
  }
});
