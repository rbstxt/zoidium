"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const { expandSuiteFiles, readSource } = require("./trapcode-env.js");
const plain = value => JSON.parse(JSON.stringify(value));
function author(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.keyframes)) {
    const key = value.keyframes[0];
    if (typeof key.value !== "number") return;
    value.animated = true;
    value.keyframes = [{ ...key, value: 2, frame: 0 }, { ...key, value: 3, frame: 20 }];
  } else for (const child of Object.values(value)) author(child);
}
for (const kind of ["particular", "form", "plexus"]) test(`${kind} retains authored values across serialization and duplication`, () => {
  const { PZ, THREE } = host();
  for (const file of expandSuiteFiles(["trapcode-common.js", "particular.js", "form.js", "plexus.js"])) new Function("PZ", "THREE", readSource(file))(PZ, THREE);
  const create = data => { const object = new PZ.object3d[kind](); object.type = `zoidium:trapcode-suite/${kind}`; object.load(data); return object; };
  const seed = create(), authored = plain(seed);
  if (kind !== "plexus") author(authored);
  else {
    authored.properties.name = "Edited Plexus";
    for (const object of authored.objects) {
      author(object.properties.geometry.primitiveCount);
      author(object.properties.effector.noiseAmount);
      author(object.properties.renderer.opacity);
    }
  }
  const original = create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const packageData = plain(new PZ.package([original])).data[0];
  assert.deepEqual(packageData, saved);
  const duplicate = create(packageData), second = create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  const collection = kind === "particular" ? "systems" : kind === "form" ? "forms" : "objects";
  const left = original[collection][0], right = duplicate[collection][0];
  if (kind !== "plexus") {
    const key = kind === "particular" ? "ratePercent" : "rotationX";
    const group = kind === "particular" ? "emitter" : "transform";
    for (const frame of [0, 7, 20]) assert.deepEqual(plain(left.properties[group][key].get(frame)), plain(right.properties[group][key].get(frame)));
  } else {
    for (const frame of [0, 7, 20]) {
      assert.equal(left.properties.geometry.primitiveCount.get(frame), right.properties.geometry.primitiveCount.get(frame));
      assert.equal(left.properties.renderer.opacity.get(frame), right.properties.renderer.opacity.get(frame));
    }
    right.properties.geometry.primitiveCount.keyframes[0].value = 23;
  }
  right.properties.name.set("Duplicate child");
  duplicate.properties.name.set("Duplicate");
  assert.deepEqual(plain(original), saved);
  for (const item of [seed, original, duplicate, second]) item.unload();
});
