"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const plugin = require("../plugins/geometry-plus/geometry-plus.js");
const plain = value => JSON.parse(JSON.stringify(value));

function author(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.keyframes)) {
    const key = value.keyframes[0];
    value.animated = true;
    value.keyframes = [{ ...key, value: 2, frame: 0 }, { ...key, value: 3, frame: 20 }];
  } else for (const child of Object.values(value)) author(child);
}

test("Geometry+ objects retain animated properties through save and duplication", async () => {
  const { PZ, THREE } = host(), registered = [];
  plugin.activate({ PZ, window: { THREE }, object3d: {
    registerClass(entry) { registered.push(entry); return () => {}; },
  } });
  try {
    for (const entry of registered) {
      const create = data => {
        const object = entry.factory(); object.load(data);
        // Native material shader loading needs a browser; serialization does not.
        object.material.loading.catch(() => {});
        return object;
      };
      const authored = plain(create()); author(authored.properties);
      const original = create(authored), saved = plain(original);
      assert.deepEqual(saved, authored, entry.name);
      const duplicate = create(saved), second = create(plain(duplicate));
      assert.deepEqual(plain(duplicate), saved, entry.name);
      assert.deepEqual(plain(second), saved, entry.name);
      for (const key of Object.keys(saved.properties)) {
        const left = original.properties[key], right = duplicate.properties[key];
        if (typeof left?.get === "function") for (const frame of [0, 7, 20]) {
          assert.deepEqual(plain(left.get(frame)), plain(right.get(frame)), `${entry.name} ${key} ${frame}`);
        }
      }
      duplicate.properties.position.objects[0].keyframes[0].value = 99;
      assert.notDeepEqual(plain(duplicate), saved);
      assert.deepEqual(plain(original), saved);
    }
  } finally { plugin.deactivate(); }
});
