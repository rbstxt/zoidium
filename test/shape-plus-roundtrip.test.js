"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const { createModel } = require("../plugins/shape-plus/model.js");
const { titles } = require("../plugins/shape-plus/properties.js");
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
for (const kind of Object.keys(titles)) {
  test(`Shape+ ${kind} content preserves animated values`, () => {
    const { PZ } = host(), { Content } = createModel(PZ);
    const create = data => { const item = new Content(kind, data); item.load(data); return item; };
    const authored = plain(create({ id: "item", kind }));
    author(authored.properties);
    const original = create(authored), saved = plain(original);
    assert.deepEqual(saved, authored);
    const duplicate = create(saved), second = create(plain(duplicate));
    assert.deepEqual(plain(duplicate), saved);
    assert.deepEqual(plain(second), saved);
    for (const frame of [0, 7, 20]) assert.deepEqual(plain(duplicate.evaluate(frame)), plain(original.evaluate(frame)));
    const key = Object.keys(duplicate.properties).find(k => duplicate.properties[k].keyframes?.length);
    if (key) {
      duplicate.properties[key].keyframes[0].value = 123;
      assert.deepEqual(plain(original), saved);
    }
  });
}
