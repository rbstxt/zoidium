"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/editor-identity-host.cjs");
const { createMeshDeformer } = require("../plugins/scene-plus/effector-mesh.js");

test("nested Delay samples each effector time once per scene pass and retains exact geometry", () => {
  const { THREE } = host();
  const calls = new Map();
  let amplitude = 2;
  const root = new THREE.Object3D();
  const chain = Array.from({length: 4}, (_, i) => {
    const node = new THREE.Object3D();root.add(node);
    return {node, effector: {
      historyFrames: () => i % 2 ? 4 : 0,
      workerCommand(time) {
        const key = i + ":" + time;calls.set(key, (calls.get(key) || 0) + 1);
        return i % 2 ? {kind: "delay", strength: 0.75, window: 4, mode: i === 1 ? 0 : 2} :
          {kind: "plain", position: [Math.sin(time) * amplitude, i, 0], rotation: [0, 0, time * 0.01], scale: [1, 1, 1], field: {type: 0}};
      },
    }};
  });
  const mesh = () => {
    const item = new THREE.Mesh(new THREE.BoxBufferGeometry(3, 4, 5), new THREE.MeshBasicMaterial());
    root.add(item);root.updateMatrixWorld(true);return item;
  };
  const deformer = createMeshDeformer(THREE);
  const bits = item => Array.from(new Uint32Array(item.geometry.attributes.position.array.buffer));
  try {
    const a = mesh(), b = mesh(), reference = mesh(), referenceB = mesh();
    b.position.set(4, -2, 1);referenceB.position.copy(b.position);root.updateMatrixWorld(true);
    const pass = { commands: new Map(), worlds: new Map() };
    deformer.deformMesh(a, chain, 20, 1, false, 0, pass);
    deformer.deformMesh(b, chain, 20, 1, false, 0, pass);
    assert.ok(calls.size > 10, "the probe exercises nested history");
    assert.ok([...calls.values()].every(count => count === 1), "each effector/time is read once across both meshes");
    assert.notDeepEqual(bits(a), bits(b), "each mesh keeps its own relative transform");
    deformer.deformMesh(reference, chain, 20, 1);
    assert.ok([...calls.values()].some(count => count > 1), "a new pass reads the properties again");
    assert.deepEqual(bits(a), bits(reference));
    deformer.deformMesh(referenceB, chain, 20, 1);
    assert.deepEqual(bits(b), bits(referenceB));
    const before = bits(a);amplitude = 7;
    deformer.deformMesh(a, chain, 20, 1, false, 0, {commands: new Map(), worlds: new Map()});
    assert.notDeepEqual(bits(a), before, "an edit at the same frame is never cached across passes");
  } finally {deformer.dispose();}
});
