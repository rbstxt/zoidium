"use strict";

// A10: the temporal core exposes canonical frame helpers (quantizeFrame,
// clampFrame, offsetFrame, planFrameSamples, readFpsProp) for other effects,
// both as Node exports and on PZ.zoidium.temporal. Historic names stay as
// aliases with identical behavior.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const {
  applyTemporalOperators,
  buildFrameSamplePlan,
  clampFrame,
  clampLocalFrame,
  offsetFrame,
  planFrameSamples,
  quantizeFrame,
  quantizeLocalFrame,
  readFpsProp,
} = require("../plugins/core/temporal-render");

test("quantizeFrame pins the posterize bucket rule", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map((frame) => quantizeFrame(frame, 30, 12)),
    [0, 0, 0, 2.5, 2.5, 5, 5, 5, 7.5],
  );
  assert.equal(quantizeFrame(-4, 30, 12), 0, "negative input clamps");
  assert.equal(quantizeFrame(-4, 30, 12, true), -5, "extrapolation keeps negatives");
  assert.equal(quantizeFrame(9, 30, 0), 9, "zero target rate passes through");
  assert.equal(quantizeLocalFrame(7, 30, 12), quantizeFrame(7, 30, 12), "alias matches");
});

test("clampFrame pins the clip range rule", () => {
  assert.equal(clampFrame(-2, 100), 0);
  assert.equal(clampFrame(150, 100), 100 - 1e-9);
  assert.equal(clampFrame(-2, 100, true), -2, "extrapolation skips the clamp");
  assert.equal(clampFrame(5, 0), 5, "empty clips only floor at zero");
  assert.equal(clampLocalFrame(150, 100), clampFrame(150, 100), "alias matches");
});

test("offsetFrame adds finite offsets", () => {
  assert.equal(offsetFrame(8, 2), 10);
  assert.equal(offsetFrame("8", "-3"), 5);
  assert.equal(offsetFrame(NaN, 2), 2);
  assert.equal(offsetFrame(8, undefined), 8);
  assert.deepEqual(
    applyTemporalOperators(8, 30, [{ kind: "time-offset", offsetFrames: 2 }], 100),
    10,
    "operator path agrees with the helper",
  );
});

test("planFrameSamples pins taps, weights and the 16-sample cap", () => {
  assert.deepEqual(planFrameSamples(12, 4, -3, 0.8, 0.5, 0, 60), [
    { frame: 9, index: 1, opacity: 0.8 },
    { frame: 6, index: 2, opacity: 0.4 },
    { frame: 3, index: 3, opacity: 0.2 },
    { frame: 0, index: 4, opacity: 0.1 },
  ]);
  assert.equal(planFrameSamples(0, 99, -1, 1, 1, 0, 60).length, 16);
  assert.deepEqual(
    planFrameSamples(2, 3, -3, 1, 1, 0, 60),
    buildFrameSamplePlan(2, 3, -3, 1, 1, 0, 60),
    "alias matches",
  );
});

test("readFpsProp reads frame-varying rates with a fallback", () => {
  assert.equal(readFpsProp({ get: () => 24 }, 10, 30), 24);
  assert.equal(readFpsProp({ get: () => "12" }, 10, 30), 12);
  assert.equal(readFpsProp({ get: () => 0 }, 10, 30), 30, "zero falls back");
  assert.equal(readFpsProp({ get: () => -5 }, 10, 30), 30, "negative falls back");
  assert.equal(readFpsProp({ get: () => NaN }, 10, 30), 30);
  assert.equal(readFpsProp({ get: () => { throw new Error("gone"); } }, 10, 30), 30);
  assert.equal(readFpsProp(null, 10, 30), 30);
});

test("helpers are reachable from PZ.zoidium.temporal at runtime", () => {
  class Layer {}
  Layer.prototype.update = function () {};
  Layer.adjustment = class extends Layer {};
  Layer.scene = class extends Layer {};
  Layer.composite = class extends Layer {};
  class Compositor {}
  Compositor.prototype.renderSequence = function () {};
  Compositor.prototype.renderLayer = function () {};
  Compositor.prototype.unload = function () {};
  class Schedule {}
  Schedule.type = { VIDEO: 0, NONE: 2 };
  Schedule.prototype.prepare = async function () {};
  class Export {}
  Export.prototype.getVideoFrame = async function () { return 0; };
  class Playback {}
  Playback.prototype.updateSchedule = function () {};
  class Viewport {}
  Viewport.prototype._render = function () {};
  const sandbox = {
    console,
    PZ: {
      layer: Layer,
      compositor: Compositor,
      schedule: Schedule,
      export: Export,
      ui: { playback: Playback, viewport: Viewport },
    },
  };
  vm.createContext(sandbox);
  for (const relative of [
    "plugins/core/temporal-math.js",
    "plugins/core/temporal-layers.js",
    "plugins/core/temporal-capture.js",
    "plugins/core/temporal-sampler.js",
    "plugins/core/temporal-export.js",
    "plugins/core/temporal-render.js",
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(projectRoot, relative), "utf8"),
      sandbox,
      { filename: path.basename(relative) },
    );
  }
  const temporal = sandbox.PZ.zoidium.temporal;
  for (const name of ["quantizeFrame", "clampFrame", "offsetFrame", "planFrameSamples", "readFpsProp"]) {
    assert.equal(typeof temporal[name], "function", `${name} exposed on the state`);
  }
  assert.equal(temporal.quantizeFrame(7, 30, 12), quantizeFrame(7, 30, 12));
  assert.equal(
    JSON.stringify(temporal.planFrameSamples(12, 4, -3, 0.8, 0.5, 0, 60)),
    JSON.stringify(planFrameSamples(12, 4, -3, 0.8, 0.5, 0, 60)),
  );
});
