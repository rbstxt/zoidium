"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { offset } = require("../plugins/shape-plus/topology.js");
const { area } = require("../plugins/shape-plus/fill.js");
const { compile } = require("../plugins/shape-plus/compiler.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { PZ } = require("./shape-plus-host.js");
const snapshots = require("./shape-plus-offset-open-snapshot.json");
const line = (x1, y1, x2, y2) => ({
  closed: false,
  points: [
    [x1, y1],
    [x2, y2],
  ],
});
const bounds = (points) => [
  Math.min(...points.map((p) => p[0])),
  Math.max(...points.map((p) => p[0])),
  Math.min(...points.map((p) => p[1])),
  Math.max(...points.map((p) => p[1])),
];
const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
for (const entry of snapshots)
  test(`closed-only offset is identical: ${entry.name} ${entry.amount} ${entry.join}`, () => {
    // Compare as JSON: Clipper integer math can produce -0 in one float slot
    // where the fixture stores 0. The two compare equal and render identically.
    assert.equal(
      JSON.stringify(
        offset([{ closed: true, points: entry.points }], { amount: entry.amount, join: entry.join }, 0.001),
      ),
      JSON.stringify(entry.result),
    );
  });
test("open line offsets to a closed outline on both sides", () => {
  const result = offset([line(0, 0, 100, 0)], { amount: 10, join: "miter" });
  assert.equal(result.length, 1);
  assert.equal(result[0].closed, true);
  const [minX, maxX, minY, maxY] = bounds(result[0].points);
  near(minX, 0);
  near(maxX, 100);
  near(minY, -10);
  near(maxY, 10);
});
test("round join gives round ends and more points than butt", () => {
  const butt = offset([line(0, 0, 100, 0)], { amount: 10, join: "miter" });
  const round = offset([line(0, 0, 100, 0)], { amount: 10, join: "round" });
  assert.equal(round.length, 1);
  const [minX, maxX] = bounds(round[0].points);
  near(minX, -10, 0.01);
  near(maxX, 110, 0.01);
  assert.ok(round[0].points.length > butt[0].points.length);
});
test("negative amount on an open path equals the positive amount", () => {
  const positive = offset([line(0, 0, 100, 0)], { amount: 10, join: "miter" });
  assert.deepEqual(offset([line(0, 0, 100, 0)], { amount: -10, join: "miter" }), positive);
});
test("mixed closed and open inputs keep both regions", () => {
  const square = {
    closed: true,
    points: [
      [1000, 1000],
      [1010, 1000],
      [1010, 1010],
      [1000, 1010],
    ],
  };
  const result = offset([square, line(0, 0, 100, 0)], { amount: 10, join: "miter" });
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map((path) => area(path.points)).sort((a, b) => a - b),
    [900, 2000],
  );
});
test("amount zero returns the open path unchanged", () => {
  const input = [line(0, 0, 100, 0)];
  const result = offset(input, { amount: 0 });
  assert.equal(result.length, 1);
  assert.equal(result[0].closed, false);
  assert.deepEqual(result[0].points, [
    [0, 0],
    [100, 0],
  ]);
});
test("open path through offset paths and stroke has geometry", () => {
  const ch = (value) => ({ animated: false, keyframes: [{ frame: 0, value, tween: 1 }] });
  const verts = [
    { point: [0, 0], in: [0, 0], out: [0, 0] },
    { point: [100, 0], in: [0, 0], out: [0, 0] },
  ];
  const { values } = require("../plugins/shape-plus/editor-geometry.js");
  const items = [
    {
      kind: "path",
      id: "p",
      vertexIds: ["v0", "v1"],
      properties: { closed: 0, path: { objects: values(verts).map(ch) } },
    },
    {
      kind: "offsetPaths",
      id: "mod",
      properties: { amount: ch(10), join: "miter", miterLimit: ch(4) },
    },
    {
      kind: "stroke",
      id: "s",
      properties: { width: ch(10), cap: "round", join: "round" },
    },
  ].map((item) => {
    const { Content } = createModel(PZ);
    const node = new Content(item.kind, item);
    node.load(item);
    return node.evaluate(0);
  });
  const result = compile(items, 1);
  assert.equal(result.commands.length, 1);
  assert.ok(result.commands[0].positions.length > 0);
});
