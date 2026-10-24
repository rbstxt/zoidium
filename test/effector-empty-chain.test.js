"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const state = require("../plugins/scene-plus/scene-state.js");
const { createDeformationSupport } = require("../plugins/scene-plus/scene-deform.js");
const core = require("../plugins/scene-plus/effector-core.js");

function harness() {
  const THREE = {};
  class Scene { update() {} }
  const calls = [];
  const mesh = { isMesh: true, geometry: {}, traverse(visit) { visit(this); } };
  const source = { threeObj: mesh };
  const cache = { sourceStage(node) { calls.push(["stage", node]); return { positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]) }; },
    deformMesh(...args) { calls.push(["deform", ...args]); },
    restoreMesh(mesh) { calls.push(["restore", mesh]); }, restoreTree() {}, pending() { return []; }, dispose() {} };
  const previous = { cache: state.meshDeformerCache, three: state.meshDeformerThree, library: state.library, jobs: state.meshJobs };
  state.meshDeformerCache = cache;
  state.meshDeformerThree = THREE;
  state.library = { core };
  const watchers = new Set();
  const editor = { project: {}, onProjectChanged: { watch(fn) { watchers.add(fn); }, unwatch(fn) { watchers.delete(fn); } } };
  const support = createDeformationSupport({ layer: { scene: Scene } }, THREE, editor);
  return { calls, mesh, source, support, editor, watchers, cache, close() {
    support.deactivate();
    state.meshDeformerCache = previous.cache;
    state.meshDeformerThree = previous.three;
    state.library = previous.library;
    state.meshJobs = previous.jobs;
  } };
}

test("scenes without effectors skip the render tree and matrix pass", () => {
  const h = harness();
  try {
    let matrixPasses = 0;
    h.mesh.traverse = () => { throw new Error("unused render tree visited"); };
    const scene = { objects: Array(420).fill(h.source), threeObj: { updateMatrixWorld() { matrixPasses++; } } };
    for (const frame of [8, 12, 0]) h.support.apply(scene, frame);
    assert.deepEqual(h.calls, []);
    assert.equal(matrixPasses, 0);
  } finally { h.close(); }
});

test("object preparation tracks geometry that needs restoring before the first scene apply", async () => {
  const h = harness();
  const layer = { objects: [] };
  const effector = { parentLayer: layer, threeObj: {}, objects: [h.source], properties: {},
    deformPositions() {}, update() {} };
  layer.objects.push(effector);
  try {
    state.meshJobs = {};
    await h.support.prepareObject(effector, 12);
    assert.equal(h.calls.filter(call => call[0] === "deform").length, 1);
    h.calls.length = 0;
    layer.objects = [];
    h.support.apply(layer, 12);
    h.support.apply(layer, 13);
    assert.deepEqual(h.calls, [["restore", h.mesh]]);
  } finally { h.close(); }
});

test("disabled effectors skip bounds and enabled effectors still derive them", () => {
  const h = harness();
  let enabled = 0;
  const effector = { threeObj: {}, objects: [h.source], properties: { enabled: { get: () => enabled } }, deformPositions() {} };
  try {
    const scene = { objects: [effector] };
    h.support.apply(scene, 3);
    assert.deepEqual(h.calls, []);
    h.calls.length = 0;
    enabled = 1;
    h.support.apply(scene, 9);
    assert.equal(h.calls[0][0], "stage");
    const chain = h.calls[1][2];
    assert.equal(chain[0].effector, effector);
    assert.deepEqual(chain[0].bounds, { min: [0,0,0], max: [1,1,0] });
    assert.equal(h.calls[1][3], 9);
    h.calls.length = 0;
    enabled = 0;
    h.support.apply(scene, 10);
    h.support.apply(scene, 11);
    assert.deepEqual(h.calls, [["restore", h.mesh]]);
    enabled = 1;
    h.support.apply(scene, 12);
    h.calls.length = 0;
    scene.objects = [];
    h.support.apply(scene, 13);
    h.support.apply(scene, 14);
    assert.deepEqual(h.calls, [["restore", h.mesh]], "removed meshes also restore once");
  } finally { h.close(); }
});

test("render-node mapping reads children linearly and sees same-sized topology replacements", () => {
  const { mapRenderNodes } = require("../plugins/scene-plus/scene-clone.js");
  let reads = 0;
  const children = Array.from({ length: 420 }, () => ({ children: [] }));
  const source = { children: new Proxy(children, { get(target, key) {
    if (/^\d+$/.test(String(key))) reads++;
    return target[key];
  } }) };
  const rendered = { children: children.map(() => ({ children: [] })) };
  let nodes = mapRenderNodes(source, rendered);
  assert.equal(reads, 420);
  assert.equal(nodes.get(children[419]), rendered.children[419]);
  const previous = children[0];
  children[0] = { children: [] };
  rendered.children[0] = { children: [] };
  nodes = mapRenderNodes(source, rendered);
  assert.equal(nodes.has(previous), false);
  assert.equal(nodes.get(children[0]), rendered.children[0]);
  assert.equal(reads, 840);
});

test("active effector evaluation maps 420 authored children without repeated tree searches", () => {
  const h = harness();
  let reads = 0;
  const meshes = Array.from({ length: 420 }, () => ({
    isMesh: true, geometry: {}, children: [], traverse(visit) { visit(this); },
  }));
  const children = new Proxy(meshes, { get(target, key) {
    if (/^\d+$/.test(String(key))) reads++;
    return target[key];
  } });
  const effector = {
    threeObj: { children }, deformPositions() {}, properties: {},
    objects: meshes.map(threeObj => ({ threeObj })),
  };
  try {
    h.support.apply({ objects: [effector] }, 3);
    assert.equal(reads, 840, "one parallel source/render traversal");
    assert.equal(h.calls.filter(call => call[0] === "deform").length, 420);
    assert.equal(h.calls.filter(call => call[0] === "stage").length, 420);
  } finally { h.close(); }
});

test("project replacement restores old deformations and releases the retained scene before another update", () => {
  const h = harness();
  const effector = { threeObj: {}, objects: [h.source], properties: {}, deformPositions() {} };
  const scene = { objects: [effector] };
  try {
    h.support.apply(scene, 3);
    h.calls.length = 0;
    h.editor.project = {};
    for (const watch of h.watchers) watch();
    assert.deepEqual(h.calls, [["restore", h.mesh]]);
    h.calls.length = 0;
    for (const watch of h.watchers) watch();
    assert.deepEqual(h.calls, [], "the previous scene is no longer retained");
  } finally { h.close(); }
  assert.equal(h.watchers.size, 0, "disable removes the project watcher");
});

test("an in-flight object preparation cannot restore ownership of a replaced project", async () => {
  const h = harness(), layer = { objects: [] };
  const effector = { parentLayer: layer, threeObj: {}, objects: [h.source], properties: {},
    deformPositions() {}, update() {} };
  layer.objects.push(effector);
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  h.cache.pending = () => { h.cache.pending = () => []; return [pending]; };
  try {
    state.meshJobs = {};
    const preparing = h.support.prepareObject(effector, 12);
    h.editor.project = {};
    for (const watch of h.watchers) watch();
    h.calls.length = 0;
    complete();
    await preparing;
    assert.deepEqual(h.calls, [], "old preparation exits before another deformation pass");
  } finally { complete(); h.close(); }
});
