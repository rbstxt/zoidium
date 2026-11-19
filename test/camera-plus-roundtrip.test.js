"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host } = require("./helpers/editor-identity-host.cjs");
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
test("Camera+ retains animated fields through save and duplicate", () => {
  const context = host(), { PZ, THREE } = context; context.parts = {};
  for (const name of ["vibrate", "camera-class"]) vm.runInContext(fs.readFileSync(`plugins/camera-plus/${name}.js`, "utf8"), context);
  const Camera = context.parts.camera.createClass(PZ, THREE, context.parts.vibrate, () => null);
  const create = data => { const camera = new Camera(); camera.load(data); return camera; };
  const authored = plain(create()); author(authored.properties);
  const original = create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const duplicate = create(saved), second = create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  function compare(left, right) {
    for (const key of Object.keys(left)) {
      if (typeof left[key]?.get === "function") for (const frame of [0, 7, 20]) {
        assert.deepEqual(plain(left[key].get(frame)), plain(right[key].get(frame)), key);
      } else if (left[key] && typeof left[key] === "object") compare(left[key], right[key]);
    }
  }
  compare(original.properties, duplicate.properties);
  duplicate.properties.focalLength.keyframes[0].value = 77;
  assert.deepEqual(plain(original), saved);
});
