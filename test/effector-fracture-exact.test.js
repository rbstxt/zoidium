"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const fracture = require("../plugins/scene-plus/effector-fracture.js");

// Original endpoint welding, retained as an independent regression oracle.
const legacyWelding = String.raw`function cutLoops(cuts, epsilon) {
  const buckets = new Map();
  const points = [];
  function weld(point) {
    const cell = point.map((v) => Math.floor(v / epsilon));
    for (let x = -1; x <= 1; x += 1) for (let y = -1; y <= 1; y += 1) for (let z = -1; z <= 1; z += 1) {
      const list = buckets.get([cell[0] + x, cell[1] + y, cell[2] + z].join(","));
      for (const id of list || []) if (distanceSquared3(points[id], point) <= epsilon * epsilon) return id;
    }
    const key = cell.join(",");
    const list = buckets.get(key) || [];
    const id = points.length;
    points.push(point);
    list.push(id);
    buckets.set(key, list);
    return id;
  }
  const edges = new Map();
  for (const [a, b] of cuts) {
    const i = weld(a);
    const j = weld(b);
    if (i === j) continue;
    const key = Math.min(i, j) + ":" + Math.max(i, j);
    if (edges.has(key)) edges.delete(key);
    else edges.set(key, [i, j]);
  }
  return extractLoops(Array.from(edges.values())).map((loop) => loop.reverse().map((id) => points[id]));
}`;

function legacyFracture() {
  const source = fs.readFileSync(require.resolve("../plugins/scene-plus/effector-fracture.js"), "utf8");
  const start = source.indexOf("function cutLoops(");
  const end = source.indexOf("\nfunction pointInTriangle2", start);
  const module = { exports: {} };
  vm.runInNewContext(source.slice(0, start) + legacyWelding + source.slice(end), {
    module, ZoidiumPluginApis: global.ZoidiumPluginApis,
    Float32Array, Float64Array, Uint16Array, Uint32Array, Uint8Array,
    require: id => require("../plugins/scene-plus/" + id.replace("./", "")),
  });
  return module.exports;
}

function torus(seed) {
  const positions = [], uvs = [], normals = [];
  const random = global.ZoidiumPluginApis.random.sceneSeededRandom;
  const rings = 10 + seed % 5, sides = 6 + seed % 4;
  const major = 1.3 + random(seed, 0, 1), minor = 0.2 + random(seed, 0, 2) * 0.5;
  const vertex = (i, j) => {
    const u = i / rings * Math.PI * 2, v = j / sides * Math.PI * 2;
    const r = major + Math.cos(v) * minor;
    return [r * Math.cos(u) + seed * 0.17, r * Math.sin(u) - seed * 0.31, Math.sin(v) * minor];
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    for (const triangle of [[[i,j],[i+1,j],[i+1,j+1]],[[i,j],[i+1,j+1],[i,j+1]]]) {
      for (const [a,b] of triangle) {
        positions.push(...vertex(a,b)); uvs.push(a/rings,b/sides);
        normals.push(Math.cos(b/sides*Math.PI*2)*Math.cos(a/rings*Math.PI*2),
          Math.cos(b/sides*Math.PI*2)*Math.sin(a/rings*Math.PI*2), Math.sin(b/sides*Math.PI*2));
      }
    }
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), normals: new Float32Array(normals) };
}

function exact(a, b) {
  if (ArrayBuffer.isView(a)) {
    assert.equal(a.constructor.name, b.constructor.name);
    assert.deepEqual(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength));
  } else if (a && typeof a === "object") {
    assert.deepEqual(Object.keys(a), Object.keys(b));
    for (const key of Object.keys(a)) exact(a[key], b[key]);
  } else assert.equal(a, b);
}

test("numeric cut buckets keep every topology byte and material group in legacy order", () => {
  const legacy = legacyFracture();
  for (let seed = 1; seed <= 12; seed++) {
    const options = { cells: 4 + seed * 3, seed: seed * 137 - 500, closed: true,
      distribution: seed % 4, cellScale: [70 + seed * 5, 130, 90] };
    const source = torus(seed);
    const current = fracture.buildVoronoiFracture(source, options);
    assert.equal(current.error, undefined);
    assert.equal(current.warning, undefined);
    exact(current, legacy.buildVoronoiFracture(source, options));
  }
});
