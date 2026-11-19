"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();

const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const { createRepeaterClass } = require("../plugins/scene-plus/scene-repeaters.js");
const plain = value => JSON.parse(JSON.stringify(value));

function author(value) {
  if (value && typeof value === "object") {
    if (Array.isArray(value.keyframes)) {
      const key = value.keyframes[0];
      value.animated = true;
      value.keyframes = [
        { ...key, value: 2.25, frame: 0 },
        { ...key, value: 4.5, frame: 20 },
      ];
    } else for (const child of Object.values(value)) author(child);
  }
}

for (const mode of ["linear", "step", "random", "echo"]) {
  test(`${mode} repeater retains authored properties and duplicate independence`, () => {
    const { PZ, THREE } = host();
    const Repeater = createRepeaterClass(PZ, THREE, mode, `zoidium:repeater/${mode}-repeater`);
    const initial = new Repeater(); initial.load();
    const authored = plain(initial);
    author(authored.repeaterProperties);
    if (mode === "random") authored.repeaterProperties.seed = 42;
    const original = new Repeater(); original.load(authored);
    const saved = plain(original);
    assert.deepEqual(saved, authored);
    const duplicate = new Repeater(); duplicate.load(saved);
    assert.deepEqual(plain(duplicate), saved);
    const second = new Repeater(); second.load(plain(duplicate));
    assert.deepEqual(plain(second), saved);
    for (const key of Object.keys(saved.repeaterProperties)) {
      const left = original.repeaterProperties[key], right = duplicate.repeaterProperties[key];
      if (typeof left?.get === "function") for (const frame of [0, 7, 20]) {
        assert.deepEqual(plain(left.get(frame)), plain(right.get(frame)), `${key} at ${frame}`);
      }
    }
    const copy = plain(duplicate);
    copy.repeaterProperties.count.keyframes[0].value = 99;
    duplicate.repeaterProperties.load(copy.repeaterProperties);
    assert.deepEqual(plain(original), saved);
  });
}
