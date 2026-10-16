"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { parsePath, arcs, pathText } = require("../plugins/shape-plus/svg-path");
const {
  importSVG,
  transform,
  affineGroup,
} = require("../plugins/shape-plus/svg-import");
const {
  convertNative,
  commandPaths,
} = require("../plugins/shape-plus/convert-native");
const { decode, FORMAT } = require("../plugins/shape-plus/workflow");
const { PZ } = require("./shape-plus-host");
const { createModel } = require("../plugins/shape-plus/model");
const {
  compile,
  matrix,
  transform: apply,
} = require("../plugins/shape-plus/compiler");
const { multiply } = require("../plugins/shape-plus/compiler-procedural");
const { area } = require("../plugins/shape-plus/fill");
const near = (a, b, eps = 1e-8) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const evaluate = (items) => {
  const { Content } = createModel(PZ);
  return items.map((item) => {
    const node = new Content(item.kind, item);
    node.load(item);
    return node.evaluate(0);
  });
};
const bounds = (paths) =>
  [0, 1].map((k) => [
    Math.min(...paths.flatMap((p) => p.points.map((v) => v[k]))),
    Math.max(...paths.flatMap((p) => p.points.map((v) => v[k]))),
  ]);
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
test("SVG relative commands, implicit lines, horizontal/vertical and compound subpaths", () => {
  const paths = parsePath("m10 20 30 0 v20 h-30 z M0 0 l5 5");
  assert.equal(paths.length, 2);
  assert.equal(paths[0].closed, true);
  assert.equal(paths[1].closed, false);
  assert.deepEqual(
    paths[0].vertices.map((v) => v.point),
    [
      [10, 20],
      [40, 20],
      [40, 40],
      [10, 40],
    ],
  );
});
test("SVG quadratic raising and smooth reflected cubic/quadratic controls", () => {
  const path = parsePath("M0 0 Q3 6 6 0 T12 0 C13 2 14 2 15 0 S17 -2 18 0")[0];
  assert.deepEqual(path.vertices[0].out, [2, 4]);
  assert.deepEqual(path.vertices[1].in, [-2, 4]);
  assert.deepEqual(path.vertices[1].out, [2, -4]);
  assert.deepEqual(path.vertices[3].out, [1, -2]);
  assert.deepEqual(parsePath(pathText(path))[0], path);
});
test("SVG arcs retain exact endpoints, corrected radii, flags and circular accuracy", () => {
  const span = arcs([10, 0], [0, 10], 10, 10, 0, false, true);
  assert.equal(span.length, 2);
  assert.deepEqual(span[0][0], [10, 0]);
  assert.deepEqual(span.at(-1)[3], [0, 10]);
  const { evaluate } = require("../plugins/shape-plus/path");
  for (const c of span)
    for (let i = 0; i <= 100; i++)
      near(Math.hypot(...evaluate(c, i / 100)), 10, 0.00005);
  const corrected = parsePath("M0 0 a1 1 0 0 1 20 0")[0];
  assert.deepEqual(corrected.vertices.at(-1).point, [20, 0]);
  assert.throws(() => parsePath("M0 0 A10 10 0 2 0 20 0"), /flag/);
  assert.deepEqual(arcs([0, 0], [10, 0], 0, 10, 0, false, true)[0], [
    [0, 0],
    [0, 0],
    [10, 0],
    [10, 0],
  ]);
});
test("SVG parser rejects malformed, excessive and non-finite path data", () => {
  for (const text of [
    "L0 0",
    "M0 0 X10 20",
    "M0",
    "M0 0 L1e999 2",
    "M0 0 ; L2 2",
    "M0 0 Z 1 2",
  ])
    assert.throws(() => parsePath(text), /SVG/);
  assert.throws(() => parsePath("M0 0 " + "L1 2 ".repeat(300)), /budget/);
});
test("SVG shapes, transformed groups, paints, holes and centered viewBox", () => {
  const svg =
    '<svg viewBox="0 0 100 100"><g transform="translate(10 20)" opacity="0.5"><rect width="40" height="20" fill="#f00" stroke="blue" stroke-width="2"/><circle cx="50" cy="50" r="10" fill="white"/></g></svg>';
  const result = compile(evaluate(importSVG(svg)));
  assert.equal(result.commands[0].kind, "isolation");
  near(result.commands[0].opacity, 0.5);
  const b = bounds(result.paths);
  near(b[0][0], -40);
  near(b[0][1], 20);
  near(b[1][0], -30);
  near(b[1][1], 30);
  const plain = compile(evaluate(importSVG("M0 0 h10 v10 h-10 z")));
  assert.equal(plain.commands.length, 1);
  near(meshArea(plain.commands[0].positions), 100);
  for (const element of [
    '<ellipse rx="10" ry="20"/>',
    '<polygon points="0,0 10,0 10,10"/>',
    '<polyline points="0,0 10,10"/>',
    '<rect width="30" height="20" rx="3"/>',
  ])
    assert.ok(
      compile(evaluate(importSVG("<svg>" + element + "</svg>"))).paths.length,
    );
});
test("affine SVD retains shear, reflections, rotations and translation", () => {
  let id = 0;
  for (const m of [
    [1, 0.2, 0.7, 2, 13, 17],
    [-2, 0.3, 0.4, 1, 2, -5],
    [0, 0, 0, 0, 3, 5],
    transform("translate(13 4) rotate(30 5 2) scale(2 -3) skewX(20)"),
  ]) {
    const group = affineGroup([], m, () => String(++id));
    const evaluated = evaluate([group])[0];
    const actual = multiply(
      matrix(evaluated.properties),
      matrix(evaluated.contents[0].properties),
    );
    for (let i = 0; i < 6; i++) near(actual[i], m[i]);
  }
});
test("SVG never permits active, external, entity or unsupported rendering data", () => {
  for (const text of [
    "<svg><script/></svg>",
    '<svg><image href="https://example.com/a.png"/></svg>',
    "<!DOCTYPE svg><svg/>",
    '<svg onload="x()"/>',
    '<svg><path d="M0 0" fill="url(#a)"/></svg>',
    "<svg><text>Hello</text></svg>",
    "<svg><g></svg>",
    '<svg><rect width="NaN"/></svg>',
    '<svg><path d="M0 0" style="filter: blur(2px)"/></svg>',
  ])
    assert.throws(() => importSVG(text), /SVG/);
});
test("native OpenType M/L/Q/C/Z converts cubics and refuses unknown outlines", () => {
  const result = commandPaths([
    { type: "M", x: 0, y: 0 },
    { type: "Q", x1: 3, y1: 6, x: 6, y: 0 },
    { type: "L", x: 0, y: 0 },
    { type: "Z" },
  ]);
  assert.deepEqual(result[0].vertices[0].out, [2, 4]);
  assert.equal(result[0].closed, true);
  assert.throws(() => commandPaths([{ type: "A" }]), /Unsupported/);
});
test("native preset conversion keeps clip-level transform, effects, keys and paint values", () => {
  const d = (value) => ({
    animated: false,
    keyframes: [{ frame: 0, value, tween: 1 }],
  });
  const source = {
    type: 0,
    properties: {
      name: "Native group",
      position: d([13, 17]),
      rotation: d(0.4),
      scale: d([2, 0.7]),
    },
    operations: [
      { type: 0, properties: { color: d([1, 0.2, 0.1]) } },
      {
        type: 1,
        properties: { color: d([0, 0, 0]), size: d(4), opacity: d(0.3) },
      },
    ],
    objects: [{ type: 1, properties: {}, operations: [] }],
  };
  const layer = {
    type: 8,
    properties: {
      name: "Original",
      position: d([8, 9]),
      scale: d([0.7, 0.8]),
      rotation: d(0.5),
      opacity: d(0.4),
    },
    effects: [{ type: "test", properties: { amount: d(2) } }],
    objects: [source],
    shapeProperties: { preset: { get: () => 1 } },
  };
  const before = JSON.stringify(layer),
    converted = convertNative(layer);
  assert.equal(JSON.stringify(layer), before);
  assert.deepEqual(converted.properties, layer.properties);
  assert.deepEqual(converted.effects, layer.effects);
  const result = compile(evaluate(converted.contents));
  assert.ok(result.commands.length >= 2);
  assert.ok(result.commands.some((c) => c.opacity === 0.3));
  const originalMatrix = matrix({
    position: [13.5, 16.5],
    anchor: [0.5, -0.5],
    scale: [2, 0.7],
    rotation: 0.4,
  });
  const point = apply([-100, -100], originalMatrix);
  near(
    Math.min(
      ...result.paths[0].points.map((p) =>
        Math.hypot(p[0] - point[0], p[1] - point[1]),
      ),
    ),
    0,
  );
  assert.throws(
    () =>
      convertNative({
        ...layer,
        type: 6,
        objects: [
          { type: 1, properties: {}, operations: [], path: { draw() {} } },
        ],
      }),
    /outlines/,
  );
  assert.throws(
    () => convertNative({ ...layer, type: 7, font: null }),
    /glyph outlines/,
  );
});
test("contents envelope retains animation/unknown fields with fresh item and vertex IDs", () => {
  const item = {
    kind: "path",
    id: "old",
    vertexIds: ["v1"],
    vertexModes: { v1: "smooth" },
    custom: { future: true },
    properties: {
      closed: 0,
      path: {
        animated: true,
        keyframes: [
          { frame: 0, value: [1, 2, 3, 4, 5, 6] },
          { frame: 30, value: [2, 3, 4, 5, 6, 7] },
        ],
      },
    },
  };
  let n = 0;
  const text = JSON.stringify({ format: FORMAT, version: 1, contents: [item] });
  const pasted = decode(text, () => "new" + ++n);
  assert.notEqual(pasted[0].id, item.id);
  assert.notEqual(pasted[0].vertexIds[0], "v1");
  assert.equal(pasted[0].vertexModes[pasted[0].vertexIds[0]], "smooth");
  assert.deepEqual(pasted[0].properties, item.properties);
  assert.deepEqual(pasted[0].custom, item.custom);
  assert.equal(
    decode("native clipboard text", () => "new"),
    null,
  );
});

test("native conditional rows track dash count, wave units, radial type and star mode without changing storage", () => {
  const { visible } = require("../plugins/shape-plus/native-properties");
  const { Content } = createModel(PZ);
  const make = (kind, properties) => {
    const item = new Content(kind);
    item.load({ properties });
    return item;
  };
  const stroke = make("gradientStroke", {
    dashPairs: 1,
    waveUnits: "length",
    gradientType: "linear",
  });
  const before = JSON.stringify(stroke);
  for (const [key, expected] of [
    ["dash1", true],
    ["gap1", true],
    ["dash2", false],
    ["gap3", false],
    ["wavelength", true],
    ["waveCycles", false],
    ["highlightLength", false],
  ])
    assert.equal(visible(key, stroke.properties), expected, key);
  assert.equal(JSON.stringify(stroke), before);
  assert.equal(
    visible(
      "highlightAngle",
      make("gradientFill", { gradientType: "radial" }).properties,
    ),
    true,
  );
  assert.equal(
    visible("innerRadius", make("polystar", { mode: "polygon" }).properties),
    false,
  );
});
