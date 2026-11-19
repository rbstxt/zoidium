"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const plugin = require("../plugins/text-plus/text-plus.js");
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
test("Text+ parent and material properties survive save and duplicate", () => {
  const { PZ, THREE } = host(), registered = [];
  plugin.activate({ PZ, window: { THREE }, object3d: {
    registerClass(entry) { registered.push(entry); return () => {}; },
  } });
  try {
    for (const entry of registered) {
      const create = data => { const object = entry.factory(); object.load(data); return object; };
      const authored = plain(create()); author(authored.characterProperties || authored.properties);
      const original = create(authored), saved = plain(original);
      assert.deepEqual(saved, authored, entry.name);
      const duplicate = create(saved), second = create(plain(duplicate));
      assert.deepEqual(plain(duplicate), saved, entry.name);
      assert.deepEqual(plain(second), saved, entry.name);
      const left = original.characterProperties || original.properties;
      const right = duplicate.characterProperties || duplicate.properties;
      for (const key of Object.keys(left)) if (typeof left[key]?.get === "function") {
        for (const frame of [0, 7, 20]) assert.deepEqual(plain(left[key].get(frame)), plain(right[key].get(frame)), `${entry.name} ${key}`);
      }
      const key = Object.keys(right).find(k => right[k].keyframes?.length);
      if (key) { right[key].keyframes[0].value = 123; assert.deepEqual(plain(original), saved); }
    }
  } finally { plugin.deactivate(); }
});
