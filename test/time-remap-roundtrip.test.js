"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
test("Time Remap retains animated settings and duplicate independence", () => {
  const c = host(), { PZ } = c;
  const source = fs.readFileSync("plugins/native-fx/effects/timeremap.js", "utf8");
  const factory = vm.runInContext(`(function () { ${source}\n})`, c);
  const create = data => {
    const effect = new PZ.effect(); effect.type = "timeremap";
    effect._zoidiumGetAsset = (_type, path) => fs.readFileSync(path.replace(/^\.\//, "").split("?")[0], "utf8");
    factory.call(effect); effect.load(data); return effect;
  };
  const seed = create(), authored = plain(seed);
  for (const value of Object.values(authored.properties)) if (value?.keyframes && typeof value.keyframes[0]?.value === "number") {
    const key = value.keyframes[0]; value.animated = true;
    value.keyframes = [{ ...key, value: 2, frame: 0 }, { ...key, value: 3, frame: 20 }];
  }
  authored.zoidiumTemporalMode = "legacy";
  const original = create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const duplicate = create(plain(new PZ.package([original])).data[0]), second = create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  for (const key of Object.keys(original.properties)) if (typeof original.properties[key]?.get === "function") {
    for (const frame of [0, 7, 20]) assert.deepEqual(plain(original.properties[key].get(frame)), plain(duplicate.properties[key].get(frame)), key);
  }
  duplicate.properties.speed.keyframes[0].value = 99;
  assert.deepEqual(plain(original), saved);
  for (const effect of [seed, original, duplicate, second]) effect.unload();
});
