"use strict";
// CPU and GPU expansion (P1.9): expansion-aware raster and GPU cache.
//
// Covers: zero takes the exact old path on both CPU and GPU (byte-identical),
// both expansion signs, feather after expansion, invert, ordered combine,
// expansion in cache signatures and coverage scaling, CPU/GPU pixel agreement
// within a stated tolerance via the existing renderer fakes, and GPU
// fallback beyond the validated bound. No UI control: expansion stays a
// data field until the P1.7 integration wires the property view.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { rasterizeCoverage, fillPolygon } = require("../plugins/shape-plus/mask-raster.js");
const {
  scaleEvaluated, signatureOf, gpuCoverageData, isGpuExpansionSupported,
  createMaskGpu, MAX_GPU_EXPANSION, MAX_GPU_FEATHER,
} = require("../plugins/shape-plus/mask-gpu.js");
const { normalizeExpansion, MIN_EXPANSION, MAX_EXPANSION } = require("../plugins/shape-plus/mask-expansion.js");

// Stated CPU/GPU agreement bound for expanded masks. The hybrid GPU upload
// caches exact CPU bytes (same rasterizeCoverage the fallback uses), so the
// bound is 0 today; a future pure-GL SDF shader is expected to match within
// the feather-like couple of LSBs and gpuCoverageData is its oracle.
const GPU_TOLERANCE = 0;

const vertex = (x, y) => ({ point: [x, y], in: [0, 0], out: [0, 0] });
const rect = (x0, y0, x1, y1) => [vertex(x0, y0), vertex(x1, y0), vertex(x1, y1), vertex(x0, y1)];
const concave = () => [
  vertex(4, 4), vertex(20, 4), vertex(20, 10), vertex(14, 10),
  vertex(14, 14), vertex(20, 14), vertex(20, 20), vertex(4, 20),
];
const mask = (vertices, overrides = {}) => ({
  vertices, closed: true, mode: "add", feather: 0, opacity: 1, invert: 0, enabled: true, ...overrides,
});
const at = (data, width, x, y) => data[y * width + x];
function diffStats(a, b) {
  let max = 0, sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / a.length };
}

// Minimal renderer fakes in the style of the existing shape-plus suites.
// `withDataTexture` controls whether the hybrid expansion upload can
// succeed: without it renderCoverage must fall back (null) for any nonzero
// expansion, exactly like the production caller expects.
function fakeHost({ withDataTexture = false } = {}) {
  const draws = [];
  class Resource { constructor() { this.disposals = 0; } dispose() { this.disposals++; } }
  class Geometry extends Resource {
    constructor() { super(); this.attributes = {}; }
    addAttribute(name, attribute) { this.attributes[name] = attribute; }
  }
  class BufferAttribute { constructor(array, size) { this.array = array; this.itemSize = size; } }
  class Material extends Resource { constructor(spec) { super(); Object.assign(this, spec); this.uniforms = spec.uniforms || {}; } }
  class Scene extends Resource { constructor() { super(); this.children = []; } add(mesh) { this.children.push(mesh); } remove() {} }
  class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; this.frustumCulled = false; } }
  class Target extends Resource {
    constructor(width, height) { super(); this.width = width; this.height = height; this.texture = { kind: "rt", width, height }; }
  }
  class DataTexture extends Resource {
    constructor(data, width, height) {
      super();
      this.image = { data };
      this.width = width; this.height = height;
    }
  }
  class Camera extends Resource { constructor() { super(); this.left = 0; } updateProjectionMatrix() {} }
  class Vector2 { constructor(x, y) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; } }
  class Color {}
  const THREE = {
    Scene, Mesh, OrthographicCamera: Camera, ShaderMaterial: Material,
    BufferGeometry: Geometry, PlaneGeometry: Geometry, BufferAttribute,
    Color, Vector2, WebGLRenderTarget: Target,
    RGBAFormat: "rgba", UnsignedByteType: "ub", LinearFilter: "linear",
    ClampToEdgeWrapping: "clamp", DoubleSide: "double",
  };
  if (withDataTexture) THREE.DataTexture = DataTexture;
  const renderer = {
    autoClear: false,
    getClearColor: () => ({ clone: () => ({}) }),
    getClearAlpha: () => 1,
    setClearColor() {},
    clearTarget() {},
    render(scene, camera, target) { draws.push({ scene, camera, target }); },
  };
  return { THREE, renderer, draws };
}

test("zero expansion matches the old scanline path byte-for-byte", () => {
  for (const vertices of [rect(4, 4, 12, 12), concave()]) {
    const width = 24, height = 24;
    const explicit = rasterizeCoverage([mask(vertices, { expansion: 0 })], width, height).data;
    const missing = rasterizeCoverage([mask(vertices)], width, height).data;
    assert.deepEqual(Array.from(explicit), Array.from(missing));
    const expected = new Float32Array(width * height);
    const { flattenPath } = require("../plugins/shape-plus/path.js");
    const { closeContour } = require("../plugins/shape-plus/mask-raster.js");
    const flat = flattenPath({ vertices: closeContour(vertices, true), closed: true });
    fillPolygon(flat.points, width, height, expected);
    const expectedBytes = Array.from(expected, v => Math.round(v * 255));
    assert.deepEqual(Array.from(explicit), expectedBytes);
  }
});

test("zero expansion on the GPU takes the old triangulated path", () => {
  const host = fakeHost();
  const gpu = createMaskGpu(host.THREE);
  const evaluated = [mask(rect(4, 4, 12, 12))];
  const scaledZero = scaleEvaluated(evaluated, 1);
  const scaledMissing = scaleEvaluated([{ ...evaluated[0], expansion: undefined }], 1);
  assert.equal(scaledZero[0].expansion, 0);
  assert.equal(scaledMissing[0].expansion, 0);
  assert.equal(signatureOf(scaledZero, 16, 16), signatureOf(scaledMissing, 16, 16));
  const sig = signatureOf(scaledZero, 16, 16);
  const first = gpu.coverageTexture(host.renderer, scaledZero, 16, 16, sig);
  assert.ok(first, "zero expansion renders instead of falling back");
  assert.ok(host.draws.length > 0, "triangulation path records draws");
  const drawsAfterFirst = host.draws.length;
  const second = gpu.coverageTexture(host.renderer, scaledZero, 16, 16, sig);
  assert.equal(second, first, "same signature hits the cache");
  assert.equal(host.draws.length, drawsAfterFirst, "cache hit renders nothing");
  assert.equal(gpu.stats().cpuFallbacks, 0);
  gpu.disposeRenderer(host.renderer);
});

test("positive expansion grows coverage, negative shrinks it", () => {
  const width = 32, height = 32;
  const base = rasterizeCoverage([mask(rect(10, 10, 20, 20))], width, height).data;
  const grown = rasterizeCoverage([mask(rect(10, 10, 20, 20), { expansion: 3 })], width, height).data;
  const shrunk = rasterizeCoverage([mask(rect(10, 10, 20, 20), { expansion: -3 })], width, height).data;
  assert.equal(at(base, width, 22, 15), 0);
  assert.equal(at(grown, width, 22, 15), 255);
  assert.equal(at(base, width, 11, 15), 255);
  assert.equal(at(shrunk, width, 11, 15), 0);
  assert.equal(at(shrunk, width, 15, 15), 255);
  assert.equal(at(grown, width, 0, 0), 0);
});

test("expansion runs before feather and preserves the soft falloff", () => {
  const width = 64, height = 64;
  const plain = rasterizeCoverage([mask(rect(4, 4, 60, 60), { feather: 4 })], width, height).data;
  const grown = rasterizeCoverage([mask(rect(4, 4, 60, 60), { feather: 4, expansion: 4 })], width, height).data;
  assert.equal(at(grown, 64, 32, 32), 255);
  const row = (data, y) => Array.from({ length: 16 }, (_, k) => data[y * 64 + 32 + 2 * k]);
  for (const data of [plain, grown]) {
    const samples = row(data, 32);
    for (let i = 1; i < samples.length; i++) assert.ok(samples[i] <= samples[i - 1], `feather falloff stays monotonic ${samples}`);
  }
  assert.ok(at(grown, width, 62, 32) >= at(plain, width, 62, 32), "grown soft edge reaches further");
  assert.ok(grown.every(v => v >= 0 && v <= 255));
});

test("expansion composes with invert", () => {
  const width = 32, height = 32;
  const grown = rasterizeCoverage([mask(rect(10, 10, 20, 20), { expansion: 3 })], width, height).data;
  const grownInverted = rasterizeCoverage([mask(rect(10, 10, 20, 20), { expansion: 3, invert: 1 })], width, height).data;
  for (let i = 0; i < grown.length; i++) assert.equal(grownInverted[i], 255 - grown[i]);
  assert.equal(at(grownInverted, width, 22, 15), 0);
  assert.equal(at(grownInverted, width, 0, 0), 255);
});

test("ordered combine respects per-mask expansion", () => {
  const width = 32, height = 32;
  const big = mask(rect(0, 0, 32, 32));
  const grownHole = mask(rect(12, 12, 20, 20), { mode: "subtract", expansion: 4 });
  const { data } = rasterizeCoverage([big, grownHole], width, height);
  assert.equal(at(data, width, 16, 16), 0, "grown subtract removes the center");
  assert.equal(at(data, width, 2, 2), 255, "far field stays covered");
  assert.equal(at(data, width, 8, 16), 0, "growth eats into the ring");
  const intersected = rasterizeCoverage(
    [big, mask(rect(4, 4, 12, 12), { mode: "intersect", expansion: 4 })], width, height).data;
  assert.equal(at(intersected, width, 14, 8), 255, "grown intersect reaches further");
  assert.equal(at(intersected, width, 24, 24), 0, "intersect still clips the far field");
  const firstSubtract = rasterizeCoverage([grownHole], width, height).data;
  assert.ok(firstSubtract.every(v => v === 0), "a first subtract on empty stays empty");
});

test("CPU and GPU oracles agree within the stated tolerance", () => {
  const cases = [
    [mask(rect(10, 10, 20, 20), { expansion: 3 })],
    [mask(rect(10, 10, 20, 20), { expansion: -3 })],
    [mask(concave(), { expansion: 4, feather: 2 })],
    [mask(concave(), { expansion: -2, feather: 2, invert: 1 })],
    [mask(rect(0, 0, 32, 32)), mask(rect(12, 12, 20, 20), { mode: "subtract", expansion: 3 })],
    [mask(rect(0, 0, 32, 32), { opacity: 0.5 }), mask(rect(4, 4, 28, 28), { mode: "intersect", expansion: -2 })],
  ];
  for (const masks of cases) {
    const width = 32, height = 32;
    const scaled = scaleEvaluated(masks, 1);
    const cpu = rasterizeCoverage(scaled, width, height).data;
    const gpu = gpuCoverageData(scaled, width, height).data;
    const { max, mean } = diffStats(cpu, gpu);
    assert.ok(max <= GPU_TOLERANCE, `CPU/GPU agree within ${GPU_TOLERANCE} LSB (max ${max}, mean ${mean})`);
  }
});

test("expansion is part of the GPU cache signature and scale", () => {
  const base = scaleEvaluated([mask(rect(4, 4, 12, 12))], 1);
  const grown = scaleEvaluated([mask(rect(4, 4, 12, 12), { expansion: 3 })], 1);
  const shrunk = scaleEvaluated([mask(rect(4, 4, 12, 12), { expansion: -3 })], 1);
  assert.notEqual(signatureOf(grown, 16, 16), signatureOf(base, 16, 16));
  assert.notEqual(signatureOf(grown, 16, 16), signatureOf(shrunk, 16, 16));
  const half = scaleEvaluated([mask(rect(8, 8, 24, 24), { expansion: 4 })], 0.5);
  assert.equal(half[0].expansion, 2);
  assert.notEqual(signatureOf(half, 16, 16), signatureOf(grown, 16, 16));
  assert.equal(signatureOf(base, 16, 16), signatureOf(scaleEvaluated([mask(rect(4, 4, 12, 12))], 1), 16, 16));
  assert.ok(isGpuExpansionSupported(0));
  assert.ok(isGpuExpansionSupported(MAX_GPU_EXPANSION));
  assert.ok(isGpuExpansionSupported(-MAX_GPU_EXPANSION));
  assert.ok(!isGpuExpansionSupported(MAX_GPU_EXPANSION + 1));
  assert.throws(() => scaleEvaluated([mask(rect(0, 0, 4, 4), { expansion: 500 })], 1), /outside the supported range/);
  assert.throws(() => gpuCoverageData(scaleEvaluated([mask(rect(0, 0, 4, 4), { expansion: 100 })], 1), 16, 16), /outside the GPU range/);
  assert.ok(MAX_GPU_FEATHER >= MAX_GPU_EXPANSION, "expansion bound stays within the blur loop budget");
});

test("GPU falls back past its bound and without a DataTexture runtime", () => {
  const noTexture = fakeHost();
  const gpu = createMaskGpu(noTexture.THREE);
  const big = scaleEvaluated([mask(rect(0, 0, 16, 16), { expansion: MAX_GPU_EXPANSION + 1 })], 1);
  assert.equal(
    gpu.coverageTexture(noTexture.renderer, big, 16, 16, signatureOf(big, 16, 16)), null,
    "beyond the GPU bound the caller uses its CPU upload");
  const small = scaleEvaluated([mask(rect(4, 4, 12, 12), { expansion: 3 })], 1);
  assert.equal(
    gpu.coverageTexture(noTexture.renderer, small, 16, 16, signatureOf(small, 16, 16)), null,
    "without DataTexture the hybrid upload falls back to the caller CPU path (same pixels)");
  gpu.disposeRenderer(noTexture.renderer);
});

test("GPU hybrid upload caches exact CPU bytes when DataTexture exists", () => {
  const host = fakeHost({ withDataTexture: true });
  const gpu = createMaskGpu(host.THREE);
  const scaled = scaleEvaluated([mask(rect(4, 4, 12, 12), { expansion: 3 })], 1);
  const sig = signatureOf(scaled, 16, 16);
  const first = gpu.coverageTexture(host.renderer, scaled, 16, 16, sig);
  assert.ok(first, "supported expansion uploads instead of triangulating");
  assert.equal(first.image.data.length, 16 * 16 * 4);
  const cpu = rasterizeCoverage(scaled, 16, 16).data;
  for (let i = 0; i < cpu.length; i++) assert.equal(first.image.data[i * 4 + 3], cpu[i], `hybrid byte ${i} matches CPU`);
  const second = gpu.coverageTexture(host.renderer, scaled, 16, 16, sig);
  assert.equal(second, first, "hybrid result is cached by signature");
  assert.equal(gpu.stats().hits, 1);
  gpu.disposeRenderer(host.renderer);
});

test("invalid expansion rejects visibly on both paths", () => {
  assert.throws(() => normalizeExpansion(Number.NaN), /finite/);
  assert.throws(() => rasterizeCoverage([mask(rect(0, 0, 4, 4), { expansion: 500 })], 8, 8), /outside the supported range/);
  assert.throws(() => rasterizeCoverage([mask(rect(0, 0, 4, 4), { expansion: "4" })], 8, 8), /finite/);
  assert.ok(MIN_EXPANSION === -128 && MAX_EXPANSION === 128, "CPU range stays +/-128 per P1.8");
  assert.ok(MAX_GPU_EXPANSION === 64, "GPU bound stays +/-64 per this package");
});

test("expansion build timings stay in the interactive-edit budget", () => {
  const width = 256, height = 256;
  const shapes = {
    rect: rect(60, 60, 196, 196),
    concave: concave().map(v => ({ point: [v.point[0] * 8, v.point[1] * 8], in: [0, 0], out: [0, 0] })),
  };
  const timings = {};
  for (const [name, vertices] of Object.entries(shapes)) {
    for (const expansion of [0, 8, 32, 64]) {
      const masks = [mask(vertices, { expansion })];
      let start = Date.now();
      rasterizeCoverage(masks, width, height);
      const cpuMs = Date.now() - start;
      start = Date.now();
      gpuCoverageData(scaleEvaluated(masks, 1), width, height);
      const gpuMs = Date.now() - start;
      timings[`${name}/e${expansion}`] = { cpuMs, gpuMs };
    }
  }
  // eslint-disable-next-line no-console
  console.log("P1.9 timings (ms, 256x256): " + JSON.stringify(timings));
  for (const [key, { cpuMs, gpuMs }] of Object.entries(timings)) {
    assert.ok(cpuMs < 2000, `${key} CPU builds in budget (got ${cpuMs} ms)`);
    assert.ok(gpuMs < 2000, `${key} GPU oracle builds in budget (got ${gpuMs} ms)`);
  }
});
