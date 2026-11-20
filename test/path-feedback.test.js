"use strict";
// Feedback and preferences: Pen cursor priority, badges, hover colours,
// endpoint and direction drawing instructions, and validated display
// preferences. Pure records and instructions; no pixels, no browser.
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  DEFAULT_VERTEX_PX,
  DEFAULT_HANDLE_PX,
  DEFAULT_PREFS,
  PREFS_MIN_PX,
  PREFS_MAX_PX,
  ENDPOINT_ENLARGE,
  PEN_CURSOR_PRIORITY,
  PEN_BADGES,
  COLORS,
  normalizePrefs,
  resolvePenCursor,
  resolveSelectCursor,
  navigationCursor,
  vertexInstruction,
  handleInstruction,
  segmentInstruction,
  directionInstruction,
  pathInstructions,
} = require("../plugins/shape-plus/path-feedback.js");

function drawing(points, closed = false) {
  return { points, closed };
}

test("default display sizes are 8 px vertices and 6 px handles", () => {
  assert.equal(DEFAULT_VERTEX_PX, 8);
  assert.equal(DEFAULT_HANDLE_PX, 6);
  assert.deepEqual({ ...DEFAULT_PREFS }, { vertexSize: 8, handleSize: 6 });
  assert.equal(PREFS_MIN_PX, 2);
  assert.equal(PREFS_MAX_PX, 32);
});

test("pen cursor priority order is close, continue, delete, add, start", () => {
  assert.deepEqual([...PEN_CURSOR_PRIORITY], [
    "endpoint-close",
    "endpoint-continue",
    "vertex-delete",
    "segment-add",
    "canvas-start",
  ]);
});

test("pen badges are o, /, -, + with no badge for empty canvas", () => {
  assert.deepEqual({ ...PEN_BADGES }, {
    "endpoint-close": "o",
    "endpoint-continue": "/",
    "vertex-delete": "-",
    "segment-add": "+",
    "canvas-start": null,
  });
});

test("normalizePrefs defaults missing input without errors", () => {
  for (const input of [undefined, null, {}]) {
    const { prefs, errors } = normalizePrefs(input);
    assert.deepEqual(prefs, { vertexSize: 8, handleSize: 6 });
    assert.deepEqual(errors, []);
  }
});

test("normalizePrefs accepts valid custom sizes", () => {
  const { prefs, errors } = normalizePrefs({ vertexSize: 10, handleSize: 4 });
  assert.deepEqual(prefs, { vertexSize: 10, handleSize: 4 });
  assert.deepEqual(errors, []);
});

test("normalizePrefs keeps one valid field while rejecting the other", () => {
  const { prefs, errors } = normalizePrefs({ vertexSize: 12, handleSize: 0 });
  assert.equal(prefs.vertexSize, 12);
  assert.equal(prefs.handleSize, 6);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /handleSize/);
});

test("normalizePrefs rejects zero, negative, NaN, text, and oversize values", () => {
  for (const bad of [0, -3, NaN, Infinity, "8", 33, 1000]) {
    const { prefs, errors } = normalizePrefs({ vertexSize: bad });
    assert.equal(prefs.vertexSize, 8);
    assert.equal(errors.length, 1);
    assert.equal(typeof errors[0], "string");
    assert.ok(errors[0].length > 0);
  }
});

test("normalizePrefs rejects non-object input with an English error", () => {
  for (const bad of [["vertexSize"], "large", 12]) {
    const { prefs, errors } = normalizePrefs(bad);
    assert.deepEqual(prefs, { vertexSize: 8, handleSize: 6 });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /object/i);
  }
});

test("empty canvas starts a new path with no badge", () => {
  for (const target of [null, undefined]) {
    const cursor = resolvePenCursor({ target });
    assert.equal(cursor.tool, "pen");
    assert.equal(cursor.state, "canvas-start");
    assert.equal(cursor.badge, null);
  }
});

test("hovering the drawing start closes with the o badge", () => {
  const cursor = resolvePenCursor({
    target: { kind: "anchor", vertexIndex: 0 },
    drawing: drawing([[0, 0], [10, 0], [10, 10]]),
  });
  assert.equal(cursor.state, "endpoint-close");
  assert.equal(cursor.badge, "o");
});

test("hovering the drawing end continues with the / badge", () => {
  const cursor = resolvePenCursor({
    target: { kind: "anchor", vertexIndex: 2 },
    drawing: drawing([[0, 0], [10, 0], [10, 10]]),
  });
  assert.equal(cursor.state, "endpoint-continue");
  assert.equal(cursor.badge, "/");
});

test("endpoint close wins when one point is both first and last", () => {
  const cursor = resolvePenCursor({
    target: { kind: "anchor", vertexIndex: 0 },
    drawing: drawing([[5, 5]]),
  });
  assert.equal(cursor.state, "endpoint-close");
  assert.equal(cursor.badge, "o");
});

test("hovering a middle vertex while drawing deletes with the - badge", () => {
  const cursor = resolvePenCursor({
    target: { kind: "anchor", vertexIndex: 1 },
    drawing: drawing([[0, 0], [10, 0], [10, 10]]),
  });
  assert.equal(cursor.state, "vertex-delete");
  assert.equal(cursor.badge, "-");
});

test("hovering a vertex with no drawing deletes with the - badge", () => {
  const cursor = resolvePenCursor({ target: { kind: "anchor", vertexIndex: 3 } });
  assert.equal(cursor.state, "vertex-delete");
  assert.equal(cursor.badge, "-");
});

test("hovering an open-path endpoint with no drawing continues", () => {
  const cursor = resolvePenCursor({
    target: { kind: "anchor", vertexIndex: 0, isEndpoint: true, pathClosed: false },
  });
  assert.equal(cursor.state, "endpoint-continue");
  assert.equal(cursor.badge, "/");
});

test("hovering a closed-path vertex with no drawing deletes", () => {
  const cursor = resolvePenCursor({
    target: { kind: "anchor", vertexIndex: 0, isEndpoint: true, pathClosed: true },
  });
  assert.equal(cursor.state, "vertex-delete");
  assert.equal(cursor.badge, "-");
});

test("closed drawing paths never offer endpoint close or continue", () => {
  for (const vertexIndex of [0, 2]) {
    const cursor = resolvePenCursor({
      target: { kind: "anchor", vertexIndex },
      drawing: drawing([[0, 0], [10, 0], [10, 10]], true),
    });
    assert.equal(cursor.state, "vertex-delete");
  }
});

test("hovering a segment adds with the + badge", () => {
  const cursor = resolvePenCursor({ target: { kind: "segment", segmentIndex: 1 } });
  assert.equal(cursor.state, "segment-add");
  assert.equal(cursor.badge, "+");
});

test("handles and unknown targets fall back to canvas start", () => {
  for (const target of [
    { kind: "handle", vertexIndex: 0 },
    { kind: "mystery" },
    {},
  ]) {
    const cursor = resolvePenCursor({ target });
    assert.equal(cursor.state, "canvas-start");
    assert.equal(cursor.badge, null);
  }
});

test("every pen state has a distinct cursor token", () => {
  const cursors = PEN_CURSOR_PRIORITY.map((state) => {
    if (state === "endpoint-close") {
      return resolvePenCursor({
        target: { kind: "anchor", vertexIndex: 0 },
        drawing: drawing([[0, 0], [9, 9]]),
      }).cursor;
    }
    if (state === "endpoint-continue") {
      return resolvePenCursor({
        target: { kind: "anchor", vertexIndex: 1 },
        drawing: drawing([[0, 0], [9, 9]]),
      }).cursor;
    }
    if (state === "vertex-delete") return resolvePenCursor({ target: { kind: "anchor", vertexIndex: 0 } }).cursor;
    if (state === "segment-add") return resolvePenCursor({ target: { kind: "segment", segmentIndex: 0 } }).cursor;
    return resolvePenCursor({ target: null }).cursor;
  });
  assert.equal(new Set(cursors).size, PEN_CURSOR_PRIORITY.length);
});

test("selection cursor shows hover, canvas, and marquee states", () => {
  assert.equal(resolveSelectCursor({}).state, "canvas");
  assert.equal(resolveSelectCursor({ target: null }).state, "canvas");
  for (const target of [
    { kind: "anchor", vertexIndex: 0 },
    { kind: "handle", vertexIndex: 0 },
    { kind: "segment", segmentIndex: 0 },
  ]) {
    assert.equal(resolveSelectCursor({ target }).state, "hover");
  }
  const marquee = resolveSelectCursor({ target: { kind: "anchor", vertexIndex: 0 }, marquee: true });
  assert.equal(marquee.state, "marquee");
});

test("selection cursors never reuse pen tokens", () => {
  const pen = new Set(
    PEN_CURSOR_PRIORITY.map((state) => "pen-" + state),
  );
  for (const record of [
    resolveSelectCursor({}),
    resolveSelectCursor({ target: { kind: "anchor", vertexIndex: 0 } }),
    resolveSelectCursor({ marquee: true }),
  ]) {
    assert.equal(record.tool, "select");
    assert.equal(record.badge, null);
    assert.ok(!pen.has(record.cursor));
  }
});

test("navigation cursors are grab and grabbing", () => {
  assert.deepEqual(
    navigationCursor({}),
    { tool: "navigate", state: "pan", badge: null, cursor: "pan", css: "grab" },
  );
  assert.deepEqual(
    navigationCursor({ panning: true }),
    { tool: "navigate", state: "panning", badge: null, cursor: "pan-active", css: "grabbing" },
  );
});

test("all tool cursor tokens are pairwise distinct", () => {
  const tokens = [
    ...PEN_CURSOR_PRIORITY.map((state) => "pen-" + state),
    resolveSelectCursor({}).cursor,
    resolveSelectCursor({ target: { kind: "segment", segmentIndex: 0 } }).cursor,
    resolveSelectCursor({ marquee: true }).cursor,
    navigationCursor({}).cursor,
    navigationCursor({ panning: true }).cursor,
  ];
  assert.equal(new Set(tokens).size, tokens.length);
});

test("selected vertices are filled squares and others are hollow", () => {
  assert.equal(vertexInstruction({ selected: true }).shape, "filled-square");
  assert.equal(vertexInstruction({ selected: false }).shape, "hollow-square");
});

test("first vertex always carries the double ring", () => {
  assert.equal(vertexInstruction({ isFirst: true }).shape, "double-ring");
  assert.equal(vertexInstruction({ selected: true, isFirst: true }).shape, "filled-double-ring");
  assert.equal(vertexInstruction({ isFirst: true }).ring, "double");
  assert.equal(vertexInstruction({}).ring, "single");
});

test("endpoint hover enlarges the ring and adds the badge without changing shape", () => {
  for (const [intent, badge] of [["close", "o"], ["continue", "/"]]) {
    const plain = vertexInstruction({ isFirst: true });
    const hovered = vertexInstruction({ isFirst: true, intent });
    assert.equal(hovered.shape, plain.shape);
    assert.equal(hovered.size, plain.size * ENDPOINT_ENLARGE);
    assert.equal(hovered.badge, badge);
  }
  assert.equal(vertexInstruction({}).size, 8);
  assert.equal(vertexInstruction({ isFirst: true, intent: "close" }).size, 12);
});

test("delete hover turns the vertex red with the - badge and keeps its shape", () => {
  const plain = vertexInstruction({});
  const hovered = vertexInstruction({ intent: "delete" });
  assert.equal(hovered.shape, plain.shape);
  assert.equal(hovered.size, plain.size);
  assert.equal(hovered.color, COLORS.hoverDelete);
  assert.equal(hovered.badge, "-");
});

test("vertex instruction honours validated preferences", () => {
  assert.equal(vertexInstruction({ prefs: { vertexSize: 12 } }).size, 12);
  assert.equal(vertexInstruction({ prefs: { vertexSize: 0 } }).size, 8);
});

test("handles are circles at the 6 px default and fill on selection", () => {
  const plain = handleInstruction({});
  assert.equal(plain.shape, "circle");
  assert.equal(plain.size, 6);
  assert.equal(plain.color, COLORS.vertex);
  assert.equal(handleInstruction({ selected: true }).color, COLORS.selected);
  assert.equal(handleInstruction({ prefs: { handleSize: 9 } }).size, 9);
});

test("add segments highlight while plain segments do not", () => {
  const plain = segmentInstruction({});
  assert.equal(plain.highlighted, false);
  assert.equal(segmentInstruction({ highlighted: true }).highlighted, true);
  assert.equal(segmentInstruction({ highlighted: true }).color, COLORS.hoverAdd);
  assert.notEqual(plain.color, COLORS.hoverAdd);
});

test("direction arrow marks open paths and never closed ones", () => {
  assert.equal(directionInstruction({ closed: true, points: [[0, 0], [5, 5]] }), null);
  assert.equal(directionInstruction({ closed: false, points: [[0, 0]] }), null);
  assert.equal(directionInstruction({ closed: false, points: [] }), null);
  const points = [[0, 0], [4, 0], [4, 6]];
  const arrow = directionInstruction({ closed: false, points });
  assert.equal(arrow.shape, "direction-arrow");
  assert.deepEqual(arrow.from, [4, 0]);
  assert.deepEqual(arrow.to, [4, 6]);
  assert.equal(typeof arrow.color, "string");
  points[2][0] = 999;
  assert.deepEqual(arrow.to, [4, 6]);
});

test("path instructions mark selection, first vertex, and hover together", () => {
  const vertices = [
    { id: "a", point: [0, 0] },
    { id: "b", point: [10, 0] },
    { id: "c", point: [10, 10] },
  ];
  const result = pathInstructions({
    vertices,
    closed: false,
    selectedIds: ["b"],
    hover: { kind: "anchor", vertexIndex: 0, intent: "close" },
  });
  assert.equal(result.vertices[0].shape, "double-ring");
  assert.equal(result.vertices[0].badge, "o");
  assert.equal(result.vertices[0].size, 12);
  assert.equal(result.vertices[1].shape, "filled-square");
  assert.equal(result.vertices[1].badge, null);
  assert.equal(result.vertices[2].shape, "hollow-square");
  assert.ok(result.direction);
  assert.equal(result.direction.shape, "direction-arrow");
  assert.deepEqual(result.errors, []);
});

test("path instructions accept selection sets and highlight one segment", () => {
  const vertices = [
    { id: "a", point: [0, 0] },
    { id: "b", point: [10, 0] },
    { id: "c", point: [10, 10] },
  ];
  const result = pathInstructions({
    vertices,
    closed: false,
    selectedIds: new Set(["a", "c"]),
    hover: { kind: "segment", segmentIndex: 1 },
  });
  assert.equal(result.vertices[0].shape, "filled-double-ring");
  assert.equal(result.vertices[2].shape, "filled-square");
  assert.deepEqual(result.segments.map((segment) => segment.highlighted), [false, true]);
});

test("closed paths report all segments and no direction arrow", () => {
  const vertices = [
    { id: "a", point: [0, 0] },
    { id: "b", point: [10, 0] },
    { id: "c", point: [10, 10] },
  ];
  const result = pathInstructions({ vertices, closed: true });
  assert.equal(result.segments.length, 3);
  assert.equal(result.direction, null);
  assert.equal(result.vertices[0].shape, "double-ring");
  const open = pathInstructions({ vertices, closed: false });
  assert.equal(open.segments.length, 2);
});

test("path instructions fall back to defaults on invalid prefs and report errors", () => {
  const result = pathInstructions({
    vertices: [{ id: "a", point: [0, 0] }],
    prefs: { vertexSize: -1 },
  });
  assert.deepEqual(result.prefs, { vertexSize: 8, handleSize: 6 });
  assert.equal(result.errors.length, 1);
});
