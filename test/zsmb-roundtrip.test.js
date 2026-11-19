"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host, fixture } = require("./helpers/editor-identity-host.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
test("ZSMB retains settings through save and package copy", () => {
  const c = host(), { PZ } = c, { project } = fixture(c);
  const source = fs.readFileSync("plugins/smart-motion-blur-lite/effect.js", "utf8");
  const factory = vm.runInContext(`(function () { ${source}\n})`, c);
  const create = data => {
    const effect = new PZ.effect(); effect.type = "smart-motion-blur-lite";
    Object.defineProperty(effect, "parentProject", { value: project });
    effect._zoidiumGetAsset = (_type, path) => fs.readFileSync(path.replace(/^\.?\//, "").split("?")[0], "utf8");
    factory.call(effect); effect.load(data); return effect;
  };
  const seed = create(), authored = plain(seed);
  for (const [key, value] of Object.entries(authored.properties)) if (["amount", "sensitivity"].includes(key)) {
    const first = value.keyframes[0]; value.animated = true;
    value.keyframes = [{ ...first, value: 0.25, frame: 0 }, { ...first, value: 0.75, frame: 20 }];
  }
  authored.properties.quality.keyframes[0].value = 2;
  authored.properties.trackFrame.keyframes[0].value = 1;
  authored.zoidiumTemporalMode = "legacy";
  const original = create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const duplicate = create(plain(new PZ.package([original])).data[0]), second = create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  for (const key of ["amount", "sensitivity", "quality", "trackFrame"]) for (const frame of [0, 7, 20]) {
    assert.equal(duplicate.properties[key].get(frame), original.properties[key].get(frame));
  }
  duplicate.properties.amount.keyframes[0].value = 4;
  assert.deepEqual(plain(original), saved);
  for (const item of [seed, original, duplicate, second]) item.unload();
});
