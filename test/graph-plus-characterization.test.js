"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function load() {
  const sandbox = { module: { exports: {} }, console, PZ: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "zoidium/plugin-apis.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, "plugins/graph-plus/graph-plus.js"), "utf8"), sandbox);
  const plugin = sandbox.module.exports;
  if (plugin.__test.loadDependencies) plugin.__test.loadDependencies({
    apis: sandbox.ZoidiumPluginApis,
    getAsset: (_kind, file) => fs.readFileSync(path.join(root, file), "utf8"),
  });
  return plugin;
}

function graph() {
  const PZ = {
    ui: { panel: function () {}, splitPanel: function () {} },
    tween: { correctCurve: () => 0.5, easingList: [{}, { fn: (u) => u }, { fn: (u) => u * u }] },
  };
  return load().__test.gpDefineGraphEditor(PZ).graph.prototype;
}

function curve(right, left = { frame: 2, value: 3, controlPoints: [[-2, 1], [4, 6]] }) {
  const attributes = {};
  const group = { pz_valueScale: 2, pz_frameOffset: 5, pz_color: "red", style: { display: "none" } };
  graph().updateCurve.call({ options: { curveLineWidth: 2.5 } }, {
    parentElement: { parentElement: group },
    setAttributeNS: (_ns, name, value) => { attributes[name] = value; },
  }, left, right);
  return attributes;
}

const right = { frame: 12, value: 8, controlPoints: [[-4, 2], [2, 3]] };
test("Graph+ curve rendering pins linear, hold and corrected Bezier paths", () => {
  assert.deepEqual(curve({ ...right, tween: 1 }), {
    stroke: "red", "stroke-width": "2.5px", opacity: "0.15", d: "M 2 -6 L 12 -16",
  });
  assert.equal(curve({ ...right, tween: 0 }).d, "M 2 -6 L 12 -6 L 12 -16");
  assert.equal(curve({ ...right, tween: 257 }).d, "M 2 -6 C 4 -12, 10 -18, 12 -16");
  assert.equal(curve({ ...right, tween: 1, value: "text" }, { frame: NaN, value: 1 }).d, "M 0 0");
});

test("Graph+ sampled easing preserves all twenty segments", () => {
  const expected = "M 2 -6" + Array.from({ length: 20 }, (_, i) => {
    const u = (i + 1) / 20;
    return " L " + (2 + 10 * u) + " " + (-((8 - 3) * (u * u) + 3) * 2);
  }).join("");
  assert.equal(curve({ ...right, tween: 2 }).d, expected);
});
