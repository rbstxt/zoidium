"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { deform, wiggleTransform } = require("../plugins/shape-plus/deform");
const {
  merge,
  offset,
  integerPaths,
} = require("../plugins/shape-plus/topology");
const { area, triangulate } = require("../plugins/shape-plus/fill");
const { compile } = require("../plugins/shape-plus/compiler");
const { PZ } = require("./shape-plus-host");
const { createModel } = require("../plugins/shape-plus/model");
const square = (x = 0, y = 0, size = 10) => ({
  closed: true,
  points: [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ],
});
const total = (paths) =>
  paths.reduce((sum, path) => sum + area(path.points), 0);
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
test("twist rotates radius 100 through the specified angle about center", () => {
  const path = {
    closed: false,
    points: [
      [110, 20],
      [210, 20],
    ],
  };
  const result = deform(path, "twist", {
    angle: Math.PI / 2,
    center: [10, 20],
  });
  near(result.points[0][0], 10);
  near(result.points[0][1], 120);
  const last = result.points.at(-1);
  near(last[0], -190);
  near(last[1], 20);
  assert.deepEqual(path.points, [
    [110, 20],
    [210, 20],
  ]);
});
test("zig zag has two alternating extrema per ridge and fixed endpoints", () => {
  const path = {
    closed: false,
    points: [
      [0, 0],
      [70, 0],
    ],
  };
  const result = deform(path, "zigZag", {
    size: 7,
    ridges: 3,
    points: "corner",
  });
  assert.equal(result.points.length, 8);
  assert.deepEqual(result.points[0], [0, 0]);
  assert.deepEqual(result.points.at(-1), [70, 0]);
  assert.deepEqual(
    result.points.slice(1, -1).map((p) => p[1]),
    [7, -7, 7, -7, 7, -7],
  );
  const smooth = deform(path, "zigZag", {
    size: 7,
    ridges: 3,
    points: "smooth",
  });
  assert.ok(smooth.points.length > 8);
  assert.ok(smooth.points.flat().every(Number.isFinite));
});
test("positive bloat pulls corners inward and edge midpoints outward; negative reverses it", () => {
  const path = square(-10, -10, 20),
    plus = deform(path, "puckerBloat", { amount: 50 }),
    minus = deform(path, "puckerBloat", { amount: -50 });
  assert.deepEqual(plus.points[0], [-5, -5]);
  assert.deepEqual(minus.points[0], [-15, -15]);
  // Resampling at four pixels includes points near the middle of each edge.
  assert.ok(Math.min(...plus.points.map((p) => p[1])) < -14);
  assert.ok(Math.min(...minus.points.map((p) => p[1])) === -15);
});
test("wiggle is deterministic at shuffled fractional/negative times and independent seeds", () => {
  const path = square(),
    p = {
      size: 8,
      detail: 5,
      frequency: 2,
      seed: 3,
      correlation: 30,
      temporalPhase: 17,
      spatialPhase: 13,
    };
  const expected = new Map();
  for (const time of [0, 1, 0.37, -0.2, 1, 0, 0.37, -0.2]) {
    const value = deform(path, "wigglePaths", { ...p, time });
    if (expected.has(time)) assert.deepEqual(value, expected.get(time));
    else expected.set(time, value);
  }
  assert.notDeepEqual(
    deform(path, "wigglePaths", { ...p, time: 0.37, seed: 4 }),
    expected.get(0.37),
  );
  const a = wiggleTransform(
    { ...p, position: [20, 30], scale: [15, 20], rotation: 1, time: 0.37 },
    0,
  );
  const b = wiggleTransform(
    { ...p, position: [20, 30], scale: [15, 20], rotation: 1, time: 0.37 },
    1,
  );
  assert.notDeepEqual(a, b);
  assert.deepEqual(
    wiggleTransform({ ...p, correlation: 100, position: [20, 30] }, 0),
    wiggleTransform({ ...p, correlation: 100, position: [20, 30] }, 9),
  );
});
for (const [join, expected] of [
  ["miter", 144],
  ["round", 140 + Math.PI],
  ["bevel", 142],
])
  test(`square offset ${join} area`, () => {
    near(
      total(offset([square()], { amount: 1, join }, 0.001)),
      expected,
      0.015,
    );
    near(total(offset([square()], { amount: -1, join }, 0.001)), 64, 0.015);
    assert.equal(offset([square()], { amount: -6, join }).length, 0);
  });
for (const [mode, expected] of [
  ["add", 150],
  ["subtract", 50],
  ["intersect", 50],
  ["exclude", 100],
])
  test(`overlapping squares ${mode}`, () => {
    const input = [square(), square(5)],
      before = JSON.stringify(input),
      result = merge(input, { mode });
    near(total(result), expected);
    assert.equal(JSON.stringify(input), before);
    assert.deepEqual(merge(input, { mode }), result);
  });
test("offset miter limit below two bevels a square corner",()=>{
  near(total(offset([square()],{amount:1,join:"miter",miterLimit:1})),142);
});
test("merge retains contours without welding, subtract unions all cutters", () => {
  assert.equal(merge([square(), square(5)], { mode: "merge" }).length, 2);
  near(
    total(
      merge([square(), square(2, 0, 4), square(4, 0, 4)], { mode: "subtract" }),
    ),
    76,
  );
});
test("offset splits a narrow neck and preserves oppositely wound holes", () => {
  const dumbbell = {
    closed: true,
    points: [
      [0, 0],
      [10, 0],
      [10, 4],
      [20, 4],
      [20, 0],
      [30, 0],
      [30, 10],
      [20, 10],
      [20, 6],
      [10, 6],
      [10, 10],
      [0, 10],
    ],
  };
  assert.equal(offset([dumbbell], { amount: -1.1, join: "miter" }).length, 2);
  const hole = square(3, 3, 4);
  hole.points.reverse();
  near(total(offset([square(), hole], { amount: 1, join: "miter" })), 140);
});
const corpus = [
  {
    name: "bow tie",
    points: [
      [0, 0],
      [10, 10],
      [0, 10],
      [10, 0],
    ],
    area: 50,
  },
  { name: "coincident", paths: [square(), square()], area: 100 },
  {
    name: "reverse cancellation",
    paths: [square(), { ...square(), points: square().points.reverse() }],
    area: 0,
  },
  { name: "touching corner", paths: [square(), square(10, 10)], area: 200 },
  { name: "touching edge", paths: [square(), square(10)], area: 200 },
  {
    name: "collinear reversal",
    points: [
      [0, 0],
      [10, 0],
      [5, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    area: 100,
  },
  {
    name: "near grid tie",
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [5, 10.0001],
      [0, 10],
    ],
    area: 100,
  },
];
for (const entry of corpus)
  test(`clipping corpus: ${entry.name}`, () => {
    const result = merge(
      entry.paths || [{ closed: true, points: entry.points }],
      { mode: "add" },
    );
    near(total(result), entry.area, 0.01);
    assert.ok(triangulate(result.map((p) => p.points)).every(Number.isFinite));
  });
test("circles have analytic lens union, intersection and xor areas", () => {
  const circle = (x) => ({
    closed: true,
    points: Array.from({ length: 512 }, (_, i) => [
      x + 10 * Math.cos((i * 2 * Math.PI) / 512),
      10 * Math.sin((i * 2 * Math.PI) / 512),
    ]),
  });
  const lens = 200 * Math.acos(0.5) - 5 * Math.sqrt(300);
  for (const [mode, expected] of [
    ["intersect", lens],
    ["add", 200 * Math.PI - lens],
    ["exclude", 200 * Math.PI - 2 * lens],
  ])
    near(total(merge([circle(0), circle(10)], { mode })), expected, 0.04);
});
test("topology quantization has symmetric half ties and bounded work", () => {
  assert.deepEqual(
    integerPaths([
      {
        closed: true,
        points: [
          [0.5 / 1024, -0.5 / 1024],
          [1, 0],
          [0, 1],
        ],
      },
    ])[0][0],
    { X: 1, Y: -1 },
  );
  assert.throws(
    () =>
      merge(
        [
          {
            closed: false,
            points: [
              [0, 0],
              [1, 0],
            ],
          },
        ],
        { mode: "add" },
      ),
    /closed/,
  );
  assert.throws(() => offset([square()], { amount: Infinity }), /budget/);
  assert.throws(() => merge([square(1e7)], { mode: "add" }), /coordinate/);
  assert.throws(
    () =>
      merge(
        Array.from({ length: 8193 }, () => square()),
        { mode: "add" },
      ),
    /point/,
  );
});
test("wiggle before repeater applies once to paint and paths, with copy correlation", () => {
  const { Content } = createModel(PZ);
  const node = (kind, id, properties = {}) => {
    const n = new Content(kind, { id });
    n.load({ id, properties });
    return n.evaluate(11);
  };
  const list = [
    node("rectangle", "r"),
    node("fill", "f"),
    node("wiggleTransform", "w"),
    node("repeater", "rep"),
  ];
  const result = compile(list),
    centers = result.commands.map((c) =>
      c.positions
        .filter((_, i) => i % 3 === 0)
        .reduce((a, b, _, l) => a + b / l.length, 0),
    );
  assert.equal(result.paths.length, 3);
  assert.equal(centers.length, 3);
  assert.notEqual(centers[0], centers[1]);
  const same = compile(list);
  assert.deepEqual(result, same);
  // A single painted copy has the same geometry as the later compound paint.
  list.pop();
  const a = compile(list).commands[0];
  list.splice(1, 1);
  list.push(node("fill", "f"));
  const b = compile(list).commands[0];
  const bounds = (c) =>
    [0, 1].map((k) => [
      Math.min(...c.positions.filter((_, i) => i % 3 === k)),
      Math.max(...c.positions.filter((_, i) => i % 3 === k)),
    ]);
  assert.deepEqual(bounds(a), bounds(b));
});

test("smooth modifiers retain paint ownership and reset length metadata after Trim", () => {
  const { Content } = createModel(PZ);
  const node = (kind, id, properties = {}) => {
    const n = new Content(kind, { id });
    n.load({ id, properties });
    return n.evaluate(7);
  };
  for (const kind of ["zigZag", "wigglePaths", "twist", "puckerBloat"]) {
    const contents = [
      node("rectangle", "r"),
      node("trim", "trim"),
      node(kind, "op", { points: "smooth" }),
      node("stroke", "s"),
    ];
    contents[3].properties.waveAmount = 25;
    const result = compile(contents);
    assert.ok(result.paths.length > 0, kind);
    assert.ok(result.commands[0].positions.length > 0, kind);
    assert.ok(result.commands[0].positions.every(Number.isFinite), kind);
  }
});

test("resolved triangulation retains holes, islands, crossings and translucent stroke area", () => {
  const {
    tessellate,
    strokeRegion,
  } = require("../plugins/shape-plus/topology");
  const meshArea = (positions) => {
    let sum = 0;
    for (let i = 0; i < positions.length; i += 9)
      sum += Math.abs(
        area([
          positions.slice(i, i + 2),
          positions.slice(i + 3, i + 5),
          positions.slice(i + 6, i + 8),
        ]),
      );
    return sum;
  };
  const hole = square(3, 3, 4);
  hole.points.reverse();
  near(meshArea(tessellate([square(), hole, square(4, 4, 2)])), 88);
  for (const entry of corpus)
    near(
      meshArea(
        tessellate(entry.paths || [{ closed: true, points: entry.points }]),
      ),
      entry.area,
      0.01,
    );
  for (const [cap, expected] of [
    ["butt", 20],
    ["square", 24],
    ["round", 20 + Math.PI],
  ]) {
    const region = strokeRegion(
      [
        {
          closed: false,
          points: [
            [0, 0],
            [10, 0],
          ],
        },
      ],
      { width: 2, cap, join: "miter" },
      0.001,
    );
    near(meshArea(tessellate(region)), expected, 0.02);
  }
  near(
    meshArea(
      tessellate(
        strokeRegion([square()], { width: 2, join: "miter", cap: "butt" }),
      ),
    ),
    80,
  );
});
