"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { copyFixture } = require("./helpers/temporal-alpha-fixture.cjs");
const Temporal = require("../zoidium/community-temporal");

function requestFor(file, overrides = {}) {
  const { h } = copyFixture();
  const effect = { _zoidiumGetAsset(_kind, file) {
    return fs.readFileSync(path.resolve(__dirname, "..", file.replace(/^\.\//, "").replace(/^\//, "")), "utf8");
  } };
  let definition;
  const apis = { ...h.sandbox.ZoidiumPluginApis,
    defineFrameSampler(spec) { definition = spec; },
    installFrameSamplerContext() {},
  };
  const PZ = { property: { type: {} }, asset: { type: {} } };
  const THREE = { Pass: function () {} };
  new Function("PZ", "THREE", "ZoidiumPluginApis", effect._zoidiumGetAsset("text", file))
    .call(effect, PZ, THREE, apis);
  effect.properties = Object.fromEntries(Object.entries(definition.properties)
    .map(([key, spec]) => [key, { get: () => key in overrides ? overrides[key] : spec.value }]));
  return definition.getRequest(effect, 15);
}

const consumers = [
  ["Echo", "native-fx/effects/echo.js"],
  ["CC Wide Time", "native-fx/effects/ccwidetime.js"],
  ["Time Difference", "native-fx/effects/timedifference.js"],
  ["Time Displacement", "native-fx/effects/timedisplacement.js"],
  ["Smart Motion Blur Optical Flow", "native-fx/effects/smartmotionblur.js", { reconstruction: 1 }],
  ["Echo (Legacy)", "openzoid-legacy/effects/echo-legacy.js"],
  ["VHS", "openzoid-legacy/effects/vhs.js"],
  ["Datamosh", "openzoid-legacy/effects/datamosh.js"],
];

for (const [name, file, overrides] of consumers) {
  test(`${name} captures premultiplied input without a second alpha multiply`, () => {
    const request = requestFor("plugins/" + file, overrides);
    assert.notEqual(request.enabled, false);
    const { h, compositor, source } = copyFixture(), output = {};
    h.parts.sampler.copyRenderTarget(compositor, output, source, 1, 1, request.preserveInputRGB === true);
    assert.deepEqual(output.rgba, [128, 64, 32, 128]);
    source.texture.rgba = [128, 64, 32, 255];
    h.parts.sampler.copyRenderTarget(compositor, output, source, 1, 1, request.preserveInputRGB === true);
    assert.deepEqual(output.rgba, source.texture.rgba, "opaque capture remains identical");
    source.texture.rgba = [0, 0, 0, 0];
    h.parts.sampler.copyRenderTarget(compositor, output, source, 1, 1, request.preserveInputRGB === true);
    assert.deepEqual(output.rgba, source.texture.rgba, "transparent black remains identical");
  });
}

test("community temporal plans preserve premultiplied input after exact-frame preflight", async () => {
  const effect = {}, instance = {};
  const authority = { frameKey: "15" };
  const temporal = Temporal.install({ effect, instance, stamp: () => authority,
    sameStamp: (a, b) => a === b, valid: () => true, PZ: {},
    compute: async () => ({ temporal: { offsets: [-1, 0], weights: [0.5, 0.5] } }),
  });
  assert.equal(effect._zoidiumFrameSampler.getRequest(effect, 15), null);
  await temporal.preflight(effect, 15);
  const request = effect._zoidiumFrameSampler.getRequest(effect, 15);
  assert.deepEqual(request.frames, [-1, 0]);
  const { h, compositor, source } = copyFixture(), output = {};
  h.parts.sampler.copyRenderTarget(compositor, output, source, 1, 1, request.preserveInputRGB === true);
  assert.deepEqual(output.rgba, [128, 64, 32, 128]);
  assert.equal(effect._zoidiumFrameSampler.getRequest(effect, 15, { exportPolicy: { communityBypass: true } }), null);
});
