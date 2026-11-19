"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function temporal(file) {
  let spec;
  const source = fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects", file), "utf8");
  new Function("PZ", "ZoidiumPluginApis", source)(
    { property: { type: { OPTION: 1, NUMBER: 2 } } },
    { defineTemporal(value) { spec = value; } },
  );
  return spec;
}

test("temporal effects accept string-valued enabled keys", () => {
  for (const [file, parameter] of [["timeoffset.js", "offset"], ["posterizetime.js", "fps"]]) {
    const spec = temporal(file);
    for (const value of [0, 1, "0", "1"]) {
      const effect = { properties: { enabled: { get: () => value }, [parameter]: { get: () => 5 } } };
      assert.equal(spec.getOperator(effect, 10).enabled, Number(value) === 1, `${file}: ${value}`);
      assert.equal(effect.properties.enabled.get(), value);
    }
  }
});

test("Drop Shadow accepts string enabled keys", () => {
  const source = fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects/dropshadow.js"), "utf8");
  const effect = { parentProject: { assets: { createFromPreset() {} } }, properties: { addAll() {} } };
  new Function("PZ", "THREE", source).call(effect,
    { asset: { type: { SHADER: 1 } }, property: { type: { OPTION: 1, COLOR: 2, NUMBER: 3 } } }, {});
  effect.properties = Object.fromEntries(Object.entries(effect.propertyDefinitions).map(([key, def]) => [key, { get: () => def.value }]));
  effect.pass = {};
  for (const value of [0, 1, "0", "1"]) {
    effect.properties.enabled.get = () => value;
    effect.update(0);
    assert.equal(effect.pass.enabled, Number(value) === 1);
  }
});
