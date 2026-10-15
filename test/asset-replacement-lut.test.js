"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
test("replaced LUT cache releases its old hold when core retains the bytes, including undo and redo", async () => {
  const Looks = { cube: { MAX_TEXT_LENGTH: 100, parseCubeLut: text => text, buildAtlas: text => text } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/magic-looks/looks-lut-assets.js"), "utf8"), { Looks });
  const assets = new Map(["old", "next"].map(key => [key, { key, references: 1, file: { size: 3, text: async () => key } }]));
  const list = {
    load(key) { const asset = assets.get(key); asset.references++; return asset; },
    unload(asset) { asset.references--; },
  };
  let current = "old";
  const effect = { parentProject: { assets: list }, properties: { lutData: { get: () => current } } };
  const cache = Looks.lutAssets.create(effect, {}, {}, { retained: key => assets.has(key) });
  await cache.prepare(0); assert.equal(assets.get("old").references, 2);
  current = "next"; await cache.prepare(0);
  assert.equal(assets.get("old").references, 1); assert.equal(assets.get("next").references, 2);
  current = "old"; await cache.prepare(0);
  assert.equal(assets.get("old").references, 2); assert.equal(assets.get("next").references, 1);
  current = "next"; await cache.prepare(0);
  assert.equal(assets.get("old").references, 1); assert.equal(assets.get("next").references, 2);
  cache.dispose(); assert.equal(assets.get("next").references, 1);
});
