"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { queryObjects } = require("node:v8");

test("plugin usage indexes do not own abandoned project instances", async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-manager-state.js", "utf8"), sandbox);
  const manager = sandbox.window.ZoidiumPluginManagerInternals;
  const names = ["trackedPluginMaterials", "missingPluginMaterials", "trackedPluginObjects",
    "missingPluginObjects", "trackedPluginResources", "missingPluginResources",
    "missingNumericObjects", "missingNumericLayers"];
  const references = new Map(names.map(name => [name, []]));
  const counts = Object.fromEntries(names.map(name => [name, []]));
  function track(name) {
    const item = { parentProject: {} };
    manager[name].add(item);
    manager[name].add(item);
    return new WeakRef(item);
  }
  for (const n of [5, 10, 20]) {
    for (const name of names) while (references.get(name).length < n) {
      references.get(name).push(track(name));
    }
    await new Promise(resolve => setImmediate(resolve));
    queryObjects(class CollectionTrigger {});
    for (const name of names) counts[name].push(references.get(name).filter(ref => ref.deref()).length);
  }
  assert.deepEqual(counts, Object.fromEntries(names.map(name => [name, [0, 0, 0]])));
  for (const name of names) {
    const current = {};
    manager[name].add(current);
    assert.equal(manager[name].has(current), true);
    manager[name].delete(current);
    assert.equal(manager[name].has(current), false);
    assert.equal(manager[name].size, 0);
  }
});
