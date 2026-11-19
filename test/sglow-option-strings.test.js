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
