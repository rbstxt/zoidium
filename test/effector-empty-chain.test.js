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
    deformMesh(...args) { calls.push(["deform", ...args]); }, restoreTree() {}, dispose() {} };
  const previous = { cache: state.meshDeformerCache, three: state.meshDeformerThree, library: state.library };
  state.meshDeformerCache = cache;
  state.meshDeformerThree = THREE;
  state.library = { core };
  const support = createDeformationSupport({ layer: { scene: Scene } }, THREE);
  return { calls, mesh, source, support, close() {
    support.deactivate();
    state.meshDeformerCache = previous.cache;
    state.meshDeformerThree = previous.three;
    state.library = previous.library;
  } };
}

test("empty deformer chains skip source staging but still restore former deformation", () => {
  const h = harness();
  try {
    h.support.apply({ objects: [h.source] }, 8);
    assert.deepEqual(h.calls, [["deform", h.mesh, [], 8, 1, false]]);
  } finally { h.close(); }
});

test("disabled effectors skip bounds and enabled effectors still derive them", () => {
  const h = harness();
  let enabled = 0;
  const effector = { threeObj: {}, objects: [h.source], properties: { enabled: { get: () => enabled } }, deformPositions() {} };
  try {
    h.support.apply({ objects: [effector] }, 3);
    assert.deepEqual(h.calls, [["deform", h.mesh, [], 3, 1, false]]);
    h.calls.length = 0;
    enabled = 1;
    h.support.apply({ objects: [effector] }, 9);
    assert.equal(h.calls[0][0], "stage");
    const chain = h.calls[1][2];
    assert.equal(chain[0].effector, effector);
    assert.deepEqual(chain[0].bounds, { min: [0,0,0], max: [1,1,0] });
    assert.equal(h.calls[1][3], 9);
  } finally { h.close(); }
});
