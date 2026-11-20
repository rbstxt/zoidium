"use strict";
// Multi-mask transactions: Shift-click mask-set selection, one active mask
// for Pen and timeline focus, atomic V-transforms across the selected
// unlocked masks, relative-order-preserving reorder, rollback on failure,
// and one history entry per operation.
//
// Consumed contracts (already merged, used directly or as seams):
// - `mask-metadata.js`: `reorder` (same-set validation) is required
//   directly. Reorder is not a locked action by design (the P1.2 lock list covers geometry, topology, keyframe, and delete), so a
//   locked mask may move with the selected block but its content still
//   round-trips unchanged through the host lock check.
// - `path-controller.js`: only the method seam is consumed (`activate`,
//   `deactivate`, `getSelection`, `handleProjectChanged`). The module never
//   requires it, so tests and the integration package inject the real
//   controller. Per-path vertex selections stay shared: V reads them from
//   the controller, and panel switches never touch this module, so
//   activation and selection survive panel changes.
// - `path-hosts.js`: only the adapter seam is consumed (`readSnapshot`,
//   `writeSnapshot`, `restoreSnapshot`, `isLocked`). `writeSnapshot` is the
//   lock-enforcing edit path, `restoreSnapshot` the verbatim undo path.
//
// Selection rules: a plain click selects exactly one mask and makes it
// active. Shift-click toggles membership; adding makes the added mask
// active, removing the active mask falls back to the most recently added
// remaining mask (null when empty). `setActive` adds a missing id, so the
// active mask is always selected. Stale ids (after undo/restore) are
// dropped with `pruneSelection`, never silently kept.
//
// Transform rules: `transformSelected` resolves target masks from the
// selection, skips locked masks (lock prevents mutation; they are reported
// in `skippedLocked` and never reach `apply`), and resolves vertices per
// mask from `verticesByMask` or the shared controller selection. `apply`
// receives a detached mask clone plus its vertex ids and either mutates
// the clone or returns a replacement; it throws to abort. The full next
// snapshot is built before any write, then committed with one
// `writeSnapshot` and one history entry. A build failure writes nothing;
// a write failure restores the pre-operation snapshot, discards the
// history operation, and rethrows. A no-op (no unlocked mask with
// vertices) writes nothing and records no history.
//
// History seam (same shape as P1.6 `applyCreation`): an optional object
// with `startOperation`, `pushCommand(fn, payload)`, `finishOperation`,
// and `discardOperation`. One successful operation pushes exactly one
// command (`restoreHostSnapshot` with `{ host, before }`), so undo is one
// entry. Absent history still commits atomically; only the undo entry is
// skipped.
const { reorder: reorderMasks } = require("./mask-metadata.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checkId(id) {
  if (typeof id !== "string" || !id) throw Error("Multi-mask selection needs a short string id");
  return id;
}

// The host adapter seam: snapshot reads/writes plus lock state.
function checkAdapter(host) {
  if (!host || typeof host.readSnapshot !== "function" ||
      typeof host.writeSnapshot !== "function" ||
      typeof host.restoreSnapshot !== "function" ||
      typeof host.isLocked !== "function")
    throw Error("Multi-mask transactions need a host with read, write, restore, and lock functions");
  return host;
}

function checkSelectionState(selection) {
  if (!selection || typeof selection.getSelected !== "function" ||
      typeof selection.click !== "function" || typeof selection.shiftClick !== "function" ||
      typeof selection.setActive !== "function" || typeof selection.clear !== "function" ||
      typeof selection.prune !== "function")
    throw Error("Multi-mask transactions need a selection created by createMultiMaskSelection");
  return selection;
}

// Accept either a selection state or a plain id array (deduped, in order).
function selectedIdsOf(selection) {
  if (Array.isArray(selection)) {
    const seen = new Set();
    for (const id of selection) {
      checkId(id);
      seen.add(id);
    }
    return [...seen];
  }
  checkSelectionState(selection);
  return selection.getSelected();
}

// Undo entry shared with the P1.6 history seam.
function restoreHostSnapshot(payload) {
  payload.host.restoreSnapshot(payload.before);
}

// One atomic commit: a single validating write plus exactly one history
// entry. On failure the pre-operation snapshot is restored (best effort),
// a started history operation is discarded, and the original error is
// rethrown so callers see the cause, not the rollback.
function commitOne({ host, before, next, history }) {
  if (history && typeof history.startOperation === "function") history.startOperation();
  try {
    const written = host.writeSnapshot(next);
    if (history && typeof history.pushCommand === "function") {
      history.pushCommand(restoreHostSnapshot, { host, before });
      if (typeof history.finishOperation === "function") history.finishOperation();
    }
    return written;
  } catch (error) {
    if (history && typeof history.discardOperation === "function") {
      try { history.discardOperation(); } catch (_discard) { /* original error wins */ }
    }
    try { host.restoreSnapshot(clone(before)); } catch (_restore) { /* original error wins */ }
    throw error;
  }
}

// Shift-click mask-set selection with one active mask. Insertion order is
// kept so active fallback is deterministic.
function createMultiMaskSelection() {
  const state = { order: [], active: null };

  function snapshot() {
    return { selected: state.order.slice(), active: state.active };
  }

  function click(id) {
    checkId(id);
    state.order = [id];
    state.active = id;
    return snapshot();
  }

  function shiftClick(id) {
    checkId(id);
    const at = state.order.indexOf(id);
    if (at < 0) {
      state.order.push(id);
      state.active = id;
    } else {
      state.order.splice(at, 1);
      if (state.active === id)
        state.active = state.order.length ? state.order[state.order.length - 1] : null;
    }
    return snapshot();
  }

  function setActive(id) {
    checkId(id);
    if (!state.order.includes(id)) state.order.push(id);
    state.active = id;
    return snapshot();
  }

  function clear() {
    state.order = [];
    state.active = null;
    return snapshot();
  }

  function prune(liveIds) {
    if (!Array.isArray(liveIds)) throw Error("Multi-mask prune needs an array of live ids");
    const live = new Set(liveIds);
    state.order = state.order.filter(id => live.has(id));
    if (state.active !== null && !live.has(state.active))
      state.active = state.order.length ? state.order[state.order.length - 1] : null;
    return snapshot();
  }

  return {
    click,
    shiftClick,
    setActive,
    clear,
    prune,
    snapshot,
    getSelected: () => state.order.slice(),
    getActive: () => state.active,
    has: id => state.order.includes(id),
    size: () => state.order.length,
  };
}

// Plain click selects one mask, Shift-click toggles membership; the result
// is mirrored into the shared controller so Pen and timeline focus follow
// the active mask. Unknown ids throw before the selection changes.
function activateMask({ controller = null, host = null, selection, id, additive = false }) {
  checkSelectionState(selection);
  checkId(id);
  if (host && typeof host.hasPath === "function" && !host.hasPath(id))
    throw Error("Unknown path " + id);
  const next = additive ? selection.shiftClick(id) : selection.click(id);
  if (controller && typeof controller.activate === "function") {
    if (next.active !== null) controller.activate(host, next.active);
    else if (typeof controller.deactivate === "function") controller.deactivate();
  }
  return next;
}

// Drop selected/active ids the host no longer lists (after undo, restore,
// or project load). Uses `listPathIds` when the host offers it, otherwise
// the snapshot order.
function pruneSelection(selection, host) {
  checkSelectionState(selection);
  checkAdapter(host);
  const live = typeof host.listPathIds === "function"
    ? host.listPathIds()
    : host.readSnapshot().map(mask => mask?.id);
  return selection.prune(live);
}

function resolveVertices({ controller, host, maskId, verticesByMask }) {
  if (verticesByMask && Object.hasOwn(verticesByMask, maskId)) {
    const ids = verticesByMask[maskId];
    if (!Array.isArray(ids)) throw Error("Multi-mask transform needs an array of vertex ids");
    return ids.map(checkId);
  }
  if (controller && typeof controller.getSelection === "function")
    return controller.getSelection(host, maskId);
  return [];
}

// V-transform: apply `apply(maskClone, vertexIds, { maskId, host })` to
// every selected unlocked mask with vertices, in one snapshot write and
// one history entry. Locked masks are skipped, never mutated. Returns the
// per-mask outcome; a no-op records nothing.
function transformSelected({
  host,
  selection,
  controller = null,
  verticesByMask = null,
  apply,
  history = null,
} = {}) {
  const adapter = checkAdapter(host);
  if (typeof apply !== "function") throw Error("Multi-mask transform needs an apply function");
  const ids = selectedIdsOf(selection);
  const before = adapter.readSnapshot();
  const live = new Set(before.map(mask => mask?.id));
  const result = { transformed: [], skippedLocked: [], skippedEmpty: [], skippedMissing: [] };
  const targets = [];
  for (const id of ids) {
    if (!live.has(id)) { result.skippedMissing.push(id); continue; }
    if (adapter.isLocked(id)) {
      result.skippedLocked.push(id);
      continue;
    }
    const vertices = resolveVertices({ controller, host: adapter, maskId: id, verticesByMask });
    if (!vertices.length) { result.skippedEmpty.push(id); continue; }
    targets.push({ id, vertices });
  }
  if (!targets.length) return result;
  // Build the whole next snapshot detached first: an `apply` failure
  // leaves the store and history untouched by construction.
  const next = clone(before);
  const byId = new Map(next.map(mask => [mask?.id, mask]));
  for (const { id, vertices } of targets) {
    const replacement = apply(byId.get(id), vertices.slice(), { maskId: id, host: adapter });
    if (replacement !== undefined) {
      const at = next.findIndex(mask => mask?.id === id);
      next[at] = replacement;
    }
  }
  commitOne({ host: adapter, before, next, history });
  for (const { id } of targets) result.transformed.push(id);
  return result;
}

// Reorder the whole collection while retaining relative order among the
// selected masks (they move as a block). `idsInOrder` must hold the same
// id set; anything that would reorder selected masks against each other
// throws before writing. One snapshot write, one history entry.
function reorderSelected({ host, selection, idsInOrder, history = null } = {}) {
  const adapter = checkAdapter(host);
  if (!Array.isArray(idsInOrder) || !idsInOrder.length)
    throw Error("Multi-mask reorder needs a new id order");
  for (const id of idsInOrder) checkId(id);
  const selected = selectedIdsOf(selection);
  if (!selected.length) throw Error("Multi-mask reorder needs a non-empty selection");
  const before = adapter.readSnapshot();
  const live = new Set(before.map(mask => mask?.id));
  for (const id of selected) {
    if (!live.has(id)) throw Error("Unknown layer mask id");
  }
  const wanted = new Set(selected);
  const beforeSub = before.map(mask => mask?.id).filter(id => wanted.has(id));
  const afterSub = idsInOrder.filter(id => wanted.has(id));
  if (afterSub.length !== selected.length ||
      !beforeSub.every((id, index) => id === afterSub[index]))
    throw Error("Multi-mask reorder must retain relative order among selected masks");
  // Same-set validation (no drops, no doubles, no strangers).
  const next = reorderMasks(before, idsInOrder);
  commitOne({ host: adapter, before, next, history });
  return { order: next.map(mask => mask.id) };
}

// Project close (or switch): the shared controller resets itself and the
// mask-set selection is cleared, so neither activation nor multi-selection
// leaks across projects. Panel changes never call this, so they keep both.
function handleProjectChanged({ selection, controller = null }, nextProject) {
  checkSelectionState(selection);
  let changed = true;
  if (controller && typeof controller.handleProjectChanged === "function")
    changed = controller.handleProjectChanged(nextProject);
  if (changed) selection.clear();
  return changed;
}

module.exports = {
  createMultiMaskSelection,
  activateMask,
  pruneSelection,
  transformSelected,
  reorderSelected,
  handleProjectChanged,
  selectedIdsOf,
};
