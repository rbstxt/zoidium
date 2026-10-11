"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSuite } = require("./trapcode-env");
// Pre-optimization query paths pin candidate order, including hash collisions.
const legacyNear = function (i, maxDistance, above, out, limit) {
        var points = this.points;
        var cell = this.cell;
        var ax = points[i * 3];
        var ay = points[i * 3 + 1];
        var az = points[i * 3 + 2];
        var cx = Math.floor(ax / cell);
        var cy = Math.floor(ay / cell);
        var cz = Math.floor(az / cell);
        var maxSq = maxDistance * maxDistance;
        var found = 0;
        for (var ox = -1; ox <= 1; ox++) {
            for (var oy = -1; oy <= 1; oy++) {
                for (var oz = -1; oz <= 1; oz++) {
                    var j = this.head[this.bucket(cx + ox, cy + oy, cz + oz)];
                    while (j >= 0 && found < limit) {
                        if (j !== i && (!above || j > i)) {
                            var px = points[j * 3];
                            var py = points[j * 3 + 1];
                            var pz = points[j * 3 + 2];
                            if (Math.floor(px / cell) === cx + ox && Math.floor(py / cell) === cy + oy &&
                                Math.floor(pz / cell) === cz + oz) {
                                var dx = px - ax;
                                var dy = py - ay;
                                var dz = pz - az;
                                if (dx * dx + dy * dy + dz * dz < maxSq) out[found++] = j;
                            }
                        }
                        j = this.next[j];
                    }
                }
            }
        }
        return found;
    };
const legacyLines = function (n, maxDistance, maxConnections, positions, colors, emit, verts, sameSource) {
            var work = this._work;
            var colorsIn = this._colors;
            var sourceIds = sameSource ? this._sourceIds : null;
            var grid = this._grid;
            grid.build(work, n, Math.max(maxDistance, 0.0001));
            var cell = grid.cell;
            var maxSq = maxDistance * maxDistance;
            for (var i = 0; i < n; i++) {
                var ax = work[i * 3];
                var ay = work[i * 3 + 1];
                var az = work[i * 3 + 2];
                var acx = Math.floor(ax / cell);
                var acy = Math.floor(ay / cell);
                var acz = Math.floor(az / cell);
                var connections = 0;
                for (var ox = -1; ox <= 1 && connections < maxConnections; ox++) {
                    for (var oy = -1; oy <= 1 && connections < maxConnections; oy++) {
                        for (var oz = -1; oz <= 1 && connections < maxConnections; oz++) {
                            var j = grid.head[grid.bucket(acx + ox, acy + oy, acz + oz)];
                            while (j >= 0 && connections < maxConnections) {
                                if (j > i && (!sourceIds || sourceIds[j] === sourceIds[i])) {
                                    var bx = work[j * 3];
                                    var by = work[j * 3 + 1];
                                    var bz = work[j * 3 + 2];
                                    var dx = ax - bx;
                                    var dy = ay - by;
                                    var dz = az - bz;
                                    if (dx * dx + dy * dy + dz * dz < maxSq &&
                                        Math.floor(bx / cell) === acx + ox &&
                                        Math.floor(by / cell) === acy + oy &&
                                        Math.floor(bz / cell) === acz + oz) {
                                        emit(i, j, work, colorsIn);
                                        verts += 2;
                                        connections++;
                                    }
                                }
                                j = grid.next[j];
                            }
                        }
                    }
                }
            }
            return verts;
        };

const MAX_TRIANGLES = 20000, MAX_NEAR = 64;
const legacyTriangulate = function (n, maxDistance) {
            var indices = [];
            if (n < 3) return indices;
            maxDistance = Math.max(maxDistance, 0.0001);
            var work = this._work;
            var grid = this._grid;
            grid.build(work, n, maxDistance);
            var near = this._near;
            var seen = this._seen;
            seen.clear();
            var maxSq = maxDistance * maxDistance;
            for (var a = 0; a < n && indices.length < MAX_TRIANGLES * 3; a++) {
                var found = grid.near(a, maxDistance, false, near, MAX_NEAR);
                if (found < 2) continue;
                // Insertion sort by distance to a (at most MAX_NEAR entries).
                for (var s = 1; s < found; s++) {
                    var item = near[s];
                    var key = pointDistSq(work, item, a);
                    var p = s - 1;
                    while (p >= 0 && pointDistSq(work, near[p], a) > key) {
                        near[p + 1] = near[p];
                        p--;
                    }
                    near[p + 1] = item;
                }
                var candidates = Math.min(found, 10);
                for (var mi = 0; mi < candidates && indices.length < MAX_TRIANGLES * 3; mi++) {
                    for (var ni = mi + 1; ni < candidates && indices.length < MAX_TRIANGLES * 3; ni++) {
                        var b = near[mi];
                        var c = near[ni];
                        if (b === a || c === a || b === c) continue;
                        if (pointDistSq(work, b, c) > maxSq) continue;
                        // Skip degenerate (zero-area) triangles.
                        if (triangleAreaSq(work, a, b, c) < 1e-8) continue;
                        var t = [a, b, c].sort(function (x, y) { return x - y; });
                        var tkey = (t[0] * n + t[1]) * n + t[2];
                        if (seen.has(tkey)) continue;
                        seen.add(tkey);
                        indices.push(t[0], t[1], t[2]);
                        // One fan triangle per neighbor pair is enough; cap fan-out
                        // so dense clouds do not explode into overlapping sheets.
                        if (ni - mi > 4) break;
                    }
                }
            }
            return indices;
        };
    function pointDistSq(points, i, j) {
        var dx = points[i * 3] - points[j * 3];
        var dy = points[i * 3 + 1] - points[j * 3 + 1];
        var dz = points[i * 3 + 2] - points[j * 3 + 2];
        return dx * dx + dy * dy + dz * dz;
    }

    function triangleAreaSq(points, i, j, k) {
        var ax = points[j * 3] - points[i * 3];
        var ay = points[j * 3 + 1] - points[i * 3 + 1];
        var az = points[j * 3 + 2] - points[i * 3 + 2];
        var bx = points[k * 3] - points[i * 3];
        var by = points[k * 3 + 1] - points[i * 3 + 1];
        var bz = points[k * 3 + 2] - points[i * 3 + 2];
        var cx = ay * bz - az * by;
        var cy = az * bx - ax * bz;
        var cz = ax * by - ay * bx;
        return cx * cx + cy * cy + cz * cz;
    }


function setup(count, spread) {
  const { PZ } = loadSuite(["trapcode-common.js", "plexus.js"]);
  const root = new PZ.object3d.plexus();
  root._work = new Float32Array(count * 3);
  root._colors = new Float32Array(count * 3).fill(1);
  root._sourceIds = new Int32Array(count);
  root._count = count;
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) root._work[i * 3 + axis] = Math.sin(i * 17 + axis * 39) * spread;
    root._sourceIds[i] = i % 3;
  }
  return root;
}
function queries(grid, count, distance) {
  for (let i = 0; i < count; i++) for (const above of [false, true]) for (const limit of [0, 1, 7, 64, count]) {
    const actual = new Int32Array(count), expected = new Int32Array(count);
    const a = grid.near(i, distance, above, actual, limit);
    const b = legacyNear.call(grid, i, distance, above, expected, limit);
    assert.equal(a, b);
    assert.deepEqual(actual, expected);
  }
}
test("stored cells preserve exact neighbor order across cell sizes, collisions and rebuilds", () => {
  const root = setup(160, 100), grid = root._grid;
  for (const cell of [0.0001, 1, 17, 100, 500]) {
    grid.build(root._work, root._count, cell);
    queries(grid, root._count, cell);
    for (let i = 0; i < root._work.length; i++) assert.equal(grid.cells[i], Math.floor(root._work[i] / cell));
  }
  // Changed values in the same buffer, then growth and shrinkage.
  root._work.fill(-19.5); grid.build(root._work, 160, 7); queries(grid, 160, 7);
  const larger = setup(257, 40)._work;
  grid.build(larger, 257, 5); queries(grid, 257, 5);
  grid.build(larger, 11, 15); queries(grid, 11, 15);
  grid.build(new Float32Array(0), 0, 2); assert.equal(grid.count, 0);
});
test("cell coordinates retain doubles outside int32 range and nonfinite behavior", () => {
  const root = setup(12, 1e12), grid = root._grid;
  root._work[0] = -0; root._work[1] = Infinity; root._work[2] = NaN;
  grid.build(root._work, 12, 0.0001);
  for (let i = 0; i < root._work.length; i++) assert.equal(grid.cells[i], Math.floor(root._work[i] / 0.0001));
  queries(grid, 12, 0.0001);
});
test("distance and shape lines keep the original emitted pair order", () => {
  for (const spread of [0, 12, 500, 1e10]) {
    const root = setup(130, spread);
    for (const distance of [0.0001, 15, 600]) for (const max of [1, 5, 10]) for (const shape of [false, true]) {
      const actual = [], expected = [];
      const a = root.buildLinesDistance(130, distance, max, null, null, (i,j) => actual.push([i,j]), 0, shape);
      const b = legacyLines.call(root, 130, distance, max, null, null, (i,j) => expected.push([i,j]), 0, shape);
      assert.equal(a, b); assert.deepEqual(actual, expected);
    }
  }
});
test("facets and triangulation keep the original index ordering", () => {
  for (const spread of [0, 20, 500]) for (const distance of [1, 50, 1000]) {
    const root = setup(130, spread), near = root._grid.near;
    const facets = root.facets(130, distance, 8), triangles = root.triangulate(130, distance);
    root._grid.near = legacyNear;
    assert.deepEqual(root.facets(130, distance, 8), facets);
    assert.deepEqual(legacyTriangulate.call(root, 130, distance), triangles);
    root._grid.near = near;
  }
});

test("triangulation distance reuse preserves ties and degenerate points", () => {
  const root = setup(300, 12);
  for (let i = 0; i < 300; i++) {
    root._work[i * 3] = i % 7;
    root._work[i * 3 + 1] = Math.floor(i / 7) % 7;
    root._work[i * 3 + 2] = Math.floor(i / 49);
  }
  for (const distance of [1, 2, 10]) {
    const actual = root.triangulate(300, distance);
    root._grid.near = legacyNear;
    assert.deepEqual(actual, legacyTriangulate.call(root, 300, distance));
  }
});

test("triangulation cached distances stop at the same triangle cap", () => {
  const root = setup(1500, 12);
  const actual = root.triangulate(1500, 100);
  root._grid.near = legacyNear;
  assert.equal(actual.length, 60000);
  assert.deepEqual(actual, legacyTriangulate.call(root, 1500, 100));
});
