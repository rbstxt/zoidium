"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadEchoDefinition() {
  let definition = null;
  const sandbox = {
    PZ: {
      property: {
        type: { NUMBER: 0, OPTION: 10 },
      },
    },
    ZoidiumPluginApis: {
      defineFrameSampler(spec) {
        definition = spec;
      },
    },
  };
  vm.createContext(sandbox);
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
      enabled: true,
      count: 6,
      offsetFrames: -2.5,
      startOpacity: 0.8,
      decay: 0.6,
    },
  );
});
