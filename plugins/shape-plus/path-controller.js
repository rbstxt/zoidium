"use strict";
// Shared path-editing state for the Mask and Shape+ adapters: one controller
// per project and viewport owns the tool ("pen"/"select"), the active host
// and path ID, vertex selections keyed by host and path, drawing, hover, the
// active gesture, and focus ownership. Panels and the timeline activate
// through this controller, so Q/V and panel switches preserve selection. A
// project change disposes state; deleting a path drops only its selection;
// undo and reload prune IDs against live host objects, never stale refs.
//
// Host contract (only `id` is required; the rest are optional until the P1.6
// adapters exist): hasPath(id), listPathIds(), listVertexIds(pathId),
// isLocked(id) (locked paths stay selectable; callers block edits), and
// syncSelection({ hostId, pathId, vertices }) mirrored after activation and
// selection changes.
const TOOLS = ["pen", "select"];

function keyFor(hostId, pathId) {
  return hostId + "\n" + pathId;
}

function hostIdOf(host) {
  if (!host || typeof host.id !== "string" || !host.id) throw Error("Path host needs a string id");
  return host.id;
}

function livePathIds(host) {
  if (typeof host.listPathIds === "function") {
    const ids = host.listPathIds();
    return Array.isArray(ids) ? ids : null;
  }
  return null;
}

function filterLiveVertices(host, pathId, vertices) {
  if (typeof host.listVertexIds !== "function") return vertices;
  let live;
  try {
    live = host.listVertexIds(pathId);
  } catch (_error) {
    return vertices;
  }
  if (!Array.isArray(live)) return vertices;
  const keep = new Set(live);
  return vertices.filter(id => keep.has(id));
}

function createPathController(options = {}) {
  const state = {
    project: options.project !== undefined ? options.project : null,
    viewport: options.viewport !== undefined ? options.viewport : null,
    onChange: typeof options.onChange === "function" ? options.onChange : null,
    tool: "select",
    activeHost: null,
    activeHostId: null,
    activePathId: null,
    selections: new Map(),
    drawing: null,
    hover: null,
    gesture: null,
    focusOwner: null,
    disposed: false,
  };

  function assertUsable() {
    if (state.disposed) throw Error("Path controller is disposed");
  }

  function notify(kind) {
    if (state.onChange) state.onChange(kind, snapshot());
    const host = state.activeHost;
    if (host && typeof host.syncSelection === "function" &&
        (kind === "activate" || kind === "selection" || kind === "deactivate")) {
      host.syncSelection({
        hostId: state.activeHostId,
        pathId: state.activePathId,
        vertices: getSelection(),
      });
    }
  }

  function snapshot() {
    return {
      tool: state.tool,
      hostId: state.activeHostId,
      pathId: state.activePathId,
      drawing: state.drawing ? { ...state.drawing, points: state.drawing.points.slice() } : null,
      hover: state.hover,
      gesture: state.gesture ? { ...state.gesture } : null,
      focusOwner: state.focusOwner,
    };
  }

  function resolveHostAndPath(host, pathId) {
    if (host === undefined || host === null) return { host: state.activeHost, pathId: pathId !== undefined ? pathId : state.activePathId };
    if (pathId === undefined || pathId === null) return { host, pathId: null };
    return { host, pathId };
  }

  function getSelection(host, pathId) {
    if (host === undefined && pathId === undefined) {
      if (!state.activeHost || state.activePathId === null) return [];
      const key = keyFor(state.activeHostId, state.activePathId);
      const stored = state.selections.get(key);
      if (!stored) return [];
      return filterLiveVertices(state.activeHost, state.activePathId, [...stored]);
    }
    const resolved = resolveHostAndPath(host, pathId);
    if (!resolved.host || resolved.pathId === null || resolved.pathId === undefined) return [];
    const key = keyFor(hostIdOf(resolved.host), resolved.pathId);
    const stored = state.selections.get(key);
    if (!stored) return [];
    return filterLiveVertices(resolved.host, resolved.pathId, [...stored]);
  }

  function setSelection(host, pathId, vertexIds) {
    assertUsable();
    const resolved = resolveHostAndPath(host, pathId);
    if (!resolved.host || resolved.pathId === null || resolved.pathId === undefined) {
      throw Error("Selection needs a host and path id");
    }
    const id = hostIdOf(resolved.host);
    if (typeof resolved.host.hasPath === "function" && !resolved.host.hasPath(resolved.pathId)) {
      throw Error("Unknown path " + resolved.pathId);
    }
    if (!Array.isArray(vertexIds)) throw Error("Selection needs an array of vertex ids");
    for (const vertexId of vertexIds) {
      if (typeof vertexId !== "string" || !vertexId) throw Error("Vertex ids must be short strings");
    }
    const filtered = filterLiveVertices(resolved.host, resolved.pathId, vertexIds.slice());
    state.selections.set(keyFor(id, resolved.pathId), new Set(filtered));
    notify("selection");
    return getSelection(resolved.host, resolved.pathId);
  }

  function toggleVertex(host, pathId, vertexId) {
    assertUsable();
    if (typeof vertexId !== "string" || !vertexId) throw Error("Vertex id must be a short string");
    const resolved = resolveHostAndPath(host, pathId);
    if (!resolved.host || resolved.pathId === null || resolved.pathId === undefined) {
      throw Error("Selection needs a host and path id");
    }
    const current = new Set(getSelection(resolved.host, resolved.pathId));
    const selected = !current.has(vertexId);
    if (selected) current.add(vertexId);
    else current.delete(vertexId);
    setSelection(resolved.host, resolved.pathId, [...current]);
    return selected;
  }

  function clearPathSelection(host, pathId) {
    assertUsable();
    const resolved = resolveHostAndPath(host, pathId);
    if (!resolved.host || resolved.pathId === null || resolved.pathId === undefined) return;
    state.selections.delete(keyFor(hostIdOf(resolved.host), resolved.pathId));
    notify("selection");
  }

  function clearAllSelections() {
    assertUsable();
    if (state.selections.size === 0) return;
    state.selections.clear();
    notify("selection");
  }

  function cancelDrawingSilent() {
    state.drawing = null;
  }

  function endGestureSilent() {
    state.gesture = null;
  }

  function setTool(next) {
    assertUsable();
    if (!TOOLS.includes(next)) throw Error("Unknown path tool " + next);
    if (state.tool === next) {
      // Re-selecting the active tool ends transient state but keeps the
      // active path and vertex selection.
      cancelDrawingSilent();
      endGestureSilent();
      state.hover = null;
      return state.tool;
    }
    state.tool = next;
    cancelDrawingSilent();
    endGestureSilent();
    state.hover = null;
    notify("tool");
    return state.tool;
  }

  function activate(host, id) {
    assertUsable();
    if (host === null || host === undefined || id === null || id === undefined) {
      state.activeHost = null;
      state.activeHostId = null;
      state.activePathId = null;
      cancelDrawingSilent();
      endGestureSilent();
      state.hover = null;
      notify("deactivate");
      return null;
    }
    if (typeof id !== "string" || !id) throw Error("Path id must be a short string");
    const idOfHost = hostIdOf(host);
    if (typeof host.hasPath === "function" && !host.hasPath(id)) {
      throw Error("Unknown path " + id);
    }
    state.activeHost = host;
    state.activeHostId = idOfHost;
    state.activePathId = id;
    if (!state.selections.has(keyFor(idOfHost, id))) {
      state.selections.set(keyFor(idOfHost, id), new Set());
    }
    cancelDrawingSilent();
    endGestureSilent();
    state.hover = null;
    notify("activate");
    return { hostId: idOfHost, pathId: id };
  }

  function deactivate() {
    return activate(null, null);
  }

  function startDrawing(options = {}) {
    assertUsable();
    if (!state.activeHost || state.activePathId === null) {
      throw Error("Drawing needs an active path");
    }
    const points = options.points !== undefined ? options.points : [];
    if (!Array.isArray(points)) throw Error("Drawing points must be an array");
    state.drawing = {
      hostId: state.activeHostId,
      pathId: state.activePathId,
      points: points.map(point => (Array.isArray(point) ? point.slice(0, 2) : point)),
      startedAt: typeof options.startedAt === "number" ? options.startedAt : Date.now(),
    };
    notify("drawing");
    return state.drawing;
  }

  function addDrawingPoint(point) {
    assertUsable();
    if (!state.drawing) throw Error("No drawing in progress");
    if (!Array.isArray(point) || point.length < 2 ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      throw Error("Drawing point must hold two finite numbers");
    }
    state.drawing.points.push([point[0], point[1]]);
    notify("drawing");
    return state.drawing.points.length;
  }

  function finishDrawing() {
    assertUsable();
    if (!state.drawing) return null;
    const finished = { ...state.drawing, points: state.drawing.points.slice() };
    state.drawing = null;
    notify("drawing");
    return finished;
  }

  function cancelDrawing() {
    assertUsable();
    if (!state.drawing) return false;
    state.drawing = null;
    notify("drawing");
    return true;
  }

  function setHover(hover) {
    assertUsable();
    state.hover = hover === undefined ? null : hover;
    notify("hover");
    return state.hover;
  }

  function clearHover() {
    assertUsable();
    state.hover = null;
    notify("hover");
  }

  function beginGesture(gesture) {
    assertUsable();
    if (!gesture || typeof gesture !== "object") throw Error("Gesture must be an object");
    state.gesture = { ...gesture };
    notify("gesture");
    return state.gesture;
  }

  function endGesture(cancelled = false) {
    assertUsable();
    if (!state.gesture) return null;
    const finished = { ...state.gesture, cancelled: !!cancelled };
    state.gesture = null;
    notify("gesture");
    return finished;
  }

  function claimFocus(owner = "path") {
    assertUsable();
    if (typeof owner !== "string" || !owner) throw Error("Focus owner must be a short string");
    state.focusOwner = owner;
    notify("focus");
    return state.focusOwner;
  }

  function releaseFocus(owner) {
    assertUsable();
    if (owner !== undefined && owner !== state.focusOwner) return state.focusOwner;
    state.focusOwner = null;
    notify("focus");
    return null;
  }

  function ownsFocus(owner = "path") {
    return state.focusOwner === owner;
  }

  // Undo/reload replaced the live collection: drop selections for paths the
  // host no longer lists and deactivate when the active path is gone. Other
  // hosts are untouched.
  function handlePathsChanged(host) {
    assertUsable();
    if (!host) return;
    const idOfHost = hostIdOf(host);
    const live = livePathIds(host);
    if (live !== null) {
      const keep = new Set(live);
      for (const key of [...state.selections.keys()]) {
        if (!key.startsWith(idOfHost + "\n")) continue;
        if (!keep.has(key.slice(idOfHost.length + 1))) state.selections.delete(key);
      }
      if (state.activeHostId === idOfHost &&
          (state.activePathId === null || !keep.has(state.activePathId))) {
        state.activeHost = null;
        state.activeHostId = null;
        state.activePathId = null;
        cancelDrawingSilent();
        endGestureSilent();
        state.hover = null;
        notify("deactivate");
        return;
      }
      notify("selection");
      return;
    }
    if (typeof host.hasPath === "function" && state.activeHostId === idOfHost &&
        state.activePathId !== null && !host.hasPath(state.activePathId)) {
      handlePathDeleted(host, state.activePathId);
    }
  }

  // Deleting a path removes only its own selection; other hosts and paths
  // keep their vertices.
  function handlePathDeleted(host, pathId) {
    assertUsable();
    if (!host || pathId === null || pathId === undefined) return;
    const idOfHost = hostIdOf(host);
    state.selections.delete(keyFor(idOfHost, pathId));
    if (state.activeHostId === idOfHost && state.activePathId === pathId) {
      state.activeHost = null;
      state.activeHostId = null;
      state.activePathId = null;
      cancelDrawingSilent();
      endGestureSilent();
      state.hover = null;
      notify("deactivate");
      return;
    }
    notify("selection");
  }

  function reset() {
    state.tool = "select";
    state.activeHost = null;
    state.activeHostId = null;
    state.activePathId = null;
    state.selections.clear();
    state.drawing = null;
    state.hover = null;
    state.gesture = null;
    state.focusOwner = null;
    if (!state.disposed) notify("reset");
  }

  // A project change disposes state: same-project calls keep everything,
  // any other project resets to a blank controller.
  function handleProjectChanged(nextProject) {
    assertUsable();
    if (nextProject === state.project) return false;
    state.project = nextProject;
    reset();
    return true;
  }

  function dispose() {
    if (state.disposed) return;
    reset();
    state.disposed = true;
  }

  const controller = {
    get project() { return state.project; },
    get viewport() { return state.viewport; },
    get tool() { return state.tool; },
    get activeHost() { return state.activeHost; },
    get activeHostId() { return state.activeHostId; },
    get activePathId() { return state.activePathId; },
    get drawing() {
      return state.drawing ? { ...state.drawing, points: state.drawing.points.slice() } : null;
    },
    get hover() { return state.hover; },
    get gesture() { return state.gesture ? { ...state.gesture } : null; },
    get focusOwner() { return state.focusOwner; },
    get disposed() { return state.disposed; },
    setTool,
    activate,
    deactivate,
    getSelection,
    setSelection,
    toggleVertex,
    clearPathSelection,
    clearAllSelections,
    startDrawing,
    addDrawingPoint,
    finishDrawing,
    cancelDrawing,
    setHover,
    clearHover,
    beginGesture,
    endGesture,
    claimFocus,
    releaseFocus,
    ownsFocus,
    handlePathsChanged,
    handlePathDeleted,
    handleProjectChanged,
    reset,
    dispose,
    snapshot,
  };
  return controller;
}

module.exports = { createPathController, TOOLS };
