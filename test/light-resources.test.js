"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../plugins/core/light-resources.js"), "utf8");

test("unloading a light releases its own shadow target once", () => {
  let nativeCalls = 0, disposals = 0;
  class Light { unload() { nativeCalls++; return 17; } }
  const PZ = { object3d: { light: Light } };
  vm.runInNewContext(source, { PZ });
  const unload = Light.prototype.unload;
  vm.runInNewContext(source, { PZ });
  assert.equal(Light.prototype.unload, unload);
  const light = new Light();
  const liveMap = { dispose() { throw Error("Live light must stay allocated"); } };
  const liveLight = { threeObj: { shadow: { map: liveMap } } };
  light.threeObj = { shadow: { map: { dispose() { disposals++; } } } };
  assert.equal(light.unload(), 17);
  light.unload();
  assert.equal(disposals, 1);
  assert.equal(nativeCalls, 2);
  assert.equal(light.threeObj.shadow.map, null);
  assert.equal(liveLight.threeObj.shadow.map, liveMap);
  new Light().unload();
  light.threeObj = {};
  light.unload();
});
