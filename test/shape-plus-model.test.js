"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createModel, validate } = require("../plugins/shape-plus/model");
const { compile } = require("../plugins/shape-plus/compiler");
const { PZ } = require("./shape-plus-host");
const clone = value => JSON.parse(JSON.stringify(value));
const dynamic = (a, b) => ({ animated: b !== undefined, keyframes: [{ frame: 0, value: a, tween: 1 }, ...(b !== undefined ? [{ frame: 30, value: b, tween: 1 }] : [])] });
function fixture() {
  return { id: "group", kind: "group", future: { version: 3 }, properties: { opacity: dynamic(.5), unknown: "retained" }, contents: [
    { id: "path", kind: "path", vertexIds: ["a", "b", "c"], vertexModes: { a: "smooth" }, properties: { closed: 1, path: dynamic([0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0]) }, future: [1, 2] },
    { id: "fill", kind: "fill", properties: { color: dynamic([1, .5, 0]) } },
  ] };
}
test("model round trip retains stable ids, native channels, topology and unknown fields", () => {
  const { Content } = createModel(PZ), data = fixture(), before = clone(data);
  const node = new Content("group", data); node.load(data);
  assert.deepEqual(data, before);
  const saved = clone(node), reopened = new Content("group"); reopened.load(saved);
  assert.deepEqual(clone(reopened), saved);
  assert.equal(reopened.id, "group"); assert.deepEqual(reopened.contents[0].vertexIds, ["a", "b", "c"]);
  assert.equal(reopened.contents[0].properties.path.objects.length, 18);
  assert.deepEqual(saved.future, { version: 3 }); assert.equal(saved.properties.unknown, "retained");
  assert.equal(reopened.contents[0].parent, reopened.contents);
  assert.equal(reopened.contents.parent, reopened);
});
test("evaluated geometry is identical for out-of-order, repeated and fractional frames", () => {
  const { Content } = createModel(PZ), node = new Content("group", fixture()); node.load(fixture());
  const evaluate = frame => compile([node.evaluate(frame)]);
  const reference = new Map([0, 15, 30, 7.25].map(frame => [frame, evaluate(frame)]));
  for (const frame of [30, 0, 7.25, 15, 0, 30, 15]) assert.deepEqual(evaluate(frame), reference.get(frame));
  assert.notDeepEqual(reference.get(0), reference.get(30));
});
test("malformed topology, duplicate ids, depth and content budgets reject before allocation", () => {
  assert.throws(() => validate([fixture(), fixture()]), /duplicate/);
  const data = fixture(); data.contents[0].vertexIds = ["a", "a"];
  assert.throws(() => validate([data]), /topology/);
  let nested = [];
  for (let i = 0; i < 18; i++) nested = [{ id: "g" + i, kind: "group", contents: nested }];
  assert.throws(() => validate(nested), /depth/);
  assert.throws(() => validate(Array.from({ length: 513 }, (_, i) => ({ id: String(i), kind: "fill" }))), /item/);
});

test("native cloning assigns fresh contents ids while deletion undo keeps the originals", () => {
  const { Content } = createModel(PZ), root = new Content("group"); root.load({ contents: [fixture()] });
  const original = root.contents[0], saved = clone(original), copy = new Content("group");
  root.contents.push(copy); copy.load(saved);
  assert.notEqual(copy.id, original.id);
  assert.notEqual(copy.contents[0].id, original.contents[0].id);
  validate([clone(root)]);
  root.contents.splice(0, 1);
  const restored = new Content("group"); root.contents.push(restored); restored.load(saved);
  assert.equal(restored.id, saved.id);
  assert.equal(restored.contents[0].id, saved.contents[0].id);
});
