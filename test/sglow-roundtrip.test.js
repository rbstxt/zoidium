"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
test("S_Glow retains authored properties through save and package copy", async () => {
  const c = host(), { PZ } = c; c.queueMicrotask = queueMicrotask;
  const source = fs.readFileSync("plugins/sglow-hq-v2-preview/effects/sglow-hq-v2-preview.js", "utf8");
  const factory = vm.runInContext(`(function () { ${source}\n})`, c);
  const create = async data => {
    const effect = new PZ.effect(); effect.type = "sglow-hq-v2-preview";
    factory.call(effect); await effect.load(data); return effect;
  };
  const seed = await create(), authored = plain(seed);
  for (const key of ["brightness", "threshold", "glowWidth", "atmosphereAmp", "time"]) {
    const value = authored.properties[key], first = value.keyframes[0]; value.animated = true;
    value.keyframes = [{ ...first, value: 0.25, frame: 0 }, { ...first, value: 0.75, frame: 20 }];
  }
  authored.properties.timeMode = 1;
  delete authored.properties.time.expression;
  for (const key of ["quality", "combine", "engine"]) authored.properties[key].keyframes[0].value = 0;
  const original = await create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const duplicate = await create(plain(new PZ.package([original])).data[0]), second = await create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  for (const key of ["brightness", "threshold", "glowWidth", "atmosphereAmp", "time", "quality"]) for (const frame of [0, 7, 20]) {
    assert.deepEqual(plain(duplicate.properties[key].get(frame)), plain(original.properties[key].get(frame)), key);
  }
  duplicate.properties.brightness.keyframes[0].value = 9;
  assert.deepEqual(plain(original), saved);
  seed.properties.timeMode.set(1);
  seed.properties.time.keyframes[0].value = 4.5;
  seed.properties.time.animated = true;
  seed.properties.timeMode.set(0);
  const automatic = plain(seed), reopened = await create(automatic);
  assert.deepEqual(plain(reopened), automatic);
  reopened.properties.timeMode.set(1);
  assert.equal(reopened.properties.time.keyframes[0].value, 4.5);
  assert.equal(reopened.properties.time.animated, true);
  for (const effect of [seed, original, duplicate, second, reopened]) effect.unload();
});
