"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const old = require("./worker-helper-originals.js");
const core = require("../plugins/scene-plus/effector-core.js");
const fracture = require("../plugins/scene-plus/effector-fracture.js");
const buffers = require("../plugins/material-plus/graph-buffers.js")(null);
const values = require("../plugins/scene-plus/scene-values.js");
function privateFunction(file, name) {
  const sandbox = { ZoidiumPluginApis, module: { exports: {} }, console };
  vm.runInNewContext(fs.readFileSync(file, "utf8") + "\nmodule.exports = " + name + ";", sandbox);
  return sandbox.module.exports;
}
const pbrRead = privateFunction("plugins/material-plus/pbr-plus.js", "readNumber");
// Matcap's reader lives in its closure; expose it only in this test evaluation.
function matcapReader() {
  const source = fs.readFileSync("plugins/material-plus/material-plus.js", "utf8")
    .replace("return { activate, deactivate };", "return { activate, deactivate, readNumber };");
  const sandbox = { ZoidiumPluginApis, module: { exports: {} }, console };
  vm.runInNewContext(source, sandbox);
  return sandbox.module.exports.readNumber;
}
const seeds = [-2.75, -1, -0, 0, 1, 1.1, 42, 2147483647, NaN, Infinity, null, undefined, "7"];
test("remaining worker random and numeric helpers match verbatim originals", () => {
  for (const seed of seeds) {
    assert.equal(core.finiteOr(seed, 3), old.finiteOr(seed, 3));
    assert.equal(core.clampUnit(seed), old.clampUnit(seed));
    assert.equal(values.numberValue(seed, 3), old.numberValue(seed, 3));
    for (const index of [-2, 0, 1.5, 40, 91]) for (const channel of [0, 1, 10, 31]) {
      assert.equal(core.hash01(seed, index, channel), old.hash01(seed, index, channel));
      assert.deepEqual(Array.from(core.hashUnitVector(seed, index, channel)), old.hashUnitVector(seed, index, channel));
      const expected = old.hslToRgb(old.hash01(seed, index, 40), 0.45 + 0.2 * old.hash01(seed, index, 41), 0.55 + 0.15 * old.hash01(seed, index, 42));
      assert.deepEqual(Array.from(fracture.pieceColor(seed, index)), expected);
    }
  }
});
test("remaining worker color helpers match verbatim originals over input grids", () => {
  for (const a of [-0.5, -0, 0, 0.125, 0.5, 0.75, 1, 1.5, NaN, Infinity]) {
    for (const b of [0, 0.2, 0.5, 1]) for (const c of [0, 0.3, 0.55, 1]) {
      assert.deepEqual(Array.from(buffers.rgbToHsv(a, b, c)), old.rgbToHsv(a, b, c));
      assert.deepEqual(Array.from(buffers.hsvToRgb(a, b, c)), old.hsvToRgb(a, b, c));
    }
  }
});
test("Material+ coercing number readers keep strings, null, missing and throwing defaults", () => {
  const readers = [pbrRead, matcapReader()];
  for (const value of [...seeds, true, false, [], [2], {}, ""]) {
    const property = { get: frame => { assert.equal(frame, 1.25); return value; } };
    for (const read of readers) assert.equal(read(property, 1.25, 3), old.readNumber(property, 1.25, 3));
  }
  for (const property of [null, {}, { get() { throw new Error("unavailable"); } }]) {
    for (const read of readers) assert.equal(read(property, 0, 3), old.readNumber(property, 0, 3));
  }
});
