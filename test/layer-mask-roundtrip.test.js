"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host, fixture } = require("./helpers/editor-identity-host.cjs");
const { installMaskPersistence } = require("../plugins/shape-plus/mask-persist.js");
const { FIELD, evaluateMask } = require("../plugins/shape-plus/mask-model.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const plain = value => JSON.parse(JSON.stringify(value));
test("animated masks survive native layer packages and do not share state", () => {
  const c = host(), { PZ } = c, cleanups = [];
  const originalLoad = PZ.layer.prototype.load;
  PZ.layer.prototype.load = function () {};
  installMaskPersistence(PZ, fn => cleanups.push(fn));
  try {
    const { layer } = fixture(c), { Content } = createModel(PZ);
    const path = [0, 0, 0, 0, 0, 0, 50, 0, 0, 0, 0, 0, 40, 50, 0, 0, 0, 0];
    layer[FIELD] = [{ id: "mask", kind: "path", mode: "subtract", feather: 12, opacity: 0.4, invert: 1,
      vertexIds: ["a", "b", "c"], vertexModes: { a: "smooth" }, properties: { name: "Cut", enabled: 1, closed: 1,
        path: { animated: true, keyframes: [{ frame: 0, value: path, tween: 1 }, { frame: 20, value: path.map(v => v + 2), tween: 1 }] } } }];
    const saved = plain(layer), packageData = plain(new PZ.package([layer])).data[0];
    assert.deepEqual(packageData, saved);
    const duplicate = fixture(c).layer; duplicate.load(packageData);
    assert.deepEqual(plain(duplicate)[FIELD], saved[FIELD]);
    const second = fixture(c).layer; second.load(plain(duplicate));
    assert.deepEqual(plain(second)[FIELD], saved[FIELD]);
    const item = mask => { const node = new Content("path", mask); node.load(mask); return node; };
    const a = item(layer[FIELD][0]), b = item(duplicate[FIELD][0]);
    for (const frame of [0, 7, 20]) assert.deepEqual(plain(evaluateMask(b, frame)), plain(evaluateMask(a, frame)));
    duplicate[FIELD][0].properties.path.keyframes[0].value[0] = 999;
    assert.deepEqual(plain(layer)[FIELD], saved[FIELD]);
  } finally { cleanups.reverse().forEach(fn => fn()); PZ.layer.prototype.load = originalLoad; }
});
