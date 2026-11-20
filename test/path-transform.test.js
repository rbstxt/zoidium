"use strict";
// Snapping and point transform: selection bounds, default pivot, move,
// scale, rotate, modifier constraints, snap priority and thresholds,
// handle vectors, per-path inverses, and locked selections. Pure logic;
// no browser or resource cache is needed.
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  SNAP_THRESHOLD_PX,
  selectionBounds,
  defaultPivot,
  constrainMoveDelta,
  constrainScaleFactors,
  constrainRotateAngle,
  movePoints,
  scalePoints,
  rotatePoints,
  transformHandleVector,
  snapPoint,
  collectSnapVertices,
  freeTransform,
} = require("../plugins/shape-plus/path-transform.js");

const IDENTITY = [1, 0, 0, 1, 0, 0];
const translate = (x, y) => [1, 0, 0, 1, x, y];
const vertex = (point, inn = [0, 0], out = [0, 0]) => ({ point, in: inn, out });
const path = (id, vertices, matrix = IDENTITY, locked = false) => ({ id, vertices, matrix, locked });

function approx(actual, expected, epsilon = 1e-9) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= epsilon,
      `expected [${actual}] to approximate [${expected}]`,
    );
  }
}

function snapshot(value) {
  return JSON.stringify(value);
}

test("snap threshold is the shared 9 px constant", () => {
  assert.equal(SNAP_THRESHOLD_PX, 9);
});

test("selectionBounds reports min, max, centre, and size", () => {
  const bounds = selectionBounds([
    [0, 10],
    [100, 30],
  ]);
  assert.equal(bounds.empty, false);
  assert.equal(bounds.count, 2);
  assert.deepEqual(bounds.min, [0, 10]);
  assert.deepEqual(bounds.max, [100, 30]);
  assert.deepEqual(bounds.center, [50, 20]);
  assert.deepEqual(bounds.size, [100, 20]);
});

test("selectionBounds marks an empty selection instead of going infinite", () => {
  assert.deepEqual(selectionBounds([]), {
    empty: true,
    count: 0,
    min: null,
    max: null,
    center: null,
    size: null,
  });
});

test("selectionBounds rejects non-finite points", () => {
  assert.throws(() => selectionBounds([[0, Number.NaN]]), /finite/);
});

test("defaultPivot returns the bounds centre as a copy", () => {
  const bounds = selectionBounds([
    [0, 0],
    [100, 40],
  ]);
  const pivot = defaultPivot(bounds);
  assert.deepEqual(pivot, [50, 20]);
  pivot[0] = 999;
  assert.deepEqual(bounds.center, [50, 20]);
});

test("defaultPivot needs a non-empty bounds", () => {
  assert.throws(() => defaultPivot(selectionBounds([])), /non-empty/);
});

test("constrainMoveDelta passes moves through without Shift", () => {
  assert.deepEqual(constrainMoveDelta([9, 1]), [9, 1]);
  assert.deepEqual(constrainMoveDelta([9, 1], {}), [9, 1]);
});

test("Shift locks a move to the nearest 45-degree direction", () => {
  const length = Math.hypot(10, 2);
  approx(constrainMoveDelta([10, 2], { shift: true }), [length, 0]);
  approx(constrainMoveDelta([3, 3], { shift: true }), [3, 3]);
  assert.deepEqual(constrainMoveDelta([0, 0], { shift: true }), [0, 0]);
});

test("constrainScaleFactors forces the dominant axis with Shift", () => {
  assert.deepEqual(constrainScaleFactors(2, 1.5), [2, 1.5]);
  assert.deepEqual(constrainScaleFactors(2, 1.2, { shift: true }), [2, 2]);
  assert.deepEqual(constrainScaleFactors(0.5, 0.9, { shift: true }), [0.5, 0.5]);
  assert.throws(() => constrainScaleFactors(Number.NaN, 1, {}), /finite/);
});

test("constrainRotateAngle snaps to 15 degrees with Shift", () => {
  assert.equal(constrainRotateAngle(0.3), 0.3);
  assert.ok(Math.abs(constrainRotateAngle((20 * Math.PI) / 180, { shift: true }) - Math.PI / 12) < 1e-12);
  assert.ok(Math.abs(constrainRotateAngle((100 * Math.PI) / 180, { shift: true }) - (7 * Math.PI) / 12) < 1e-12);
  assert.throws(() => constrainRotateAngle(Number.POSITIVE_INFINITY, {}), /finite/);
});

test("movePoints translates every point without touching the input", () => {
  const before = [
    [0, 0],
    [5, 5],
  ];
  const after = movePoints(before, [10, -2]);
  assert.deepEqual(after, [
    [10, -2],
    [15, 3],
  ]);
  assert.deepEqual(before, [
    [0, 0],
    [5, 5],
  ]);
});

test("scalePoints works about an explicit pivot and the default centre", () => {
  const anchors = [
    [0, 0],
    [100, 0],
  ];
  assert.deepEqual(scalePoints(anchors, { pivot: [50, 0], sx: 2, sy: 1 }), [
    [-50, 0],
    [150, 0],
  ]);
  assert.deepEqual(scalePoints(anchors, { sx: 2, sy: 1 }), [
    [-50, 0],
    [150, 0],
  ]);
  assert.throws(() => scalePoints(anchors, { sx: Number.NaN, sy: 1 }), /finite/);
});

test("rotatePoints turns 90 degrees about the pivot", () => {
  approx(rotatePoints([[1, 0]], { pivot: [0, 0], angle: Math.PI / 2 })[0], [0, 1]);
  assert.deepEqual(rotatePoints([[0, 0]], { pivot: [0, 0], angle: Math.PI / 2 }).map(([x, y]) => [Math.round(x), Math.round(y)]), [
    [0, 0],
  ]);
  const pair = rotatePoints(
    [
      [0, 0],
      [2, 0],
    ],
    { angle: Math.PI / 2 },
  );
  approx(pair[0], [1, -1]);
  approx(pair[1], [1, 1]);
});

test("transformHandleVector follows each mode and rejects unknown modes", () => {
  assert.deepEqual(transformHandleVector([3, 4], { mode: "move" }), [3, 4]);
  assert.deepEqual(transformHandleVector([3, 4], { mode: "scale", sx: 2, sy: 0.5 }), [6, 2]);
  approx(transformHandleVector([1, 0], { mode: "rotate", angle: Math.PI / 2 }), [0, 1]);
  assert.throws(() => transformHandleVector([1, 0], { mode: "skew" }), /Unknown point transform mode/);
});

test("snapPoint attracts to a vertex within the threshold", () => {
  const result = snapPoint([100, 100], { vertices: [[105, 100], [200, 200]] });
  assert.equal(result.snapped, true);
  assert.equal(result.kind, "vertex");
  assert.deepEqual(result.point, [105, 100]);
  assert.deepEqual(result.delta, [5, 0]);
  assert.deepEqual(result.guide, { kind: "vertex", point: [105, 100] });
});

test("snapPoint treats exactly 9 px as in range and 10 px as out", () => {
  assert.equal(snapPoint([0, 0], { vertices: [[9, 0]] }).snapped, true);
  assert.equal(snapPoint([0, 0], { vertices: [[10, 0]] }).snapped, false);
});

test("a vertex outranks a closer guide", () => {
  const result = snapPoint([0, 0], {
    vertices: [[8, 0]],
    guides: [{ axis: "x", value: 1 }],
  });
  assert.equal(result.kind, "vertex");
  assert.deepEqual(result.point, [8, 0]);
});

test("snapPoint snaps one axis to a guide and reports drawable lines", () => {
  const result = snapPoint([0, 0], { guides: [{ axis: "x", value: 4 }] });
  assert.equal(result.snapped, true);
  assert.equal(result.kind, "guide");
  assert.deepEqual(result.point, [4, 0]);
  assert.deepEqual(result.guide, { kind: "guide", lines: [{ axis: "x", value: 4 }] });
});

test("snapPoint falls back to gesture-origin axes below guides", () => {
  const axisOnly = snapPoint([12, 25], { origin: [10, 20] });
  assert.equal(axisOnly.kind, "axis");
  assert.deepEqual(axisOnly.point, [10, 20]);
  assert.deepEqual(axisOnly.guide, {
    kind: "axis",
    lines: [
      { axis: "x", value: 10 },
      { axis: "y", value: 20 },
    ],
  });
  const mixed = snapPoint([0, 25], {
    guides: [{ axis: "x", value: 5 }],
    origin: [10, 20],
  });
  assert.equal(mixed.kind, "guide");
  assert.deepEqual(mixed.point, [5, 25]);
});

test("snapPoint honours a custom threshold", () => {
  assert.equal(snapPoint([0, 0], { vertices: [[5, 0]], threshold: 4 }).snapped, false);
  assert.equal(snapPoint([0, 0], { vertices: [[5, 0]], threshold: 4 }).kind, "none");
  assert.equal(snapPoint([0, 0], { vertices: [[5, 0]], threshold: 6 }).snapped, true);
});

test("snapPoint validates its inputs", () => {
  assert.throws(() => snapPoint([0, Number.NaN], {}), /finite screen point/);
  assert.throws(() => snapPoint([0, 0], { threshold: 0 }), /positive threshold/);
  assert.throws(() => snapPoint([0, 0], { guides: [{ axis: "z", value: 1 }] }), /Snap guides/);
  assert.throws(() => snapPoint([0, 0], { origin: [1, Number.NaN] }), /Snap origin/);
});

test("collectSnapVertices skips selected indices across paths", () => {
  const targets = collectSnapVertices(
    [
      { id: "a", vertices: [{ point: [0, 0] }, { point: [10, 0] }] },
      { id: "b", vertices: [{ point: [20, 0] }] },
    ],
    { a: [0] },
  );
  assert.deepEqual(targets, [
    [10, 0],
    [20, 0],
  ]);
});

test("freeTransform moves points and preserves handle vectors", () => {
  const paths = [path("a", [vertex([0, 0], [-10, 0], [10, 0]), vertex([100, 0])])];
  const before = snapshot(paths);
  const result = freeTransform({
    paths,
    selection: { a: [0] },
    gesture: { mode: "move", delta: [20, 50], origin: [0, 0], snap: { origin: null } },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "move");
  assert.deepEqual(result.pivot, [0, 0]);
  assert.equal(result.snap.snapped, false);
  assert.deepEqual(result.paths[0].changed, [0]);
  approx(result.paths[0].vertices[0].point, [20, 50]);
  approx(result.paths[0].vertices[0].in, [-10, 0]);
  approx(result.paths[0].vertices[0].out, [10, 0]);
  assert.deepEqual(result.paths[0].vertices[1].point, [100, 0]);
  assert.equal(snapshot(paths), before);
});

test("freeTransform maps screen results through each path inverse", () => {
  const paths = [path("a", [vertex([0, 0])]), path("b", [vertex([0, 0])], translate(100, 0))];
  const result = freeTransform({
    paths,
    selection: { a: [0], b: [0] },
    gesture: { mode: "move", delta: [10, 0], origin: [0, 0], snap: false },
  });
  assert.equal(result.ok, true);
  assert.equal(result.paths.length, 2);
  approx(result.paths.find((entry) => entry.id === "a").vertices[0].point, [10, 0]);
  approx(result.paths.find((entry) => entry.id === "b").vertices[0].point, [10, 0]);
});

test("freeTransform scales about the selection centre by default", () => {
  const result = freeTransform({
    paths: [path("a", [vertex([0, 0]), vertex([100, 0])])],
    selection: { a: [0, 1] },
    gesture: { mode: "scale", sx: 2, sy: 1, snap: false },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.pivot, [50, 0]);
  approx(result.paths[0].vertices[0].point, [-50, 0]);
  approx(result.paths[0].vertices[1].point, [150, 0]);
});

test("freeTransform honours a pivot override for rotation", () => {
  const result = freeTransform({
    paths: [path("a", [vertex([10, 0])])],
    selection: { a: [0] },
    gesture: { mode: "rotate", angle: Math.PI / 2, pivot: [0, 0], snap: false },
  });
  assert.equal(result.ok, true);
  approx(result.paths[0].vertices[0].point, [0, 10]);
});

test("modifier constraints run before snapping", () => {
  // Axis snapping is disabled here so the vertex target alone decides: the
  // raw pointer would attract it, but the Shift-constrained pointer moves
  // out of the 9 px threshold first.
  const paths = [path("a", [vertex([0, 0])]), path("b", [vertex([9, 9.4])])];
  const input = {
    paths,
    selection: { a: [0] },
    gesture: { mode: "move", delta: [9, 1], origin: [0, 0], modifiers: { shift: true }, snap: { origin: null } },
  };
  const shifted = freeTransform(input);
  assert.equal(shifted.ok, true);
  assert.equal(shifted.snap.snapped, false);
  approx(shifted.applied.delta, [Math.hypot(9, 1), 0]);
  const raw = freeTransform({
    paths,
    selection: { a: [0] },
    gesture: { mode: "move", delta: [9, 1], origin: [0, 0], snap: { origin: null } },
  });
  assert.equal(raw.snap.snapped, true);
  assert.equal(raw.snap.kind, "vertex");
  assert.deepEqual(raw.snap.point, [9, 9.4]);
});

test("snap:false disables even in-range vertex attraction", () => {
  const result = freeTransform({
    paths: [path("a", [vertex([0, 0])]), path("b", [vertex([5, 0])])],
    selection: { a: [0] },
    gesture: { mode: "move", delta: [1, 0], origin: [0, 0], snap: false },
  });
  assert.equal(result.snap.snapped, false);
  approx(result.paths[0].vertices[0].point, [1, 0]);
});

test("locked paths are skipped as edit targets but attract snaps", () => {
  const locked = path("locked", [vertex([30, 0]), vertex([200, 200])], IDENTITY, true);
  const open = path("open", [vertex([0, 0])]);
  const before = snapshot([locked, open]);
  const result = freeTransform({
    paths: [locked, open],
    selection: { locked: [1], open: [0] },
    gesture: { mode: "move", delta: [26, 0], origin: [0, 0], snap: { origin: null } },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.skippedLocked, ["locked"]);
  assert.equal(result.paths.length, 1);
  assert.equal(result.paths[0].id, "open");
  assert.equal(result.snap.kind, "vertex");
  assert.deepEqual(result.snap.point, [30, 0]);
  approx(result.paths[0].vertices[0].point, [30, 0]);
  assert.equal(snapshot([locked, open]), before);
});

test("an all-locked selection fails with a locked explanation", () => {
  const result = freeTransform({
    paths: [path("locked", [vertex([0, 0])], IDENTITY, true)],
    selection: { locked: [0] },
    gesture: { mode: "move", delta: [5, 5], snap: false },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "locked-selection");
  assert.ok(result.message.length > 0);
  assert.deepEqual(result.skippedLocked, ["locked"]);
});

test("singular mappings fail per path without moving healthy paths", () => {
  const broken = path("broken", [vertex([0, 0])], [0, 0, 0, 0, 0, 0]);
  const healthy = path("healthy", [vertex([0, 0])]);
  const partial = freeTransform({
    paths: [broken, healthy],
    selection: { broken: [0], healthy: [0] },
    gesture: { mode: "move", delta: [5, 0], snap: false },
  });
  assert.equal(partial.ok, true);
  assert.equal(partial.paths.length, 1);
  assert.equal(partial.failures[0].id, "broken");
  assert.equal(partial.failures[0].reason, "singular-mapping");
  const total = freeTransform({
    paths: [broken],
    selection: { broken: [0] },
    gesture: { mode: "move", delta: [5, 0], snap: false },
  });
  assert.equal(total.ok, false);
  assert.equal(total.reason, "singular-mapping");
  assert.ok(total.message.length > 0);
});

test("empty selections fail with an explanation", () => {
  const empty = freeTransform({
    paths: [path("a", [vertex([0, 0])])],
    selection: {},
    gesture: { mode: "move", delta: [5, 0], snap: false },
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "empty-selection");
  const cleared = freeTransform({
    paths: [path("a", [vertex([0, 0])])],
    selection: { a: [] },
    gesture: { mode: "move", delta: [5, 0], snap: false },
  });
  assert.equal(cleared.reason, "empty-selection");
});

test("freeTransform rejects unknown paths, indices, and modes", () => {
  const paths = [path("a", [vertex([0, 0])])];
  assert.throws(
    () => freeTransform({ paths, selection: { missing: [0] }, gesture: { mode: "move", delta: [1, 0] } }),
    /Unknown path/,
  );
  assert.throws(
    () => freeTransform({ paths, selection: { a: [7] }, gesture: { mode: "move", delta: [1, 0] } }),
    /Unknown vertex index/,
  );
  assert.throws(
    () => freeTransform({ paths, selection: { a: [0] }, gesture: { mode: "skew" } }),
    /Unknown point transform mode/,
  );
});

test("scaling recomputes factors from a snapped handle", () => {
  const result = freeTransform({
    paths: [path("a", [vertex([100, 0])])],
    selection: { a: [0] },
    gesture: {
      mode: "scale",
      sx: 1.05,
      sy: 1,
      pivot: [0, 0],
      handle: [100, 0],
      snap: { guides: [{ axis: "x", value: 110 }] },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.snap.kind, "guide");
  assert.ok(Math.abs(result.applied.sx - 1.1) < 1e-9);
  approx(result.paths[0].vertices[0].point, [110, 0]);
});

test("Shift constrains a rotation gesture to 15 degrees", () => {
  const result = freeTransform({
    paths: [path("a", [vertex([10, 0])])],
    selection: { a: [0] },
    gesture: {
      mode: "rotate",
      angle: (20 * Math.PI) / 180,
      pivot: [0, 0],
      modifiers: { shift: true },
      snap: false,
    },
  });
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.applied.angle - Math.PI / 12) < 1e-12);
  approx(result.paths[0].vertices[0].point, [10 * Math.cos(Math.PI / 12), 10 * Math.sin(Math.PI / 12)]);
});

test("rotate and scale leave untouched vertices and inputs alone", () => {
  const paths = [path("a", [vertex([10, 0]), vertex([500, 500])])];
  const before = snapshot(paths);
  const rotated = freeTransform({
    paths,
    selection: { a: [0] },
    gesture: { mode: "rotate", angle: Math.PI, pivot: [0, 0], snap: false },
  });
  approx(rotated.paths[0].vertices[0].point, [-10, 0]);
  assert.deepEqual(rotated.paths[0].vertices[1].point, [500, 500]);
  assert.deepEqual(rotated.paths[0].changed, [0]);
  assert.equal(snapshot(paths), before);
});
