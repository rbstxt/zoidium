"use strict";

// fx-gen native effects (Radio Waves, Beam, Numbers, Timecode): the shared
// deterministic math matches the EffectCraft reference formulas, and every
// effect source loads and updates against stubbed hosts.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const M = require("../plugins/native-fx/effects/fxgen-math.js");

function loadEffectSpec(file) {
  let spec = null;
  const sandbox = {
    PZ: {
      property: {
        type: { NUMBER: 0, TEXT: 7, OPTION: 10, VECTOR2: 5, COLOR: 4 },
      },
    },
    THREE: {
      Vector2: class { constructor(x, y) { this.x = x; this.y = y; } set(x, y) { this.x = x; this.y = y; } },
      Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      Vector4: class { constructor(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } },
      DataTexture: class { constructor(data, w, h) { this.image = { data }; this.width = w; this.height = h; this.needsUpdate = false; } dispose() {} },
      RGBAFormat: 1,
      UnsignedByteType: 1,
      LinearFilter: 1,
      ClampToEdgeWrapping: 1,
    },
    ZoidiumPluginApis: {
      defineFilter(value) { spec = value; },
      modules: {
        createRequire() {
          return () => M;
        },
      },
    },
  };
  sandbox._zoidiumGetAsset = () => null;
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/effects", file), "utf8");
  new vm.Script(source, { filename: file }).runInContext(sandbox);
  return spec;
}

function stubProp(value) {
  return { get: () => value };
}

function fakeEffect(spec, overrides) {
  const properties = {};
  for (const [id, def] of Object.entries(spec.properties)) {
    if (def && def.group && Array.isArray(def.objects)) {
      const first = def.objects.map((o) => o.value);
      properties[id] = stubProp(first.length >= 2 ? [first[0], first[1]] : [0.5, 0.5]);
    } else if (def) {
      properties[id] = stubProp(def.value);
    }
  }
  Object.assign(properties, overrides || {});
  return {
    properties,
    parentProject: { sequence: { properties: { rate: stubProp(30) } } },
    parentLayer: { properties: { resolution: stubProp([320, 240]) } },
    pass: null,
  };
}

// ---------------------------------------------------------------- hash

test("hashNoise matches the Rust reference values", () => {
  assert.ok(Math.abs(M.hashNoise(0, 17, 1) - 0.8092586) < 1e-7);
  assert.ok(Math.abs(M.hashNoise(5, 17, 1) - 0.41799814) < 1e-7);
  assert.ok(Math.abs(M.hashNoise(90, 17, 3) - 0.7729937) < 1e-7);
});

// ---------------------------------------------------------------- radio waves

function waveOpts(extra) {
  return {
    time: 1.5, freq: 1, lifespan: 2, producerX: 0.5, producerY: 0.5,
    bufW: 640, bufH: 480, expansion: 100, orientationDeg: 0, directionDeg: 90,
    velocity: 0, spinDeg: 0, reflection: false, startWidth: 5, endWidth: 5,
    fadeIn: 0, fadeOut: 0, color: [1, 1, 1, 1], opacity: 1, sides: 64,
    star: false, starDepth: -0.3, maxWaves: 24, ...extra,
  };
}

test("radio waves are born at k/freq with radius expansion*age", () => {
  const waves = M.radioWaves(waveOpts({}));
  assert.equal(waves.length, 2);
  assert.equal(waves[0].radius, 150);
  assert.equal(waves[1].radius, 50);
  assert.equal(waves[0].cx, 320);
  assert.equal(waves[0].cy, 240);
});

test("radio waves respect lifespan, fade envelopes and width lerp", () => {
  const waves = M.radioWaves(waveOpts({ time: 5, fadeIn: 1, fadeOut: 1, startWidth: 2, endWidth: 10 }));
  for (const wv of waves) {
    assert.ok(wv.fade >= 0 && wv.fade <= 1);
    assert.ok(wv.halfWidth >= 1 && wv.halfWidth <= 5);
  }
  const young = M.radioWaves(waveOpts({ time: 0.05, fadeIn: 1 }));
  assert.equal(young.length, 1);
  assert.ok(young[0].fade < 0.1, "fade-in ramps from zero");
  const dying = M.radioWaves(waveOpts({ time: 3.9, freq: 0.5, lifespan: 4, fadeOut: 1 }));
  assert.ok(dying.length > 0 && dying[0].fade < 0.2, "fade-out ramps to zero");
});

test("radio waves drift with velocity/direction, spin, and reflect", () => {
  const still = M.radioWaves(waveOpts({ time: 1, freq: 1 }));
  const moved = M.radioWaves(waveOpts({ time: 1, freq: 1, velocity: 100, directionDeg: 90 }));
  assert.ok(Math.abs(moved[0].cx - still[0].cx - 100) < 1e-9);
  const spun = M.radioWaves(waveOpts({ time: 1, freq: 1, orientationDeg: 10, spinDeg: 90 }));
  assert.ok(Math.abs(spun[0].rotation - ((10 + 90) * Math.PI) / 180) < 1e-9);
  const bounced = M.radioWaves(waveOpts({
    time: 2, freq: 1, producerX: 0.99, producerY: 0.5, velocity: 1000,
    directionDeg: 90, reflection: true,
  }));
  for (const wv of bounced) {
    assert.ok(wv.cx >= 0 && wv.cx <= 640, "reflected centre stays in the layer");
    assert.ok(wv.cy >= 0 && wv.cy <= 480, "reflected centre stays in the layer");
  }
});

test("radio waves cap the live set and flag circles/stars", () => {
  const many = M.radioWaves(waveOpts({ time: 10, freq: 10, lifespan: 10, maxWaves: 24 }));
  assert.equal(many.length, 24);
  assert.equal(many[0].sides, 0, "64 sides without star is a circle");
  const poly = M.radioWaves(waveOpts({ sides: 5 }));
  assert.equal(poly[0].sides, 5);
  assert.equal(poly[0].starK, 0);
  const star = M.radioWaves(waveOpts({ sides: 5, star: true, starDepth: -0.3 }));
  assert.ok(Math.abs(star[0].starK - 0.7) < 1e-12);
});

// ---------------------------------------------------------------- beam

test("polygon SDF is exact on vertices, edges and centre", () => {
  // Square, R = 100, rot 0: vertices at top/right/bottom/left.
  assert.ok(Math.abs(M.polySD(0, -100, 100, 4, 0, 0)) < 1e-9, "top vertex is on the outline");
  assert.ok(Math.abs(M.polySD(100, 0, 100, 4, 0, 0)) < 1e-9, "right vertex is on the outline");
  // Edge midpoint at the apothem.
  const apothem = 100 * Math.cos(Math.PI / 4);
  const mid = (apothem / Math.SQRT2);
  assert.ok(Math.abs(M.polySD(mid, -mid, 100, 4, 0, 0)) < 1e-9, "edge midpoint is on the outline");
  assert.ok(M.polySD(0, 0, 100, 4, 0, 0) < -50, "centre is deep inside");
  assert.ok(M.polySD(0, -140, 100, 4, 0, 0) > 30, "outside point is positive");
  // Pentagon symmetry: rotating the query by one sector matches rotation.
  const a = M.polySD(60, -40, 90, 5, 0, 0);
  const sector = (2 * Math.PI) / 5;
  const c = Math.cos(sector);
  const s = Math.sin(sector);
  const b = M.polySD(60 * c - -40 * s, 60 * s + -40 * c, 90, 5, 0, 0);
  assert.ok(Math.abs(a - b) < 1e-9, "pentagon has 5-fold symmetry");
  // Star: outer vertex on the outline, bay inside near the inner vertex.
  assert.ok(Math.abs(M.polySD(0, -80, 80, 5, 0.7, 0)) < 1e-9, "star tip is on the outline");
  assert.ok(M.polySD(0, 0, 80, 5, 0.7, 0) < 0, "star centre is inside");
});

test("beam window follows length/time", () => {
  assert.deepEqual(M.beamWindow(25, 0), { len: 0.25, t0: 0, t1: 0.25 });
  assert.deepEqual(M.beamWindow(50, 100), { len: 0.5, t0: 0.5, t1: 1 });
  assert.deepEqual(M.beamWindow(0, 50), { len: 0, t0: 0.5, t1: 0.5 });
});

test("beam covers the segment core and nothing far away", () => {
  const beam = { startX: 0, startY: 50, endX: 200, endY: 50, t0: 0, t1: 1, startThick: 8, endThick: 8, soft: 0.2, len: 1, persp: true };
  const core = M.beamPixel(100, 49, beam);
  assert.ok(core.cover > 0.9, "beam core is covered");
  assert.ok(core.edge01 < 0.5, "beam core edge factor is low");
  const far = M.beamPixel(100, 100, beam);
  assert.equal(far.cover, 0);
  const empty = M.beamPixel(100, 49, { ...beam, len: 0 });
  assert.equal(empty.cover, 0, "zero length draws nothing");
});

// ---------------------------------------------------------------- numbers / timecode strings

function numText(extra) {
  return M.numbersText({
    type: 0, value: 0, decimalPlaces: 2, randomValues: false,
    currentTime: false, seed: 1, timeSec: 0, fps: 30, ...extra,
  });
}

test("numbers formats every type", () => {
  assert.equal(numText({ value: 42.5 }), "42.50");
  assert.equal(numText({ type: 1, value: 42.5 }), "00042.50");
  assert.equal(numText({ type: 1, value: -3.2, decimalPlaces: 1 }), "-00003.2");
  assert.equal(numText({ type: 2, currentTime: true, timeSec: 65.5 }), "00:01:05:15");
  assert.equal(numText({ type: 3, currentTime: true, timeSec: 65.5 }), "00:01:05:12");
  assert.equal(numText({ type: 4, currentTime: true, timeSec: 65.5 }), "00:01:05:12");
  assert.equal(numText({ type: 5, currentTime: true, timeSec: 3661 }), "01:01:01");
  assert.equal(numText({ type: 6, value: 0, decimalPlaces: 0 }), "01/01/00");
  assert.equal(numText({ type: 7, value: 0, decimalPlaces: 0 }), "Jan 1, 2000");
  assert.equal(numText({ type: 8, value: 0, decimalPlaces: 0 }), "Saturday, January 1, 2000");
  assert.equal(numText({ type: 9, value: 255, decimalPlaces: 0 }), "FF");
  assert.equal(numText({ type: 9, value: -255, decimalPlaces: 0 }), "-FF");
});

test("numbers random values are deterministic per frame", () => {
  const a = numText({ randomValues: true, value: 100, timeSec: 3, seed: 7 });
  const b = numText({ randomValues: true, value: 100, timeSec: 3 + 1 / 60, seed: 7 });
  const c = numText({ randomValues: true, value: 100, timeSec: 4, seed: 7 });
  assert.equal(a, b, "same frame gives the same value");
  assert.notEqual(a, c, "different frames differ ( overwhelmingly likely )");
  const v = Number(a);
  assert.ok(v >= 0 && v < 100, "random value is within [0, max)");
});

test("numbers random values match the hashed frame", () => {
  const expected = (M.hashNoise(90, 17, 3) * 10).toFixed(2);
  assert.equal(numText({ randomValues: true, value: 10, timeSec: 3, seed: 3 }), expected);
});

function tcText(extra) {
  return M.timecodeText({
    displayFormat: 0, timeSource: 0, timeUnits: 30, dropFrame: false,
    startingFrame: 0, timeSec: 0, fps: 30, ...extra,
  });
}

test("timecode formats SMPTE, frames and feet at several fps", () => {
  assert.equal(tcText({ timeSec: 3661.5 }), "01:01:01:15");
  assert.equal(tcText({ timeSec: 3661.5, fps: 25 }), "01:01:01:12");
  assert.equal(tcText({ timeSec: 10, fps: 24 }), "00:00:10:00");
  assert.equal(tcText({ displayFormat: 1, timeSec: 4 }), "120");
  assert.equal(tcText({ displayFormat: 2, timeSource: 2, timeSec: 1 }), "1+14");
  assert.equal(tcText({ displayFormat: 3, timeSource: 2, timeSec: 2 }), "1+20");
  assert.equal(tcText({ timeSource: 2, timeUnits: 25, startingFrame: 10, timeSec: 4 }), "00:00:04:10");
  assert.equal(tcText({ displayFormat: 0, dropFrame: true, timeSec: 0 }), "00;00;00;00");
  assert.equal(tcText({ displayFormat: 0, dropFrame: true, timeSec: 1800 / 30 }), "00;01;00;02");
});

// ---------------------------------------------------------------- glyph atlas + raster

test("every timecode/numbers character has glyph strokes", () => {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz:;+-.,/ ";
  for (const ch of chars) {
    if (ch === " ") {
      assert.deepEqual(M.glyphStrokes(ch), []);
      continue;
    }
    assert.ok(M.glyphStrokes(ch).length > 0, `glyph for ${ch}`);
  }
});

test("glyph raster covers the stroke core", () => {
  const segs = [{ a: [10, 10], b: [10, 10], r: 2, v: 1 }];
  const cov = M.rasterSegs(32, 32, segs, 2);
  assert.ok(cov[10 * 32 + 10] > 0.99, "dot centre is covered");
  assert.equal(cov[0], 0, "far pixel is empty");
  const polys = M.layoutLine("8", 4, 12, 24, 0, true);
  assert.ok(polys.length > 0);
  const text = M.textCoverage(120, 40, polys, M.textWeight(24), 0);
  let sum = 0;
  for (const v of text.fill) sum += v;
  assert.ok(sum > 10, "glyph 8 rasterises ink");
  assert.equal(text.ring, null, "no ring without stroke width");
  const stroked = M.textCoverage(120, 40, polys, M.textWeight(24), 3);
  assert.ok(stroked.ring instanceof Float32Array, "stroke ring is rasterised");
});

// ---------------------------------------------------------------- effect wiring

function fakeVec4Array(n) {
  return Array.from({ length: n }, () => ({
    x: 0, y: 0, z: 0, w: 0,
    set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; },
  }));
}

test("radio waves effect fills the wave tables for the frame", () => {
  const spec = loadEffectSpec("radiowaves.js");
  assert.equal(spec.displayName, "Radio Waves");
  const effect = fakeEffect(spec);
  effect.pass = {
    enabled: true,
    uniforms: {
      resolution: { value: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } } },
      uWavesA: { value: fakeVec4Array(24) },
      uWavesB: { value: fakeVec4Array(24) },
      uWavesC: { value: fakeVec4Array(24) },
      uWavesD: { value: fakeVec4Array(24) },
      uWaveCount: { value: 0 },
      uProfile: { value: 0 },
      uComposite: { value: 1 },
    },
  };
  spec.update.call(effect, 45);
  assert.equal(effect.pass.uniforms.uWaveCount.value, 2, "freq 1, lifespan 2 at t=1.5s");
  const first = effect.pass.uniforms.uWavesA.value[0];
  assert.ok(Math.abs(first.z - 150) < 1e-6, "oldest wave radius is expansion*age");
});

test("beam effect writes the length/time window", () => {
  const spec = loadEffectSpec("beam.js");
  assert.equal(spec.displayName, "Beam");
  const effect = fakeEffect(spec, { length: stubProp(50), time: stubProp(100) });
  const window = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  effect.pass = {
    enabled: true,
    uniforms: {
      uStart: { value: { set() {} } },
      uEnd: { value: { set() {} } },
      uWindow: { value: window },
      uThick: { value: { set() {} } },
      uSoft: { value: 0 },
      uInside: { value: { set() {} } },
      uOutside: { value: { set() {} } },
      uPersp: { value: 0 },
      uComposite: { value: 0 },
    },
  };
  spec.update.call(effect, 0);
  assert.deepEqual([window.x, window.y, window.z], [0.5, 1, 0.5]);
});

test("numbers and timecode effects rebuild the text layer", () => {
  for (const file of ["numbers.js", "timecode.js"]) {
    const spec = loadEffectSpec(file);
    const effect = fakeEffect(spec);
    const uniforms = {
      resolution: { value: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } } },
      uText: { value: null },
      uFill: { value: { set() {} } },
      uStroke: { value: { set() {} } },
      uDisplay: { value: 0 },
      uComposite: { value: 0 },
      uBoxRect: { value: { set() {} } },
      uBoxColor: { value: { set() {} } },
      uBoxOn: { value: 0 },
    };
    effect.pass = { enabled: true, uniforms };
    spec.onLoad.call(effect, effect);
    assert.ok(effect._fxgenLayer, `${file} creates the text layer`);
    spec.update.call(effect, 60);
    assert.ok(uniforms.uText.value, `${file} uploads coverage`);
    const bytes = uniforms.uText.value.image.data;
    let ink = 0;
    for (let i = 0; i < bytes.length; i += 4) ink += bytes[i];
    assert.ok(ink > 0, `${file} rasterises visible glyphs`);
    const firstKey = effect._fxgenLayer.key;
    spec.update.call(effect, 60);
    assert.equal(effect._fxgenLayer.key, firstKey, "same frame reuses the layer");
    spec.onUnload.call(effect, effect);
    assert.equal(effect._fxgenLayer, null, "unload releases the layer");
  }
});

test("numbers layer png bytes match the analytic coverage", () => {
  const spec = loadEffectSpec("numbers.js");
  const effect = fakeEffect(spec, { value: stubProp(8), decimalPlaces: stubProp(0) });
  const uniforms = {
    resolution: { value: { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } } },
    uText: { value: null },
    uFill: { value: { set() {} } },
    uStroke: { value: { set() {} } },
    uDisplay: { value: 0 },
    uComposite: { value: 0 },
    uBoxRect: { value: { set() {} } },
    uBoxColor: { value: { set() {} } },
    uBoxOn: { value: 0 },
  };
  effect.pass = { enabled: true, uniforms };
  spec.onLoad.call(effect, effect);
  spec.update.call(effect, 0);
  assert.match(effect._fxgenLayer.key, /^8\|/, "the layer key starts with the drawn string");
});


test("disabled text effects skip all layout reads and rebuild current text on enable", () => {
  for (const file of ["numbers.js", "timecode.js"]) {
    const spec = loadEffectSpec(file), effect = fakeEffect(spec);
    effect.pass = { enabled: true, uniforms: spec.uniforms };
    spec.onLoad(effect);
    let uploads = 0;
    const ensure = effect._fxgenLayer.ensure;
    effect._fxgenLayer.ensure = function () { uploads++; return ensure.apply(this, arguments); };
    spec.update.call(effect, 0);
    const key = effect._fxgenLayer.key;
    const prop = file === "numbers.js" ? "value" : "startingFrame";
    effect.properties[prop] = stubProp(1234);
    effect.properties.enabled = stubProp(0);
    let reads = 0;
    for (const [name, property] of Object.entries(effect.properties)) {
      if (name === "enabled") continue;
      const get = property.get;
      property.get = () => { reads++; return get(); };
    }
    for (let frame = 0; frame < 60; frame++) spec.update.call(effect, frame);
    assert.equal(reads, 0, file);
    assert.equal(uploads, 1);
    assert.equal(effect.pass.enabled, false);
    assert.equal(effect._fxgenLayer.key, key, "disabled frames leave the cache untouched");
    effect.properties.enabled = stubProp(1);
    spec.update.call(effect, 60);
    assert.equal(effect.pass.enabled, true);
    assert.notEqual(effect._fxgenLayer.key, key);
    assert.equal(uploads, 2, "enabling uploads coverage for the current properties");
    spec.onUnload(effect);
  }
});
