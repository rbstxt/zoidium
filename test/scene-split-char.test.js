"use strict";

// Characterization net for the scene-plus split: pins the entry's public
// test surface so the file can move into cohesive modules without changing
// behavior. Uses only plain require, which works before and after the split.

require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { _test } = require("../plugins/scene-plus/scene-plus.js");

test("scene-plus test surface exposes every seam helper", () => {
  for (const key of [
    "defaultSourceData", "createPropertyCategory", "createRepeaterClass",
    "nameNewSourceShapes", "cloneMaterial", "cloneRenderTree",
    "createDeformationSupport", "createEffectorBaseClass", "installFieldHelpers",
    "fieldGuidePoints", "createPlainClass", "createDelayClass", "createTwistClass",
    "createWarpClass", "createVoronoiClass", "curvePolygonCount", "fieldFromProperties",
    "getCount", "getEchoFrame", "getEchoFrames", "getTransform", "makeProperties",
    "migrateLegacyEffectorRecord", "migrateEffectorData", "seededRandom",
    "getMeshDeformer", "loadLibraryFromAssets", "library",
  ]) {
    assert.equal(typeof _test[key], "function", key);
  }
});

test("transforms evaluate to pinned numbers", () => {
  assert.deepEqual(
    _test.getTransform("step", 2, 4, { positionStep: [1, 2, 3], rotationStep: [0, 0, 0], scaleStep: [2, 2, 2] }, 7),
    { position: [2, 4, 6], rotation: [0, 0, 0], scale: [4, 4, 4] }
  );
  assert.deepEqual(
    _test.getTransform("linear", 2, 5, { positionEnd: [10, 20, 30], rotationEnd: [0, 90, 0], scaleEnd: [2, 2, 2] }, 1),
    { position: [5, 10, 15], rotation: [0, 45, 0], scale: [1.5, 1.5, 1.5] }
  );
  assert.deepEqual(
    _test.getTransform("random", 3, 10, { positionMin: [0, 0, 0], positionMax: [10, 10, 10], rotationMin: [0, 0, 0], rotationMax: [0, 0, 0], scaleMin: [1, 1, 1], scaleMax: [1, 1, 1] }, 99),
    { position: [7.8834776929579675, 8.414368510711938, 0.4097414202988148], rotation: [0, 0, 0], scale: [1, 1, 1] }
  );
  assert.equal(_test.seededRandom(11, 5, 2), 0.6690919427201152);
  assert.equal(_test.seededRandom(11, 5, 2), _test.seededRandom(11, 5, 2));
});

test("repeater source data keeps its normalized shape", () => {
  assert.deepEqual(_test.defaultSourceData({ type: "zoidium:repeater/repeater" }), {
    type: "zoidium:repeater/repeater",
    objects: [],
    properties: {},
    repeaterProperties: {},
    schemaVersion: 2,
  });
  assert.equal(_test.migrateLegacyEffectorRecord({ type: 9 }).type, "zoidium:repeater/voronoi-fracture");
});

test("bundled effector library loads with sibling requires", () => {
  const projectRoot = path.join(__dirname, "..");
  const getAsset = (kind, url) => fs.readFileSync(
    path.join(projectRoot, String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "")),
    "utf8"
  );
  const loaded = _test.loadLibraryFromAssets(getAsset);
  for (const key of ["core", "fracture", "mesh", "jobs", "workerSource"]) {
    assert.ok(loaded[key], key);
  }
  assert.equal(typeof loaded.core.twistPositions, "function");
  assert.equal(typeof loaded.mesh.createMeshDeformer, "function");
  assert.equal(typeof loaded.jobs.createMeshJobs, "function");
  assert.equal(typeof loaded.workerSource, "string");
});
