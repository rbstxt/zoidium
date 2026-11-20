"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const transfer = require("../plugins/shape-plus/path-transfer.js");
const { createMaskPathHost, createShapePathHost } = require("../plugins/shape-plus/path-hosts.js");
const { createMask } = require("../plugins/shape-plus/mask-model.js");
function fixture() {
  const item = createMask("old", "Mask 1", [1, 2]);
  item.vertexIds = ["a", "b"]; item.vertexModes = { a: "smooth", b: "corner" };
  item.properties.closed = 1;
  item.properties.path = { animated: true, keyframes: [
    { frame: 0, value: [1,2,3,4,5,6,7,8,9,10,11,12], tween: 1 },
    { frame: 10, value: [2,3,4,5,6,7,8,9,10,11,12,13], tween: 2 },
  ] };
  item.mode = "subtract"; item.feather = 12; return item;
}
function host(kind, initial) {
  let data = structuredClone(initial), n = 0;
  const store = { read: () => data, write: value => { data = value; }, nextId: () => `host${++n}` };
  return (kind === "mask" ? createMaskPathHost : createShapePathHost)({ id: kind, store });
}
function ids() { let n = 0; return () => `fresh${++n}`; }
function history() {
  return { operation: null, entries: [], startOperation() { this.operation = []; },
    pushCommand(fn, payload) { this.operation.push([fn, payload]); },
    finishOperation() { this.entries.push(this.operation); this.operation = null; },
    discardOperation() { this.operation = null; },
    undo() { const commands = this.entries.pop(); this.startOperation(); commands.reverse().forEach(([fn, p]) => fn(p)); this.finishOperation(); },
  };
}
test("clipboard preserves keys and modes but excludes mask settings", () => {
  const envelope = transfer.copyPath(fixture());
  assert.equal(envelope.version, 1); assert.equal(envelope.path.closed, 1);
  assert.deepEqual(envelope.path.vertexModes, { a: "smooth", b: "corner" });
  assert.equal(JSON.stringify(envelope).includes("subtract"), false);
  assert.equal(envelope.path.channels[0].keyframes[1].tween, 2);
});
test("affine mapping transforms all point keys and handle vectors with fresh ids", () => {
  const result = transfer.materialize(transfer.copyPath(fixture()), [0, 2, -3, 0, 100, 200], ids(), []);
  assert.notEqual(result.id, "old"); assert.deepEqual(result.vertexIds, ["fresh2", "fresh3"]);
  assert.deepEqual(result.vertexModes, { fresh2: "smooth", fresh3: "corner" });
  assert.deepEqual(result.properties.path.keyframes[0].value, [94,202,-12,6,-18,10,76,214,-30,18,-36,22]);
  assert.deepEqual(result.properties.path.keyframes[1].value.slice(0, 6), [91,204,-15,8,-21,12]);
  assert.equal(result.properties.path.keyframes[1].tween, 2);
});
test("invalid envelopes, expressions, and non-affine mappings are rejected", () => {
  const envelope = transfer.copyPath(fixture());
  assert.throws(() => transfer.materialize({ ...envelope, version: 2 }, [1,0,0,1,0,0], ids(), []), /version/i);
  const bad = structuredClone(envelope); bad.path.channels[0].keyframes[0].value = null;
  assert.throws(() => transfer.materialize(bad, [1,0,0,1,0,0], ids(), []), /key/i);
  assert.throws(() => transfer.materialize(envelope, [1,0,0,0,1,0,0.1,0,1], ids(), []), /affine/i);
  const item = fixture(); item.properties.path.expression = "x";
  assert.throws(() => transfer.copyPath(item), /expression/i);
});
test("paste and conversion are single undoable transactions with default mask settings", () => {
  const source = host("shape", [fixture()]), dest = host("mask", []), h = history();
  transfer.convert({ source, pathId: "old", destination: dest, matrix: [1,0,0,1,5,7], nextId: ids(), history: h });
  assert.equal(source.readSnapshot().length, 0); const item = dest.readSnapshot()[0];
  assert.equal(item.mode, "add"); assert.equal(item.feather, 0); assert.equal(item.opacity, 1);
  assert.equal(h.entries.length, 1); h.undo(); assert.equal(source.readSnapshot().length, 1); assert.equal(dest.readSnapshot().length, 0);
  h.undo(); assert.equal(source.readSnapshot().length, 0); assert.equal(dest.readSnapshot().length, 1);
});
test("mask conversion creates painted group before deleting and restores on failure", () => {
  const source = host("mask", [fixture()]), dest = host("shape", []), h = history();
  const createPainted = group => { assert.equal(source.hasPath("old"), true); dest.writeSnapshot([group.contents[0]]); throw Error("paint failed"); };
  assert.throws(() => transfer.convert({ source, pathId: "old", destination: dest, matrix: [1,0,0,1,0,0], nextId: ids(), history: h, createPainted }), /paint failed/);
  assert.equal(source.hasPath("old"), true); assert.deepEqual(dest.readSnapshot(), []); assert.equal(h.entries.length, 0);
  let group;
  transfer.convert({ source, pathId: "old", destination: dest, matrix: [1,0,0,1,0,0], nextId: ids(), history: h,
    createPainted(value) { group = value; dest.writeSnapshot([group.contents[0]]); } });
  assert.equal(group.contents[1].kind, "fill"); assert.equal(source.hasPath("old"), false); assert.equal(h.entries.length, 1);
});
test("paste uses one history entry and avoids source and destination IDs", () => {
  const destination = host("mask", []), h = history(), candidates = ["old", "a", "new", "v1", "v2"];
  transfer.paste({ envelope: transfer.copyPath(fixture()), destination, matrix: [1,0,0,1,0,0],
    nextId: () => candidates.shift(), history: h });
  assert.equal(destination.readSnapshot()[0].id, "new"); assert.equal(h.entries.length, 1);
  h.undo(); assert.deepEqual(destination.readSnapshot(), []);
});
test("independent key schedules retain their data or reject unsafe mixing", () => {
  const envelope = transfer.copyPath(fixture());
  envelope.path.channels[1].keyframes[1].frame = 8;
  const separate = transfer.materialize(envelope, [2,0,0,3,1,2], ids());
  assert.equal(separate.properties.path.objects[1].keyframes[1].frame, 8);
  assert.throws(() => transfer.materialize(envelope, [1,1,0,1,0,0], ids()), /preserve animation/i);
  const destination = host("mask", []), h = history();
  assert.throws(() => transfer.paste({ envelope, destination, matrix: [1,0,0,1,0,0], nextId: ids(), history: h }), /separate channel/i);
  assert.deepEqual(destination.readSnapshot(), []); assert.equal(h.entries.length, 0);
});
test("conversion failure on source deletion removes the destination", () => {
  const source = host("shape", [fixture()]), destination = host("mask", []), h = history();
  source.deletePath = () => { throw Error("delete failed"); };
  assert.throws(() => transfer.convert({ source, pathId: "old", destination, matrix: [1,0,0,1,0,0], nextId: ids(), history: h }), /delete failed/);
  assert.equal(source.hasPath("old"), true); assert.deepEqual(destination.readSnapshot(), []); assert.equal(h.entries.length, 0);
});
