"use strict";
const apis = require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const old = require("./worker-helper-originals.js");
const { createWorkerSource } = require("../plugins/scene-plus/effector-jobs.js");
const { GRAPH_MODULES, createGraphWorkerSource } = require("../plugins/material-plus/graph-worker.js");
const { evaluateMesh } = require("../plugins/scene-plus/effector-evaluate.js");
const nodes = require("../plugins/material-plus/graph-runtime.js")({}, null);
const local = value => Array.isArray(value) || ArrayBuffer.isView(value) ? Array.from(value, local)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, local(v)])) : value;
function workerRealm(source) {
  const messages = [];
  const sandbox = { console, performance: { now: () => 0 }, postMessage: data => messages.push(data) };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  assert.equal(sandbox.window, undefined);
  assert.equal(sandbox.document, undefined);
  assert.equal(sandbox.fetch, undefined);
  return { sandbox, messages };
}
function sources(directory, names) {
  return Object.fromEntries(names.map(name => [name, fs.readFileSync("plugins/" + directory + "/" + name, "utf8")]));
}
test("every shared table embeds its initializer without page globals or fetches", () => {
  const realm = workerRealm(["random", "props", "color", "gl", "json", "windows"].map(name => apis[name].workerSource()).join("\n"));
  const worker = realm.sandbox.ZoidiumPluginApis;
  for (const name of Object.keys(worker)) {
    assert.deepEqual(Object.keys(worker[name]), Object.keys(apis[name]));
    assert.equal(typeof worker[name].workerSource, "function");
    assert.equal(Object.keys(worker[name]).includes("workerSource"), false);
  }
  for (const seed of [-3, -0, 0, 1.1, 42, Infinity, NaN, "7", null]) {
    for (const index of [-1, 0, 1.5, 40]) for (const channel of [0, 10, 31]) {
      assert.equal(worker.random.effectorHash01(seed, index, channel), old.hash01(seed, index, channel));
      assert.deepEqual(local(worker.random.effectorHashUnitVector(seed, index, channel)), old.hashUnitVector(seed, index, channel));
    }
    assert.equal(worker.props.finiteOr(seed, 3), old.finiteOr(seed, 3));
    assert.equal(worker.color.clampUnit(seed), old.clampUnit(seed));
  }
  for (const a of [-0.5, 0, 0.25, 0.75, 1, 1.5, NaN, Infinity]) {
    for (const b of [0, 0.5, 1]) for (const c of [0, 0.3, 0.55, 1]) {
      assert.deepEqual(local(worker.color.hslToRgb(a, b, c)), old.hslToRgb(a, b, c));
      assert.deepEqual(local(worker.color.rgbToHsv01(a, b, c)), old.rgbToHsv(a, b, c));
      assert.deepEqual(local(worker.color.hsvToRgb01(a, b, c)), old.hsvToRgb(a, b, c));
    }
  }
  assert.deepEqual(local(worker.props.cloneJson({ a: [1, 2] })), { a: [1, 2] });
  assert.deepEqual(local(worker.json.parseJsonClean('{"ok":1,"__proto__":{"bad":true}}')), { ok: 1 });
  assert.equal(worker.windows.shouldCloseOnEscape({ key: "Escape" }), true);
  assert.equal(worker.gl.sameSize({ width: 4, height: 5 }, 4, 5), true);
});
test("generated mesh worker matches all fracture attributes and motion across frame orders", () => {
  const realm = workerRealm(createWorkerSource(sources("scene-plus", ["earcut.js", "effector-core.js", "effector-fracture.js", "effector-mesh.js", "effector-evaluate.js"])));
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const positions = new Float32Array([[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]].flatMap(face => face.flatMap(i => corners[i])));
  for (const distance of [0.2, 0.8, 0, 0.2]) {
    const input = { base: { positions, attributes: {}, count: positions.length / 3, index: null, groups: [], uvs: null, smooth: false, kind: "source" },
      sourceId: 1, polygonCount: 1, commands: [{ kind: "fracture", topology: { cells: 8, seed: 3, closed: true },
        motion: { distance, scatter: 0.1, spin: 0.3, offset: 5 }, relation: { identity: true } }] };
    realm.sandbox.onmessage({ data: { id: 1, input } });
    const result = realm.messages.pop();
    assert.equal(result.error, undefined);
    assert.deepEqual(local(result.value), local(evaluateMesh(input)));
  }
});
test("generated graph worker matches every procedural node's pixels across frame orders", () => {
  const realm = workerRealm(createGraphWorkerSource(sources("material-plus", GRAPH_MODULES)));
  for (const type of Object.keys(nodes.types)) {
    const n = nodes.createNode(type, "n");
    const graph = nodes.parse({ nodes: [n, nodes.createNode("output", "o")], links: [{ from: "n", fromPort: nodes.types[type].outputs[0]?.key, to: "o", toPort: "color" }] });
    for (const time of [0.5, 2, 0, 0.5]) {
      realm.sandbox.onmessage({ data: { id: 1, graph, size: 8, time, images: {} } });
      const result = realm.messages.pop();
      assert.equal(result.error, undefined, type);
      assert.deepEqual(local(result.outputs), local(nodes.evaluate(graph, 8, time, { images: {} })), type);
    }
  }
});
