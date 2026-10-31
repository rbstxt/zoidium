"use strict";
// Fix 8 (perf/shape-model-time-ids): the generated-ID allocator is a bounded
// high-water mark. No per-ID set is retained across create/unload cycles;
// every observed canonical "s<base36>" ID advances the mark so later
// generated IDs cannot collide with imported or history-restored IDs.
// Serialized IDs load unchanged; live-root duplicates are replaced as before.
const { test } = require("node:test"), assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host");
const { createModel, clone } = require("../plugins/shape-plus/model");
function groupWith(contents) {
  const { Content } = createModel(PZ);
  const root = new Content("group");
  root.load({ id: "root", contents });
  return { Content, root };
}
test("5,000 create/unload cycles keep unique IDs on a single counter", () => {
  const { Content, nextId } = createModel(PZ);
  const seen = new Set(), cycles = 5000;
  for (let i = 0; i < cycles; i++) {
    const node = new Content("rectangle");
    assert.ok(!seen.has(node.id), "reused ID " + node.id);
    seen.add(node.id);
    node.unload();
  }
  assert.equal(seen.size, cycles);
  // No retention-based skipping: the mark advanced exactly once per cycle.
  assert.equal(nextId(), "s" + (cycles + 1).toString(36));
});
test("loaded canonical IDs advance the high-water mark; others do not", () => {
  const { Content } = createModel(PZ);
  const root = new Content("group");
  root.load({ id: "root", contents: [{ id: "sz", kind: "rectangle", properties: {} }] });
  assert.equal(new Content("rectangle").id, "s10");
  const fresh = createModel(PZ);
  const plain = new fresh.Content("group", { id: "group" });
  plain.load({ id: "group", contents: [
    { id: "sp-550e8400-e29b-41d4-a716-446655440000", kind: "rectangle", properties: {} },
    { id: "S1", kind: "rectangle", properties: {} },
    { id: "rect", kind: "rectangle", properties: {} },
  ] });
  assert.equal(new fresh.Content("rectangle").id, "s1");
  // The canonical format is purely syntactic: even a word like "shape" is a
  // valid s<base36> ID, so loading it advances the mark past its value.
  const wordy = createModel(PZ);
  const holder = new wordy.Content("group");
  holder.load({ id: "root", contents: [{ id: "shape", kind: "rectangle", properties: {} }] });
  assert.ok(parseInt(new wordy.Content("rectangle").id.slice(1), 36) > parseInt("hape", 36));
});
test("serialized IDs survive save/load unchanged, including high canonical IDs", () => {
  const data = { id: "root", contents: [
    { id: "s1z", kind: "rectangle", properties: {} },
    { id: "group", kind: "group", properties: {}, contents: [{ id: "s2", kind: "rectangle", properties: {} }] },
    { id: "custom-name", kind: "fill", properties: {} },
  ] };
  const first = groupWith(structuredClone(data).contents);
  assert.deepEqual(clone(first.root).contents.map(item => item.id), ["s1z", "group", "custom-name"]);
  const second = groupWith(clone(first.root).contents);
  assert.deepEqual(clone(second.root), clone(first.root));
});
test("duplicate IDs within one live root are replaced without live collision", () => {
  const { root } = groupWith([{ id: "dup", kind: "rectangle", properties: {} }, { id: "dup", kind: "rectangle", properties: {} }]);
  const [first, second] = Array.from(root.contents);
  assert.equal(first.id, "dup");
  assert.notEqual(second.id, "dup");
  assert.ok(!Array.from(root.contents).some(node => node !== second && node.id === second.id));
});
test("separate live roots may share an imported ID; the mark still advances", () => {
  const { Content } = createModel(PZ);
  const left = new Content("group"), right = new Content("group");
  left.load({ id: "left", contents: [{ id: "s7", kind: "rectangle", properties: {} }] });
  right.load({ id: "right", contents: [{ id: "s7", kind: "rectangle", properties: {} }] });
  assert.equal(left.contents[0].id, "s7");
  assert.equal(right.contents[0].id, "s7");
  assert.ok(parseInt(new Content("rectangle").id.slice(1), 36) > 7);
});
test("undo restores retired IDs; live collisions get fresh IDs", () => {
  const { Content } = createModel(PZ);
  const saved = size => ({ id: "root", contents: [
    { id: "s1", kind: "rectangle", properties: {} },
    ...(size > 1 ? [{ id: "s2", kind: "rectangle", properties: {} }] : []),
  ] });
  const live = new Content("group");
  live.load(saved(2));
  live.load(saved(1)); // delete s2
  assert.deepEqual(Array.from(live.contents, node => node.id), ["s1"]);
  const added = new Content("rectangle", { id: undefined });
  live.contents.push(added);
  added.load({ id: added.id });
  assert.ok(!["s1"].includes(added.id));
  live.load(saved(2)); // undo restores s2
  assert.deepEqual(Array.from(live.contents, node => node.id), ["s1", "s2"]);
  // Redo-style collision: s2 already live elsewhere in the same root.
  const clash = new Content("rectangle");
  live.contents.push(clash);
  clash.load({ id: "s2" });
  assert.notEqual(clash.id, "s2");
  assert.equal(new Set(Array.from(live.contents, node => node.id)).size, live.contents.length);
});
test("nested loads observe canonical IDs at every depth", () => {
  const { Content } = createModel(PZ);
  const root = new Content("group");
  root.load({ id: "root", contents: [{ id: "g", kind: "group", properties: {}, contents: [{ id: "s3k", kind: "rectangle", properties: {} }] }] });
  assert.ok(parseInt(new Content("rectangle").id.slice(1), 36) > parseInt("3k", 36));
});
test("allocator exhaustion throws explicitly instead of reusing IDs", () => {
  const { Content } = createModel(PZ);
  const root = new Content("group");
  root.load({ id: "root", contents: [{ id: "s" + Number.MAX_SAFE_INTEGER.toString(36), kind: "rectangle", properties: {} }] });
  assert.throws(() => new Content("rectangle"), /allocator exhausted/);
});
