"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { createWorkerSource, createMeshJobs } = require("../plugins/scene-plus/effector-jobs.js");
const { GRAPH_MODULES, createGraphWorkerSource } = require("../plugins/material-plus/graph-worker.js");
function warningsFor(source, suffix = "") {
  const warnings = [], messages = [];
  const sandbox = { ZoidiumPluginApis, module: { exports: {} }, require,
    console: { warn: (...args) => warnings.push(args) },
    performance: { now: () => 0 }, postMessage: data => messages.push(data) };
  vm.createContext(sandbox);
  vm.runInContext(source + suffix, sandbox);
  return { sandbox, warnings, messages };
}
test("graph parse failure warns once and preserves the default graph recovery", () => {
  const buffers = require("../plugins/material-plus/graph-buffers.js");
  const images = require("../plugins/material-plus/graph-images.js");
  const types = require("../plugins/material-plus/graph-types.js");
  const source = fs.readFileSync("plugins/material-plus/graph-runtime.js", "utf8");
  const warnings = [];
  const sandbox = { ZoidiumPluginApis, module: { exports: {} },
    require: id => ({ "./graph-buffers.js": buffers, "./graph-images.js": images, "./graph-types.js": types })[id],
    console: { warn: (...args) => warnings.push(args) } };
  vm.runInNewContext(source, sandbox);
  const runtime = sandbox.module.exports({}, null);
  for (let i = 0; i < 3; i++) assert.deepEqual(runtime.parse("broken"), runtime.parse(runtime.defaultGraph()));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /^\[Zoidium\] Material\+ graph:/);
  assert.equal(warnings[0][1].name, "SyntaxError");
});
test("mesh and graph worker failures warn once and still post every job error", () => {
  const mesh = createWorkerSource({ "effector-evaluate.js": 'module.exports={createStageCache:()=>({}),evaluateMesh:()=>{throw new Error("bad mesh")}};' });
  const files = Object.fromEntries(GRAPH_MODULES.map(name => [name, ""]));
  files["graph-runtime.js"] = 'module.exports=()=>({evaluate:()=>{throw new Error("bad graph")}});';
  for (const source of [mesh, createGraphWorkerSource(files)]) {
    const realm = warningsFor(source);
    for (let id = 1; id < 4; id++) realm.sandbox.onmessage({ data: { id, input: {}, graph: {}, size: 8 } });
    assert.equal(realm.warnings.length, 1);
    assert.equal(realm.messages.length, 3);
    assert.match(realm.messages[0].error, /bad (mesh|graph)/);
    assert.match(realm.warnings[0][0], /^\[Zoidium\]/);
  }
});
test("interactive mesh job failure warns once per key and keeps export rejection", async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const host = { Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
      Worker: class { postMessage() { throw new Error("dispatch failed"); } terminate() {} } };
    const jobs = createMeshJobs("", host);
    for (let i = 0; i < 2; i++) {
      const consumer = {};
      const entry = jobs.request(consumer, "catch-test-key", {});
      await assert.rejects(entry.promise, /dispatch failed/);
      jobs.release(consumer);
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /^\[Zoidium\] Effector:/);
    jobs.dispose();
  } finally { console.warn = original; }
});
test("PBR environment failures preserve cleanup and warn once per source", () => {
  const source = fs.readFileSync("plugins/material-plus/pbr-plus.js", "utf8");
  const realm = warningsFor(source, "\nmodule.exports = {syncEnvironmentMap};");
  const env = { getTexture() { throw new Error("environment unavailable"); } };
  const material = { threeObj: {}, parentLayer: { envMap: env }, properties: { reflection: { value: 1 } } };
  for (let i = 0; i < 3; i++) realm.sandbox.module.exports.syncEnvironmentMap(material);
  assert.equal(realm.warnings.length, 1);
  assert.equal(material._zoidiumEnvironmentSource, null);
  assert.equal(material.threeObj.envMap, undefined);
});
test("Scene+ Node module evaluation errors fail loudly", () => {
  const source = fs.readFileSync("plugins/scene-plus/scene-plus.js", "utf8");
  const failure = new TypeError("source evaluation failed");
  assert.throws(() => vm.runInNewContext(source, { module: { exports: {} }, require() { throw failure; } }), error => error === failure);
});
