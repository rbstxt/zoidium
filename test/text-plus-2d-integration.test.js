"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { convertNative } = require("../plugins/shape-plus/convert-native.js");

test("saved native Text advertises Text+ even when its plugin is missing", () => {
  const context = vm.createContext({ window: {}, PZ: {} });
  for (const part of ["state", "scanners"]) {
    vm.runInContext(fs.readFileSync(`zoidium/plugin-manager-${part}.js`, "utf8"), context);
  }
  const manager = context.window.ZoidiumPluginManagerInternals;
  const layer = { type: 7, effects: [], objects: [], properties: {} };
  assert.equal(manager.projectPluginRequirements({ object: layer }).length, 0);
  layer.zoidiumTextPlus2D = { schemaVersion: 1, characterProperties: { mode: 1 } };
  const result = JSON.parse(JSON.stringify(manager.projectPluginRequirements({ object: layer })));
  const dependency = result.find(plugin => plugin.id === "text-plus");
  assert.deepEqual(dependency.features, ["2d-characters"]);
  assert.deepEqual(dependency.objects, []);
  assert.equal(result.some(plugin => plugin.id === "effector-plus"), false);
});

test("Shape+ refuses to discard active native Text character animation", () => {
  assert.throws(() => convertNative({ type: 7, zoidiumTextPlus2D: {
    schemaVersion: 1, characterProperties: { mode: 4 },
  } }), /Set Character Mode to None/);
  assert.throws(() => convertNative({ type: 7, zoidiumTextPlus2D: {
    schemaVersion: 1, characterProperties: { mode: 0 },
  } }), /glyph outlines/);
});
