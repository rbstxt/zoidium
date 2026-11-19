"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const { nativeHost } = require("./expressions-plus-harness");

test("S_Glow time mode accepts saved and edited option strings", () => {
  const { PZ, context } = nativeHost();
  context.queueMicrotask = () => {};
  context.ZoidiumPluginApis = {};
  const effect = context.effect = new PZ.effect();
  const source = fs.readFileSync("plugins/sglow-hq-v2-preview/effects/sglow-hq-v2-preview.js", "utf8");
  vm.runInContext("(function(){" + source + "}).call(effect)", context);
  effect.update = () => {};
  effect.applySettingsSnapshot({ timeMode: "1" });
  assert.equal(effect.properties.time.visible, true);
  assert.equal(JSON.parse(JSON.stringify(effect.properties)).timeMode, "1");
  effect.properties.timeMode.set("0");
  assert.equal(effect.properties.time.visible, false);
  assert.equal(effect.properties.time.expression.source, "time");
  effect.properties.timeMode.set("1");
  assert.equal(effect.properties.time.visible, true);
  assert.equal(JSON.parse(JSON.stringify(effect.properties)).timeMode, "1");
});

test("S_Glow dynamic OPTION keys survive reload and reach its pass as numbers", () => {
  const { PZ, context } = nativeHost(); context.queueMicrotask = () => {}; context.ZoidiumPluginApis = {};
  const effect = context.effect = new PZ.effect();
  const source = fs.readFileSync("plugins/sglow-hq-v2-preview/effects/sglow-hq-v2-preview.js", "utf8");
  vm.runInContext("(function(){" + source + "}).call(effect)", context);
  for (const key of Object.keys(effect.propertyDefinitions)) effect.properties[key].load();
  for (const [key, value] of [["enabled", "1"], ["expandBorders", "1"], ["opacity", "0"], ["quality", "3"]]) {
    effect.properties[key].set(value, 0);
    const saved = JSON.parse(JSON.stringify(effect.properties[key]));
    effect.properties[key].load(saved);
    assert.equal(effect.properties[key].get(0), value);
  }
  effect.pass = {};
  effect.update(0);
  assert.equal(effect.pass.enabled, true);
  assert.equal(effect.cached.expandBorders, 1);
  assert.equal(effect.cached.opacity, 0);
  assert.equal(effect.cached.quality, 3);
  effect.properties.enabled.set("0", 0); effect.update(0);
  assert.equal(effect.pass.enabled, false);
  assert.equal(JSON.parse(JSON.stringify(effect.properties.enabled)).keyframes[0].value, "0");
});
