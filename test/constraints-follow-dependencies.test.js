"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");

test("Follow requires Constraints in nested saved payloads while cleared links and inert IDs do not", () => {
  const context = vm.createContext({ window: {}, PZ: {} });
  for (const file of ["plugin-manager-state.js", "plugin-manager-scanners.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../zoidium", file), "utf8"), context);
  }
  const scan = data => JSON.parse(JSON.stringify(context.window.ZoidiumPluginManagerInternals.projectPluginRequirements(data)));
  const constraint = data => scan(data).find(plugin => plugin.id === "constraints");
  assert.deepEqual(constraint({ nested: { type: 5, properties: { zoidiumFollow: "missing-uuid" } } }).features, ["follow"]);
  assert.deepEqual(constraint({ type: 5, properties: { zoidiumTrackTo: "a", zoidiumFollow: "b" } }).features, ["follow", "track-to"]);
  assert.equal(constraint({ type: 5, properties: { zoidiumFollow: "", zoidiumId: "id" } }), undefined);
  assert.equal(constraint({ properties: { zoidiumFollow: "unrelated" } }), undefined);
});
