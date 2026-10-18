"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function load() {
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../zoidium/plugin-apis.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../plugins/graph-plus/graph-plus.js'), 'utf8'), sandbox);
  sandbox.module.exports.__test.loadDependencies({ apis: sandbox.ZoidiumPluginApis,
    getAsset: (_kind, file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8') });
  return sandbox.module.exports.__test;
}
test("reopening reveals the window, resizes the graph and focuses its canvas", () => {
  const calls = [];
  const facade = { resize: () => calls.push("resize"),
    panel: { _right: { bodyEl: { focus: () => calls.push("canvas focus") } } },
    host: { reveal: () => calls.push("reveal") } };
  load().restoreFloatingWindow(facade);
  assert.deepEqual(calls, ["reveal", "resize", "canvas focus"]);
});

test("disposing a disabled CM3 property picker unloads deferred list rows and their subscriptions", () => {
  const calls = [];
  const panel = { enabled: false, objects: {}, list: {}, unloadListItem() {},
    objectsChanged() { assert.equal(this.objects, null); calls.push("rows unloaded"); },
    el: { remove: () => calls.push("removed") } };
  load().disposePanel(panel);
  assert.deepEqual(calls, ["rows unloaded", "removed"]);
});


test("rebuilding carries manual picks without duplicating an already-following target selection", () => {
  const picked = {}, following = {};
  function Old() { this._left = { selection: [picked] }; this.el = { remove() {} }; }
  function Next() { this._left = { selection: [following, picked] }; }
  const win = { panel: new Old(), setPanel(panel) { this.panel = panel; } };
  assert.equal(load().rebuildOpenPanels([win], Old, Next), 1);
  assert.deepEqual(win.panel._left.selection, [picked]);
});
