"use strict";
// Path selection and activation rules for the shared path controller.
//
// Consumed contracts (provided by other wave packages or fakes in tests):
// - `candidateIds`: path IDs under the click, ordered front to back by
//   actual draw order. Produced by projected picking (P2.1); today the
//   editor-canvas outline order is the stand-in.
// - `selection`: the controller vertex/path selection sets (P1.1
//   `path-controller.js`); marquee helpers below read and return them.
// - `isLocked(id)`: host lock state per path (P1.2 metadata, P1.6 hosts).
//   Locked paths activate and select exactly like unlocked ones; only
//   mutation is gated through `canEditPath` and `deletionDecision`.
//
// Provided: overlap cycling (`createCycleState`, `chooseCandidate`,
// `resetCycle`), marquee helpers (`startMarquee`, `applyMarquee`,
// `pointsInRect`), and vertex-only deletion decisions
// (`deletionDecision`). The controller calls `resetCycle` on frame
// changes and on any selection it did not make through `chooseCandidate`.
// Pure logic: no DOM, no host calls, safe in Node and the browser.

// Hit radius in CSS pixels, shared with picking and snap thresholds.
const HIT_RADIUS_PX = 9;

// True while two points count as the same click location.
function samePoint(a, b, radius = HIT_RADIUS_PX) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= radius;
}

function candidatesKey(ids) {
  return ids.join("\0");
}

// Overlap-cycle state. `lastKey` fingerprints the candidate list so a
// changed overlap restarts; `index` advances while the pointer stays
// within the hit radius of the same overlap.
function createCycleState() {
  return { lastPoint: null, lastKey: null, index: 0 };
}

function resetCycle(state) {
  state.lastPoint = null;
  state.lastKey = null;
  state.index = 0;
  return state;
}

// Pick the path a click activates. The first click takes the frontmost
// candidate; repeated clicks at the same location cycle through every
// candidate in draw order, wrapping around, including the active path.
// Movement beyond the hit radius or a changed candidate set restarts at
// the frontmost. Returns the activated path ID, or null when empty.
function chooseCandidate(state, point, candidateIds) {
  const ids = Array.isArray(candidateIds) ? candidateIds.slice() : [];
  if (!ids.length) {
    resetCycle(state);
    return null;
  }
  const key = candidatesKey(ids);
  if (
    state.lastPoint &&
    samePoint(state.lastPoint, point) &&
    state.lastKey === key
  ) {
    state.index = (state.index + 1) % ids.length;
  } else {
    state.index = 0;
  }
  state.lastPoint = Array.isArray(point) ? point.slice(0, 2) : null;
  state.lastKey = key;
  return ids[state.index];
}

// Capture the vertex selection when a marquee gesture starts. Plain
// marquees replace it; Shift marquees toggle against this capture.
function startMarquee(captured) {
  return { captured: new Set(captured || []) };
}

// Resolve a marquee drag to the next vertex selection. `keysInRect` holds
// the keys inside the current drag rectangle. With Shift, keys inside the
// rectangle toggle against the gesture-start capture; without Shift the
// rectangle replaces the selection. Never mutates the capture.
function applyMarquee(marquee, keysInRect, shift) {
  const inside = new Set(keysInRect || []);
  if (!shift) return inside;
  const result = new Set(marquee.captured);
  for (const key of inside) {
    if (result.has(key)) result.delete(key);
    else result.add(key);
  }
  return result;
}

// Keys whose points fall inside the drag rectangle. Both corners work as
// the start, and edges count as inside.
function pointsInRect(vertices, rect) {
  const start = rect?.start || [0, 0], end = rect?.end || [0, 0];
  const lo = [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
    hi = [Math.max(start[0], end[0]), Math.max(start[1], end[1])];
  const keys = [];
  for (const vertex of vertices || []) {
    const point = vertex?.point;
    if (!Array.isArray(point)) continue;
    if (point[0] >= lo[0] && point[0] <= hi[0] && point[1] >= lo[1] && point[1] <= hi[1])
      keys.push(vertex.key);
  }
  return keys;
}

// Locked paths stay visible and selectable but refuse every mutation.
function canEditPath(path) {
  return !path?.locked;
}

// Decide what Delete/Backspace does. Selected vertices are removed only
// while path editing owns focus on an unlocked path; otherwise the key
// belongs to the focused native panel. A locked path reports the block
// with an English explanation instead of silently deferring.
function deletionDecision({ ownsFocus = false, vertexCount = 0, locked = false } = {}) {
  if (locked && ownsFocus && vertexCount > 0)
    return { action: "blocked-locked", message: "Unlock the mask to delete vertices." };
  if (ownsFocus && !locked && vertexCount > 0) return { action: "delete-vertices" };
  return { action: "defer-to-panel" };
}

module.exports = {
  HIT_RADIUS_PX,
  samePoint,
  createCycleState,
  chooseCandidate,
  resetCycle,
  startMarquee,
  applyMarquee,
  pointsInRect,
  canEditPath,
  deletionDecision,
};
