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

function geometryLib() {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  return PZ.trapcode.plexusGeometry;
}

function warnings(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try {
    return { result: fn(), lines };
  } finally {
    console.warn = original;
  }
}

test("small OBJ text parses through the minimal vertex reader", () => {
  const geometry = geometryLib();
  const text = "# test\no 1 2 3\nv 0 0 0\nv 1 2 3\nvn 0 1 0\n";
  assert.deepEqual(geometry.parseGeometryText(text), [0, 0, 0, 1, 2, 3]);
  assert.equal(geometry.parseGeometryText("not a model"), null);
  assert.equal(geometry.parseGeometryText("{invalid json"), null);
  assert.equal(geometry.parseGeometryText(null), null);
});

test("source text beyond the byte cap is rejected before parsing", () => {
  const geometry = geometryLib();
  const big = "#".repeat(geometry.MAX_GEOMETRY_TEXT_BYTES + 1);
  const { result, lines } = warnings(() => geometry.parseGeometryText(big));
  assert.equal(result, null);
  assert.equal(lines.length, 1, "one clean console message");
  assert.match(lines[0], /Trapcode Plexus/);
  assert.match(lines[0], /16,777,216|16777216/);
  assert.match(lines[0], /primitive/);
});

test("an OBJ declaring more vertices than the cap is rejected", () => {
  const geometry = geometryLib();
  const many = "v 0 0 0\n".repeat(geometry.MAX_GEOMETRY_VERTICES + 1);
  assert.ok(many.length < geometry.MAX_GEOMETRY_TEXT_BYTES, "test input stays under the byte cap");
  const { result, lines } = warnings(() => geometry.parseGeometryText(many));
  assert.equal(result, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /vertices/);
  const ok = "v 1 2 3\n".repeat(3000);
  assert.equal(geometry.parseGeometryText(ok).length, 9000, "inputs under the cap still parse");
});

test("computeBounds measures the source for normalization", () => {
  const geometry = geometryLib();
  assert.deepEqual(geometry.computeBounds(triangle()), {
    minX: 0, minY: 0, minZ: 0, maxX: 30, maxY: 60, maxZ: 0,
  });
  assert.deepEqual(geometry.computeBounds([]), {
    minX: -0.5, minY: -0.5, minZ: -0.5, maxX: 0.5, maxY: 0.5, maxZ: 0.5,
  });
});

test("a decoded mesh beyond the vertex cap resolves to no mesh", async () => {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const geometry = PZ.trapcode.plexusGeometry;
  const huge = new Array((geometry.MAX_GEOMETRY_VERTICES + 1) * 3).fill(0);
  const small = [0, 0, 0, 1, 1, 1];
  let array = huge;
  PZ.asset.geometry = class {
    readFile() {
      throw new Error("no text");
    }
    getGeometry() {
      return Promise.resolve({ attributes: { position: { array } } });
    }
  };
  const project = { assets: { load: () => ({}), unload() {} } };
  const { result, lines } = await (async () => {
    const collected = [];
    const original = console.warn;
    console.warn = (...args) => collected.push(args.join(" "));
    try {
      const out = await geometry.loadMeshVertices(project, "mesh");
      return { result: out, lines: collected };
    } finally {
      console.warn = original;
    }
  })();
  assert.equal(result, null, "oversized decoded mesh is rejected");
  assert.equal(lines.length, 1);
  array = small;
  assert.deepEqual(await geometry.loadMeshVertices(project, "mesh"), small, "small meshes still load");
});
