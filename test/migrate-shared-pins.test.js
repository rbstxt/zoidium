"use strict";

// Migration pin tests (round 9): every helper migrated to a shared module is
// compared against a VERBATIM copy of the old local implementation over a
// grid of inputs. These tests run against the shared tables directly, so they
// pass before the migration (proving the twins identical) and keep passing
// after the local bodies become one-line delegates.
//
// Two known, intentional deltas are pinned separately at the bottom:
// - cloneJson no longer throws on unserializable input (round-8 hardening);
// - textSeedHash normalizes non-number seeds with a typeof check while the
//   old copy coerced with Number() (production seeds are always numbers:
//   every call boundary coerces with numberValue first).

const assert = require("node:assert/strict");
const test = require("node:test");

const { loadSharedTables } = require("./shared-test-apis.js");
const tables = loadSharedTables();
const sharedRandom = tables.random;
const sharedProps = tables.props;
const sharedColor = tables.color;
const sharedGl = tables.gl;

/* ---------------- verbatim old copies ---------------- */

// plugins/scene-plus/scene-values.js
function oldSceneSeededRandom(seed, index, channel) {
  let value = (Math.trunc(seed) | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function oldSceneCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

// plugins/scene-plus/effector-core.js (TINY = 1e-9 there)
function oldFiniteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function oldClampUnit(value) {
  if (!(value > 0)) return 0;
  return value < 1 ? value : 1;
}

function oldHash01(seed, index, channel) {
  let value = (Math.trunc(oldFiniteOr(seed, 0)) | 0) ^ Math.imul((index | 0) + 1, 0x45d9f3b);
  value ^= Math.imul((channel | 0) + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function oldHashUnitVector(seed, index, channel) {
  const x = 2 * oldHash01(seed, index, channel) - 1;
  const y = 2 * oldHash01(seed, index, channel + 1) - 1;
  const z = 2 * oldHash01(seed, index, channel + 2) - 1;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (!(length > 1e-9)) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

// plugins/text-plus/text-plus-utils.js
function oldNumberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

const oldSeedBits = new DataView(new ArrayBuffer(8));

function oldSeedHash(seed) {
  const numericSeed = oldNumberValue(seed, 1);
  if (Number.isInteger(numericSeed)) return Math.trunc(numericSeed) | 0;
  oldSeedBits.setFloat64(0, numericSeed, true);
  let value =
    oldSeedBits.getUint32(0, true) ^
    Math.imul(oldSeedBits.getUint32(4, true), 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return value | 0;
}

function oldTextSeededRandom(seed, index, channel) {
  let value = oldSeedHash(seed) ^ Math.imul(index + 1, 0x45d9f3b);
  value ^= Math.imul(channel + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

// plugins/trapcode-suite/particular-sim.js
function oldSimHash(seed, key, channel) {
  var h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(key | 0, 0x85ebca77) ^ Math.imul(channel | 0, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// plugins/trapcode-suite/plexus.js
function oldPlexusRand(seed) {
  return Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
}

function oldPlexusHash2(x, y, seed) {
  var n = Math.sin(x * 127.1 + y * 311.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

function oldPlexusSmoothNoise2(x, y, seed) {
  var xi = Math.floor(x);
  var yi = Math.floor(y);
  var xf = x - xi;
  var yf = y - yi;
  var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  var v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  var c00 = oldPlexusHash2(xi, yi, seed);
  var c10 = oldPlexusHash2(xi + 1, yi, seed);
  var c01 = oldPlexusHash2(xi, yi + 1, seed);
  var c11 = oldPlexusHash2(xi + 1, yi + 1, seed);
  var a = c00 + (c10 - c00) * u;
  var b = c01 + (c11 - c01) * u;
  return (a + (b - a) * v) * 2 - 1;
}

function oldPlexusFbm2(x, y, seed) {
  var sum = 0;
  var amp = 1;
  var freq = 1;
  var norm = 0;
  for (var o = 0; o < 3; o++) {
    sum += oldPlexusSmoothNoise2(x * freq, y * freq, seed + o * 17.3) * amp;
    norm += amp;
    amp *= 0.45;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

// plugins/trapcode-suite/form-fields.js
function oldFormSrand(i) {
  var v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// plugins/trapcode-suite/form-grid.js
function oldFormHash3(x, y, z, seed) {
  var n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37) * 43758.5453;
  return n - Math.floor(n);
}

function oldFormSmoothNoise(x, y, z, seed) {
  var xi = Math.floor(x);
  var yi = Math.floor(y);
  var zi = Math.floor(z);
  var xf = x - xi;
  var yf = y - yi;
  var zf = z - zi;
  var u = xf * xf * (3 - 2 * xf);
  var v = yf * yf * (3 - 2 * yf);
  var w = zf * zf * (3 - 2 * zf);
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  var c000 = oldFormHash3(xi, yi, zi, seed);
  var c100 = oldFormHash3(xi + 1, yi, zi, seed);
  var c010 = oldFormHash3(xi, yi + 1, zi, seed);
  var c110 = oldFormHash3(xi + 1, yi + 1, zi, seed);
  var c001 = oldFormHash3(xi, yi, zi + 1, seed);
  var c101 = oldFormHash3(xi + 1, yi, zi + 1, seed);
  var c011 = oldFormHash3(xi, yi + 1, zi + 1, seed);
  var c111 = oldFormHash3(xi + 1, yi + 1, zi + 1, seed);
  var x00 = lerp(c000, c100, u);
  var x10 = lerp(c010, c110, u);
  var x01 = lerp(c001, c101, u);
  var x11 = lerp(c011, c111, u);
  var y0 = lerp(x00, x10, v);
  var y1 = lerp(x01, x11, v);
  return lerp(y0, y1, w) * 2 - 1;
}

// plugins/magic-looks/looks-color.js
function oldLooksClamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function oldLooksLerp(a, b, t) {
  return a + (b - a) * t;
}

function oldLooksHsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = oldLooksClamp(s, 0, 1);
  v = oldLooksClamp(v, 0, 1);
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

function oldLooksRgbToHsv(r, g, b) {
  var mx = Math.max(r, g, b);
  var mn = Math.min(r, g, b);
  var d = mx - mn;
  var h = 0;
  if (d > 1e-9) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h: h, s: mx === 0 ? 0 : d / mx, v: mx };
}

// plugins/material-plus/graph-buffers.js (hue in [0, 1]: the *01 variants)
function oldBuffersRgbToHsv(r, g, b) {
  var max = Math.max(r, g, b);
  var min = Math.min(r, g, b);
  var delta = max - min;
  var h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  var s = max === 0 ? 0 : delta / max;
  return [h, s, max];
}

function oldBuffersHsvToRgb(h, s, v) {
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

// plugins/scene-plus/effector-fracture.js
function oldHueToRgb(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function oldHslToRgb(hue, saturation, lightness) {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    oldHueToRgb(p, q, hue + 1 / 3),
    oldHueToRgb(p, q, hue),
    oldHueToRgb(p, q, hue - 1 / 3),
  ];
}

/* ---------------- grids ---------------- */

// Values returned from the shared vm sandbox carry the sandbox realm's
// prototypes, so deepStrictEqual against test-realm literals fails on
// prototype identity (see canon() in test/shared-helpers.test.js). local()
// re-roots a value in this realm structurally, preserving -0 (which a JSON
// round-trip would lose).
function local(value) {
  // Note: value.map() would keep the sandbox realm via Array species, so
  // build the copy explicitly in this realm.
  if (Array.isArray(value)) {
    const out = [];
    for (let index = 0; index < value.length; index += 1) out.push(local(value[index]));
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = local(value[key]);
    return out;
  }
  return value;
}

function assertSameArray(actual, expected, message) {
  assert.deepStrictEqual(local(actual), expected, message);
}

function assertSameValue(actual, expected, message) {
  assert.deepStrictEqual(local(actual), local(expected), message);
}

const SEEDS = [-3, -1, -0.5, 0, 1, 2, 7, 42, 1000, 2147483647, 1.1, 1.9, 2.25, -2.75];
const SMALL_SEEDS = [0, 1, 2, 42, 9999];
const INDICES = [0, 1, 2, 5, 11, 40, 41, 42, 91, 100];
const CHANNELS = [0, 1, 2, 3, 6, 10, 21, 24, 30, 31];

/* ---------------- random ---------------- */

test("sceneSeededRandom matches the old scene-plus copy", () => {
  for (const seed of SEEDS) {
    for (const index of INDICES) {
      for (const channel of CHANNELS) {
        assert.equal(
          sharedRandom.sceneSeededRandom(seed, index, channel),
          oldSceneSeededRandom(seed, index, channel),
          `seed=${seed} index=${index} channel=${channel}`,
        );
      }
    }
  }
});

test("effectorHash01 matches the old effector-core copy", () => {
  const seeds = [...SEEDS, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "7", [3]];
  for (const seed of seeds) {
    for (const index of [...INDICES, -2, 1.5]) {
      for (const channel of CHANNELS) {
        assert.equal(
          sharedRandom.effectorHash01(seed, index, channel),
          oldHash01(seed, index, channel),
          `seed=${String(seed)} index=${index} channel=${channel}`,
        );
      }
    }
  }
});

test("effectorHashUnitVector matches the old effector-core copy", () => {
  for (const seed of SEEDS) {
    for (const index of [0, 1, 5, 40]) {
      for (const channel of [0, 10, 21, 31]) {
        assertSameArray(
          sharedRandom.effectorHashUnitVector(seed, index, channel),
          oldHashUnitVector(seed, index, channel),
          `seed=${seed} index=${index} channel=${channel}`,
        );
      }
    }
  }
});

test("textSeedHash/textSeededRandom match the old text-plus copies on numbers", () => {
  const seeds = [...SEEDS, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -0, 1e21];
  for (const seed of seeds) {
    assert.equal(sharedRandom.textSeedHash(seed), oldSeedHash(seed), `seedHash(${String(seed)})`);
    for (const index of INDICES) {
      for (const channel of CHANNELS) {
        assert.equal(
          sharedRandom.textSeededRandom(seed, index, channel),
          oldTextSeededRandom(seed, index, channel),
          `seed=${String(seed)} index=${index} channel=${channel}`,
        );
      }
    }
  }
});

test("particularSimHash matches the old particular-sim copy", () => {
  for (const seed of SMALL_SEEDS) {
    for (const key of [0, 1, 17, 1000, 65536]) {
      for (const channel of [0, 1, 2, 7]) {
        assert.equal(
          sharedRandom.particularSimHash(seed, key, channel),
          oldSimHash(seed, key, channel),
          `seed=${seed} key=${key} channel=${channel}`,
        );
      }
    }
  }
});

test("plexus rand/hash2/noise2/fbm2 match the old plexus copies", () => {
  for (const seed of [...SMALL_SEEDS, 0.5, 17.3]) {
    assert.equal(sharedRandom.plexusRand(seed), oldPlexusRand(seed), `rand(${seed})`);
  }
  const coords = [-2, -1, -0.5, 0, 0.25, 1, 3.7, 64];
  for (const x of coords) {
    for (const y of coords) {
      for (const seed of SMALL_SEEDS) {
        assert.equal(
          sharedRandom.plexusHash2(x, y, seed),
          oldPlexusHash2(x, y, seed),
          `hash2(${x},${y},${seed})`,
        );
        assert.equal(
          sharedRandom.plexusSmoothNoise2(x, y, seed),
          oldPlexusSmoothNoise2(x, y, seed),
          `noise2(${x},${y},${seed})`,
        );
        assert.equal(
          sharedRandom.plexusFbm2(x, y, seed),
          oldPlexusFbm2(x, y, seed),
          `fbm2(${x},${y},${seed})`,
        );
      }
    }
  }
});

test("form srand/hash3/noise match the old form copies", () => {
  for (const i of [-3, 0, 1, 3.7, 11.1, 100, 7919]) {
    assert.equal(sharedRandom.formSrand(i), oldFormSrand(i), `srand(${i})`);
  }
  const coords = [-1, 0, 0.5, 1, 2.5, 32];
  for (const x of coords) {
    for (const y of coords) {
      for (const z of coords) {
        for (const seed of SMALL_SEEDS) {
          assert.equal(
            sharedRandom.formHash3(x, y, z, seed),
            oldFormHash3(x, y, z, seed),
            `hash3(${x},${y},${z},${seed})`,
          );
          assert.equal(
            sharedRandom.formSmoothNoise(x, y, z, seed),
            oldFormSmoothNoise(x, y, z, seed),
            `noise(${x},${y},${z},${seed})`,
          );
        }
      }
    }
  }
});

/* ---------------- props ---------------- */

test("props.finiteOr matches the old effector-core copy", () => {
  const values = [0, 1, -2.5, "3", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, [1], true];
  for (const value of values) {
    for (const fallback of [0, 1, 100]) {
      assert.equal(sharedProps.finiteOr(value, fallback), oldFiniteOr(value, fallback));
    }
  }
});

test("color.clampUnit matches the old effector-core copy", () => {
  for (const value of [-2, -0.5, -0, 0, 0.25, 0.99, 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(sharedColor.clampUnit(value), oldClampUnit(value), `clampUnit(${String(value)})`);
  }
});

test("props.cloneJson matches the old round-trip copy on JSON-safe input", () => {
  const values = [
    null,
    0,
    "text",
    [1, 2, { deep: [true, null, "x"] }],
    { type: "zoidium:test", schemaVersion: 3, properties: { seed: 7, tags: ["a", "b"] }, objects: [] },
  ];
  for (const value of values) {
    assertSameValue(sharedProps.cloneJson(value), oldSceneCloneJson(value));
  }
  // Clones are detached, like the old copy.
  const source = { nested: { list: [1] } };
  const cloned = sharedProps.cloneJson(source);
  assertSameValue(cloned, source);
  assert.notEqual(cloned, source);
  assert.notEqual(cloned.nested, source.nested);
});

/* ---------------- color ---------------- */

test("color clamp/lerp/hsv/rgb match the old magic-looks copies", () => {
  for (const v of [-1, 0, 0.5, 1, 2]) {
    assert.equal(sharedColor.clamp(v, 0, 1), oldLooksClamp(v, 0, 1));
    assert.equal(sharedColor.lerp(1, 5, v), oldLooksLerp(1, 5, v));
  }
  for (const h of [-30, 0, 30, 59.9, 60, 90, 180, 270, 359.9, 360, 720]) {
    for (const s of [0, 0.5, 1]) {
      for (const v of [0, 0.5, 1]) {
        assertSameArray(sharedColor.hsvToRgb(h, s, v), oldLooksHsvToRgb(h, s, v), `hsv(${h},${s},${v})`);
      }
    }
  }
  for (const r of [0, 0.25, 1, 2]) {
    for (const g of [0, 0.5, 1]) {
      for (const b of [0, 0.75, 1]) {
        assertSameValue(sharedColor.rgbToHsv(r, g, b), oldLooksRgbToHsv(r, g, b), `rgb(${r},${g},${b})`);
      }
    }
  }
});

test("color *01 variants match the old material-plus graph-buffers copies", () => {
  const channels = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5, -0.25];
  for (const r of channels) {
    for (const g of channels) {
      for (const b of channels) {
        assertSameArray(
          sharedColor.rgbToHsv01(r, g, b),
          oldBuffersRgbToHsv(r, g, b),
          `rgb01(${r},${g},${b})`,
        );
      }
    }
  }
  for (const h of [0, 0.125, 0.25, 0.5, 0.75, 1, 1.25, -0.5]) {
    for (const s of [0, 0.5, 1]) {
      for (const v of [0, 0.5, 1]) {
        assertSameArray(
          sharedColor.hsvToRgb01(h, s, v),
          oldBuffersHsvToRgb(h, s, v),
          `hsv01(${h},${s},${v})`,
        );
      }
    }
  }
});

test("color.hslToRgb matches the old effector-fracture copy", () => {
  for (const h of [0, 0.25, 0.5, 0.75, 1, 1.5, -0.25]) {
    for (const s of [0, 0.2, 0.65, 1]) {
      for (const l of [0, 0.3, 0.55, 1]) {
        assertSameArray(sharedColor.hslToRgb(h, s, l), oldHslToRgb(h, s, l), `hsl(${h},${s},${l})`);
      }
    }
  }
});

/* ---------------- gl ---------------- */

function stubTHREE() {
  function WebGLRenderTarget(width, height, options) {
    this.width = width;
    this.height = height;
    Object.assign(this, options);
    this.texture = { generateMipmaps: true };
  }
  WebGLRenderTarget.prototype.setSize = function (width, height) {
    this.width = width;
    this.height = height;
  };
  WebGLRenderTarget.prototype.dispose = function () {
    this.disposed = true;
  };
  return {
    WebGLRenderTarget,
    LinearFilter: "linear",
    NearestFilter: "nearest",
    RGBAFormat: "rgba",
    UnsignedByteType: "ubyte",
  };
}

function targetShape(target) {
  return {
    width: target.width,
    height: target.height,
    minFilter: target.minFilter,
    magFilter: target.magFilter,
    format: target.format,
    type: target.type,
    depthBuffer: target.depthBuffer,
    stencilBuffer: target.stencilBuffer,
    generateMipmaps: target.texture.generateMipmaps,
  };
}

// The inline pattern used by echo-legacy/ascii/tracery/vhs-pass and the
// temporal sampler / layer-input pool (linear RGBA, no depth/stencil).
function oldLinearTarget(THREE, width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

// The inline pattern used by datamosh block targets (nearest RGBA).
function oldNearestTarget(THREE, width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

// The inline pattern used by jpegdamage (nearest RGBA + explicit byte type).
function oldJpegTarget(THREE, width, height) {
  const target = new THREE.WebGLRenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  target.texture.generateMipmaps = false;
  return target;
}

test("gl.createRenderTarget reproduces every inline target shape", () => {
  const THREE = stubTHREE();
  assert.deepEqual(
    targetShape(sharedGl.createRenderTarget(THREE, 64, 32, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    })),
    targetShape(oldLinearTarget(THREE, 64, 32)),
  );
  assert.deepEqual(
    targetShape(sharedGl.createRenderTarget(THREE, 1, 1, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    })),
    targetShape(oldNearestTarget(THREE, 1, 1)),
  );
  assert.deepEqual(
    targetShape(sharedGl.createRenderTarget(THREE, 320, 200, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    })),
    targetShape(oldJpegTarget(THREE, 320, 200)),
  );
});

test("gl.ensureSize matches the inline resize branches", () => {
  const THREE = stubTHREE();
  const target = oldLinearTarget(THREE, 64, 32);
  assert.equal(sharedGl.ensureSize(target, 64, 32), false);
  assert.equal(target.width, 64);
  assert.equal(sharedGl.ensureSize(target, 128, 64), true);
  assert.equal(target.width, 128);
  assert.equal(target.height, 64);
  assert.equal(sharedGl.ensureSize(null, 8, 8), false);
});

/* ---------------- documented deltas ---------------- */

test("cloneJson hardening delta: shared never throws (round-8 semantics)", () => {
  assert.throws(() => oldSceneCloneJson(undefined));
  assert.equal(sharedProps.cloneJson(undefined), undefined);
  const circular = {};
  circular.self = circular;
  assert.throws(() => oldSceneCloneJson(circular));
  assert.equal(sharedProps.cloneJson(circular), circular);
});

test("textSeedHash delta: shared normalizes non-number seeds without coercion", () => {
  // Reachable production seeds are always finite numbers (every call
  // boundary coerces with numberValue first); the numeric grid above pins
  // those. Only non-numbers differ, and they never occur in renders.
  assert.equal(oldSeedHash("3"), oldSeedHash(3));
  assert.equal(sharedRandom.textSeedHash("3"), sharedRandom.textSeedHash(1));
  assert.equal(oldSeedHash(null), oldSeedHash(0));
  assert.equal(sharedRandom.textSeedHash(null), sharedRandom.textSeedHash(1));
});
