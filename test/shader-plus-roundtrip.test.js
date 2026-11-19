"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const plain = value => JSON.parse(JSON.stringify(value));
function author(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.keyframes)) {
    const key = value.keyframes[0];
    if (typeof key.value !== "number") return;
    value.animated = true;
    value.keyframes = [{ ...key, value: 0.25, frame: 0 }, { ...key, value: 0.75, frame: 20 }];
  } else if (value.objects) for (const child of value.objects) author(child);
}
test("Shader+ custom property definitions and values survive round trips", () => {
  const { PZ } = nativeHost();
  for (const [name, kind] of Object.entries(KINDS)) {
    if (name === "staticDropdown") continue; // Covered by the separate OPTION typing sweep.
    const definition = kind.create();
    definition.zoidiumShader.visibleWhen = { property: "Mode", values: [1, 2] };
    definition.zoidiumShader.renameWhen = [{ property: "Mode", name: "Alternate", values: [2] }];
    definition.zoidiumPropertyGroup = { name: "Controls", visibleWhen: { property: "Mode", values: [2] } };
    const create = data => { const property = PZ.property.create(data?.type || definition); property.load(data); return property; };
    const authored = plain(create()); author(authored);
    const original = create(authored), saved = plain(original);
    assert.deepEqual(saved, authored, name);
    const duplicate = create(plain(saved)), second = create(plain(duplicate));
    assert.deepEqual(plain(duplicate), saved, name); assert.deepEqual(plain(second), saved, name);
    for (const frame of [0, 7, 20]) assert.deepEqual(plain(duplicate.get(frame)), plain(original.get(frame)), name);
    duplicate.definition.zoidiumShader.visibleWhen.values.push(9);
    assert.deepEqual(plain(original), saved, name);
  }
});
