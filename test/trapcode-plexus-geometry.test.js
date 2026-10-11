"use strict";

// Characterization of Plexus OBJ sampling (the SEC-05 area): sampleOBJ
// normalizes mesh bounds to [-0.5, 0.5] so Size maps predictably, spreads
// samples with a prime stride, and falls back to a primitive when no mesh is
// ready. These pins must hold before and after the ingestion caps land.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env");

function makeObj() {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const obj = new PZ.object3d.plexus.object();
  obj.load({ objectKind: 0, subType: 2, properties: {} });
  assert.equal(obj.properties.geometry.geometryType.get(0), 2, "OBJ geometry type selected");
  return obj;
}

// A right triangle in the z=0 plane: x in [0, 30], y in [0, 60].
function triangle() {
  return [0, 0, 0, 30, 0, 0, 0, 60, 0];
}

function withSource(obj, source) {
  obj._assets.ready = () => source;
}

test("sampleOBJ normalizes bounds into the Size box", () => {
  const obj = makeObj();
  withSource(obj, triangle());
  const points = obj.sampleOBJ(3, [100, 200, 300], 7);
  assert.equal(points.length, 3);
  // Prime stride (i * 7919) % 3 visits vertices in order 0, 2, 1.
  // Vertex 0 is (minX, minY): maps to the negative corner of the Size box.
  assert.deepEqual(points[0], [-50, -100, 0]);
  // Vertex 2 is (minX, maxY): positive Y corner.
  assert.deepEqual(points[1], [-50, 100, 0]);
  // Vertex 1 is (maxX, minY): positive X corner.
  assert.deepEqual(points[2], [50, -100, 0]);
});

test("sampleOBJ spreads samples with a deterministic prime stride", () => {
  const first = makeObj();
  withSource(first, triangle());
  const a = first.sampleOBJ(9, [10, 10, 10], 7);
  const second = makeObj();
  withSource(second, triangle());
  const b = second.sampleOBJ(9, [10, 10, 10], 99);
  assert.deepEqual(a, b, "sampling does not depend on the seed");
  const unique = new Set(a.map((point) => point.join(",")));
  assert.equal(unique.size, 3, "stride cycles through every source vertex");
  assert.deepEqual(first.sampleOBJ(9, [10, 10, 10], 7), a, "repeated calls agree");
});

test("sampleOBJ falls back to a primitive when no mesh is ready", () => {
  const obj = makeObj();
  withSource(obj, null);
  const points = obj.sampleOBJ(5, [10, 10, 10], 7);
  assert.equal(points.length, 5, "fallback still produces the requested count");
  withSource(obj, [1, 2]);
  assert.equal(obj.sampleOBJ(5, [10, 10, 10], 7).length, 5, "a degenerate source falls back too");
});
