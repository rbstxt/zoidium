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
function windowFixture(width = 800, height = 550) {
  const calls = [], style = { width: "1200px", height: "700px", left: "720px", top: "518px" };
  const facade = { resize: () => calls.push("resize"), panel: { _right: { bodyEl: { focus: () => calls.push("canvas focus") } } },
    host: { element: { style, ownerDocument: { defaultView: { innerWidth: width, innerHeight: height } } },
      setCollapsed: (value) => calls.push(["collapsed", value]),
      setMaximized: (value) => calls.push(["maximized", value]), isMaximized: () => true,
      focus: () => calls.push("window focus") } };
  return { facade, calls, style };
}

test("reopening restores collapse state, fits a moved window, resizes the graph and focuses its canvas", () => {
  const { facade, calls, style } = windowFixture();
  load().restoreFloatingWindow(facade);
  assert.deepEqual(calls, [["collapsed", false], ["maximized", true], "resize", "window focus", "canvas focus"]);
  assert.deepEqual(style, { width: "784px", height: "534px", left: "8px", top: "8px" });
});

test("viewport recovery handles zero size, negative coordinates and a viewport below graph minima", () => {
  const { facade, style } = windowFixture(360, 240);
  Object.assign(style, { width: "0px", height: "0px", left: "-2000px", top: "-100px" });
  load().fitFloatingWindow(facade);
  assert.deepEqual(style, { width: "344px", height: "224px", left: "8px", top: "8px" });
});

test("disposing a disabled CM3 property picker unloads deferred list rows and their subscriptions", () => {
  const calls = [];
  const panel = { enabled: false, objects: {}, list: {}, unloadListItem() {},
    objectsChanged() { assert.equal(this.objects, null); calls.push("rows unloaded"); },
    el: { remove: () => calls.push("removed") } };
  load().disposePanel(panel);
  assert.deepEqual(calls, ["rows unloaded", "removed"]);
});
