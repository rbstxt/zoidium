"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { nativeHost } = require("./expressions-plus-harness.js");
const plain = value => JSON.parse(JSON.stringify(value));
function author(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.keyframes)) {
    const key = value.keyframes[0];
    if (typeof key.value !== "number") return;
    value.animated = true;
    value.keyframes = [{ ...key, value: 0.3, frame: 0 }, { ...key, value: 0.7, frame: 20 }];
  } else for (const child of Object.values(value)) author(child);
}
for (const type of [1, 2, 3, 4]) test(`Light+ type ${type} retains saved fields and duplicate independence`, () => {
  const { PZ, context } = nativeHost(); context.window = context;
  vm.runInContext(fs.readFileSync("plugins/core/object3d-enabled.js", "utf8"), context);
  const create = data => { const light = PZ.object3d.create(3); light.load(data); return light; };
  const authored = plain(create({ objectType: type })); author(authored.properties);
  if (authored.properties.zoidiumCastShadows !== undefined) authored.properties.zoidiumCastShadows = 0;
  const original = create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const duplicate = create(saved), second = create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  for (const key of Object.keys(original.properties)) if (typeof original.properties[key]?.get === "function") {
    for (const frame of [0, 7, 20]) assert.deepEqual(plain(duplicate.properties[key].get(frame)), plain(original.properties[key].get(frame)), key);
  }
  duplicate.properties.intensity.keyframes[0].value = 77;
  assert.deepEqual(plain(original), saved);
});
