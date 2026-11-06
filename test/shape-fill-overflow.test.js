"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict"), fs = require("node:fs");
const { Worker } = require("node:worker_threads"), { createHash } = require("node:crypto");
const { triangulate } = require("../plugins/shape-plus/text-fill");
const { bounded, used } = require("../plugins/shape-plus/geometry-budget");
const { compile } = require("../plugins/shape-plus/compiler");
const { createModel } = require("../plugins/shape-plus/model");
const { createLoader } = require("../plugins/shape-plus/text-engine");
const { layoutText } = require("../plugins/shape-plus/text-layout");
const { PZ } = require("./shape-plus-host");
const held = value => ({ animated: false, keyframes: [{ frame: 0, value, tween: 1 }] });
const circle = (x, y, count = 24, radius = 1) => Array.from({ length: count }, (_, i) => {
  const angle = i / count * Math.PI * 2;
  return [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius];
});
const hash = positions => createHash("sha256").update(Buffer.from(new Float64Array(positions).buffer)).digest("hex");
function area(positions) {
  let result = 0;
  for (let i = 0; i < positions.length; i += 9) {
    result += Math.abs((positions[i + 3] - positions[i]) * (positions[i + 7] - positions[i + 1]) -
      (positions[i + 6] - positions[i]) * (positions[i + 4] - positions[i + 1])) / 2;
  }
  return result;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("large disjoint compounds preserve holes and fill rules without changing tolerance", () => {
  const pairs = Array.from({ length: 150 }, (_, i) => [circle(i * 5, 0), circle(i * 5, 0, 24, .5).reverse()]);
  for (const rule of ["nonzero", "even-odd"]) {
    const result = bounded(() => triangulate(pairs.flat(), rule));
    const expected = pairs.flatMap(contours => triangulate(contours, rule));
    assert.deepEqual(result, expected);
    near(area(result), area(triangulate(pairs[0], rule)) * pairs.length);
  }
});

test("connected overflow resolves overlap, coincidence, containment and shared edges once", () => {
  const outer = circle(0, 0, 240), inner = circle(0, 0, 240, .5).reverse();
  // 21 coincident rings exceed 4096 edges and form a single component.
  const repeated = Array.from({ length: 21 }, () => outer);
  for (const rule of ["nonzero", "even-odd"]) {
    near(area(bounded(() => triangulate(repeated, rule))), area(triangulate([outer], rule)));
    near(area(bounded(() => triangulate([...repeated, inner], rule))), area(triangulate(rule === "nonzero" ? [outer, outer, inner] : [outer, inner], rule)));
    const shifted = circle(.5, 0, 240);
    near(area(bounded(() => triangulate([...repeated, shifted], rule))), area(triangulate([outer, shifted], rule)));
  }
  const tiled = Array.from({ length: 2100 }, (_, i) => [[i, 0], [i + 1, 0], [i + 1, 1], [i, 1]]);
  near(area(bounded(() => triangulate(tiled))), 2100);
  assert.equal(area(bounded(() => triangulate([...repeated, outer], "even-odd"))), 0);
  assert.equal(area(bounded(() => triangulate([...repeated, ...repeated.map(p => p.slice().reverse())]))), 0);
});

test("overflow keeps deterministic work, vertex, edge and intersection bounds", () => {
  assert.throws(() => triangulate([Array.from({ length: 131073 }, (_, i) => [i, 0])]), /vertex budget exceeded/);
  assert.throws(() => triangulate([circle(0, 0, 65540)]), /edge budget exceeded/);
  assert.throws(() => bounded(() => triangulate(Array.from({ length: 3000 }, () => [[0, 0], [1, 0], [1, 1], [0, 1]]))), /intersection work budget exceeded/);
  const contours = Array.from({ length: 200 }, (_, i) => circle(i * 5, 0));
  const start = used(), first = bounded(() => triangulate(contours)), charge = used() - start;
  const now = performance.now;
  try {
    performance.now = () => 1e20;
    const startAgain = used();
    assert.deepEqual(bounded(() => triangulate(contours)), first);
    assert.equal(used() - startAgain, charge);
  } finally { performance.now = now; }
  const invalid = contours.concat([[[NaN, 0], [1, 1], [0, 1]]]);
  assert.throws(() => triangulate(invalid), /nonfinite polygon/);
});

test("connected overflow retains arrangement and triangle allocation limits", () => {
  assert.throws(() => bounded(() => triangulate([circle(0, 0, 7000)])), /arrangement work budget exceeded/);
  const outer = [[-2, -2], [1200, -2], [1200, 2], [-2, 2]];
  const holes = Array.from({ length: 400 }, (_, i) => circle(i * 3, i % 40 * .001).reverse());
  assert.throws(() => bounded(() => triangulate([outer, ...holes])), /triangle budget exceeded/);
});

test("overflow arrays match in a worker and synchronous compile", async () => {
  const contours = Array.from({ length: 200 }, (_, i) => circle(i * 5, 0));
  const contents = contours.map((points, index) => ({
    id: "path-" + index, kind: "path", vertexIds: points.map((_, i) => "v" + i),
    properties: { enabled: 1, closed: 1, path: points.flatMap(p => [...p, 0, 0, 0, 0]) },
  }));
  contents.push({ id: "paint", kind: "fill", properties: { enabled: 1, color: [1, 1, 1], opacity: 1, fillRule: "nonzero" } });
  const expected = hash(compile(contents, .125).commands[0].positions);
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { compile } = require(workerData.module);
    const { createHash } = require('node:crypto');
    const positions = compile(workerData.contents, .125).commands[0].positions;
    parentPort.postMessage(createHash('sha256').update(Buffer.from(new Float64Array(positions).buffer)).digest('hex'));
  `, { eval: true, workerData: { module: require.resolve("../plugins/shape-plus/compiler"), contents } });
  try {
    const actual = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    assert.equal(actual, expected);
  } finally { await worker.terminate(); }
});

let font, Content;
before(async () => {
  const engine = await createLoader((_, name) => fs.readFileSync(name, "utf8"), name => require("../plugins/shape-plus/" + name))();
  const bytes = fs.readFileSync("test/fixtures/shape-text/RobotoFlex-subset.ttf");
  font = engine.open(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), "fixture");
  ({ Content } = createModel(PZ, { evaluate: (_, p) => layoutText(font, null, p) }));
});
after(() => font?.dispose());
function item(kind, properties = {}) {
  const node = new Content(kind);
  node.load({ id: kind, properties });
  return node.evaluate(0);
}
test("160, 400 and 1000 glyphs retain fills at every preview quality", () => {
  for (const count of [160, 400, 1000]) {
    const text = item("text", { sourceText: "AV office ".repeat(count / 8), fontSize: held(20) });
    assert.equal(text.textLayout.glyphs.length, count);
    for (const tolerance of [.125, .25, .5, 1]) {
      const contents = [text, item("fill")], result = compile(contents, tolerance);
      assert.ok(result.commands[0]?.positions.length > 0, `${count} glyphs at ${tolerance}`);
      assert.equal(hash(compile(contents, tolerance).commands[0].positions), hash(result.commands[0].positions));
    }
  }
});
test("kerned overlapping text and per-character transforms retain compound coverage", () => {
  const text = item("text", { sourceText: "AV office ".repeat(20), fontSize: held(20), tracking: held(-100) });
  const fill = item("fill", { fillRule: "even-odd" });
  const animator = item("textAnimator", { enabled_rotation: 1, rotation: held(.3), enabled_position: 1, position: held([2, 3]) });
  for (const contents of [[text, fill], [text, animator, fill]]) {
    const result = compile(contents, .125);
    const plain = triangulate(result.paths.map(p => p.points), "even-odd");
    assert.ok(plain.length > 0);
    near(area(result.commands[0].positions), area(plain));
    assert.equal(hash(compile(contents, .125).commands[0].positions), hash(result.commands[0].positions));
  }
});
test("a large imported SVG compound uses the same overflow path", () => {
  const d = Array.from({ length: 64 }, (_, i) => {
    const x = i * 250;
    return `M${x} 0 A100 100 0 1 0 ${x + 200} 0 A100 100 0 1 0 ${x} 0 Z`;
  }).join(" ");
  let id = 0;
  const contents = require("../plugins/shape-plus/svg-import").importSVG(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#ffffff" fill-rule="evenodd"/></svg>`,
    () => "svg-" + id++,
  );
  function evaluate(data) {
    const node = new Content(data.kind, data); node.load(data);
    return node.evaluate(0);
  }
  const result = compile(contents.map(evaluate), .125);
  assert.ok(result.paths.reduce((n, p) => n + p.points.length, 0) > 4096);
  assert.ok(result.commands[0].positions.length > 0);
  const expectedArea = result.paths.reduce((sum, path) => sum + area(triangulate([path.points])), 0);
  near(area(result.commands[0].positions), expectedArea);
});
