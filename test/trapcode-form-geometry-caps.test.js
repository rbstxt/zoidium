"use strict";

// SEC-05 follow-up: Form's T.loadGeometryPositions enforces the same decoded
// vertex cap as Plexus (T.plexusGeometry.MAX_GEOMETRY_VERTICES). An oversized
// model resolves to null, which Form treats as "no mesh" and falls back to a
// random scatter (sampleModel), instead of exhausting memory.

const assert = require("node:assert/strict");
const test = require("node:test");

const { loadSuite } = require("./trapcode-env");

function projectWithMesh(PZ, vertexCount) {
  PZ.asset.geometry = class {
    async getGeometry() {
      if (vertexCount === null) return {};
      return { attributes: { position: { array: new Float32Array(vertexCount * 3) } } };
    }
  };
  const asset = { id: "model" };
  return {
    assets: {
      load(value) {
        assert.equal(value, "model-ref");
        return asset;
      },
      unload(loaded) {
        assert.equal(loaded, asset);
      },
    },
  };
}

function withWarnCapture(run) {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  return Promise.resolve()
    .then(run)
    .finally(() => {
      console.warn = original;
    })
    .then((result) => ({ result, warnings }));
}

test("a small decoded mesh resolves to a position copy", async () => {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const positions = await PZ.trapcode.loadGeometryPositions(
    projectWithMesh(PZ, 4),
    "model-ref",
  );
  assert.ok(positions instanceof Float32Array);
  assert.equal(positions.length, 12);
});

test("a mesh at exactly the Plexus vertex limit is accepted", async () => {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  assert.equal(PZ.trapcode.plexusGeometry.MAX_GEOMETRY_VERTICES, 500000);
  const positions = await PZ.trapcode.loadGeometryPositions(
    projectWithMesh(PZ, 500000),
    "model-ref",
  );
  assert.ok(positions instanceof Float32Array);
  assert.equal(positions.length, 1500000);
});

test("a mesh past the Plexus vertex limit resolves to null with a warning", async () => {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const { result, warnings } = await withWarnCapture(() =>
    PZ.trapcode.loadGeometryPositions(projectWithMesh(PZ, 500001), "model-ref"),
  );
  assert.equal(result, null);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /500001 vertices \(limit 500000\)/);
});

test("the limit is read from the Plexus helper, not a hardcoded copy", async () => {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const original = PZ.trapcode.plexusGeometry.MAX_GEOMETRY_VERTICES;
  PZ.trapcode.plexusGeometry.MAX_GEOMETRY_VERTICES = 10;
  try {
    const { result } = await withWarnCapture(() =>
      PZ.trapcode.loadGeometryPositions(projectWithMesh(PZ, 11), "model-ref"),
    );
    assert.equal(result, null);
    const kept = await PZ.trapcode.loadGeometryPositions(projectWithMesh(PZ, 10), "model-ref");
    assert.ok(kept instanceof Float32Array);
  } finally {
    PZ.trapcode.plexusGeometry.MAX_GEOMETRY_VERTICES = original;
  }
});

test("the fallback cap applies when plexus-geometry has not loaded", async () => {
  const { PZ } = loadSuite(["trapcode-common.js"]);
  assert.equal(PZ.trapcode.plexusGeometry, undefined);
  const kept = await PZ.trapcode.loadGeometryPositions(projectWithMesh(PZ, 8), "model-ref");
  assert.ok(kept instanceof Float32Array);
  const { result } = await withWarnCapture(() =>
    PZ.trapcode.loadGeometryPositions(projectWithMesh(PZ, 500001), "model-ref"),
  );
  assert.equal(result, null);
});

test("a mesh without positions resolves to null", async () => {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const result = await PZ.trapcode.loadGeometryPositions(projectWithMesh(PZ, null), "model-ref");
  assert.equal(result, null);
});
