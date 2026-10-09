"use strict";

// Coverage for Plexus: link renderers match a brute-force neighbour search,
// the point and link caps hold, the frame output does not depend on frame
// history, and the sound effector never reads a live analyser.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function setup() {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const root = new PZ.object3d.plexus();
  root.load(null);
  return { PZ, THREE, root };
}

function addEffector(PZ, root, subType, name) {
  const effector = new PZ.object3d.plexus.object();
  root.objects.push(effector);
  effector.load({ objectKind: 1, subType, properties: {} });
  effector.applyPreset(name);
  return effector;
}

function lineMeshKey(x, y, z) {
  return [x, y, z].map((v) => v.toFixed(3)).join(",");
}

test("line renderer links exactly the pairs a brute-force search finds", () => {
  const { root } = setup();
  const lines = root.objects[1];
  lines.properties.renderer.maxDistance.set(110);
  lines.properties.renderer.maxConnections.set(10);
  root.update(0);

  const source = root.objects[0].sourcePoints();
  const count = source.length / 3;
  const indexOf = new Map();
  for (let i = 0; i < count; i++) {
    indexOf.set(lineMeshKey(source[i * 3], source[i * 3 + 1], source[i * 3 + 2]), i);
  }
  const expected = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = source[i * 3] - source[j * 3];
      const dy = source[i * 3 + 1] - source[j * 3 + 1];
      const dz = source[i * 3 + 2] - source[j * 3 + 2];
      if (dx * dx + dy * dy + dz * dz < 110 * 110) expected.push(i + "-" + j);
    }
  }

  const geometry = root.lineMesh.geometry;
  const vertices = geometry.drawRange.count;
  const positions = geometry.attributes.position.array;
  const found = [];
  for (let s = 0; s < vertices / 2; s++) {
    const a = indexOf.get(lineMeshKey(positions[s * 6], positions[s * 6 + 1], positions[s * 6 + 2]));
    const b = indexOf.get(lineMeshKey(positions[s * 6 + 3], positions[s * 6 + 4], positions[s * 6 + 5]));
    assert.ok(a !== undefined && b !== undefined, "segment endpoints are source points");
    found.push(Math.min(a, b) + "-" + Math.max(a, b));
  }
  assert.equal(found.length, expected.length, "same number of links");
  assert.deepEqual(found.slice().sort(), expected.slice().sort());
});

test("link renderers stay within the point caps and write valid indices", () => {
  const { PZ, root } = setup();
  root.objects[0].properties.geometry.primitiveCount.set(60000);
  const lines = root.objects[1];
  lines.properties.renderer.maxDistance.set(110);
  lines.properties.renderer.maxConnections.set(10);
  root.update(0);
  assert.ok(root._count > 12000, "source is larger than the link cap");
  assert.ok(root.lineMesh.geometry.drawRange.count <= 12000 * 10 * 2, "line vertices bounded by the cap");

  root.objects[1].properties.renderer.rendererType.set(2);
  root.objects[1].properties.renderer.maxDistance.set(60);
  root.update(0);
  const index = root.mesh.geometry.index;
  assert.ok(Array.isArray(index));
  assert.equal(index.length % 3, 0, "triangle list");
  const limit = Math.min(root._count, 4000);
  for (const value of index) assert.ok(value < limit, "facet indices within the mesh cap");
  assert.ok(PZ);
});

test("source points are cached until their inputs change", () => {
  const { root } = setup();
  const primitives = root.objects[0];
  const first = primitives.sourcePoints();
  assert.equal(primitives.sourcePoints(), first, "same array while inputs are unchanged");
  primitives.properties.geometry.primitiveCount.set(300);
  const second = primitives.sourcePoints();
  assert.notEqual(second, first, "regenerated when the count changes");
  assert.equal(second.length / 3, 300);
});

function renderSnapshot(root) {
  const count = root._count;
  return Array.from(root.pointCloud.geometry.attributes.position.array.slice(0, count * 3));
}

test("frame output is a function of the frame, not of the frames rendered before", () => {
  const direct = setup();
  addEffector(direct.PZ, direct.root, 0, "noise");
  direct.root.update(5);
  const expected = renderSnapshot(direct.root);

  const history = setup();
  addEffector(history.PZ, history.root, 0, "noise");
  for (const frame of [0, 1, 2, 3, 4, 50, 5]) history.root.update(frame);
  assert.deepEqual(renderSnapshot(history.root), expected);
});

test("sound effector never reads a live analyser", () => {
  const plain = setup();
  addEffector(plain.PZ, plain.root, 6, "noise").properties.effector.effectorType.set(6);
  plain.root.update(12);
  const expected = renderSnapshot(plain.root);

  const hostile = setup();
  addEffector(hostile.PZ, hostile.root, 6, "noise").properties.effector.effectorType.set(6);
  let reads = 0;
  globalThis.CM = {
    playback: {
      get audioDst() {
        reads++;
        throw new Error("live analyser read");
      },
    },
  };
  try {
    hostile.root.update(12);
  } finally {
    delete globalThis.CM;
  }
  assert.equal(reads, 0, "no analyser access");
  assert.deepEqual(renderSnapshot(hostile.root), expected);
});

test("sound effector with an undecoded audio layer uses neutral level, deterministically", () => {
  const { PZ, root } = setup();
  const effector = addEffector(PZ, root, 6, "noise");
  effector.properties.effector.effectorType.set(6);
  effector.properties.effector.audioLayer.set("clip.wav");
  root.update(3);
  const first = renderSnapshot(root);
  root.update(9);
  root.update(3);
  assert.deepEqual(renderSnapshot(root), first);
});

test("facets and triangulation render without throwing on the default source", () => {
  const { root } = setup();
  for (const type of [2, 3]) {
    root.objects[1].properties.renderer.rendererType.set(type);
    root.objects[1].properties.renderer.maxDistance.set(110);
    root.update(0);
    assert.ok(root.mesh.visible);
    assert.equal(root.mesh.geometry.index.length % 3, 0);
  }
});
