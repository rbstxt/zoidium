"use strict";

// Bump Noise Scale coverage: values 1..64 keep the released generator and
// output byte for byte, values above 64 stay bounded in memory and build time
// and raise the visible frequency through the seamless tile repeat.

require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const NodeMaterial = require("../plugins/material-plus/node-material");
const createSurfaceShader = require("../plugins/material-plus/surface-shader.js");
const { harness } = require("./material-node-harness.js");

// Frozen copy of the released 1..64 generator. Keep it in sync with the
// shipped pzNoiseCanvas only for that range; it exists to lock the bytes.
function legacyNoiseBytes(size, cells, seed) {
  var value = seed | 0;
  function random() {
    value = (value + 0x6d2b79f5) | 0;
    var t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  var octaves = 3;
  var frequency = Math.max(2, Math.round(cells));
  var amplitude = 1;
  var total = 0;
  var values = new Float32Array(size * size);
  for (var o = 0; o < octaves; o++) {
    var lattice = new Float32Array((frequency + 1) * (frequency + 1));
    for (var i = 0; i < lattice.length; i++) lattice[i] = random();
    for (var y = 0; y < size; y++) {
      var gy = (y / size) * frequency;
      var y0 = Math.min(gy | 0, frequency - 1);
      var fy = gy - y0;
      var sy = fy * fy * (3 - 2 * fy);
      for (var x = 0; x < size; x++) {
        var gx = (x / size) * frequency;
        var x0 = Math.min(gx | 0, frequency - 1);
        var fx = gx - x0;
        var sx = fx * fx * (3 - 2 * fx);
        var i00 = x0 + y0 * (frequency + 1);
        var i10 = i00 + 1;
        var i01 = i00 + frequency + 1;
        var i11 = i01 + 1;
        var top = lattice[i00] + (lattice[i10] - lattice[i00]) * sx;
        var bottom = lattice[i01] + (lattice[i11] - lattice[i01]) * sx;
        values[x + y * size] += (top + (bottom - top) * sy) * amplitude;
      }
    }
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  var data = new Uint8ClampedArray(size * size * 4);
  for (var p = 0; p < size * size; p++) {
    var gray = Math.round((values[p] / total) * 255);
    var index = p * 4;
    data[index] = gray;
    data[index + 1] = gray;
    data[index + 2] = gray;
    data[index + 3] = 255;
  }
  return data;
}

async function prepare(scale) {
  const h = harness();
  NodeMaterial.activate(h.context);
  const material = h.material("nodes");
  (await h.PZ.material.fnList.nodes).call(material);
  material.load();
  material.properties.bumpNoise.set(1);
  material.properties.bumpNoiseScale.set(scale);
  return { h, material };
}

function bytesOf(material) {
  return Array.from(material.pzNoiseTexture.image.data);
}

test("Bump Noise Scale accepts typed values up to 1024", async () => {
  const { h, material } = await prepare(4);
  try {
    assert.equal(material.properties.bumpNoiseScale.max, 1024);
    assert.equal(material.properties.bumpNoiseScale.min, 1);
    assert.equal(material.properties.bumpNoiseScale.decimals, 0);
  } finally {
    material.unload();
    for (const dispose of h.dispose.reverse()) dispose();
  }
});

test("scales 1..64 keep the released noise bytes", async () => {
  for (const scale of [1, 2, 3, 4, 7, 9, 16, 23, 32, 47, 63, 64]) {
    const { h, material } = await prepare(scale);
    try {
      const expected = legacyNoiseBytes(256, scale, 7);
      const actual = bytesOf(material);
      assert.equal(actual.length, expected.length, "scale " + scale + " size");
      for (let i = 0; i < expected.length; i++) {
        if (actual[i] !== expected[i]) {
          assert.fail("scale " + scale + " differs at byte " + i + ": " + actual[i] + " != " + expected[i]);
        }
      }
      assert.equal(material.pzNoiseTile, 1, "scale " + scale + " does not tile");
      assert.equal(material.pzUniforms.uPzBumpNoiseTile.value, 1, "scale " + scale + " tile factor");
      assert.equal(material.threeObj.defines.PZ_BUMP_NOISE_TILE, 0, "scale " + scale + " keeps the original shader path");
    } finally {
      material.unload();
      for (const dispose of h.dispose.reverse()) dispose();
    }
  }
});

test("scales above 64 reuse one seamless 256 px tile at a higher repeat", async () => {
  const { h, material } = await prepare(64);
  const base = bytesOf(material);
  material.unload();
  for (const dispose of h.dispose.reverse()) dispose();

  for (const scale of [65, 128, 256, 512, 1024]) {
    const run = await prepare(scale);
    try {
      const image = run.material.pzNoiseTexture.image;
      assert.equal(image.width, 256, "scale " + scale + " keeps canvas width");
      assert.equal(image.height, 256, "scale " + scale + " keeps canvas height");
      assert.equal(run.material.pzNoiseTile, scale / 64, "scale " + scale + " tile factor");
      assert.ok(Math.abs(run.material.pzUniforms.uPzBumpNoiseTile.value - scale / 64) < 1e-9, "scale " + scale + " uniform");
      assert.equal(run.material.threeObj.defines.PZ_BUMP_NOISE_TILE, 1, "scale " + scale + " uses the tiled path");
      assert.equal(run.material.pzNoiseTexture.wrapS, run.h.context.window.THREE.RepeatWrapping);
      assert.equal(run.material.pzNoiseTexture.wrapT, run.h.context.window.THREE.RepeatWrapping);

      // The interior is unchanged from the released 64-cell image. Only the
      // last 4 px cell of each edge moves to close the seam.
      const tiled = bytesOf(run.material);
      let interiorChanges = 0;
      let edgeChanges = 0;
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const i = (y * 256 + x) * 4;
          if (tiled[i] === base[i]) continue;
          if (x >= 252 || y >= 252) edgeChanges++;
          else interiorChanges++;
        }
      }
      assert.equal(interiorChanges, 0, "scale " + scale + " keeps the interior noise");
      assert.ok(edgeChanges > 0, "scale " + scale + " closes the tile seam");
    } finally {
      run.material.unload();
      for (const dispose of run.h.dispose.reverse()) dispose();
    }
  }
});

test("the seamless tile wraps without a visible seam", async () => {
  const { h, material } = await prepare(128);
  try {
    const data = bytesOf(material);
    let largestInteriorStep = 0;
    let largestWrapStep = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 255; x++) {
        const a = data[(y * 256 + x) * 4];
        const b = data[(y * 256 + x + 1) * 4];
        largestInteriorStep = Math.max(largestInteriorStep, Math.abs(a - b));
      }
      largestWrapStep = Math.max(largestWrapStep,
        Math.abs(data[(y * 256 + 255) * 4] - data[y * 256 * 4]));
    }
    for (let x = 0; x < 256; x++) {
      for (let y = 0; y < 255; y++) {
        const a = data[(y * 256 + x) * 4];
        const b = data[((y + 1) * 256 + x) * 4];
        largestInteriorStep = Math.max(largestInteriorStep, Math.abs(a - b));
      }
      largestWrapStep = Math.max(largestWrapStep,
        Math.abs(data[(255 * 256 + x) * 4] - data[x * 4]));
    }
    assert.ok(largestWrapStep <= largestInteriorStep,
      "wrap step " + largestWrapStep + " stays within interior step " + largestInteriorStep);
  } finally {
    material.unload();
    for (const dispose of h.dispose.reverse()) dispose();
  }
});

test("high scales stay bounded in memory and build time", async () => {
  const small = await prepare(64);
  const smallStart = performance.now();
  for (let i = 0; i < 5; i++) small.material.updateBumpMap();
  const smallMs = (performance.now() - smallStart) / 5;
  small.material.unload();
  for (const dispose of small.h.dispose.reverse()) dispose();

  const large = await prepare(1024);
  try {
    const start = performance.now();
    for (let i = 0; i < 5; i++) large.material.updateBumpMap();
    const largeMs = (performance.now() - start) / 5;
    assert.equal(large.material.pzNoiseTexture.image.width, 256, "no larger canvas");
    assert.ok(largeMs < 500, "1024 rebuild averages " + largeMs.toFixed(1) + " ms");
    assert.ok(largeMs < smallMs * 4 + 10,
      "1024 rebuild " + largeMs.toFixed(1) + " ms stays close to 64 rebuild " + smallMs.toFixed(1) + " ms");
  } finally {
    large.material.unload();
    for (const dispose of large.h.dispose.reverse()) dispose();
  }
});

test("non-finite and oversized scales are guarded", async () => {
  const nan = await prepare(Number.NaN);
  try {
    assert.equal(nan.material.pzNoiseTexture.image.width, 256);
    assert.ok(Number.isFinite(nan.material.pzUniforms.uPzBumpNoiseTile.value));
    assert.equal(nan.material.pzNoiseTile, 1, "non-finite falls back to the untiled range");
  } finally {
    nan.material.unload();
    for (const dispose of nan.h.dispose.reverse()) dispose();
  }
  const huge = await prepare(4096);
  try {
    assert.equal(huge.material.pzNoiseTile, 16, "oversized scales clamp to the supported maximum");
    assert.equal(huge.material.pzNoiseTexture.image.width, 256);
  } finally {
    huge.material.unload();
    for (const dispose of huge.h.dispose.reverse()) dispose();
  }
});

test("the shader repeats the bump noise UV only on the tiled path", () => {
  const h = harness();
  const shader = createSurfaceShader(h.context.window.THREE, h.context.document);
  try {
    const chunk = shader.PZ_BUMP_PARS_FRAGMENT;
    assert.match(chunk, /uniform float uPzBumpNoiseTile;/);
    assert.match(chunk, /#if PZ_BUMP_NOISE_TILE\n\s*return vUv \* uPzBumpNoiseTile;/);
    assert.match(chunk, /#else\n\s*return vUv;/);
    assert.match(chunk, /#ifndef PZ_BUMP_NOISE_TILE\n#define PZ_BUMP_NOISE_TILE 0/);
    assert.ok(!/dHdxy_fwd[\s\S]*vUv \+ dSTdx/.test(chunk), "offset samples use the resolved UV");
  } finally {
    for (const dispose of h.dispose.reverse()) dispose();
  }
});
