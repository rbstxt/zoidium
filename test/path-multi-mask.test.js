"use strict";
// P3.6 multi-mask transactions: Shift-click selection, one active mask,
// atomic V-transforms across unlocked masks, relative-order reorder,
// rollback, and one history entry. Uses the real P1.1 controller and the
// real P1.6 mask host adapter over an in-memory store, so activation,
// selection mirroring, lock enforcement, and snapshot validation are the
// production paths, not fakes.
const test = require("node:test");
const assert = require("node:assert/strict");
const multi = require("../plugins/shape-plus/path-multi-mask.js");
const { createPathController } = require("../plugins/shape-plus/path-controller.js");
const { createMaskPathHost } = require("../plugins/shape-plus/path-hosts.js");

const copy = (value) => JSON.parse(JSON.stringify(value));

function memoryStore() {
  const state = { data: [], ids: 0, writes: 0 };
  return {
    state,
    read: () => copy(state.data),
    write: (next) => { state.writes++; state.data = copy(next); },
    nextId: () => "m" + (++state.ids),
  };
}

function fakeHistory() {
  return {
    starts: 0, commands: [], finishes: 0, discards: 0, operation: null,
    startOperation() { this.starts++; this.operation = {}; },
    pushCommand(fn, payload) { this.commands.push({ fn, payload }); },
    finishOperation() { this.finishes++; this.operation = null; },
    discardOperation() { this.discards++; this.operation = null; },
  };
}

// Real controller + real mask host adapter; `mirror` observes selection sync.
function rig(project = {}) {
  const store = memoryStore();
  const mirror = { activeId: null, selection: new Set(), treeSelection: new Set() };
  const controller = createPathController({ project, viewport: "v" });
  const host = createMaskPathHost({ id: "masks", store, mirror, controller });
  return { store, mirror, controller, host };
}

function makeMasks(host, count) {
  const ids = [];
  for (let i = 0; i < count; i++)
    ids.push(host.createPath({ point: [10 * i, 20 * i], name: "Mask " + (i + 1) }));
  return ids;
}

function lockMask(store, id, locked = true) {
  const data = store.read();
  data.find(mask => mask.id === id).locked = locked;
  store.write(data);
}

function pointOf(store, id) {
  const mask = store.read().find(entry => entry.id === id);
  return mask.properties.path.keyframes[0].value.slice(0, 2);
}

// V-style translate applied to the grouped native encoding.
function translate(dx, dy, seen = null) {
  return (mask, vertexIds) => {
    if (seen) seen.push(mask.id);
    assert.ok(Array.isArray(mask.vertexIds));
    for (const key of mask.properties.path.keyframes) {
      key.value[0] += dx;
      key.value[1] += dy;
    }
  };
}

test("plain click selects one mask and Shift-click adds, moving the active mask", () => {
  const sel = multi.createMultiMaskSelection();
  assert.deepEqual(sel.click("a"), { selected: ["a"], active: "a" });
  assert.deepEqual(sel.shiftClick("b"), { selected: ["a", "b"], active: "b" });
  assert.deepEqual(sel.shiftClick("c"), { selected: ["a", "b", "c"], active: "c" });
  assert.equal(sel.size(), 3);
  assert.ok(sel.has("b"));
});

test("Shift-click removes, with active falling back to the most recently added", () => {
  const sel = multi.createMultiMaskSelection();
  sel.click("a");
  sel.shiftClick("b");
  sel.shiftClick("c");
  assert.deepEqual(sel.shiftClick("c"), { selected: ["a", "b"], active: "b" });
  assert.deepEqual(sel.shiftClick("a"), { selected: ["b"], active: "b" });
  assert.deepEqual(sel.shiftClick("b"), { selected: [], active: null });
  assert.equal(sel.getActive(), null);
});

test("setActive keeps one active mask inside the selection; ids are validated", () => {
  const sel = multi.createMultiMaskSelection();
  sel.click("a");
  assert.deepEqual(sel.setActive("b"), { selected: ["a", "b"], active: "b" });
  assert.deepEqual(sel.setActive("a"), { selected: ["a", "b"], active: "a" });
  assert.throws(() => sel.click(""), /short string id/);
  assert.throws(() => sel.shiftClick(null), /short string id/);
  assert.throws(() => sel.setActive(7), /short string id/);
  assert.throws(() => sel.prune("a"), /array of live ids/);
});

test("activateMask mirrors the shared controller; unknown ids throw first", () => {
  const { controller, host, mirror } = rig();
  const ids = makeMasks(host, 2);
  const sel = multi.createMultiMaskSelection();
  assert.deepEqual(
    multi.activateMask({ controller, host, selection: sel, id: ids[0] }),
    { selected: [ids[0]], active: ids[0] });
  assert.equal(controller.activePathId, ids[0]);
  assert.equal(mirror.activeId, ids[0]);
  assert.deepEqual(
    multi.activateMask({ controller, host, selection: sel, id: ids[1], additive: true }),
    { selected: [ids[0], ids[1]], active: ids[1] });
  assert.equal(controller.activePathId, ids[1]);
  // Plain click replaces the set but Pen/alert focus follows the active mask.
  multi.activateMask({ controller, host, selection: sel, id: ids[0] });
  assert.deepEqual(sel.getSelected(), [ids[0]]);
  assert.equal(controller.activePathId, ids[0]);
  // Unknown ids never enter the selection.
  assert.throws(() => multi.activateMask({ controller, host, selection: sel, id: "nope" }), /Unknown path/);
  assert.deepEqual(sel.getSelected(), [ids[0]]);
  // Deselecting the last mask deactivates the controller.
  multi.activateMask({ controller, host, selection: sel, id: ids[0], additive: true });
  assert.deepEqual(sel.snapshot(), { selected: [], active: null });
  assert.equal(controller.activePathId, null);
});

test("V transform writes selected vertices across unlocked masks in one history entry", () => {
  const { store, controller, host } = rig();
  const ids = makeMasks(host, 3);
  const history = fakeHistory();
  const sel = multi.createMultiMaskSelection();
  sel.click(ids[0]);
  sel.shiftClick(ids[1]);
  sel.shiftClick(ids[2]);
  controller.setSelection(host, ids[0], ["v1"]);
  controller.setSelection(host, ids[1], ["v1"]);
  controller.setSelection(host, ids[2], ["v1"]);
  const before = store.read();
  const result = multi.transformSelected({ host, selection: sel, controller, apply: translate(5, -2), history });
  assert.deepEqual(result, { transformed: ids, skippedLocked: [], skippedEmpty: [], skippedMissing: [] });
  assert.deepEqual(pointOf(store, ids[0]), [5, -2]);
  assert.deepEqual(pointOf(store, ids[1]), [15, 18]);
  assert.deepEqual(pointOf(store, ids[2]), [25, 38]);
  // Combine order is untouched and one history entry records the undo.
  assert.deepEqual(store.read().map(mask => mask.id), ids);
  assert.equal(history.starts, 1);
  assert.equal(history.commands.length, 1);
  assert.equal(history.finishes, 1);
  assert.equal(history.discards, 0);
  // The single entry restores every mask.
  history.commands[0].fn(history.commands[0].payload);
  assert.deepEqual(store.read(), before);
});

test("locked masks are skipped, never reach apply, and stay byte-identical", () => {
  const { store, host } = rig();
  const ids = makeMasks(host, 3);
  lockMask(store, ids[1]);
  const seen = [];
  const history = fakeHistory();
  const before = store.read();
  const result = multi.transformSelected({
    host, selection: [ids[0], ids[1], ids[2]],
    verticesByMask: { [ids[0]]: ["v1"], [ids[1]]: ["v1"], [ids[2]]: ["v1"] },
    apply: translate(1, 1, seen), history,
  });
  assert.deepEqual(result.transformed, [ids[0], ids[2]]);
  assert.deepEqual(result.skippedLocked, [ids[1]]);
  assert.deepEqual(result.skippedEmpty, []);
  assert.deepEqual(result.skippedMissing, []);
  assert.deepEqual(seen, [ids[0], ids[2]]);
  assert.deepEqual(store.read().find(mask => mask.id === ids[1]), before.find(mask => mask.id === ids[1]));
  assert.deepEqual(pointOf(store, ids[0]), [1, 1]);
  assert.deepEqual(pointOf(store, ids[2]), [21, 41]);
  assert.equal(history.commands.length, 1);
});

test("no-op transforms write nothing and record no history", () => {
  const { store, controller, host } = rig();
  const ids = makeMasks(host, 2);
  const history = fakeHistory();
  const before = store.read();
  const writes = store.state.writes;
  const result = multi.transformSelected({ host, selection: [ids[0]], controller, apply: translate(9, 9), history });
  assert.deepEqual(result.transformed, []);
  assert.deepEqual(result.skippedEmpty, [ids[0]]);
  assert.deepEqual(store.read(), before);
  assert.equal(store.state.writes, writes);
  assert.equal(history.starts, 0);
  assert.equal(history.commands.length, 0);
});

test("apply failure writes nothing and records no history entry", () => {
  const { store, host } = rig();
  const ids = makeMasks(host, 2);
  const history = fakeHistory();
  const before = store.read();
  const writes = store.state.writes;
  assert.throws(() => multi.transformSelected({
    host, selection: [ids[0], ids[1]],
    verticesByMask: { [ids[0]]: ["v1"], [ids[1]]: ["v1"] },
    apply: (mask) => {
      if (mask.id === ids[1]) throw Error("native inverse failed");
      mask.properties.path.keyframes[0].value[0] += 100;
    },
    history,
  }), /native inverse failed/);
  assert.deepEqual(store.read(), before);
  assert.equal(store.state.writes, writes);
  assert.equal(history.starts, 0);
  assert.equal(history.commands.length, 0);
});

test("write failure rolls back through restoreSnapshot and discards history", () => {
  const { store, host } = rig();
  const ids = makeMasks(host, 2);
  const history = fakeHistory();
  const before = store.read();
  let writes = 0, restores = 0;
  const flaky = {
    ...host,
    writeSnapshot(next) { if (++writes === 1) throw Error("coverage write failed"); return host.writeSnapshot(next); },
    restoreSnapshot(snap) { restores++; return host.restoreSnapshot(snap); },
  };
  assert.throws(() => multi.transformSelected({
    host: flaky, selection: [ids[0], ids[1]],
    verticesByMask: { [ids[0]]: ["v1"], [ids[1]]: ["v1"] },
    apply: translate(3, 3), history,
  }), /coverage write failed/);
  assert.equal(restores, 1);
  assert.equal(history.discards, 1);
  assert.equal(history.finishes, 0);
  assert.equal(history.commands.length, 0);
  assert.deepEqual(store.read(), before);
});

test("reorder keeps relative order among selected masks in one history entry", () => {
  const { store, host } = rig();
  const ids = makeMasks(host, 4);
  const history = fakeHistory();
  const before = store.read();
  const sel = multi.createMultiMaskSelection();
  sel.click(ids[0]);
  sel.shiftClick(ids[2]);
  const result = multi.reorderSelected({ host, selection: sel, idsInOrder: [ids[1], ids[0], ids[3], ids[2]], history });
  assert.deepEqual(result, { order: [ids[1], ids[0], ids[3], ids[2]] });
  assert.deepEqual(store.read().map(mask => mask.id), [ids[1], ids[0], ids[3], ids[2]]);
  assert.equal(history.commands.length, 1);
  history.commands[0].fn(history.commands[0].payload);
  assert.deepEqual(store.read(), before);
});

test("reorder rejects selected-order changes and id-set mismatches without writing", () => {
  const { store, host } = rig();
  const ids = makeMasks(host, 3);
  const history = fakeHistory();
  const before = store.read();
  const writes = store.state.writes;
  const sel = multi.createMultiMaskSelection();
  sel.click(ids[0]);
  sel.shiftClick(ids[2]);
  // Selected pair (ids[0], ids[2]) would flip against each other.
  assert.throws(() => multi.reorderSelected({
    host, selection: sel, idsInOrder: [ids[2], ids[1], ids[0]], history,
  }), /relative order/);
  // Dropped mask: same relative order but a different id set.
  assert.throws(() => multi.reorderSelected({
    host, selection: [ids[0]], idsInOrder: [ids[1], ids[0]], history,
  }), /same id set/);
  // Unknown selected id.
  assert.throws(() => multi.reorderSelected({
    host, selection: [ids[0], "ghost"], idsInOrder: ids, history,
  }), /Unknown layer mask id/);
  assert.deepEqual(store.read(), before);
  assert.equal(store.state.writes, writes);
  assert.equal(history.commands.length, 0);
});

test("project change clears multi-selection and deactivates; same project keeps both", () => {
  const project = {};
  const { controller, host } = rig(project);
  const ids = makeMasks(host, 2);
  const sel = multi.createMultiMaskSelection();
  multi.activateMask({ controller, host, selection: sel, id: ids[0] });
  multi.activateMask({ controller, host, selection: sel, id: ids[1], additive: true });
  assert.equal(multi.handleProjectChanged({ selection: sel, controller }, project), false);
  assert.deepEqual(sel.snapshot(), { selected: [ids[0], ids[1]], active: ids[1] });
  assert.equal(controller.activePathId, ids[1]);
  assert.equal(multi.handleProjectChanged({ selection: sel, controller }, {}), true);
  assert.deepEqual(sel.snapshot(), { selected: [], active: null });
  assert.equal(controller.activePathId, null);
  assert.equal(controller.tool, "select");
});

test("pruneSelection drops stale ids after undo and fixes the active mask", () => {
  const { host } = rig();
  const ids = makeMasks(host, 2);
  const sel = multi.createMultiMaskSelection();
  sel.click(ids[0]);
  sel.shiftClick(ids[1]);
  // Simulate an undo that removed the second mask: raw store write.
  const remaining = host.readSnapshot().filter(mask => mask.id === ids[0]);
  host.restoreSnapshot(remaining);
  assert.deepEqual(multi.pruneSelection(sel, host), { selected: [ids[0]], active: ids[0] });
  assert.deepEqual(multi.selectedIdsOf(sel), [ids[0]]);
  assert.deepEqual(multi.selectedIdsOf([ids[0], ids[0], ids[1]]), [ids[0], ids[1]]);
  assert.throws(() => multi.selectedIdsOf({}), /need a selection/);
});
