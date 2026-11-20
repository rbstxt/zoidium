"use strict";
// Projected cubic picking and screen-to-plane inversion: zoom, rotation,
// nested transforms, perspective, degenerate planes, the 9 px limit, and
// curve extrema. Pure logic; hosts and the viewport projection arrive as
// plain affine matrices, so no browser or cache is needed.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { evaluate } = require("../plugins/shape-plus/path.js");
const { multiply } = require("../plugins/shape-plus/editor-geometry.js");
const {
  HIT_RADIUS_PX,
  composeMapping,
  projectVertices,
  projectCubic,
  closestOnCubic,
  pickPaths,
  screenToLocal,
  intersectRayPlane,
  screenToLocalOnPlane,
} = require("../plugins/shape-plus/path-projection.js");

const scale = (s) => [s, 0, 0, s, 0, 0];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const rotate90 = [0, 1, -1, 0, 0, 0];

function bruteClosest(cubic, point, samples = 2001) {
  let best = Infinity;
  for (let i = 0; i <= samples; i++) {
    const p = evaluate(cubic, i / samples);
    const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
    if (d < best) best = d;
  }
  return best;
}

function straightPath(id, y, matrix) {
  return {
    id,
    closed: false,
    matrix,
    vertices: [
      { point: [20, y], in: [0, 0], out: [30, 0] },
      { point: [100, y], in: [-30, 0], out: [0, 0] },
    ],
  };
}

test("hit radius is the shared 9 CSS px constant", () => {
  assert.equal(HIT_RADIUS_PX, 9);
});

test("identity projection leaves anchors and handles in place", () => {
  const out = projectVertices(
    [{ point: [20, 20], in: [-5, 0], out: [30, 0] }],
    null,
    null,
  );
  assert.deepEqual(out[0].point, [20, 20]);
  assert.deepEqual(out[0].in, [-5, 0]);
  assert.deepEqual(out[0].out, [30, 0]);
});

test("zoom scales anchors and handle offsets together", () => {
  const out = projectVertices(
    [{ point: [10, 10], in: [0, 0], out: [10, 0] }],
    scale(4),
    null,
  );
  assert.deepEqual(out[0].point, [40, 40]);
  assert.deepEqual(out[0].out, [40, 0]);
});

test("rotation turns handle vectors with their anchors", () => {
  const out = projectVertices(
    [{ point: [10, 0], in: [0, 0], out: [10, 0] }],
    rotate90,
    null,
  );
  assert.ok(Math.abs(out[0].point[0] - 0) < 1e-9);
  assert.ok(Math.abs(out[0].point[1] - 10) < 1e-9);
  assert.ok(Math.abs(out[0].out[0] - 0) < 1e-9);
  assert.ok(Math.abs(out[0].out[1] - 10) < 1e-9);
});

test("nested host transforms compose parent after child", () => {
  const host = multiply(translate(5, 7), scale(2));
  const out = projectVertices([{ point: [10, 10], in: [0, 0], out: [0, 0] }], host, null);
  assert.deepEqual(out[0].point, [25, 27]);
  const full = composeMapping(host, scale(3));
  assert.deepEqual(full.slice(4), [15, 21]);
});

test("projection applies after the host matrix", () => {
  const out = projectVertices([{ point: [0, 0], in: [0, 0], out: [0, 0] }], translate(10, 0), scale(2));
  assert.deepEqual(out[0].point, [20, 0]);
});

test("anchor within 9 px hits, beyond it misses", () => {
  const paths = [straightPath("a", 20, null)];
  assert.equal(pickPaths(paths, [22, 22], {}).target.kind, "anchor");
  assert.equal(pickPaths(paths, [20, 20 + 9.5], {}).target, null);
});

test("exactly 9 px still counts as a hit", () => {
  const paths = [straightPath("a", 20, null)];
  const found = pickPaths(paths, [29, 20], {}).target;
  assert.equal(found.kind, "anchor");
  assert.ok(Math.abs(found.distance - 9) < 1e-9);
});

test("handle wins over anchor and segment at the same click", () => {
  const paths = [straightPath("a", 20, null)];
  // Handle knob sits at [50, 20]; the straight segment runs through y = 20.
  const found = pickPaths(paths, [52, 22], {}).target;
  assert.equal(found.kind, "handle");
  assert.equal(found.pathId, "a");
  assert.equal(found.vertexIndex, 0);
  assert.equal(found.side, "out");
});

test("anchor wins over a nearby segment", () => {
  const paths = [straightPath("a", 20, null)];
  const found = pickPaths(paths, [22, 22], {}).target;
  assert.equal(found.kind, "anchor");
  assert.equal(found.vertexIndex, 0);
});

test("frontmost path wins among segment hits", () => {
  const paths = [straightPath("front", 20, null), straightPath("back", 20, null)];
  const { target, candidates } = pickPaths(paths, [60, 23], {});
  assert.equal(target.kind, "segment");
  assert.equal(target.pathId, "front");
  assert.deepEqual(candidates, ["front", "back"]);
});

test("segment reports an interior curve parameter", () => {
  const paths = [
    {
      id: "hump",
      closed: false,
      matrix: null,
      vertices: [
        { point: [0, 0], in: [0, 0], out: [0, 60] },
        { point: [120, 0], in: [0, 60], out: [0, 0] },
      ],
    },
  ];
  const { target } = pickPaths(paths, [60, 46], {});
  assert.equal(target.kind, "segment");
  assert.equal(target.segmentIndex, 0);
  assert.ok(target.t > 0.2 && target.t < 0.8);
});

test("closest point matches a dense brute-force reference on an S-curve", () => {
  const cubic = [[0, 0], [100, 0], [0, 100], [100, 100]];
  const query = [50, 62];
  const found = closestOnCubic(cubic, query);
  assert.ok(found.distance <= bruteClosest(cubic, query) + 0.25);
  assert.ok(found.t > 0.05 && found.t < 0.95);
});

test("closest point stays accurate after projection", () => {
  const cubic = projectCubic([[0, 0], [0, 60], [120, 60], [120, 0]], multiply(translate(5, 7), scale(2)));
  const query = [125, 100];
  const found = closestOnCubic(cubic, query);
  assert.ok(found.distance <= bruteClosest(cubic, query) + 0.25);
  assert.ok(found.t > 0.2 && found.t < 0.8);
});

test("picking is zoom-invariant in CSS pixels", () => {
  const paths = [straightPath("a", 10, scale(4))];
  // Anchor local [20, 10] lands on screen [80, 40]; offsets run across the
  // segment so the segment cannot rescue an out-of-radius anchor.
  assert.equal(pickPaths(paths, [80, 48], {}).target.kind, "anchor");
  assert.equal(pickPaths(paths, [80, 50.5], {}).target, null);
});

test("nested transforms place picks correctly", () => {
  const host = multiply(translate(5, 7), scale(2));
  const paths = [{ id: "a", closed: false, matrix: host, vertices: [{ point: [10, 10], in: [0, 0], out: [0, 0] }] }];
  const found = pickPaths(paths, [26, 28], {}).target;
  assert.equal(found.kind, "anchor");
});

test("singular paths are skipped without throwing", () => {
  const paths = [
    { id: "flat", closed: false, matrix: [0, 0, 0, 0, 5, 5], vertices: [{ point: [1, 1], in: [0, 0], out: [0, 0] }] },
    straightPath("ok", 20, null),
  ];
  const { target, candidates } = pickPaths(paths, [60, 23], {});
  assert.equal(target.pathId, "ok");
  assert.deepEqual(candidates, ["ok"]);
});

test("handle path limits restrict knobs but keep segments", () => {
  const paths = [straightPath("a", 20, null)];
  const knobOnly = pickPaths(paths, [52, 22], { handlePathIds: [] });
  assert.equal(knobOnly.target.kind, "segment");
  const allowed = pickPaths(paths, [52, 22], { handlePathIds: ["a"] });
  assert.equal(allowed.target.kind, "handle");
});

test("screen-to-local inverts zoom, rotation and translation", () => {
  const matrix = multiply(translate(4, 6), multiply(rotate90, scale(2)));
  const out = screenToLocal([4, 26], { matrix });
  assert.equal(out.ok, true);
  assert.ok(Math.abs(out.local[0] - 10) < 1e-9);
  assert.ok(Math.abs(out.local[1] - 0) < 1e-9);
});

test("screen-to-local rejects a singular mapping with an explanation", () => {
  const out = screenToLocal([10, 10], { matrix: [0, 0, 0, 0, 5, 5] });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "singular-mapping");
  assert.match(out.message, /singular/i);
});

test("orthographic ray meets the editing plane where expected", () => {
  const hit = intersectRayPlane(
    { origin: [1, 2, 5], direction: [0, 0, -1] },
    { point: [0, 0, 0], normal: [0, 0, 1] },
  );
  assert.equal(hit.ok, true);
  assert.deepEqual(hit.point, [1, 2, 0]);
});

test("perspective placement maps the ray through the plane and world inverse", () => {
  const camera = (screen) => ({ origin: [screen[0], screen[1], 10], direction: [0, 0, -1] });
  const plane = { point: [0, 0, 0], normal: [0, 0, 1] };
  const flat = screenToLocalOnPlane([30, 40], { rayFor: camera, plane, worldFromLocal: [1, 0, 0, 1, 0, 0] });
  assert.equal(flat.ok, true);
  assert.deepEqual(flat.local, [30, 40]);
  const doubled = screenToLocalOnPlane([30, 40], { rayFor: camera, plane, worldFromLocal: scale(2) });
  assert.equal(doubled.ok, true);
  assert.deepEqual(doubled.local, [15, 20]);
});

test("edge-on rays fail without moving data", () => {
  const out = screenToLocalOnPlane([30, 40], {
    rayFor: () => ({ origin: [0, 0, 10], direction: [1, 0, 0] }),
    plane: { point: [0, 0, 0], normal: [0, 0, 1] },
    worldFromLocal: [1, 0, 0, 1, 0, 0],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "edge-on-plane");
  assert.match(out.message, /edge-on/);
});

test("degenerate planes and rays fail with explanations", () => {
  const flatPlane = screenToLocalOnPlane([0, 0], {
    rayFor: (s) => ({ origin: [s[0], s[1], 10], direction: [0, 0, -1] }),
    plane: { point: [0, 0, 0], normal: [0, 0, 0] },
    worldFromLocal: [1, 0, 0, 1, 0, 0],
  });
  assert.equal(flatPlane.ok, false);
  assert.equal(flatPlane.reason, "degenerate-plane");
  const badRay = screenToLocalOnPlane([0, 0], {
    rayFor: () => ({ origin: [0, 0, 0], direction: [0, 0, 0] }),
    plane: { point: [0, 0, 0], normal: [0, 0, 1] },
    worldFromLocal: [1, 0, 0, 1, 0, 0],
  });
  assert.equal(badRay.ok, false);
  assert.equal(badRay.reason, "invalid-ray");
  assert.ok(badRay.message.length > 0);
});

test("perspective with a singular world mapping fails cleanly", () => {
  const out = screenToLocalOnPlane([0, 0], {
    rayFor: (s) => ({ origin: [s[0], s[1], 10], direction: [0, 0, -1] }),
    plane: { point: [0, 0, 0], normal: [0, 0, 1] },
    worldFromLocal: [0, 0, 0, 0, 5, 5],
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "singular-mapping");
});

test("malformed picking input throws instead of guessing", () => {
  assert.throws(() => pickPaths(null, [0, 0], {}));
  assert.throws(() => pickPaths([], [0, 0], { radius: -1 }));
});
