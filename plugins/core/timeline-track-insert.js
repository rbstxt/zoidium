(function installTimelineTrackInsert(global) {
  "use strict";

  // Dropping a clip on the boundary between two rows inserts an empty track
  // there and moves the dragged clips onto it inside the drag's existing
  // history operation. Ordinary row drops keep the native overwrite path.
  //
  // Everything below is one gesture: clipDragStart creates the per-drag state,
  // clipDragUpdate measures the pointer against the row edges, clipDragEnd
  // publishes the chosen boundary, and the moveClipProxies wrapper performs
  // the insert before delegating the actual clip moves to the host.

  const PATCH_MARKER = "__zoidiumTimelineTrackInsertPatch";
  const DRAG_STATE_KEY = "__zoidiumTrackInsertDrag";
  const DROP_STATE_KEY = "__zoidiumTrackInsertDrop";
  const LINE_CLASS = "zoidium-track-insert-line";
  const BOUNDARY_TOLERANCE_PX = 4;
  const BOUNDARY_TOLERANCE_RATIO = 0.25;

  function boundaryTolerance(rowHeight) {
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) return 0;
    return Math.min(BOUNDARY_TOLERANCE_PX, rowHeight * BOUNDARY_TOLERANCE_RATIO);
  }

  // rows are the real track rows of one container in array order. The shared
  // edge of two abutting rows is their midpoint, so this works for video rows
  // (index 0 at the bottom) and audio rows (index 0 at the top).
  function findBoundary(rows, y) {
    if (!Array.isArray(rows) || rows.length < 2 || !Number.isFinite(y)) return null;
    let best = null;
    for (let index = 0; index < rows.length - 1; index += 1) {
      const current = rows[index];
      const next = rows[index + 1];
      if (!current || !next) continue;
      if (!Number.isFinite(current.top) || !Number.isFinite(current.height) ||
          !Number.isFinite(next.top) || !Number.isFinite(next.height)) continue;
      const edge = (current.top + current.height + next.top) / 2;
      const height = Math.min(current.height, next.height);
      const distance = Math.abs(y - edge);
      if (distance > boundaryTolerance(height)) continue;
      if (!best || distance < best.distance) {
        best = { index: index + 1, edge, distance, rowHeight: height };
      }
    }
    return best;
  }

  function rowRects(container) {
    const rows = [];
    if (!container || !container.children) return rows;
    for (let index = 0; index < container.children.length; index += 1) {
      const element = container.children[index];
      if (!element || !element.pz_object) continue;
      const rect = typeof element.getBoundingClientRect === "function"
        ? element.getBoundingClientRect() : null;
      if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) continue;
      rows.push({ top: rect.top, height: rect.height });
    }
    return rows;
  }

  function boundaryUnderPointer(dragCtx) {
    const tracks = dragCtx && dragCtx.ctx;
    const origin = dragCtx && dragCtx.origin;
    const point = dragCtx && dragCtx.currentPt;
    if (!tracks || !origin || !point) return null;
    const viewportY = Number(origin.y) + Number(point.y);
    if (!Number.isFinite(viewportY)) return null;
    const kinds = [
      { type: 0, container: tracks.videoContainer },
      { type: 1, container: tracks.audioContainer },
    ];
    for (const kind of kinds) {
      const container = kind.container;
      if (!container || !container.children || typeof container.getBoundingClientRect !== "function") continue;
      const rect = container.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.height)) continue;
      if (viewportY < rect.top || viewportY > rect.top + rect.height) continue;
      const hit = findBoundary(rowRects(container), viewportY);
      if (!hit) continue;
      return { type: kind.type, index: hit.index, edge: hit.edge, container };
    }
    return null;
  }

  function hasProxyOfType(dragCtx, type) {
    const proxies = dragCtx && dragCtx.clip_proxies;
    if (!proxies || typeof proxies.length !== "number") return false;
    for (let index = 0; index < proxies.length; index += 1) {
      if (Number(proxies[index] && proxies[index].pz_type) === type) return true;
    }
    return false;
  }

  function trackCountOf(container) {
    let count = 0;
    for (let index = 0; index < container.children.length; index += 1) {
      const child = container.children[index];
      if (child && child.pz_object) count += 1;
    }
    return count;
  }

  // Groups the dragged proxies by their source row. Each source row gets one
  // new row at the boundary, ordered bottom-to-top (video) or top-to-bottom
  // (audio) by the source array index, which keeps the relative order. A
  // locked source clip or source row refuses the insert.
  function planBoundaryInsert(tracks, proxies, type, dropIndex, isLocked) {
    if (!tracks || !proxies || typeof proxies.length !== "number") return null;
    if (type !== 0 && type !== 1) return null;
    if (!Number.isFinite(dropIndex)) return null;
    const container = type === 0 ? tracks.videoContainer : tracks.audioContainer;
    if (!container || !container.children) return null;

    const groups = [];
    const bySource = new Map();
    for (let index = 0; index < proxies.length; index += 1) {
      const proxy = proxies[index];
      if (!proxy || Number(proxy.pz_type) !== type) continue;
      const clipElement = proxy.pz_clip;
      const sourceElement = clipElement && clipElement.parentElement;
      if (!clipElement || !sourceElement || sourceElement.parentElement !== container) continue;
      if (typeof isLocked === "function" &&
          (isLocked(clipElement.pz_object) || isLocked(sourceElement.pz_object))) return null;
      const sourceIndex = Array.prototype.indexOf.call(container.children, sourceElement);
      if (sourceIndex < 0) continue;
      let group = bySource.get(sourceIndex);
      if (!group) {
        group = { sourceIndex, proxies: [] };
        bySource.set(sourceIndex, group);
        groups.push(group);
      }
      group.proxies.push(proxy);
    }
    if (groups.length === 0) return null;
    const trackCount = trackCountOf(container);
    if (trackCount < 2) return null;

    groups.sort((left, right) => left.sourceIndex - right.sourceIndex);
    const base = Math.max(1, Math.min(Math.trunc(dropIndex), trackCount - 1));
    const entries = groups.map((group, position) => ({
      sourceIndex: group.sourceIndex,
      newIndex: base + position,
      proxies: group.proxies,
    }));
    const ordered = [];
    for (const entry of entries) ordered.push(...entry.proxies);
    return { type, base, entries, proxies: ordered };
  }

  // createTrack and the clip moves land in the history operation the native
  // clipDragEnd already opened, so one undo removes the row(s) and returns the
  // clips. The moveClipProxies call below is a re-entry into the same
  // prototype; the drop marker was cleared first, so it reaches the host and
  // its lock guard.
  function applyBoundaryInsert(tracks, plan, movedRight) {
    const container = plan.type === 0 ? tracks.videoContainer : tracks.audioContainer;
    if (!container || typeof tracks.createTrack !== "function" ||
        typeof tracks.moveClipProxies !== "function") return false;
    for (const entry of plan.entries) {
      tracks.createTrack({ type: plan.type, newTrackIdx: entry.newIndex, data: null });
      const target = container.children[entry.newIndex];
      if (!target) continue;
      for (const proxy of entry.proxies) target.appendChild(proxy);
    }
    tracks.moveClipProxies(plan.proxies, false, Boolean(movedRight));
    return true;
  }

  function ensureLine(dragCtx, state, document) {
    if (state.line) return state.line;
    const root = dragCtx.ctx && dragCtx.ctx.el;
    const doc = document || (root && root.ownerDocument);
    if (!root || !doc || typeof doc.createElement !== "function") return null;
    const line = doc.createElement("div");
    line.className = LINE_CLASS;
    line.style.position = "absolute";
    line.style.height = "2px";
    line.style.pointerEvents = "none";
    line.style.zIndex = "10001";
    line.style.background = "var(--zui-toggle-on, #70c29d)";
    line.style.boxShadow = "0 0 4px var(--zui-toggle-on, #70c29d)";
    line.style.display = "none";
    root.appendChild(line);
    state.line = line;
    return line;
  }

  function removeLine(state) {
    if (!state || !state.line) return;
    if (typeof state.line.remove === "function") state.line.remove();
    state.line = null;
  }

  function hideLine(state) {
    if (state && state.line) state.line.style.display = "none";
  }

  function setProxiesHidden(dragCtx, hidden) {
    const proxies = dragCtx && dragCtx.clip_proxies;
    if (!proxies || typeof proxies.length !== "number") return;
    for (let index = 0; index < proxies.length; index += 1) {
      const proxy = proxies[index];
      if (proxy && proxy.style) proxy.style.display = hidden ? "none" : (dragCtx.moved ? "" : "none");
    }
  }

  function showLine(dragCtx, state, hit, document) {
    const line = ensureLine(dragCtx, state, document);
    const root = dragCtx.ctx && dragCtx.ctx.el;
    if (!line || !root || typeof root.getBoundingClientRect !== "function" ||
        typeof hit.container.getBoundingClientRect !== "function") return;
    const rootRect = root.getBoundingClientRect();
    const containerRect = hit.container.getBoundingClientRect();
    if (!rootRect || !containerRect) return;
    line.style.top = Math.round(hit.edge - rootRect.top - 1) + "px";
    line.style.left = Math.max(0, Math.round(containerRect.left - rootRect.left)) + "px";
    line.style.width = Math.max(0, Math.round(containerRect.width)) + "px";
    line.style.display = "";
  }

  function clearCandidate(dragCtx, state) {
    if (state) {
      state.candidate = null;
      hideLine(state);
    }
    setProxiesHidden(dragCtx, false);
  }

  function updateIndicator(dragCtx) {
    const state = dragCtx && dragCtx[DRAG_STATE_KEY];
    if (!state) return;
    if (dragCtx.moved !== true || state.altKey) {
      clearCandidate(dragCtx, state);
      return;
    }
    const hit = boundaryUnderPointer(dragCtx);
    if (!hit || !hasProxyOfType(dragCtx, hit.type)) {
      clearCandidate(dragCtx, state);
      return;
    }
    state.candidate = hit;
    showLine(dragCtx, state, hit, state.document);
    setProxiesHidden(dragCtx, true);
  }

  function isCancelEvent(event) {
    return Boolean(event) && typeof event.type === "string" &&
      event.type.startsWith("key") && event.key === "Escape";
  }

  function installTimelineTrackInsert(PZ, options) {
    const prototype = PZ && PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks &&
      PZ.ui.timeline.tracks.prototype;
    if (!prototype || prototype[PATCH_MARKER]) return false;
    const originalStart = prototype.clipDragStart;
    const originalDrag = prototype.clipDrag;
    const originalUpdate = prototype.clipDragUpdate;
    const originalEnd = prototype.clipDragEnd;
    const originalMove = prototype.moveClipProxies;
    if ([originalStart, originalDrag, originalUpdate, originalEnd, originalMove,
      prototype.createTrack].some(method => typeof method !== "function")) return false;

    const settings = options || {};
    const document = settings.document;
    const isLocked = settings.isLocked;

    prototype.clipDragStart = function zoidiumTrackInsertDragStart(event) {
      const state = {
        candidate: null,
        line: null,
        altKey: Boolean(event && event.altKey),
        document,
      };
      this[DRAG_STATE_KEY] = state;
      let result;
      try {
        result = originalStart.apply(this, arguments);
      } catch (error) {
        removeLine(state);
        delete this[DRAG_STATE_KEY];
        throw error;
      }
      if (result === false) {
        removeLine(state);
        delete this[DRAG_STATE_KEY];
      }
      return result;
    };

    prototype.clipDrag = function zoidiumTrackInsertDrag(event) {
      const state = this[DRAG_STATE_KEY];
      if (state) state.altKey = Boolean(event && event.altKey);
      return originalDrag.apply(this, arguments);
    };

    prototype.clipDragUpdate = function zoidiumTrackInsertDragUpdate() {
      const result = originalUpdate.apply(this, arguments);
      updateIndicator(this);
      return result;
    };

    prototype.clipDragEnd = function zoidiumTrackInsertDragEnd(event) {
      const dragCtx = this;
      const state = dragCtx[DRAG_STATE_KEY];
      const tracks = dragCtx.ctx;
      if (isCancelEvent(event)) {
        clearCandidate(dragCtx, state);
        removeLine(state);
        const proxies = dragCtx.clip_proxies || [];
        for (const proxy of proxies) {
          if (proxy && typeof proxy.remove === "function") proxy.remove();
        }
        if (tracks && typeof tracks.verticalZoom === "function") tracks.verticalZoom();
        if (tracks && tracks.timeline && typeof tracks.timeline.updateZoom === "function") {
          tracks.timeline.updateZoom();
        }
        delete dragCtx[DRAG_STATE_KEY];
        return undefined;
      }
      const candidate = state && !state.altKey && dragCtx.moved === true ? state.candidate : null;
      if (candidate && tracks) {
        tracks[DROP_STATE_KEY] = { type: candidate.type, index: candidate.index };
      }
      try {
        return originalEnd.apply(this, arguments);
      } finally {
        if (tracks) delete tracks[DROP_STATE_KEY];
        if (state) {
          state.candidate = null;
          removeLine(state);
        }
        setProxiesHidden(dragCtx, false);
        delete dragCtx[DRAG_STATE_KEY];
      }
    };

    prototype.moveClipProxies = function zoidiumTrackInsertMove(proxies, createOnly, movedRight) {
      const active = this && this[DROP_STATE_KEY];
      if (!active) return originalMove.apply(this, arguments);
      if (this[DROP_STATE_KEY]) delete this[DROP_STATE_KEY];
      if (createOnly) return originalMove.apply(this, arguments);
      const plan = planBoundaryInsert(this, proxies, active.type, active.index, isLocked);
      if (!plan) return originalMove.apply(this, arguments);
      return applyBoundaryInsert(this, plan, movedRight);
    };

    prototype[PATCH_MARKER] = true;
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      DRAG_STATE_KEY,
      DROP_STATE_KEY,
      LINE_CLASS,
      BOUNDARY_TOLERANCE_PX,
      BOUNDARY_TOLERANCE_RATIO,
      boundaryTolerance,
      findBoundary,
      rowRects,
      boundaryUnderPointer,
      planBoundaryInsert,
      applyBoundaryInsert,
      installTimelineTrackInsert,
    };
    return;
  }

  const scope = global || {};
  installTimelineTrackInsert(scope.PZ, {
    document: scope.document,
    isLocked: scope.ZoidiumTrackSwitches && scope.ZoidiumTrackSwitches.isLocked,
  });
})(typeof window !== "undefined" ? window : null);
