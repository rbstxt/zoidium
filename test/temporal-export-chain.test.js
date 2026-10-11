"use strict";

// A1: temporal-render and video-frame-export both wrap
// PZ.export.prototype.getVideoFrame. The later script used to discard the
// earlier wrapper; now they compose explicitly so the deterministic export
// body and the export-compositor registration both run regardless of load
// order, and a repeated install stays a no-op.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const temporalSource = fs.readFileSync(
  path.join(projectRoot, "plugins/core/temporal-render.js"),
  "utf8",
);
const videoFrameSource = fs.readFileSync(
  path.join(projectRoot, "plugins/core/video-frame-export.js"),
  "utf8",
);

function stubPZ() {
  const calls = { originalGetVideoFrame: 0 };
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
  Export.prototype.getVideoFrame = function () {
    calls.originalGetVideoFrame += 1;
    return 1;
  };
  const originalGetVideoFrame = Export.prototype.getVideoFrame;
  class Playback {}
  Playback.prototype.updateSchedule = function () {};
  class Viewport {}
  Viewport.prototype._render = function () {};
  return {
    PZ: {
      layer: Layer,
      compositor: Compositor,
      schedule: Schedule,
      export: Export,
      ui: { playback: Playback, viewport: Viewport },
    },
    calls,
    originalGetVideoFrame,
  };
}

function loadInOrder(order) {
  const { PZ, calls, originalGetVideoFrame } = stubPZ();
  const sandbox = { console, PZ };
  vm.createContext(sandbox);
  for (const name of order) {
    vm.runInContext(name === "temporal" ? temporalSource : videoFrameSource, sandbox, {
      filename: name === "temporal" ? "temporal-render.js" : "video-frame-export.js",
    });
  }
  return { sandbox, PZ, calls, originalGetVideoFrame };
}

function makeExport(PZ) {
  const calls = { prepare: 0, renderSequence: 0 };
  const sequence = { prepare: async () => { calls.prepare += 1; } };
  const compositor = {
    _sequence: sequence,
    renderSequence: () => { calls.renderSequence += 1; },
  };
  const renderer = {
    context: {
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      readPixels: (_x, _y, _w, _h, _f, _t, out) => { out.fill(7); },
    },
  };
  const exp = Object.create(PZ.export.prototype);
  Object.assign(exp, {
    framesRendered: 0,
    totalFrames: 2,
    frame: 10,
    frameAdvance: 1,
    frameWaiting: -1,
    framePromise: null,
    sequence,
    compositor,
    renderer,
    params: { width: 4, height: 4 },
  });
  return { exp, calls, sequence, compositor };
}

for (const order of [["temporal", "video-frame"], ["video-frame", "temporal"]]) {
  test(`export composes in ${order.join(" then ")} order`, async () => {
    const { sandbox, PZ, calls } = loadInOrder(order);
    const temporal = sandbox.PZ.zoidium && sandbox.PZ.zoidium.temporal;
    assert.ok(temporal, "temporal core installed");
    assert.equal(
      typeof temporal.registerExportCompositor,
      "function",
      "shared registration entry point exposed",
    );

    const { exp, calls: exportCalls, sequence, compositor } = makeExport(PZ);
    const output = new Uint8Array(4 * 4 * 4);
    const result = await exp.getVideoFrame(output);

    assert.equal(result, 1, "deterministic export body ran");
    assert.equal(exportCalls.prepare, 1, "sequence prepared exactly once");
    assert.equal(exportCalls.renderSequence, 1, "sequence rendered exactly once");
    assert.equal(calls.originalGetVideoFrame, 0, "CM3 stepping never runs twice");
    assert.equal(exp.framesRendered, 1);
    assert.equal(exp.frame, 11, "frame advanced deterministically");
    assert.ok(output.every((byte) => byte === 7), "pixels read back");
    assert.equal(
      temporal.rootSequences.get(compositor),
      sequence,
      "export compositor registered with the temporal core",
    );
  });
}

test("temporal wrapper delegates to the previously installed export", async () => {
  const { sandbox, PZ, originalGetVideoFrame } = loadInOrder(["video-frame", "temporal"]);
  const temporal = sandbox.PZ.zoidium.temporal;
  assert.equal(
    temporal.originalExportGetVideoFrame.name,
    "getDeterministicVideoFrame",
    "temporal chains onto the deterministic replacement",
  );
  assert.ok(
    PZ.export.prototype.getVideoFrame === temporal.wrappedExportGetVideoFrame,
    "installed wrapper is the tracked one",
  );
  assert.notEqual(PZ.export.prototype.getVideoFrame, originalGetVideoFrame);

  const { exp } = makeExport(PZ);
  await exp.getVideoFrame(new Uint8Array(4 * 4 * 4));
  assert.equal(exp.framesRendered, 1);
});

test("reinstalling the temporal core does not double-wrap the export", async () => {
  const { sandbox, PZ } = loadInOrder(["video-frame", "temporal"]);
  const before = PZ.export.prototype.getVideoFrame;
  vm.runInContext(temporalSource, sandbox, { filename: "temporal-render.js" });
  assert.equal(
    PZ.export.prototype.getVideoFrame,
    before,
    "second install is a no-op",
  );
  const { exp, calls: exportCalls } = makeExport(PZ);
  await exp.getVideoFrame(new Uint8Array(4 * 4 * 4));
  assert.equal(exportCalls.prepare, 1, "still exactly one prepare per frame");
});

test("deterministic export works when the temporal core never loads", async () => {
  const { PZ } = stubPZ();
  const sandbox = { console, PZ };
  vm.createContext(sandbox);
  vm.runInContext(videoFrameSource, sandbox, { filename: "video-frame-export.js" });
  const { exp, calls: exportCalls } = makeExport(PZ);
  const result = await exp.getVideoFrame(new Uint8Array(4 * 4 * 4));
  assert.equal(result, 1);
  assert.equal(exportCalls.prepare, 1, "degraded boot still exports");
});
