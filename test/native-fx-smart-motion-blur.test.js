"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const math = require("../plugins/native-fx/smart-motion-blur/math.js");

test("Smart Motion Blur has stable serialized properties and native identity", () => {
  assert.equal(math.ID, "smartmotionblur");
  const props = math.properties({ NUMBER: 42, OPTION: 43 });
  assert.deepEqual(Object.keys(props), ["amount", "sensitivity", "smoothness", "maxDisplacement", "analysis", "quality", "view"]);
  assert.deepEqual(Object.values(props).map(p => p.value), [0.5, 70, 50, 256, 0, 0, 0]);
  assert.ok(Object.values(props).every(p => p.dynamic));
  assert.equal(props.analysis.items, "Both;Previous;Next");
  assert.equal(props.quality.items, "Balanced;High");
  assert.equal(props.view.items, "Result;Motion Vectors;Confidence");
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../plugins/native-fx/manifest.json")));
  assert.equal(manifest.nativeEffects.find(e => e.id === math.ID).name, math.DISPLAY_NAME);
});

test("shutter taps use project frames, centered midpoint quadrature and a single shutter span", () => {
  assert.deepEqual(math.offsets(0), [-1, 1]);
  assert.deepEqual(math.offsets(1), [-1]);
  assert.deepEqual(math.offsets(2), [1]);
  for (const amount of [0, 0.25, 0.5, 1]) {
    const times = math.shutterTimes(amount, 32);
    assert.ok(times.every(t => Math.abs(t) <= amount / 2));
    assert.equal(times[0], -times.at(-1));
    assert.ok(Math.abs(times.reduce((a, b) => a + b, 0)) < 1e-12);
    assert.ok(Math.abs(times.at(-1) - times[0] + amount / 32 - amount) < 1e-12);
  }
});

test("adaptive sampling uses displacement, shutter and quality with fixed bounds", () => {
  assert.equal(math.sampleCount(0.5, 64, 0), 16);
  assert.equal(math.sampleCount(1, 256, 0), 32);
  assert.equal(math.sampleCount(1, 256, 1), 64);
  assert.equal(math.sampleCount(0.25, 1, 1), 8);
});

test("fixed point fields preserve exact zero and signed extremes", () => {
  assert.deepEqual(math.pack([0, 0]), [128, 0, 128, 0]);
  assert.deepEqual(math.unpack(math.pack([0, 0])), [0, 0]);
  for (let x = -256; x <= 256; x += 0.137) {
    const vector = [x, -x];
    const decoded = math.unpack(math.pack(vector));
    assert.ok(decoded.every((v, i) => Math.abs(v - vector[i]) <= 256 / 65534 + 1e-12));
  }
  assert.deepEqual(math.unpack(math.pack([-256, 256])), [-256, 256]);
});

test("duplicate boundary taps never create fictitious directions", () => {
  assert.deepEqual(math.neighbors([{ frame: 0 }, { frame: 1 }], 0), { previous: null, next: { frame: 1 } });
  assert.deepEqual(math.neighbors([{ frame: 9 }, { frame: 10 - 1e-9 }], 10), { previous: { frame: 9 }, next: null });
  assert.deepEqual(math.neighbors([{ frame: 7 }, { frame: 7 }], 7), { previous: null, next: null });
  assert.deepEqual(math.neighbors([{ frame: 50 }, { frame: 52 }], 51), { previous: { frame: 50 }, next: { frame: 52 } });
});

test("preview and export distances scale independently on both axes", () => {
  for (const processing of [[1920, 1080], [960, 540], [480, 270], [240, 135], [1000, 563]]) {
    const ratio = math.scale(processing, [1920, 1080]);
    const v = [128, -32];
    const output = math.toProject(math.toProcessing(v, ratio), ratio);
    assert.ok(output.every((n, i) => Math.abs(n - v[i]) < 1e-12));
  }
  assert.equal(math.pyramidSizes(1920, 1080).length, 6);
  assert.deepEqual(math.pyramidSizes(1, 1), [[1, 1]]);
});
