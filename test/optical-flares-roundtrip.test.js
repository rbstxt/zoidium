"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const plain = value => JSON.parse(JSON.stringify(value));
function author(value) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value.keyframes)) {
    const key = value.keyframes[0];
    if (typeof key.value !== "number") return;
    value.animated = true;
    value.keyframes = [{ ...key, value: 0.25, frame: 0 }, { ...key, value: 0.75, frame: 20 }];
  } else for (const child of Object.values(value)) author(child);
}
test("Optical Flares stack survives native serialization and duplicate edits", () => {
  const { PZ, THREE } = host();
  PZ.opticalflares = { math: require("../plugins/optical-flares/optflares-math.js") };
  require("../plugins/optical-flares/optflares.js")(PZ, THREE);
  const create = data => { const flare = new PZ.object3d.optflares(); flare.type = "zoidium:optical-flares/optical-flares"; flare.load(data); return flare; };
  const seed = create({ objectType: 0 }), authored = plain(seed);
  author(authored.properties); for (const element of authored.stack) {
    const type = plain(element.properties.element.elementType);
    author(element.properties);
    element.properties.element.elementType = type;
  }
  const original = create(authored), saved = plain(original);
  assert.deepEqual(saved, authored);
  const packageData = plain(new PZ.package([original])).data[0];
  assert.deepEqual(packageData, saved);
  const duplicate = create(packageData), second = create(plain(duplicate));
  assert.deepEqual(plain(duplicate), saved); assert.deepEqual(plain(second), saved);
  function compare(a, b) {
    for (const key of Object.keys(a || {})) {
      if (typeof a[key]?.get === "function") for (const frame of [0, 7, 20]) assert.deepEqual(plain(a[key].get(frame)), plain(b[key].get(frame)), key);
      else if (a[key] && typeof a[key] === "object") compare(a[key], b[key]);
    }
  }
  compare(original.properties, duplicate.properties);
  for (let i = 0; i < original.stack.length; i++) compare(original.stack[i].properties, duplicate.stack[i].properties);
  duplicate.stack[0].properties.name.set("Duplicate");
  assert.deepEqual(plain(original), saved);
  for (const item of [seed, original, duplicate, second]) item.unload();
});
