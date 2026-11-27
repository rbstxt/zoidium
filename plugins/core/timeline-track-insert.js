(function installTimelineTrackInsert(global) {
  "use strict";

  // Dropping a clip on the boundary between two rows inserts an empty track
  // there and moves the dragged clips onto it inside the drag's existing
  // history operation. A drop on the middle of a row that would trim or delete
  // another clip does the same, one row above the destination, instead of
  // overwriting. Every other row drop keeps the native move path.
  //
  // Everything below is one gesture: clipDragStart creates the per-drag state,
  // clipDragUpdate measures the pointer against the row edges and the
  // destination rows, clipDragEnd publishes the chosen drop, and the
  // moveClipProxies wrapper performs the insert before delegating the actual
  // clip moves to the host.

  const PATCH_MARKER = "__zoidiumTimelineTrackInsertPatch";
  const DRAG_STATE_KEY = "__zoidiumTrackInsertDrag";
  const DROP_STATE_KEY = "__zoidiumTrackInsertDrop";
  const LINE_CLASS = "zoidium-track-insert-line";
  const BOUNDARY_TOLERANCE_PX = 6;
  const BOUNDARY_TOLERANCE_RATIO = 0.3;
  const BOUNDARY_TOLERANCE_MAX_RATIO = 0.45;

  // max(6 px, 30% of the shorter row), capped at 45% so the middle of every
  // row still places a clip on that row.
  function boundaryTolerance(rowHeight) {
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) return 0;
    return Math.min(
      Math.max(BOUNDARY_TOLERANCE_PX, rowHeight * BOUNDARY_TOLERANCE_RATIO),
      rowHeight * BOUNDARY_TOLERANCE_MAX_RATIO,
    );
  }

  // rows are the real track rows of one container in array order, with the
  // content position the native row detection reads (style.top/style.height)
  // and the client rect used to draw the line. The shared edge of two abutting
  // rows is their midpoint, so this works for video rows (index 0 at the
  // bottom) and audio rows (index 0 at the top). growsUp marks the video order,
  // where the last row is the top one.
  //
  // The outer edge of the first row is always a boundary (index 0). The outer
  // edge of the last row is reported as a native boundary: the native
  // insertTrackProxies path already creates that row, so the module must only
  // show the line there.
  function findBoundary(rows, y, growsUp) {
    if (!Array.isArray(rows) || rows.length === 0 || !Number.isFinite(y)) return null;
    let best = null;
    const consider = (index, edge, height, rowIndex, side, outer, native) => {
      const distance = Math.abs(y - edge);
      if (distance > boundaryTolerance(height)) return;
      if (!best || distance < best.distance) {
        best = { index, edge, distance, rowHeight: height, rowIndex, side, outer, native };
      }
    };
    for (let index = 0; index < rows.length - 1; index += 1) {
      const current = rows[index];
      const next = rows[index + 1];
      if (!current || !next) continue;
      if (!Number.isFinite(current.top) || !Number.isFinite(current.height) ||
          !Number.isFinite(next.top) || !Number.isFinite(next.height)) continue;
      const edge = (current.top + current.height + next.top) / 2;
      const height = Math.min(current.height, next.height);
      consider(index + 1, edge, height, index, growsUp === false ? "bottom" : "top", false, false);
    }
    const first = rows[0];
    if (first && Number.isFinite(first.top) && Number.isFinite(first.height)) {
      const edge = growsUp === false ? first.top : first.top + first.height;
      consider(0, edge, first.height, 0, growsUp === false ? "top" : "bottom", true, false);
    }
    const last = rows[rows.length - 1];
    if (last && Number.isFinite(last.top) && Number.isFinite(last.height)) {
      const edge = growsUp === false ? last.top + last.height : last.top;
      const beyond = growsUp === false ? y > edge : y < edge;
      if (beyond) {
        consider(rows.length, edge, last.height, rows.length - 1,
          growsUp === false ? "bottom" : "top", true, true);
      }
    }
    return best;
  }

  // Content rows plus the client rect of each row. The native drag detects the
  // row under the pointer from style.top/style.height and the container
  // scrollTop, so the boundary must use the same space. The client rect only
  // positions the line.
  function rowRects(container) {
    const rows = [];
    if (!container || !container.children) return rows;
    for (let index = 0; index < container.children.length; index += 1) {
      const element = container.children[index];
      if (!element || !element.pz_object) continue;
      const rect = typeof element.getBoundingClientRect === "function"
        ? element.getBoundingClientRect() : null;
      if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) continue;
      const style = element.style || {};
      const top = parseFloat(style.top);
      const height = parseFloat(style.height);
      rows.push({
        top: Number.isFinite(top) ? top : rect.top,
        height: Number.isFinite(height) && height > 0 ? height : rect.height,
        clientTop: rect.top,
        clientHeight: rect.height,
      });
    }
    return rows;
  }

  function hasProxyOfType(dragCtx, type) {
    const proxies = dragCtx && dragCtx.clip_proxies;
    if (!proxies || typeof proxies.length !== "number") return false;
    for (let index = 0; index < proxies.length; index += 1) {
      if (Number(proxies[index] && proxies[index].pz_type) === type) return true;
    }
    return false;
  }

  // The pointer position in the container's content space, exactly as the
  // native clipDragUpdate row detection computes it: the drag-relative y plus
  // the container scrollTop (video), or minus the container's own offset
  // (audio). The window scroll and the client rects are not part of it.
  function pointerContentY(dragCtx, type, container) {
    const point = dragCtx && dragCtx.currentPt;
    const value = Number(point && point.y);
    if (!Number.isFinite(value)) return null;
    const scrollTop = Number(container && container.scrollTop) || 0;
    if (type === 0) return value + scrollTop;
    const offset = parseFloat(container && container.style && container.style.top);
    return value - (Number.isFinite(offset) ? offset : 0) + scrollTop;
  }

  function boundaryUnderPointer(dragCtx) {
    const tracks = dragCtx && dragCtx.ctx;
    if (!tracks) return null;
    const kinds = [
      { type: 0, container: tracks.videoContainer },
      { type: 1, container: tracks.audioContainer },
    ];
    let best = null;
    for (const kind of kinds) {
      if (!hasProxyOfType(dragCtx, kind.type)) continue;
      const container = kind.container;
      if (!container || !container.children) continue;
      const rows = rowRects(container);
      if (rows.length === 0) continue;
      const y = pointerContentY(dragCtx, kind.type, container);
      if (y === null) continue;
      const hit = findBoundary(rows, y, kind.type === 0);
      if (!hit) continue;
      const row = rows[hit.rowIndex];
      if (!row) continue;
      const edge = hit.side === "top" ? row.clientTop : row.clientTop + row.clientHeight;
      if (!Number.isFinite(edge)) continue;
      if (!best || hit.distance < best.distance) {
        best = { type: kind.type, index: hit.index, edge, container, outer: hit.outer, native: hit.native };
      }
    }
    return best;
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
    if (trackCount < 1) return null;

    groups.sort((left, right) => left.sourceIndex - right.sourceIndex);
    // 0 and trackCount are the outer edges of the container and are valid
    // createTrack indices.
    const base = Math.max(0, Math.min(Math.trunc(dropIndex), trackCount));
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

  // The dropped frame range of a proxy, read the way the native
  // moveClipProxies reads it. The pz_start fallback only serves hosts that do
  // not style the proxy.
  function proxyFrameRange(proxy, timeline) {
    if (!proxy) return null;
    const style = proxy.style || {};
    const toFrame = timeline && typeof timeline.pxToFrame === "function"
      ? timeline.pxToFrame : value => value;
    let start = parseFloat(style.left);
    let length = parseFloat(style.width);
    if (Number.isFinite(start)) start = toFrame(start);
    if (Number.isFinite(length)) length = toFrame(length);
    if (!Number.isFinite(start)) {
      start = Number(proxy.start !== undefined ? proxy.start : proxy.pz_start);
    }
    if (!Number.isFinite(length)) {
      length = Number(proxy.pz_length !== undefined
        ? proxy.pz_length : proxy.pz_object && proxy.pz_object.length);
    }
    if (!Number.isFinite(start) || !Number.isFinite(length)) return null;
    return { start: Math.round(start), length: Math.round(length) };
  }

  // Touching end to start is not an overlap.
  function rangesOverlap(left, right) {
    return left.start < right.start + right.length && right.start < left.start + left.length;
  }

  function sourceLocked(proxy, isLocked) {
    const clipElement = proxy && proxy.pz_clip;
    const sourceElement = clipElement && clipElement.parentElement;
    return Boolean(
      (clipElement && isLocked(clipElement.pz_object)) ||
      (sourceElement && isLocked(sourceElement.pz_object)),
    );
  }

  function destinationGroups(tracks, proxies, type) {
    const container = type === 0 ? tracks.videoContainer : tracks.audioContainer;
    const groups = [];
    if (!container || !container.children) return { container: null, groups };
    const byElement = new Map();
    for (let index = 0; index < proxies.length; index += 1) {
      const proxy = proxies[index];
      if (!proxy || Number(proxy.pz_type) !== type) continue;
      const destElement = proxy.parentElement;
      if (!destElement || destElement.parentElement !== container) continue;
      let group = byElement.get(destElement);
      if (!group) {
        group = {
          destElement,
          destIndex: Array.prototype.indexOf.call(container.children, destElement),
          proxies: [],
        };
        byElement.set(destElement, group);
        groups.push(group);
      }
      group.proxies.push(proxy);
    }
    groups.sort((left, right) => left.destIndex - right.destIndex);
    return { container, groups };
  }

  function groupOverlaps(group, timeline, dragged) {
    const track = group.destElement && group.destElement.pz_object;
    if (!track || !Array.isArray(track.clips) || track.clips.length === 0) return false;
    for (const proxy of group.proxies) {
      const range = proxyFrameRange(proxy, timeline);
      if (!range || range.length <= 0) continue;
      for (const clip of track.clips) {
        if (!clip || dragged.has(clip)) continue;
        if (!Number.isFinite(clip.start) || !Number.isFinite(clip.length)) continue;
        if (rangesOverlap(range, clip)) return true;
      }
    }
    return false;
  }

  // A row drop that would make a dragged clip overlap a clip that is not being
  // dragged must not overwrite. Each overlapping destination row gets one new
  // row at destinationIndex + 1 and the dragged clips of that row move onto
  // it. Returns null when the native path must stay: no overlap, a locked
  // source, or a locked destination row.
  function planNoOverwrite(tracks, proxies, isLocked) {
    if (!tracks || !proxies || typeof proxies.length !== "number") return null;
    const dragged = new Set();
    for (const proxy of proxies) {
      if (proxy && proxy.pz_object) dragged.add(proxy.pz_object);
    }
    const entries = [];
    for (const type of [0, 1]) {
      const { container, groups } = destinationGroups(tracks, proxies, type);
      if (!container || groups.length === 0) continue;
      for (const group of groups) {
        if (typeof isLocked === "function") {
          if (isLocked(group.destElement.pz_object)) return null;
          if (group.proxies.some(proxy => sourceLocked(proxy, isLocked))) return null;
        }
        if (!groupOverlaps(group, tracks.timeline, dragged)) continue;
        entries.push({
          type,
          container,
          destElement: group.destElement,
          destIndex: group.destIndex,
          proxies: group.proxies,
        });
      }
    }
    return entries.length > 0 ? { entries } : null;
  }

  // Rows are created in ascending destination order. The native deleteTrack
  // inverses then replay in reverse without shifting each other, and the
  // current index of each destination element is read again after the earlier
  // inserts.
  function applyNoOverwrite(tracks, plan, proxies, movedRight) {
    if (!plan || !Array.isArray(plan.entries)) return false;
    if (!tracks || typeof tracks.createTrack !== "function" ||
        typeof tracks.moveClipProxies !== "function") return false;
    for (const entry of plan.entries) {
      const container = entry.container;
      if (!container || !container.children) continue;
      const current = Array.prototype.indexOf.call(container.children, entry.destElement);
      const newIndex = (current < 0 ? entry.destIndex : current) + 1;
      tracks.createTrack({ type: entry.type, newTrackIdx: newIndex, data: null });
      const target = container.children[newIndex];
      if (!target) continue;
      for (const proxy of entry.proxies) target.appendChild(proxy);
    }
    tracks.moveClipProxies(proxies, false, Boolean(movedRight));
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

  // The new row of an overlapping destination sits above it for video and
  // below it for audio, so the line marks that edge of the destination row.
  function overlapHit(dragCtx, isLocked) {
    const plan = planNoOverwrite(dragCtx.ctx, dragCtx.clip_proxies, isLocked);
    if (!plan) return null;
    const entry = plan.entries[0];
    if (!entry || typeof entry.destElement.getBoundingClientRect !== "function") return null;
    const rect = entry.destElement.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.height)) return null;
    return {
      type: entry.type,
      index: entry.destIndex + 1,
      container: entry.container,
      edge: entry.type === 0 ? rect.top : rect.top + rect.height,
      overlap: true,
    };
  }

  function updateIndicator(dragCtx) {
    const state = dragCtx && dragCtx[DRAG_STATE_KEY];
    if (!state) return;
    if (dragCtx.moved !== true || state.altKey) {
      clearCandidate(dragCtx, state);
      return;
    }
    const hit = boundaryUnderPointer(dragCtx);
    if (hit) {
      state.candidate = hit;
      showLine(dragCtx, state, hit, state.document);
      setProxiesHidden(dragCtx, true);
      return;
    }
    const overlap = state.shiftKey ? null : overlapHit(dragCtx, state.isLocked);
    if (overlap) {
      state.candidate = null;
      showLine(dragCtx, state, overlap, state.document);
      setProxiesHidden(dragCtx, true);
      return;
    }
    clearCandidate(dragCtx, state);
  }

  // The line follows Shift while the pointer is still, so the feedback matches
  // the drop that will happen. The native drag reads Shift only on the move
  // and end events, so the state is updated from the key events too.
  function attachKeyFeedback(dragCtx) {
    const state = dragCtx && dragCtx[DRAG_STATE_KEY];
    const root = dragCtx && dragCtx.ctx && dragCtx.ctx.el;
    const doc = state && (state.document || (root && root.ownerDocument));
    if (!state || !doc || typeof doc.addEventListener !== "function") return;
    const handler = event => {
      const current = dragCtx[DRAG_STATE_KEY];
      if (!current || !event || typeof event.shiftKey !== "boolean") return;
      current.shiftKey = event.shiftKey;
      updateIndicator(dragCtx);
    };
    state.keyHandler = handler;
    state.keyDocument = doc;
    doc.addEventListener("keydown", handler);
    doc.addEventListener("keyup", handler);
  }

  function detachKeyFeedback(state) {
    if (!state || !state.keyHandler || !state.keyDocument) return;
    const doc = state.keyDocument;
    if (typeof doc.removeEventListener === "function") {
      doc.removeEventListener("keydown", state.keyHandler);
      doc.removeEventListener("keyup", state.keyHandler);
    }
    state.keyHandler = null;
    state.keyDocument = null;
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
        // Shift keeps the native overwrite, so it also suppresses the new-row
        // feedback. Ctrl is not usable: the native clipDragStart refuses a
        // drag that starts with it, and a Ctrl drop skips the move entirely.
        shiftKey: Boolean(event && event.shiftKey),
        document,
        isLocked,
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
        return result;
      }
      attachKeyFeedback(this);
      return result;
    };

    prototype.clipDrag = function zoidiumTrackInsertDrag(event) {
      const state = this[DRAG_STATE_KEY];
      if (state) {
        state.altKey = Boolean(event && event.altKey);
        state.shiftKey = Boolean(event && event.shiftKey);
      }
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
        detachKeyFeedback(state);
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
      const altKey = Boolean(event && event.altKey);
      const moved = dragCtx.moved === true;
      const candidate = state && !altKey && moved ? state.candidate : null;
      const drop = state && !altKey && moved ? {
        // A native outer edge is created by insertTrackProxies. Carry the flag
        // so the move wrapper takes the original path and never plans a second
        // row there.
        boundary: candidate ? { type: candidate.type, index: candidate.index } : null,
        native: Boolean(candidate && candidate.native),
        overwrite: Boolean(event && event.shiftKey),
      } : null;
      if (drop && tracks) tracks[DROP_STATE_KEY] = drop;
      try {
        return originalEnd.apply(this, arguments);
      } finally {
        if (tracks) delete tracks[DROP_STATE_KEY];
        if (state) {
          state.candidate = null;
          removeLine(state);
          detachKeyFeedback(state);
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
      if (active.native) return originalMove.apply(this, arguments);
      if (active.boundary) {
        const plan = planBoundaryInsert(this, proxies, active.boundary.type, active.boundary.index, isLocked);
        if (plan) return applyBoundaryInsert(this, plan, movedRight);
        return originalMove.apply(this, arguments);
      }
      if (active.overwrite) return originalMove.apply(this, arguments);
      const plan = planNoOverwrite(this, proxies, isLocked);
      if (plan) return applyNoOverwrite(this, plan, proxies, movedRight);
      return originalMove.apply(this, arguments);
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
      BOUNDARY_TOLERANCE_MAX_RATIO,
      boundaryTolerance,
      findBoundary,
      rowRects,
      boundaryUnderPointer,
      pointerContentY,
      planBoundaryInsert,
      applyBoundaryInsert,
      proxyFrameRange,
      planNoOverwrite,
      applyNoOverwrite,
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
