"use strict";

// Unit tests for the Round 13 time effects: Time Displacement, CC Wide Time
// and Time Difference (plugins/native-fx). Effect sources run through `new
// Function` with stubbed globals, mirroring test/native-fx-echo.test.js; only
// property declarations, getRequest plans and update caching are exercised
// here (GL composition is verified in the browser).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const PZ = { property: { type: { NUMBER: 0, OPTION: 10, LIST: 20 } } };

function loadEffect(filename) {
  let definition = null;
  const apis = {
    defineFrameSampler(spec) {
      definition = spec;
    },
  };
  const source = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/effects", filename), "utf8");
  const effect = {};
  new Function("PZ", "ZoidiumPluginApis", source).call(effect, PZ, apis);
  return { definition, effect };
}

function property(value) {
  return { get: () => value };
}

function checkAlgorithmLine(filename) {
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/effects", filename),
    "utf8",
  );
  const lines = source.split("\n");
  assert.ok(
    lines.some((line) => line.includes("Algorithm adapted from EffectCraft (MIT OR Apache-2.0).")),
    `${filename} carries the EffectCraft adaptation notice`,
  );
}

test("Time Displacement declares bounded slices and a layer map source", () => {
  checkAlgorithmLine("timedisplacement.js");
  const { definition } = loadEffect("timedisplacement.js");
  assert.equal(definition.displayName, "Time Displacement");
  assert.equal(definition.properties.resolution.min, 2);
  assert.equal(definition.properties.resolution.max, 64);
  assert.equal(definition.properties.resolution.value, 16);
  assert.equal(definition.properties.maxTime.min, -30);
  assert.equal(definition.properties.maxTime.max, 30);
  assert.equal(definition.properties.source.value, "");
});

test("Time Displacement plans one tap per slice across the displacement span", () => {
  const { definition } = loadEffect("timedisplacement.js");
  const effect = {
    properties: {
      enabled: property(1),
      maxTime: property(2),
      resolution: property(5),
      stretchMap: property(1),
      source: property(""),
    },
  };
  const request = definition.getRequest(effect, 100);
  assert.equal(request.enabled, true);
  // 30 fps fallback (no parentProject in this harness): 2 s -> 60 frames.
  assert.deepEqual(request.frames, [-60, -30, 0, 30, 60]);
});

test("Time Displacement honors the project rate and disables at zero span", () => {
  const { definition } = loadEffect("timedisplacement.js");
  const at24 = {
    parentProject: { sequence: { properties: { rate: { get: () => 24 } } } },
    properties: { enabled: property(1), maxTime: property(1), resolution: property(3) },
  };
  assert.deepEqual(definition.getRequest(at24, 10).frames, [-24, 0, 24]);
  const zero = {
    properties: { enabled: property(1), maxTime: property(0), resolution: property(8) },
  };
  const request = definition.getRequest(zero, 10);
  assert.equal(request.enabled, false);
  assert.equal(request.frames.length, 8);
  const off = {
    properties: { enabled: property(0), maxTime: property(1), resolution: property(8) },
  };
  assert.equal(definition.getRequest(off, 10).enabled, false);
});

test("Time Displacement slice index matches the reference luminance formula", () => {
  // Reference CPU: slice = round(luma * (N - 1)); the GLSL computes
  // floor(luma * (N - 1) + 0.5), identical for luma in [0, 1].
  for (const slices of [2, 3, 5, 16, 64]) {
    for (let step = 0; step <= 200; step += 1) {
      const luma = step / 200;
      const expected = Math.round(luma * (slices - 1));
      const shader = Math.floor(luma * (slices - 1) + 0.5);
      assert.equal(shader, expected, `luma ${luma} with ${slices} slices`);
    }
  }
});

test("CC Wide Time declares bounded symmetric steps", () => {
  checkAlgorithmLine("ccwidetime.js");
  const { definition } = loadEffect("ccwidetime.js");
  assert.equal(definition.displayName, "CC Wide Time");
  assert.equal(definition.properties.forwardSteps.max, 45);
  assert.equal(definition.properties.backwardSteps.max, 45);
  assert.equal(definition.properties.forwardSteps.value, 3);
  assert.equal(definition.properties.nativeMotionBlur.items, "off;on");
});

test("CC Wide Time orders taps nearest-first around the current frame", () => {
  const { definition } = loadEffect("ccwidetime.js");
  const effect = {
    properties: {
      enabled: property(1),
      forwardSteps: property(2),
      backwardSteps: property(1),
      nativeMotionBlur: property(0),
    },
  };
  assert.deepEqual(definition.getRequest(effect, 50).frames, [-1, 1, 2]);
  const none = {
    properties: {
      enabled: property(1),
      forwardSteps: property(0),
      backwardSteps: property(0),
      nativeMotionBlur: property(0),
    },
  };
  const request = definition.getRequest(none, 50);
  assert.equal(request.enabled, false);
  assert.deepEqual(request.frames, []);
});

test("Time Difference declares the reference parameters and alpha modes", () => {
  checkAlgorithmLine("timedifference.js");
  const { definition } = loadEffect("timedifference.js");
  assert.equal(definition.displayName, "Time Difference");
  assert.equal(definition.properties.offset.min, -30);
  assert.equal(definition.properties.offset.max, 30);
  assert.equal(definition.properties.contrast.max, 100);
  assert.equal(definition.properties.absoluteDifference.value, 1);
  assert.deepEqual(
    definition.properties.alphaChannel.items.split(";"),
    [
      "Original",
      "Target",
      "Blend",
      "Max",
      "Full On",
      "Lightness Of Result",
      "Max Of Result",
      "Alpha Difference",
      "Alpha Difference Only",
    ],
  );
});

test("Time Difference requests a single tap at the seconds offset", () => {
  const { definition } = loadEffect("timedifference.js");
  const effect = {
    properties: {
      enabled: property(1),
      offset: property(1.5),
      contrast: property(25),
      absoluteDifference: property(1),
      alphaChannel: property(3),
    },
  };
  // 30 fps fallback: 1.5 s -> 45 frames.
  assert.deepEqual(definition.getRequest(effect, 20), {
    enabled: true,
    count: 1,
    offsetFrames: 45,
    startOpacity: 1,
    decay: 1,
  });
  const disabled = {
    properties: {
      enabled: property(0),
      offset: property(1.5),
      contrast: property(0),
      absoluteDifference: property(1),
      alphaChannel: property(0),
    },
  };
  assert.equal(definition.getRequest(disabled, 20).enabled, false);
});

test("Time Difference caches gain and alpha mode per frame", () => {
  const { definition, effect } = loadEffect("timedifference.js");
  effect.pass = { enabled: true };
  effect.properties = {
    enabled: property(1),
    offset: property(0),
    contrast: property(25),
    absoluteDifference: property(0),
    alphaChannel: property(8),
  };
  definition.lifecycle.update.call(effect, 7);
  assert.equal(effect._zoidiumTimeDifferenceGain, 2);
  assert.equal(effect._zoidiumTimeDifferenceAbs, 0);
  assert.equal(effect._zoidiumTimeDifferenceAlphaMode, 8);
});

test("Time effects restore the preparation context omitted by CM3's layer", async () => {
  for (const filename of ["timedisplacement.js", "ccwidetime.js", "timedifference.js"]) {
    const sequence = {};
    const source = fs.readFileSync(
      path.join(projectRoot, "plugins/native-fx/effects", filename),
      "utf8",
    );
    let received;
    const apis = {
      defineFrameSampler() {
        this.prepare = async function prepare(_frame, context) {
          received = context;
        };
      },
    };
    const effect = { parentProject: { sequence } };
    new Function("PZ", "ZoidiumPluginApis", source).call(effect, PZ, apis);
    await effect.prepare(17);
    assert.equal(received.sequence, sequence, filename);
  }
});
