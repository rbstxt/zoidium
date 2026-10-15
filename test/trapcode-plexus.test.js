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

test("triangulation never invents faces beyond the configured distance", () => {
  const {PZ} = loadSuite(["trapcode-common.js", "plexus.js"]);
  const plexus = new PZ.object3d.plexus();
  plexus._work = new Float32Array([0,0,0, 100,0,0, 0,100,0]);
  assert.deepEqual(plexus.triangulate(3, 1), []);
  assert.ok(plexus.triangulate(3, 150).length >= 3);
});

function lineSnapshot(root) {
  const geometry = root.lineMesh.geometry;
  const count = geometry.drawRange.count;
  return { count, points: Array.from(geometry.attributes.position.array.slice(0, count * 3)) };
}

test("effector amount and renderer lineType exist with donor defaults", () => {
  const { PZ, root } = setup();
  const effector = addEffector(PZ, root, 0, "noise");
  assert.equal(effector.properties.effector.amount.get(0), 100);
  const lines = root.objects[1];
  const lineType = lines.properties.renderer.lineType;
  assert.equal(lineType.get(0), 0);
  assert.equal(lines.properties.renderer.maxDistance.get(0), 200);
  assert.equal(lines.properties.renderer.maxConnections.get(0), 5);
  assert.ok(effector.properties.effector.soundStrength);
});

test("every lineType renders deterministically and adjacency follows creation order", () => {
  const snapshots = [];
  for (const lineType of [0, 1, 2]) {
    const { root } = setup();
    const lines = root.objects[1];
    lines.properties.renderer.lineType.set(lineType);
    lines.properties.renderer.maxDistance.set(110);
    lines.properties.renderer.maxConnections.set(10);
    // Shuffled frame order before the captured frame.
    for (const frame of [4, 9, 2, 7]) root.update(frame);
    snapshots.push(lineSnapshot(root));
    // Same mode renders identically after a reshuffle.
    for (const frame of [7, 2, 9, 4]) root.update(frame);
    assert.deepEqual(lineSnapshot(root), snapshots[lineType], "mode " + lineType + " is order-independent");
  }
  // Adjacency links each point to its next points in creation order: with a
  // tiny maxDistance the distance modes find nothing but adjacency still
  // links, and its first segment starts at point 0.
  const { root } = setup();
  const lines = root.objects[1];
  lines.properties.renderer.maxDistance.set(0.0001);
  lines.properties.renderer.maxConnections.set(2);
  lines.properties.renderer.lineType.set(1);
  root.update(0);
  const adjacent = lineSnapshot(root);
  assert.ok(adjacent.count > 0, "adjacency links regardless of distance");
  const first = adjacent.points.slice(0, 6);
  const source = root.objects[0].sourcePoints();
  assert.deepEqual(first, [source[0], source[1], source[2], source[3], source[4], source[5]]);

  const { PZ, root: root2 } = setup();
  const lines2 = root2.objects[1];
  lines2.load({
    objectKind: 2,
    subType: 1,
    properties: {
      common: { enabled: 1 },
      renderer: { rendererType: 1, lineType: 2, maxDistance: 110, maxConnections: 10 },
    },
  });
  assert.equal(lines2.properties.renderer.lineType.get(0), 2);
  for (const frame of [4, 9, 2, 7]) root2.update(frame);
  assert.ok(lineSnapshot(root2).points.length > 0, "donor-shaped lines render");
});

test("shape mode only links points from the same source object", () => {
  const { PZ, root } = setup();
  // Two far-apart sources: distance mode links across, shape mode must not.
  const geo = root.objects[0];
  geo.properties.geometry.primitiveCount.set(30);
  const second = new PZ.object3d.plexus.object();
  root.objects.push(second);
  second.load({ objectKind: 0, subType: 3, properties: {} });
  second.applyPreset("primitives");
  second.properties.geometry.primitiveCount.set(30);
  second.properties.geometry.position.set([5000, 0, 0]);
  const lines = root.objects[1];
  lines.properties.renderer.maxDistance.set(1e6);
  lines.properties.renderer.maxConnections.set(10);
  lines.properties.renderer.lineType.set(0);
  root.update(0);
  const across = lineSnapshot(root).count;
  lines.properties.renderer.lineType.set(2);
  root.update(0);
  const within = lineSnapshot(root).count;
  assert.ok(across > 0 && within > 0, "both modes link something");
  assert.ok(within < across, "shape links fewer pairs than distance (" + within + " < " + across + ")");
  // Every shape segment stays on one side of the gap.
  const geometry = root.lineMesh.geometry;
  const positions = geometry.attributes.position.array;
  for (let v = 0; v < within; v += 2) {
    const ax = positions[v * 3];
    const bx = positions[(v + 1) * 3];
    assert.ok((ax < 2500) === (bx < 2500), "segment " + v + " stays within one source");
  }
});

test("effector amount 100 keeps legacy output, 0 bypasses the effector", () => {
  const { PZ, root } = setup();
  const effector = addEffector(PZ, root, 0, "noise");
  effector.properties.effector.amount.set(100);
  root.update(0);
  const full = Array.from(root._work.slice(0, root._count * 3));
  effector.properties.effector.amount.set(0);
  root.update(0);
  const bypassed = Array.from(root._work.slice(0, root._count * 3));
  assert.notDeepEqual(bypassed, full);
  // Bypassed output equals the raw gathered sources.
  root.update(0);
  assert.deepEqual(Array.from(root._work.slice(0, root._count * 3)), bypassed);
});
