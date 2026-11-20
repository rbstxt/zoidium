"use strict";
// Host adapters for the shared path controller: mask and Shape+ adapters
// plus atomic creation requests. Consumes the real P1.1 controller, the P1.2
// metadata model, and the mask data model; stores are in-memory fakes except
// for one suite that wires a real mask-host.js host.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createPathController } = require("../plugins/shape-plus/path-controller.js");
const { setLocked } = require("../plugins/shape-plus/mask-metadata.js");
const { createMask } = require("../plugins/shape-plus/mask-model.js");
const {
  createMaskPathHost,
  createShapePathHost,
  requestCreation,
  applyCreation,
} = require("../plugins/shape-plus/path-hosts.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeMask(id, name, vertexIds = ["v1"]) {
  const mask = createMask(id, name, [10, 20]);
  mask.vertexIds = vertexIds.slice();
  const value = vertexIds.flatMap((_, index) => [10 + index, 20 + index, 0, 0, 0, 0]);
  mask.properties.path = { animated: false, keyframes: [{ frame: 0, value, tween: 1 }] };
  return mask;
}

function memoryStore(records = [], prefix = "p") {
  let data = clone(records);
  let n = 0;
  return {
    read: () => clone(data),
    write: next => { data = clone(next); },
    nextId: () => prefix + (++n),
    peek: () => clone(data),
  };
}

function mirror() {
  return { activeId: null, selection: new Set(), treeSelection: new Set() };
}

function fakeHistory() {
  return {
    operation: null,
    entries: [],
    startOperation() { this.operation = []; },
    pushCommand(fn, p) { (this.operation || this.entries[this.entries.push([]) - 1]).push({ fn, p }); },
    finishOperation() { if (this.operation && this.operation.length) this.entries.push(this.operation); this.operation = null; },
    discardOperation() { this.operation = null; },
    undo() {
      const operation = this.entries.pop();
      if (operation) for (const { fn, p } of operation) fn(p);
    },
  };
}

function shapeRecords() {
  return [
    { id: "s1", kind: "path", vertexIds: ["a", "b"] },
    { id: "s2", kind: "path", vertexIds: ["c"] },
  ];
}

test("mask adapter requires a string id and a read/write store", () => {
  const store = memoryStore([]);
  assert.throws(() => createMaskPathHost({ store }), /string id/);
  assert.throws(() => createMaskPathHost({ id: "mask", store: { read: () => [] } }), /read.*write|store/i);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  assert.equal(adapter.id, "mask:7");
  assert.equal(adapter.kind, "mask");
});

test("mask adapter enumerates ids in combine order", () => {
  const store = memoryStore([makeMask("m1", "Mask 1"), makeMask("m2", "Mask 2", ["a", "b"])]);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  assert.deepEqual(adapter.listPathIds(), ["m1", "m2"]);
  assert.equal(adapter.hasPath("m2"), true);
  assert.equal(adapter.hasPath("m9"), false);
  assert.deepEqual(adapter.listVertexIds("m2"), ["a", "b"]);
  assert.deepEqual(adapter.listVertexIds("m9"), []);
  assert.equal(adapter.isLocked("m1"), false);
});

test("mask createPath appends a Mask N with metadata defaults", () => {
  const store = memoryStore([makeMask("m1", "Mask 1"), makeMask("m2", "Mask 2")]);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  const id = adapter.createPath({ point: [3, 4] });
  assert.equal(id, "p1");
  const written = store.peek();
  assert.equal(written.length, 3);
  const item = written[2];
  assert.equal(item.properties.name, "Mask 3");
  assert.equal(item.outlineColor, "#f0883e");
  assert.equal(item.locked, false);
  assert.equal(item.expansion, 0);
  assert.deepEqual(adapter.listPathIds(), ["m1", "m2", "p1"]);
});

test("mask createPath skips colliding generator ids", () => {
  const store = memoryStore([makeMask("m1", "Mask 1")]);
  let calls = 0;
  store.nextId = () => (++calls <= 2 ? "m1" : "fresh");
  const adapter = createMaskPathHost({ id: "mask:7", store });
  assert.equal(adapter.createPath({ point: [0, 0] }), "fresh");
  assert.equal(calls, 3);
});

test("mask createPath validates points, names, and capacity", () => {
  const store = memoryStore([makeMask("m1", "Mask 1")]);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  assert.throws(() => adapter.createPath({ point: [1, NaN] }), /two finite numbers/);
  assert.throws(() => adapter.createPath({ point: [0, 0], name: "  " }), /non-empty string/);
  const full = [];
  for (let n = 0; n < 32; n++) full.push(makeMask("m" + n, "Mask " + (n + 1)));
  const capped = createMaskPathHost({ id: "mask:7", store: memoryStore(full) });
  assert.throws(() => capped.createPath({ point: [0, 0] }), /at most 32/);
});

test("mask deletePath removes, and unknown or locked ids throw", () => {
  const store = memoryStore([makeMask("m1", "Mask 1"), makeMask("m2", "Mask 2")]);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  assert.equal(adapter.deletePath("m1"), "m1");
  assert.deepEqual(adapter.listPathIds(), ["m2"]);
  assert.throws(() => adapter.deletePath("m1"), /Unknown layer mask id/);
  store.write(setLocked(store.peek(), "m2", true));
  assert.throws(() => adapter.deletePath("m2"), /locked/);
  assert.deepEqual(adapter.listPathIds(), ["m2"]);
});

test("mask writeSnapshot blocks locked-mask edits but allows unlock", () => {
  const store = memoryStore([makeMask("m1", "Mask 1"), makeMask("m2", "Mask 2")]);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  store.write(setLocked(store.peek(), "m1", true));
  const edited = clone(store.peek());
  edited[0].feather = 9;
  assert.throws(() => adapter.writeSnapshot(edited), /locked/);
  assert.equal(store.peek()[0].feather, 0);
  const removed = clone(store.peek()).filter(mask => mask.id !== "m1");
  assert.throws(() => adapter.writeSnapshot(removed), /locked/);
  const unlocked = setLocked(store.peek(), "m1", false);
  adapter.writeSnapshot(unlocked);
  assert.equal(adapter.isLocked("m1"), false);
  const renamed = clone(store.peek());
  renamed[1].properties.name = "Second";
  adapter.writeSnapshot(renamed);
  assert.equal(store.peek()[1].properties.name, "Second");
});

test("mask restoreSnapshot restores locked masks verbatim for undo", () => {
  const store = memoryStore([makeMask("m1", "Mask 1"), makeMask("m2", "Mask 2")]);
  const adapter = createMaskPathHost({ id: "mask:7", store });
  const before = adapter.readSnapshot();
  store.write(setLocked(store.peek(), "m1", true));
  adapter.deletePath("m2");
  assert.deepEqual(adapter.listPathIds(), ["m1"]);
  adapter.restoreSnapshot(before);
  assert.deepEqual(adapter.listPathIds(), ["m1", "m2"]);
  assert.equal(adapter.isLocked("m1"), false);
});

test("mask syncSelection mirrors into the session and validates", () => {
  const store = memoryStore([makeMask("m1", "Mask 1")]);
  const session = mirror();
  const adapter = createMaskPathHost({ id: "mask:7", store, mirror: session });
  const controller = createPathController({ project: "p", viewport: "v" });
  controller.activate(adapter, "m1");
  assert.equal(session.activeId, "m1");
  assert.ok(session.treeSelection.has("m1"));
  controller.setSelection(adapter, "m1", ["v1"]);
  assert.deepEqual([...session.selection], ["v1"]);
  assert.throws(() => adapter.syncSelection({ hostId: "mask:7", pathId: "nope", vertices: [] }), /Unknown path/);
  assert.throws(() => adapter.syncSelection({ hostId: "other", pathId: "m1", vertices: [] }), /mismatch/);
});

test("selection resolves against live objects after snapshot restore", () => {
  const maskStore = memoryStore([makeMask("m1", "Mask 1"), makeMask("m2", "Mask 2")]);
  const shapeStore = memoryStore(shapeRecords());
  const mask = createMaskPathHost({ id: "mask:7", store: maskStore });
  const shape = createShapePathHost({ id: "shape:9", store: shapeStore });
  const controller = createPathController({ project: "p", viewport: "v" });
  controller.activate(mask, "m1");
  controller.setSelection(mask, "m1", ["v1"]);
  controller.setSelection(shape, "s1", ["a"]);
  mask.restoreSnapshot([makeMask("m2", "Mask 2")]);
  controller.handlePathsChanged(mask);
  assert.equal(controller.activeHostId, null);
  assert.equal(controller.activePathId, null);
  assert.deepEqual(controller.getSelection(shape, "s1"), ["a"]);
  assert.deepEqual(mask.listPathIds(), ["m2"]);
});

test("mask adapter wraps a real mask-host.js host", () => {
  const { PZ } = require("./shape-plus-host.js");
  const { createModel } = require("../plugins/shape-plus/model.js");
  const { createMaskHost } = require("../plugins/shape-plus/mask-host.js");
  const { FIELD } = require("../plugins/shape-plus/mask-model.js");
  PZ.clip = PZ.clip || class {};
  const { Content } = createModel(PZ);
  const nativeLayer = {
    type: "scene",
    parent: null,
    getAddress: () => [7],
    tryGetParentOfType: () => null,
  };
  const project = { addressLookup: () => nativeLayer };
  const editor = { project, history: fakeHistory(), playback: { currentFrame: 0 } };
  const host = createMaskHost({ nativeLayer, Content, editor, project });
  let n = 0;
  const adapter = createMaskPathHost({
    id: "mask:7",
    store: {
      read: () => host.readHistory(nativeLayer) || [],
      write: data => host.writeHistory(nativeLayer, data),
      nextId: () => "mx" + (++n),
    },
  });
  assert.deepEqual(adapter.listPathIds(), []);
  const id = adapter.createPath({ point: [5, 6] });
  assert.equal(id, "mx1");
  assert.equal(nativeLayer[FIELD].length, 1);
  assert.equal(nativeLayer[FIELD][0].properties.name, "Mask 1");
  assert.deepEqual(adapter.readSnapshot(), nativeLayer[FIELD]);
  assert.equal(adapter.hasPath("mx1"), true);
});

test("shape adapter enumerates live records", () => {
  const store = memoryStore(shapeRecords(), "s");
  const adapter = createShapePathHost({ id: "shape:9", store });
  assert.equal(adapter.kind, "shape");
  assert.deepEqual(adapter.listPathIds(), ["s1", "s2"]);
  assert.equal(adapter.hasPath("s2"), true);
  assert.equal(adapter.hasPath("m1"), false);
  assert.deepEqual(adapter.listVertexIds("s1"), ["a", "b"]);
  assert.deepEqual(adapter.listVertexIds("missing"), []);
  assert.equal(adapter.isLocked("s1"), false);
});

test("shape lock predicate blocks edits but not restores", () => {
  const store = memoryStore(shapeRecords(), "s");
  const locked = new Set(["s1"]);
  const adapter = createShapePathHost({ id: "shape:9", store, isLocked: id => locked.has(id) });
  assert.equal(adapter.isLocked("s1"), true);
  assert.throws(() => adapter.deletePath("s1"), /locked/);
  assert.deepEqual(adapter.listPathIds(), ["s1", "s2"]);
  const changed = clone(store.peek());
  changed[0].vertexIds = ["a", "b", "z"];
  assert.throws(() => adapter.writeSnapshot(changed), /locked/);
  const before = adapter.readSnapshot();
  adapter.deletePath("s2");
  adapter.restoreSnapshot(before);
  assert.deepEqual(adapter.listPathIds(), ["s1", "s2"]);
  locked.clear();
  assert.equal(adapter.deletePath("s1"), "s1");
});

test("shape createPath validates topology and mints fresh ids", () => {
  const store = memoryStore(shapeRecords(), "s");
  let calls = 0;
  store.nextId = () => (++calls === 1 ? "s1" : "s3");
  const adapter = createShapePathHost({ id: "shape:9", store });
  assert.equal(adapter.createPath({ vertexIds: ["x"] }), "s3");
  assert.throws(() => adapter.createPath({ vertexIds: [] }), /vertex/);
  assert.throws(() => adapter.createPath({ vertexIds: ["x", "x"] }), /vertex|unique|duplicate/i);
});

test("activating a foreign path id throws on both adapters", () => {
  const mask = createMaskPathHost({ id: "mask:7", store: memoryStore([makeMask("m1", "Mask 1")]) });
  const shape = createShapePathHost({ id: "shape:9", store: memoryStore(shapeRecords()) });
  const controller = createPathController({ project: "p", viewport: "v" });
  assert.throws(() => controller.activate(shape, "m1"), /Unknown path/);
  assert.throws(() => controller.activate(mask, "s1"), /Unknown path/);
  controller.activate(mask, "m1");
  assert.equal(controller.activePathId, "m1");
});

test("requestCreation routes mask first, then shape, then a new layer", () => {
  const mask = createMaskPathHost({ id: "mask:7", store: memoryStore([]) });
  const shape = createShapePathHost({ id: "shape:9", store: memoryStore([]) });
  assert.equal(requestCreation({ mask, shape }).kind, "mask");
  assert.equal(requestCreation({ mask: null, shape }).kind, "shape");
  assert.equal(requestCreation({ mask: null, shape: null }).kind, "new-shape-layer");
  assert.equal(requestCreation({}).kind, "new-shape-layer");
  assert.throws(() => requestCreation({ mask: { id: "bogus" } }), /host adapter/);
});

test("applyCreation writes, records one history entry, and activates", () => {
  const store = memoryStore([makeMask("m1", "Mask 1")]);
  const mask = createMaskPathHost({ id: "mask:7", store });
  const controller = createPathController({ project: "p", viewport: "v" });
  const history = fakeHistory();
  const result = applyCreation(requestCreation({ mask, shape: null }), {
    point: [8, 9],
    history,
    controller,
  });
  assert.equal(result.kind, "mask");
  assert.equal(result.host, mask);
  assert.equal(result.pathId, "p1");
  assert.equal(history.entries.length, 1);
  assert.equal(history.operation, null);
  assert.equal(controller.activePathId, "p1");
  history.undo();
  assert.deepEqual(mask.listPathIds(), ["m1"]);
});

test("applyCreation builds a Shape+ layer and path in one history operation", () => {
  const calls = [];
  const shape = createShapePathHost({ id: "shape:new", store: memoryStore([]) });
  const history = {
    operation: null,
    entries: [],
    startOperation() { calls.push("start"); this.operation = []; },
    pushCommand(fn, p) { calls.push("push"); this.operation.push({ fn, p }); },
    finishOperation() { calls.push("finish"); this.entries.push(this.operation); this.operation = null; },
    discardOperation() { calls.push("discard"); this.operation = null; },
    undo() { const op = this.entries.pop(); if (op) for (const { fn, p } of op) fn(p); },
  };
  const controller = createPathController({ project: "p", viewport: "v" });
  let rolledBack = null;
  const result = applyCreation({ kind: "new-shape-layer", host: null }, {
    point: [1, 2],
    history,
    controller,
    createShapeLayer: () => {
      calls.push("layer");
      return { host: shape };
    },
    rollback: payload => { rolledBack = payload; },
  });
  assert.deepEqual(calls, ["start", "layer", "push", "finish"]);
  assert.equal(result.kind, "new-shape-layer");
  assert.equal(result.host, shape);
  assert.ok(result.pathId);
  assert.equal(controller.activePathId, result.pathId);
  history.undo();
  assert.equal(rolledBack.host, shape);
  assert.equal(rolledBack.pathId, result.pathId);
});

test("applyCreation refuses nested history, unknown kinds, and missing factories", () => {
  const mask = createMaskPathHost({ id: "mask:7", store: memoryStore([]) });
  const busy = fakeHistory();
  busy.startOperation();
  assert.throws(() => applyCreation(requestCreation({ mask }), { history: busy }), /free history/);
  busy.discardOperation();
  assert.throws(() => applyCreation({ kind: "explode", host: mask }, {}), /Unknown.*creation/i);
  assert.throws(() => applyCreation({ kind: "new-shape-layer", host: null }, { history: fakeHistory() }), /factory/);
  const before = mask.readSnapshot();
  assert.throws(() => applyCreation(requestCreation({ mask }), { point: [0, NaN] }), /finite/);
  assert.deepEqual(mask.readSnapshot(), before);
});
