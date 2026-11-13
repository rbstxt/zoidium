"use strict";
// Layer mask data model: defaults, validation, combine order, sampling,
// UV conversion, references and native-interpolated evaluation.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const {
  FIELD, MODES, MAX_MASKS, MAX_POINTS,
  getMasks, setMasks, createMask, validateMasks, ensureNames, combineValue,
  samplePoints, toUV, evaluateMask, formatReference, parseReference,
} = require("../plugins/shape-plus/mask-model.js");

const PATH_VALUE = [0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 100, 100, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0];
function mask(overrides = {}) {
  return {
    id: "m1",
    kind: "path",
    mode: "add",
    feather: 0,
    opacity: 1,
    invert: 0,
    vertexIds: ["a", "b", "c", "d"],
    vertexModes: {},
    properties: {
      name: "Mask 1",
      enabled: 1,
      closed: 1,
      path: { animated: false, keyframes: [{ frame: 0, value: PATH_VALUE.slice(), tween: 1 }] },
    },
    ...overrides,
  };
}

test("mask field defaults to no masks and round-trips through set", () => {
  const layer = {};
  assert.deepEqual(getMasks(layer), []);
  assert.deepEqual(getMasks({ [FIELD]: null }), []);
  setMasks(layer, [mask()]);
  assert.equal(layer[FIELD].length, 1);
  assert.equal(layer[FIELD][0].mode, "add");
  assert.deepEqual(getMasks(layer), layer[FIELD]);
});

test("mask validation rejects bad modes, ranges and shapes", () => {
  assert.throws(() => validateMasks(null), /array/);
  assert.throws(() => validateMasks(new Array(MAX_MASKS + 1).fill(mask())), /at most/);
  assert.throws(() => validateMasks([{ ...mask(), mode: "xor" }]), /mode/);
  assert.throws(() => validateMasks([{ ...mask(), feather: -1 }]), /feather/);
  assert.throws(() => validateMasks([{ ...mask(), feather: 501 }]), /feather/);
  assert.throws(() => validateMasks([{ ...mask(), opacity: 1.5 }]), /opacity/);
  assert.throws(() => validateMasks([{ ...mask(), invert: 2 }]), /invert/);
  assert.throws(() => validateMasks([{ ...mask(), kind: "group", contents: [] }]), /only paths/);
  assert.throws(() => validateMasks([mask(), { ...mask() }]), /Duplicate/);
  assert.throws(() => validateMasks([{ ...mask(), vertexIds: [] }]), /vertex/);
  assert.throws(() => validateMasks([{ ...mask(), vertexIds: ["a", "a", "b", "c"] }]), /unique/);
  assert.throws(() => validateMasks([{ ...mask(), vertexModes: { a: "wavy" } }]), /vertex mode/);
  const short = { ...mask() };
  short.properties = { ...short.properties, path: { animated: false, keyframes: [{ frame: 0, value: [0], tween: 1 }] } };
  assert.throws(() => validateMasks([short]), /6 finite numbers/);
  assert.doesNotThrow(() => validateMasks([mask()]));
});

test("mask creation and AE-style numbering", () => {
  const created = createMask("m9", "Mask 9", [5, 6]);
  assert.equal(created.kind, "path");
  assert.deepEqual(created.properties.path.keyframes[0].value.slice(0, 2), [5, 6]);
  assert.doesNotThrow(() => validateMasks([created]));
  const masks = [{ ...mask(), properties: { ...mask().properties, name: "Path" } }, { ...mask(), id: "m2", properties: { ...mask().properties, name: "" } }];
  ensureNames(masks);
  assert.deepEqual(masks.map(m => m.properties.name), ["Mask 1", "Mask 2"]);
});

test("combine order follows AE semantics", () => {
  assert.equal(combineValue(0, 0.5, "add", true), 0.5);
  assert.equal(combineValue(0, 0.5, "intersect", true), 0.5);
  assert.equal(combineValue(0, 0.5, "subtract", true), 0);
  assert.equal(combineValue(0.5, 0.5, "add", false), 0.75);
  assert.equal(combineValue(0.5, 0.5, "subtract", false), 0.25);
  assert.equal(combineValue(0.5, 0.75, "intersect", false), 0.5);
  assert.equal(combineValue(1, 1, "add", false), 1);
});

test("sampling spaces points equally along a closed square", () => {
  const { Content } = createModel(PZ);
  const item = new Content("path", mask());
  item.load(mask());
  const evaluated = evaluateMask(item, 7);
  assert.equal(evaluated.closed, true);
  assert.equal(evaluated.vertices.length, 4);
  const { points, length } = samplePoints(evaluated, 8);
  assert.equal(points.length, 8);
  assert.equal(length, 400);
  // Square (0,0)-(100,100) perimeter 400; 8 samples land on corners/midpoints.
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points[2], [100, 0]);
  assert.deepEqual(points[4], [100, 100]);
  const { points: full } = samplePoints(evaluated);
  assert.equal(full.length, MAX_POINTS);
});

test("sampling keeps open paths open and repeats degenerate paths", () => {
  const open = mask({ properties: { name: "M", enabled: 1, closed: 0, path: mask().properties.path } });
  const { Content } = createModel(PZ);
  const item = new Content("path", open);
  item.load(open);
  const evaluated = evaluateMask(item, 0);
  assert.equal(evaluated.closed, false);
  const { points, length } = samplePoints(evaluated, 4);
  assert.equal(length, 300);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points[3], [0, 100]);
  const single = mask({ id: "s", vertexIds: ["a"], properties: { name: "S", enabled: 1, closed: 0, path: { animated: false, keyframes: [{ frame: 0, value: [7, 8, 0, 0, 0, 0], tween: 1 }] } } });
  const singleItem = new Content("path", single);
  singleItem.load(single);
  const one = samplePoints(evaluateMask(singleItem, 3), 5);
  assert.equal(one.length, 0);
  assert.deepEqual(one.points, [[7, 8], [7, 8], [7, 8], [7, 8], [7, 8]]);
});

test("sampling follows animated vertices at the requested frame", () => {
  const animated = mask();
  animated.properties.path = {
    animated: true,
    keyframes: [
      { frame: 0, value: PATH_VALUE.slice(), tween: 1 },
      { frame: 10, value: PATH_VALUE.map((v, i) => (i % 6 < 2 ? v + 100 : v)), tween: 1 },
    ],
  };
  const { Content } = createModel(PZ);
  const item = new Content("path", animated);
  item.load(animated);
  const at0 = samplePoints(evaluateMask(item, 0), 4).points[0];
  const at10 = samplePoints(evaluateMask(item, 10), 4).points[0];
  const at5 = samplePoints(evaluateMask(item, 5), 4).points[0];
  assert.deepEqual(at0, [0, 0]);
  assert.deepEqual(at10, [100, 100]);
  assert.deepEqual(at5, [50, 50]);
});

test("uv conversion maps mask space with y down", () => {
  assert.deepEqual(toUV([[0, 0], [1920, 1080], [960, 540]], 1920, 1080), [[0, 1], [1, 0], [0.5, 0.5]]);
});

test("references format, parse and reject garbage", () => {
  // The clip address is the only source token; nothing reads a track index.
  const maskRef = formatReference({ source: "mask", clip: [0, 1, 0, 0, 0], mask: "m1" });
  assert.deepEqual(parseReference(maskRef), { source: "mask", clip: [0, 1, 0, 0, 0], mask: "m1" });
  const shapeRef = formatReference({ source: "shape", clip: [0, 2, 0, 0, 0], path: "p3" });
  assert.deepEqual(parseReference(shapeRef), { source: "shape", clip: [0, 2, 0, 0, 0], path: "p3" });
  // References without a clip still parse (the source picker re-links them).
  assert.deepEqual(parseReference(formatReference({ source: "mask", mask: "m1" })), { source: "mask", mask: "m1" });
  // The retired Round-3 `track` list index is ignored, never required.
  const legacy = JSON.stringify({ version: 1, source: "mask", track: "0", clip: [0, 1, 0, 0, 0], mask: "m1" });
  assert.deepEqual(parseReference(legacy), { source: "mask", clip: [0, 1, 0, 0, 0], mask: "m1" });
  assert.ok(!("track" in JSON.parse(formatReference({ source: "mask", clip: [0], mask: "m1" }))));
  assert.equal(parseReference("not json"), null);
  assert.equal(parseReference(JSON.stringify({ version: 999, source: "mask", mask: "m" })), null);
  assert.equal(parseReference(JSON.stringify({ version: 1, source: "mask" })), null);
  assert.equal(parseReference(JSON.stringify({ version: 1, source: "effect", mask: "m" })), null);
  assert.equal(parseReference("null"), null);
});

test("modes list is stable and documented", () => {
  assert.deepEqual(MODES, ["add", "subtract", "intersect"]);
});
