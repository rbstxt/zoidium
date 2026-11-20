"use strict";
// Interaction gestures over selected path points (design "Geometry and
// feedback"). Transform gestures over selected points, direct segment drag,
// context-menu requests such as Set First Vertex, and Space-drag pan /
// wheel-zoom handoff to the viewport. No DOM, no host calls; runs in Node
// and the browser. The caller (P2.7 wiring) supplies the store, viewport,
// and selection callbacks documented below; tests use small fakes.
//
// Consumed contracts (all already merged on `feat/mask-overhaul`):
// - P1.1 `path-controller.js`: owns tool, active path, drawing, and the
//   opaque gesture record. Transform/pan gestures register through
//   `beginGesture`/`endGesture`; Space-pan restores the prior tool with
//   `setTool`; Escape cancellation ends with `endGesture(true)`.
// - P1.5 `path-input.js`: the optional `input` instance supplies
//   `isTemporarySelect` (Ctrl/Cmd point selection while held in Pen),
//   `isAltHeld` (handle-break intent tagged on the gesture for P2.7), and
//   `notifyFrameChanged` (overlap-cycle reset when playback moves).
//   `isEditableTarget` guards the Space/Escape keys bound by `bind`.
// - P2.1 `path-projection.js`: `pickPaths` finds the anchor/handle/segment
//   under the pointer for gesture routing and context-menu requests;
//   `projectVertices` feeds marquee hit-testing; `screenToLocal` failures
//   surface through `freeTransform` below and never move data.
// - P2.2 `path-transform.js`: `freeTransform` runs every transform move in
//   screen space (constrain before snap) and maps back through each path's
//   inverse. Locked paths land in `skippedLocked`; singular mappings land
//   in `failures` with English messages; neither moves data.
// - P2.3 `path-feedback.js`: `resolvePenCursor` / `resolveSelectCursor` /
//   `navigationCursor` supply the cursor for hover, marquee, and pan states.
//
// Store contract (supplied by P2.7; faked in tests):
// - `paths()` returns `[{ id, vertices: [{ point, in, out, id? }], closed,
//   matrix|null, locked }]` where `matrix` is the combined host transform.
// - `selection()` returns `{ pathId: [vertexIndex, ...] }` in path-local
//   indices. `onSelect` payloads below are applied synchronously by the
//   host, so the gesture re-reads `selection()` right after calling it.
// - `projection()` returns the shared viewport affine or null (identity).
// - `guides()` returns `[{ axis: "x"|"y", value }]` (optional).
// - `snapshot()` reads an opaque undo snapshot; `restore(token)` puts it
//   back; `preview(editedPaths)` shows working edits with no history;
//   `commit(label)` collapses the preview into one history entry.
// Viewport contract: `panBy(dx, dy)` and `zoomAt(point, factor)` in CSS px.
//
// Provided: `createPathGestures({ controller, input, store, viewport,
// onMessage, onSelect, onContextMenu })` with direct methods (`press`,
// `move`, `release`, `cancel`, `handleEscape`, `handleBlur`,
// `notifyFrameChanged`, `setSpaceHeld`, `wheel`, `requestContextMenu`,
// `cursorFor`) plus `bind(element, ownerWindow)` which wires pointer,
// wheel, context-menu, blur, and Space/Escape keys with pointer capture.
// Interruptions (`pointercancel`, lost capture, blur) keep the preview and
// commit it; only an explicit cancel (Escape, frame change) restores the
// snapshot. A release with no movement commits nothing.
const { pickPaths, projectVertices } = require("./path-projection.js");
const { freeTransform } = require("./path-transform.js");
const {
  resolvePenCursor,
  resolveSelectCursor,
  navigationCursor,
} = require("./path-feedback.js");
const { isEditableTarget } = require("./path-input.js");
const {
  startMarquee,
  applyMarquee,
  pointsInRect,
} = require("./path-selection.js");

const MARQUEE_KEY_SEP = "\0";

function isFinitePoint(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

function copyPoint(point) {
  return [point[0], point[1]];
}

// Endpoints of one segment drag: a closed path wraps its last segment.
function segmentEndpoints(path, segmentIndex) {
  const count = path.vertices.length;
  if (count < 2) return null;
  if (path.closed) return [segmentIndex % count, (segmentIndex + 1) % count];
  if (segmentIndex < 0 || segmentIndex >= count - 1) return null;
  return [segmentIndex, segmentIndex + 1];
}

function createPathGestures(options = {}) {
  const { controller, input = null, store, viewport = null } = options;
  if (!controller || typeof controller.beginGesture !== "function") {
    throw Error("Path gestures need a path controller");
  }
  if (!store || typeof store.paths !== "function") {
    throw Error("Path gestures need a store");
  }
  const onMessage = typeof options.onMessage === "function" ? options.onMessage : null;
  const onSelect = typeof options.onSelect === "function" ? options.onSelect : null;
  const onContextMenu = typeof options.onContextMenu === "function" ? options.onContextMenu : null;

  const state = {
    active: null,
    spaceHeld: false,
  };

  function tell(message) {
    if (onMessage && typeof message === "string" && message) onMessage(message);
  }

  function snapshotPaths() {
    return typeof store.snapshot === "function" ? store.snapshot() : null;
  }

  function currentPaths() {
    const paths = store.paths();
    if (!Array.isArray(paths)) throw Error("Path gesture store must list a paths array");
    return paths;
  }

  function pathById(paths, id) {
    return paths.find((path) => path && path.id === id) || null;
  }

  function pickAt(point) {
    const paths = currentPaths();
    const projection = typeof store.projection === "function" ? store.projection() : null;
    return pickPaths(
      paths.map((path) => ({
        id: path.id,
        vertices: path.vertices || [],
        closed: !!path.closed,
        matrix: path.matrix === undefined ? null : path.matrix,
      })),
      point,
      { projection },
    );
  }

  function guides() {
    if (typeof store.guides !== "function") return [];
    const list = store.guides();
    return Array.isArray(list) ? list : [];
  }

  function reportFailure(result) {
    if (!result || result.ok) return;
    if (Array.isArray(result.failures) && result.failures.length) {
      tell(result.failures[0].message);
      return;
    }
    tell(result.message || "The points cannot be transformed here, so nothing changed.");
  }

  function applyTransformMove(gesture, start, current, shiftKey) {
    const still = Math.hypot(current[0] - start[0], current[1] - start[1]) < 1e-9;
    if (still) return { applied: false, snapped: false, result: null };
    const paths = currentPaths();
    const selection = typeof store.selection === "function" ? store.selection() : {};
    const result = freeTransform({
      paths: paths.map((path) => ({
        id: path.id,
        matrix: path.matrix === undefined ? null : path.matrix,
        locked: !!path.locked,
        vertices: path.vertices || [],
      })),
      selection,
      projection: typeof store.projection === "function" ? store.projection() : null,
      gesture: {
        mode: "move",
        delta: [current[0] - start[0], current[1] - start[1]],
        origin: copyPoint(start),
        modifiers: { shift: !!shiftKey },
        snap: { guides: guides(), origin: copyPoint(start) },
      },
    });
    if (!result.ok) {
      reportFailure(result);
      return { applied: false, snapped: false, result };
    }
    if (result.failures.length) tell(result.failures[0].message);
    if (typeof store.preview === "function") store.preview(result.paths);
    return { applied: true, snapped: !!(result.snap && result.snap.snapped), result };
  }

  function finishGesture(commit, event) {
    const active = state.active;
    if (!active) return { action: "ignore", releaseCapture: false };
    state.active = null;
    const pointerId = active.pointerId;
    if (active.kind === "pan") {
      try {
        if (active.priorTool !== undefined) controller.setTool(active.priorTool);
      } catch (_error) {
        // Restoring the tool must not break pointer release.
      }
      controller.endGesture(false);
      return { action: "end-pan", releaseCapture: true, pointerId };
    }
    if (active.kind === "marquee") {
      controller.endGesture(false);
      if (commit) emitMarqueeSelection(active);
      return { action: commit ? "select-marquee" : "end-marquee", releaseCapture: true, pointerId };
    }
    // Transform and segment gestures.
    if (!commit) {
      if (active.snapshot !== null && typeof store.restore === "function") {
        store.restore(active.snapshot);
      }
      controller.endGesture(true);
      return { action: "cancel", releaseCapture: true, pointerId };
    }
    if (active.dirty && typeof store.commit === "function") {
      store.commit(active.kind === "segment" ? "drag-segment" : "transform-points");
    }
    controller.endGesture(false);
    return { action: active.dirty ? "commit" : "end", committed: !!active.dirty, releaseCapture: true, pointerId };
  }

  function marqueeKey(pathId, index) {
    return pathId + MARQUEE_KEY_SEP + index;
  }

  function emitMarqueeSelection(active) {
    if (!onSelect) return;
    const paths = currentPaths();
    const projection = typeof store.projection === "function" ? store.projection() : null;
    const entries = [];
    for (const path of paths) {
      let screen;
      try {
        screen = projectVertices(path.vertices || [], path.matrix === undefined ? null : path.matrix, projection);
      } catch (_error) {
        continue;
      }
      screen.forEach((vertex, index) => {
        entries.push({ key: marqueeKey(path.id, index), point: vertex.point });
      });
    }
    const inside = new Set(pointsInRect(entries, { start: active.start, end: active.current }));
    const captured = startMarquee(active.capturedKeys);
    const next = applyMarquee(captured, [...inside], active.shiftKey);
    const selection = {};
    for (const key of next) {
      const sep = key.indexOf(MARQUEE_KEY_SEP);
      if (sep < 0) continue;
      const pathId = key.slice(0, sep);
      const index = Number(key.slice(sep + 1));
      if (!Number.isInteger(index)) continue;
      if (!selection[pathId]) selection[pathId] = [];
      selection[pathId].push(index);
    }
    onSelect({ type: "marquee", selection, replace: !active.shiftKey });
  }

  function currentSelectionKeys() {
    const selection = typeof store.selection === "function" ? store.selection() : {};
    const keys = [];
    for (const [pathId, indices] of Object.entries(selection || {})) {
      for (const index of indices || []) keys.push(marqueeKey(pathId, index));
    }
    return keys;
  }

  // Primary pointer press in CSS pixels. Returns a descriptor; `capture`
  // tells `bind` (or the P2.7 caller) whether to hold pointer capture.
  function press(point, event = {}) {
    if (!isFinitePoint(point)) throw Error("Path gestures need a finite pointer point");
    if (event.isPrimary === false) return { action: "ignore", reason: "secondary-pointer", capture: false };
    if (state.active) return { action: "ignore", reason: "gesture-active", capture: false };
    const pointerId = event.pointerId === undefined ? 1 : event.pointerId;
    const button = event.button === undefined ? 0 : event.button;
    if (button !== 0 && button !== 1) return { action: "ignore", reason: "button", capture: false };
    const screen = copyPoint(point);
    const space = event.spaceHeld !== undefined ? !!event.spaceHeld : state.spaceHeld;

    if (space) {
      if (!viewport || typeof viewport.panBy !== "function") {
        return { action: "ignore", reason: "no-viewport", capture: false };
      }
      const priorTool = controller.tool;
      controller.beginGesture({ kind: "pan", pointerId, start: screen, priorTool });
      state.active = { kind: "pan", pointerId, start: screen, last: screen, priorTool };
      return { action: "pan", capture: true, pointerId, cursor: navigationCursor({ panning: true }) };
    }

    if (controller.tool === "pen" && !(input && typeof input.isTemporarySelect === "function" && input.isTemporarySelect())) {
      return { action: "ignore", reason: "pen-tool", capture: false };
    }

    const { target, candidates } = pickAt(screen);
    void candidates;
    if (!target) {
      if (controller.tool !== "select") return { action: "ignore", reason: "empty-press", capture: false };
      controller.beginGesture({ kind: "marquee", pointerId, start: screen });
      state.active = {
        kind: "marquee",
        pointerId,
        start: screen,
        current: copyPoint(screen),
        shiftKey: !!event.shiftKey,
        capturedKeys: currentSelectionKeys(),
      };
      return { action: "marquee", capture: true, pointerId };
    }

    const paths = currentPaths();
    const path = pathById(paths, target.pathId);
    if (!path) return { action: "ignore", reason: "unknown-path", capture: false };
    const shiftKey = !!event.shiftKey;

    if (target.kind === "anchor" || target.kind === "handle") {
      const selection = typeof store.selection === "function" ? store.selection() : {};
      const selected = new Set(selection[target.pathId] || []);
      if (path.locked) {
        if (onSelect) {
          onSelect(
            shiftKey
              ? { type: "click", pathId: target.pathId, vertexIndex: target.vertexIndex, toggle: true }
              : { type: "activate", pathId: target.pathId },
          );
        }
        return { action: "activate", pathId: target.pathId, capture: false, locked: true };
      }
      if (shiftKey) {
        if (onSelect) {
          onSelect({ type: "click", pathId: target.pathId, vertexIndex: target.vertexIndex, toggle: true });
        }
        return { action: "toggle-only", pathId: target.pathId, vertexIndex: target.vertexIndex, capture: false };
      }
      let activated = false;
      if (!selected.has(target.vertexIndex) && onSelect) {
        onSelect({ type: "click", pathId: target.pathId, vertexIndex: target.vertexIndex, toggle: false });
        activated = true;
      }
      const snapshot = snapshotPaths();
      const altBreak = !!(input && typeof input.isAltHeld === "function" && input.isAltHeld());
      controller.beginGesture({
        kind: "move",
        pointerId,
        pathId: target.pathId,
        vertexIndex: target.vertexIndex,
        start: screen,
        altBreak,
      });
      state.active = { kind: "move", pointerId, start: screen, snapshot, dirty: false, activated };
      return { action: "move", capture: true, pointerId, activated };
    }

    // Direct segment drag moves the segment's two endpoints together.
    if (target.kind === "segment") {
      if (path.locked) {
        if (onSelect) onSelect({ type: "activate", pathId: target.pathId });
        return { action: "activate", pathId: target.pathId, capture: false, locked: true };
      }
      const endpoints = segmentEndpoints({ vertices: path.vertices || [], closed: !!path.closed }, target.segmentIndex);
      if (!endpoints) return { action: "ignore", reason: "degenerate-segment", capture: false };
      if (onSelect) {
        onSelect({ type: "segment", pathId: target.pathId, vertexIndices: endpoints, segmentIndex: target.segmentIndex });
      }
      const snapshot = snapshotPaths();
      controller.beginGesture({
        kind: "segment",
        pointerId,
        pathId: target.pathId,
        segmentIndex: target.segmentIndex,
        vertexIndices: endpoints,
        start: screen,
      });
      state.active = { kind: "segment", pointerId, start: screen, snapshot, dirty: false };
      return { action: "segment", capture: true, pointerId, vertexIndices: endpoints };
    }

    return { action: "ignore", reason: "unknown-target", capture: false };
  }

  function move(point, event = {}) {
    const active = state.active;
    if (!active) return { action: "ignore", reason: "no-gesture" };
    if (event.pointerId !== undefined && event.pointerId !== active.pointerId) {
      return { action: "ignore", reason: "secondary-pointer" };
    }
    if (!isFinitePoint(point)) throw Error("Path gestures need a finite pointer point");
    const screen = copyPoint(point);
    if (active.kind === "pan") {
      const delta = [screen[0] - active.last[0], screen[1] - active.last[1]];
      active.last = screen;
      if (viewport && typeof viewport.panBy === "function") viewport.panBy(delta[0], delta[1]);
      return { action: "pan", panned: true };
    }
    if (active.kind === "marquee") {
      active.current = screen;
      return { action: "marquee", rect: { start: copyPoint(active.start), end: copyPoint(screen) } };
    }
    const outcome = applyTransformMove(active, active.start, screen, event.shiftKey);
    if (outcome.applied) active.dirty = true;
    return {
      action: active.kind === "segment" ? "segment" : "move",
      applied: outcome.applied,
      snapped: outcome.snapped,
    };
  }

  function release(point, event = {}) {
    const active = state.active;
    if (!active) return { action: "ignore", reason: "no-gesture", releaseCapture: false };
    if (event.pointerId !== undefined && event.pointerId !== active.pointerId) {
      return { action: "ignore", reason: "secondary-pointer", releaseCapture: false };
    }
    if (active.kind === "marquee" && isFinitePoint(point)) active.current = copyPoint(point);
    if ((active.kind === "move" || active.kind === "segment") && isFinitePoint(point)) {
      const outcome = applyTransformMove(active, active.start, copyPoint(point), event.shiftKey);
      if (outcome.applied) active.dirty = true;
    }
    return finishGesture(true);
  }

  // Explicit cancellation (Escape): restore the gesture-start snapshot so
  // the drag leaves no data behind, then end the controller gesture.
  function cancel() {
    return finishGesture(false);
  }

  function handleEscape() {
    if (!state.active) return false;
    finishGesture(false);
    return true;
  }

  function handleBlur() {
    if (!state.active) {
      if (state.spaceHeld) state.spaceHeld = false;
      return { action: "ignore", reason: "no-gesture", releaseCapture: false };
    }
    state.spaceHeld = false;
    return finishGesture(true);
  }

  // Playback moved mid-gesture: the in-progress edit belongs to another
  // frame, so restore the snapshot and end instead of committing it.
  function notifyFrameChanged() {
    try {
      if (input && typeof input.notifyFrameChanged === "function") input.notifyFrameChanged();
    } catch (_error) {
      // Cycle state must not break gesture teardown.
    }
    if (!state.active) return { action: "ignore", reason: "no-gesture", releaseCapture: false };
    const active = state.active;
    state.active = null;
    if (active.snapshot !== null && active.snapshot !== undefined && typeof store.restore === "function") {
      store.restore(active.snapshot);
    }
    controller.endGesture(true);
    tell("The frame changed, so the in-progress edit was cancelled.");
    return { action: "cancel-frame", releaseCapture: true, pointerId: active.pointerId };
  }

  function wheel(point, deltaY, event = {}) {
    if (!isFinitePoint(point)) throw Error("Path gestures need a finite pointer point");
    if (!viewport || typeof viewport.zoomAt !== "function") {
      return { action: "ignore", reason: "no-viewport" };
    }
    let delta = Number(deltaY);
    if (!Number.isFinite(delta)) throw Error("Path gesture zoom needs a finite wheel delta");
    if (event.deltaMode === 1) delta *= 16;
    const factor = Math.min(4, Math.max(0.25, Math.exp(-delta * 0.0012)));
    viewport.zoomAt(copyPoint(point), factor);
    return { action: "zoom", factor };
  }

  // Context-menu request for one screen point. Anchor and handle hits ask
  // for Set First Vertex on that vertex; segments and empty canvas ask for
  // nothing. The caller shows the menu; P2.7 executes the topology change.
  function requestContextMenu(point) {
    if (!isFinitePoint(point)) throw Error("Path gestures need a finite pointer point");
    const { target } = pickAt(copyPoint(point));
    if (!target || (target.kind !== "anchor" && target.kind !== "handle")) return null;
    const paths = currentPaths();
    const path = pathById(paths, target.pathId);
    const vertex = path && Array.isArray(path.vertices) ? path.vertices[target.vertexIndex] : null;
    const request = {
      action: "set-first-vertex",
      pathId: target.pathId,
      vertexIndex: target.vertexIndex,
      vertexId: vertex && vertex.id !== undefined ? vertex.id : null,
      locked: !!(path && path.locked),
    };
    if (onContextMenu) onContextMenu(request);
    return request;
  }

  function setSpaceHeld(held) {
    state.spaceHeld = !!held;
    return state.spaceHeld;
  }

  // Cursor for one hover target: navigation while Space is held or panning,
  // Pen priority while drawing, Selection states otherwise.
  function cursorFor(hover = {}) {
    if (state.spaceHeld || (state.active && state.active.kind === "pan")) {
      return navigationCursor({ panning: !!(state.active && state.active.kind === "pan") });
    }
    if (controller.tool === "pen") {
      return resolvePenCursor({ target: hover.target || null, drawing: controller.drawing || null });
    }
    return resolveSelectCursor({
      target: hover.target || null,
      marquee: !!(state.active && state.active.kind === "marquee"),
    });
  }

  function toScreen(event, element) {
    let left = 0,
      top = 0;
    try {
      const rect = element.getBoundingClientRect();
      if (rect) {
        left = rect.left || 0;
        top = rect.top || 0;
      }
    } catch (_error) {
      // A fake without layout still yields client coordinates.
    }
    return [event.clientX - left, event.clientY - top];
  }

  // Wire DOM-style events with pointer capture, mirroring the Shape+
  // editor pointer fake used in `test/shape-plus-editor-pointer.test.js`.
  // Mount the gesture binding before path-input keyboard handling so an
  // active gesture consumes Escape first. Returns an unbind function.
  function bind(element, ownerWindow) {
    if (!element || typeof element.addEventListener !== "function") {
      throw Error("Path gestures need an element to bind");
    }
    const owner = ownerWindow || (element.ownerDocument && element.ownerDocument.defaultView) || null;

    function capture(pointerId) {
      try {
        element.setPointerCapture(pointerId);
      } catch (_error) {
        // Without capture the gesture still receives events over the canvas.
      }
    }

    function releaseCapture(pointerId, result) {
      if (!result || !result.releaseCapture) return;
      const id = result.pointerId !== undefined ? result.pointerId : pointerId;
      try {
        if (element.hasPointerCapture && element.hasPointerCapture(id)) element.releasePointerCapture(id);
      } catch (_error) {
        // Capture state must not break gesture teardown.
      }
    }

    function onPointerDown(event) {
      if (event.isPrimary === false) return;
      if (event.button !== undefined && event.button !== 0 && event.button !== 1) return;
      const outcome = press(toScreen(event, element), {
        pointerId: event.pointerId,
        button: event.button,
        shiftKey: !!event.shiftKey,
      });
      if (outcome.capture) capture(outcome.pointerId);
    }

    function onPointerMove(event) {
      move(toScreen(event, element), {
        pointerId: event.pointerId,
        shiftKey: !!event.shiftKey,
      });
    }

    function onPointerUp(event) {
      const result = release(toScreen(event, element), {
        pointerId: event.pointerId,
        shiftKey: !!event.shiftKey,
      });
      releaseCapture(event.pointerId, result);
    }

    function onInterrupt(event) {
      if (event && event.pointerId !== undefined && state.active && event.pointerId !== state.active.pointerId) return;
      const result = finishGesture(true);
      releaseCapture(event && event.pointerId, result);
    }

    function onBlur() {
      const result = handleBlur();
      releaseCapture(undefined, result);
    }

    function onWheel(event) {
      if (typeof event.preventDefault === "function") event.preventDefault();
      wheel(toScreen(event, element), event.deltaY, { deltaMode: event.deltaMode });
    }

    function onContextMenuEvent(event) {
      const request = requestContextMenu(toScreen(event, element));
      if (request && typeof event.preventDefault === "function") event.preventDefault();
    }

    function onKeyDown(event) {
      if (event && (event.key === " " || event.key === "Spacebar") && !event.repeat && !isEditableTarget(event.target)) {
        state.spaceHeld = true;
      }
      if (event && event.key === "Escape" && state.active && !isEditableTarget(event.target)) {
        const escaping = state.active.pointerId;
        if (handleEscape()) {
          try {
            if (element.hasPointerCapture && element.hasPointerCapture(escaping)) {
              element.releasePointerCapture(escaping);
            }
          } catch (_error) {
            // Capture state must not break cancellation.
          }
          try {
            event.preventDefault();
          } catch (_error) {
            // A bare fake still records the consumed decision.
          }
          try {
            event.stopImmediatePropagation();
          } catch (_error) {
            // Same: the returned boolean is the contract.
          }
        }
      }
    }

    function onKeyUp(event) {
      if (event && (event.key === " " || event.key === "Spacebar")) state.spaceHeld = false;
    }

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onInterrupt);
    element.addEventListener("lostpointercapture", onInterrupt);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("contextmenu", onContextMenuEvent);
    element.addEventListener("keydown", onKeyDown);
    element.addEventListener("keyup", onKeyUp);
    if (owner && typeof owner.addEventListener === "function") owner.addEventListener("blur", onBlur);

    return function unbind() {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onInterrupt);
      element.removeEventListener("lostpointercapture", onInterrupt);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("contextmenu", onContextMenuEvent);
      element.removeEventListener("keydown", onKeyDown);
      element.removeEventListener("keyup", onKeyUp);
      if (owner && typeof owner.removeEventListener === "function") owner.removeEventListener("blur", onBlur);
    };
  }

  return {
    press,
    move,
    release,
    cancel,
    handleEscape,
    handleBlur,
    notifyFrameChanged,
    setSpaceHeld,
    wheel,
    requestContextMenu,
    cursorFor,
    bind,
    get active() {
      return state.active ? { ...state.active } : null;
    },
    get spaceHeld() {
      return state.spaceHeld;
    },
  };
}

module.exports = { createPathGestures, segmentEndpoints };
