"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
require("../zoidium/plugin-apis.js");
const { installFrameSamplerContext } = global.ZoidiumPluginApis;
const vm = require("node:vm");

function loadEchoDefinition(effect = {}) {
  let definition = null;
  const sandbox = {
    ...effect,
    PZ: {
      property: {
        type: { NUMBER: 0, OPTION: 10 },
      },
    },
    ZoidiumPluginApis: {
      installFrameSamplerContext,
      defineFrameSampler(spec) {
        definition = spec;
      },
    },
  };
  vm.createContext(sandbox);
  // Echo's target helpers call ZoidiumPluginApis.gl directly (the shared
  // overlay scripts load before any plugin code runs).
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../zoidium/shared/gl.js"), "utf8"),
    sandbox,
    { filename: "shared/gl.js" },
  );
  sandbox.ZoidiumPluginApis.gl = sandbox.ZoidiumSharedGl;
  const source = fs.readFileSync(
    path.join(__dirname, "../plugins/native-fx/effects/echo.js"),
    "utf8",
  );
  new vm.Script(source, { filename: "echo.js" }).runInContext(sandbox);
  return definition;
}

function property(value) {
  return { get: () => value };
}

test("Echo declares bounded controls and five composite modes", () => {
  const definition = loadEchoDefinition();

  assert.equal(definition.displayName, "Echo");
  assert.equal(definition.properties.echoes.max, 16);
  assert.equal(definition.properties.delay.name, "Echo delay (frames)");
  assert.equal(
    definition.properties.composite.items,
    "over;behind (alpha);add;screen;maximum",
  );
  assert.equal(definition.properties.composite.value, 0);
});

test("Echo requests explicit earlier frames with animated opacity decay", () => {
  const definition = loadEchoDefinition();
  const effect = {
    properties: {
      enabled: property(1),
      echoes: property(6),
      delay: property(2.5),
      opacity: property(0.8),
      decay: property(0.6),
    },
  };

  assert.deepEqual(
    JSON.parse(JSON.stringify(definition.getRequest(effect, 24))),
    {
      preserveInputRGB: true,
      enabled: true,
      count: 6,
      offsetFrames: -2.5,
      startOpacity: 0.8,
      decay: 0.6,
    },
  );
});


test("Echo restores the preparation context omitted by CM3's layer", async () => {
  const sequence = {};
  const effect = { parentProject: { sequence } };
  let received;
  const apis = {
    installFrameSamplerContext,
    defineFrameSampler() {
      this.prepare = async function (_frame, context) { received = context; };
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects/echo.js"), "utf8");
  new Function("PZ", "ZoidiumPluginApis", source).call(effect, { property: { type: { NUMBER: 0, OPTION: 10 } } }, apis);
  await effect.prepare(17);
  assert.equal(received.sequence, sequence);
  const context = { sequence, export: true };
  await effect.prepare(18, context);
  assert.equal(received, context);
});


test("Echo omits exactly zero-weight captures and disables its pass", () => {
  for (const [opacity, decay, expected] of [[0, 1, 0], [1, 0, 1], [1e-100, 1e-100, 3], [1e-10, 0.5, 16]]) {
    const effect = { pass: {}, properties: {
      enabled: property(1), echoes: property(16), delay: property(3),
      opacity: property(opacity), decay: property(decay), composite: property(0),
    } };
    const definition = loadEchoDefinition(effect);
    const request = definition.getRequest(effect, 20);
    assert.equal(request.enabled ? request.count : 0, expected);
    definition.lifecycle.update.call(effect, 20);
    assert.equal(effect.pass.enabled, expected > 0);
  }
});
