"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const controls = require("./editor-controls.js");
const g = require("./editor-geometry.js");
const { clone } = require("./model.js");
const { channels } = require("./editor-topology.js");
const { createPointerMachine } = require("./editor-pointer-machine.js");
const xf = require("./editor-transform.js");
const { pickTarget, parentOf } = require("./editor-pick.js");
const { transform } = require("./compiler.js");
const { startMarquee, applyMarquee, pointsInRect } = require("./path-selection.js");
const { createPathGestures } = require("./path-gestures.js");
const { requestCreation } = require("./path-hosts.js");
function createPointer(s, canvas) {
  const api = s.canvasApi;
  const point = (event) => {
    const r = canvas.getBoundingClientRect();
    return [event.clientX - r.left, event.clientY - r.top];
  };
  function transaction(work) {
    if (!s.gesture.active && !s.gesture.begin()) return false;
    work();
    return true;
  }
  let marqueeHandles = [];
  const gestures = s.pathController && createPathGestures({
    controller: s.pathController, input: s.pathInput, viewport: api,
    minDragDistance: 2, selectLockedPoints: true, previewMarquee: true, deferSegmentSelection: true,
    onMessage: s.message,
    store: {
      paths: api.gesturePaths,
      pick: q => api.pickPaths(q),
      projection: api.projection,
      guides: api.guides,
      marqueePaths: () => api.gesturePaths().filter(path => path.id === s.activeId),
      snapping: () => s.snap,
      showSnap(guide) { s.snapGuide = guide; s.dirty = true; },
      selection() {
        if (s.tool === "select" && s.maskSelection?.size() > 1) {
          return Object.fromEntries([...s.multiMaskVertices()].flatMap(([id, selected]) => {
            if (!selected.length) return [];
            const ids = s.sharedPathHost.listVertexIds(id), wanted = new Set(selected);
            return [[id, ids.flatMap((vertexId, i) => wanted.has(vertexId) ? [i] : [])]];
          }));
        }
        const id = s.activeId;
        const ids = id && s.sharedPathHost?.listVertexIds(id);
        return ids ? { [id]: ids.flatMap((vertexId, i) => s.selection.has(selectionKey(vertexId)) ? [i] : []) } : {};
      },
      // The native transaction owns the full snapshot, including channel
      // keys and layer mask fields. Start it only on the first real write.
      snapshot: () => s.gesture,
      restore: gesture => gesture.finish(true),
      resetPreview: () => s.gesture.finish(true),
      commit: () => s.gesture.finish(),
      preview(edited) {
        const frame = s.localFrame();
        const writes = edited.map(item => {
          const { id, vertices } = item;
          const property = s.find(id).properties.path;
          return { item, property, values: g.values(vertices), current: property.get(frame) };
        }).filter(({ values, current }) => values.some((value, i) => value !== current[i]));
        if (!writes.length) return true;
        if (!s.gesture.active && !s.gesture.begin()) return false;
        if (s.tool === "select" && s.maskSelection?.size() > 1)
          s.previewMaskTransform(writes.map(write => write.item), frame);
        else {
          for (const { property, values } of writes) s.setValue(property, values, frame);
          s.pathHost?.persist();
        }
        return true;
      },
    },
    onSelect({ type, pathId, vertexIndex, vertexIndices, selection, toggle }) {
      const id = pathId || s.activeId;
      const ids = s.sharedPathHost.listVertexIds(id);
      const keys = (indices) => indices.map(index => selectionKey(ids[index]));
      if (type === "click") {
        const key = selectionKey(ids[vertexIndex]);
        if (!toggle) s.selection = new Set([key]);
        else if (s.selection.has(key)) s.selection.delete(key);
        else s.selection.add(key);
      } else if (type === "segment") s.selection = new Set(keys(vertexIndices));
      else if (type === "marquee") s.selection = new Set([...marqueeHandles, ...keys(selection[id] || [])]);
      s.refresh();
    },
  });
  function navigationCursor() {
    const cursor = gestures?.cursorFor();
    return cursor?.tool === "navigate" ? cursor : null;
  }
  function updateCursor() {
    const navigation = navigationCursor();
    if (navigation) canvas.style.cursor = navigation.css;
    else if (s.pointerPoint) api.scoped(() => updateHover(s.pointerPoint));
    else canvas.style.cursor = api.cursorFor(null).css;
  }
  function managedPress(event, start, request = {}) {
    const before = new Set(s.selection);
    const result = gestures.press(start, event, request);
    if (!result.capture) return null;
    const marquee = result.action === "marquee";
    const frame = s.localFrame();
    if (marquee) {
      marqueeHandles = event.shiftKey ? [...before].filter(key => selectionPart(key).side) : [];
      s.marquee = { start, end: start };
      if (!event.shiftKey) { s.selection.clear(); s.refresh(); }
    }
    if (result.cursor) canvas.style.cursor = result.cursor.css;
    return {
      managed: true, frame, target: request.pathId ?? request.target?.pathId,
      move(e) {
        s.pointerPoint = point(e);
        s.pathInput?.trackPointer(s.pointerPoint);
        const moved = api.scoped(() => gestures.move(s.pointerPoint, e));
        if (moved.rect) { s.marquee = moved.rect; s.dirty = true; }
      },
      end(e) {
        try {
          if (!marquee && result.action !== "pan" && s.valid() && frame !== s.localFrame()) {
            gestures.notifyFrameChanged();
          } else {
            const screen = e?.type === "pointerup" ? point(e) : undefined;
            api.scoped(() => gestures.release(screen, e));
          }
        } catch (error) {
          gestures.cancel();
          s.gesture.finish(true);
          s.message(error.message);
        } finally {
          s.marquee = null;
          marqueeHandles = [];
          s.refresh(true);
          updateCursor();
        }
      },
      cancel() {
        gestures.cancel();
        s.marquee = null;
        marqueeHandles = [];
        if (marquee) s.selection = before;
        s.refresh(true);
        updateCursor();
      },
    };
  }
  function capturePenState() {
    return { activeId: s.activeId, treeSelection: new Set(s.treeSelection), selection: new Set(s.selection),
      penFinished: s.penFinished, drawing: s.pathController?.drawing };
  }
  function restorePenState({ drawing, ...before }) {
    Object.assign(s, before);
    s.refresh(true);
    const controller = s.pathController;
    if (!controller || controller.disposed) return;
    if (drawing && drawing.pathId === controller.activePathId) controller.startDrawing(drawing);
    else controller.cancelDrawing();
  }
  // Click topology edits retain the same capture/rollback boundary as drags.
  // Commit at pointerup, so Escape or lost capture can undo a close or split.
  function clickEdit(work) {
    if (!s.gesture.begin()) return null;
    const before = capturePenState();
    try { work(); s.refresh(true); }
    catch (error) { s.gesture.finish(true); restorePenState(before); s.message(error.message); return null; }
    return {
      frame: s.localFrame(), target: s.activeId,
      end() { s.gesture.finish(); s.refresh(true); },
      cancel() {
        s.gesture.finish(true);
        restorePenState(before);
      },
    };
  }
  function pen(event, start, hit) {
    const item = s.active();
    if (hit?.kind === "anchor") return clickEdit(() => {
      s.requireEditablePath?.(item.id);
      const intent = s.pathController ? api.penCursor(hit).state :
        (hit.index === 0 && item.vertexIds.length > 1 && Number(item.properties.closed.get()) !== 1
          ? "endpoint-close" : "vertex-delete");
      if (intent === "endpoint-close") {
        channels(clone(item));
        item.properties.closed.set(1);
        s.penFinished = true;
        s.pathController?.finishDrawing();
        s.preview();
      } else if (intent === "endpoint-continue") {
        // Continue from the hovered end. Reverse an idle open path when its
        // first vertex is the chosen end, so append still uses the tail.
        const id = item.vertexIds[hit.index];
        if (hit.index === 0 && item.vertexIds.length > 1) s.topology({ kind: "reverse" });
        s.penFinished = false;
        s.selection = new Set([selectionKey(id)]);
        s.pathController?.startDrawing({ points: s.pathPoints().map(v => v.point) });
      } else {
        s.topology({ kind: "delete", ids: [item.vertexIds[hit.index]] });
        s.selection.clear();
      }
    });
    if (hit?.kind === "segment") return clickEdit(() => {
      const id = s.nextId();
      s.topology({ kind: "insert", index: hit.index,
        t: Math.max(0.000001, Math.min(0.999999, hit.t)), id });
      s.selection = new Set([selectionKey(id)]);
    });
    if (!s.gesture.begin()) return null;
    const before = capturePenState();
    const { drawing } = before;
    try {
      let local;
      if (
        item?.kind === "path" &&
        Number(item.properties.closed.get()) !== 1 &&
        !s.penFinished && !s.pathLocked?.(item.id) &&
        (s.sharedPathHost?.kind !== "mask" || drawing?.pathId === item.id)
      ) {
        local = api.local(start);
        if (!local) {
          s.gesture.finish(true);
          return null;
        }
        local = api.snap(local, [], s.pathPoints().at(-1).point, event.shiftKey);
        s.topology({ kind: "append", id: s.nextId(), point: local });
      } else {
        local = api.local(start, { matrix: s.insertionMatrix(true) });
        if (!local) {
          s.gesture.finish(true);
          return null;
        }
        const host = s.sharedPathHost;
        if (host) {
          const request = requestCreation({ [host.kind]: host });
          const pathId = request.host.createPath({ point: local });
          s.pathController.activate(request.host, pathId);
          s.preview();
        } else s.addItem("path", local);
        const snapped = api.snap(local, s.active().vertexIds);
        s.setPoints([{ point: snapped, in: [0, 0], out: [0, 0] }]);
        s.penFinished = false;
      }
      const path = s.active(),
        index = path.vertexIds.length - 1,
        id = path.vertexIds[index];
      s.selection = new Set([selectionKey(id)]);
      s.refresh(true);
      if (s.pathController && s.pathController.activePathId === path.id) {
        if (s.pathController.drawing) s.pathController.addDrawingPoint(local);
        else s.pathController.startDrawing({ points: [local] });
      }
      const origin = s.pathPoints(),
        frame = s.localFrame();
      let broken = null;
      return {
        frame,
        target: path.id,
        move(e) {
        return api.scoped(() => {
          const p = api.local(point(e));
          if (!p) return;
          let vector = g.sub(p, origin[index].point);
          if (e.shiftKey) vector = g.constrain(vector);
          if (Math.hypot(...g.sub(point(e), start)) < 2) return;
          const mode = e.altKey ? "independent" : "symmetric",
            points = g.vertices(g.values(origin));
          if (e.altKey) {
            broken = broken || s.pathPoints()[index].in.slice();
            points[index].in = broken.slice();
          } else broken = null;
          points[index] = g.handle(points[index], "out", vector, mode);
          s.setPoints(points);
          path.vertexModes[id] = mode;
        });
        },
        end() {
          s.gesture.finish();
          s.refresh(true);
        },
        cancel() {
          s.gesture.finish(true);
          restorePenState(before);
        },
      };
    } catch (error) {
      s.gesture.finish(true);
      restorePenState(before);
      s.message(error.message);
      return null;
    }
  }
  function pathCandidates(point) {
    return s.pathInput ? api.pickPaths(point).candidates : [];
  }
  function toggleAnchorMode(item, index) {
    const id = item.vertexIds[index];
    s.selection = new Set([selectionKey(id)]);
    s.refresh();
    if (s.pathLocked?.(item.id)) return;
    const before = item.vertexModes[id];
    s.setMode(!before || before === "corner" ? "smooth" : "corner");
  }
  function beginInner(event) {
    canvas.focus({ preventScroll: true });
    s.closeMenu?.();
    // An arrow-key nudge still holding the history transaction ends first, so
    // this press starts its own transaction instead of joining or losing it.
    s.finishNudge?.();
    if (!s.valid() || gestures && !api.projection()) return null;
    const start = point(event);
    s.pointerPoint = start;
    if (gestures?.spaceHeld) return managedPress(event, start);
    if (event.button !== 0) return null;
    s.editor.playback.speed = 0;
    // A text caret session owns presses first: inside the edited text it
    // moves the caret or drags a selection, outside it commits and the
    // press continues as a normal selection gesture.
    if (s.textEdit?.active) {
      const textGesture = s.textEdit.press(event, start);
      if (textGesture) return textGesture;
    }
    const control = controls.beginHandle(s, start, point);
    if (control) return control;
    const frame = s.localFrame();
    let hit = s.tool === "pen" || s.treeSelection.size === 1 ? api.hit(start) : null;
    if (s.pathInput && hit?.kind !== "anchor" && hit?.kind !== "handle" &&
        (s.tool === "select" || !hit)) {
      const candidates = pathCandidates(start);
      const activated = s.pathInput.activateAt(start, candidates, s.sharedPathHost, frame);
      if (activated) {
        hit = api.hit(start);
        if (s.tool === "pen" && api.penCursor(hit).state !== "endpoint-continue") return null;
      }
    }
    const item = s.active(), locked = s.pathLocked?.(item?.id);
    if (s.pathInput && event.altKey && hit?.kind === "anchor") {
      toggleAnchorMode(item, hit.index);
      return null;
    }
    if (s.tool === "pen" && hit?.kind !== "handle" && (!locked || !hit))
      return pen(event, start, hit);
    const box = gestures && !event.shiftKey ? api.pointBox() : null;
    const pointHandle = box && api.pointBoxHandle(start, box);
    if (pointHandle && (!hit || hit.kind === "segment")) {
      const mode = pointHandle.rotate ? "rotate" : "scale";
      const { point: handle } = pointHandle;
      return managedPress(event, start, { pathId: item.id, transform: { mode, pivot: box.pivot, handle, origin: handle } });
    }
    const boxHandle = s.tool === "select" ? xf.handleAt(s, start) : null;
    if (boxHandle) return xf.boxGesture(s, boxHandle, start, point);
    const movesExtraHandles = hit?.kind === "anchor" && !event.shiftKey &&
      s.selection.has(selectionKey(item.vertexIds[hit.index])) &&
      [...s.selection].some(key => selectionPart(key).side);
    if (gestures && s.tool === "select" &&
        (hit?.kind === "segment" || hit?.kind === "anchor" && !movesExtraHandles)) {
      return managedPress(event, start, { target: hit, transform: { mode: "move", origin: hit.point } });
    }
    if (box && !hit && start.every((v, i) => v >= box.min[i] && v <= box.max[i]))
      return managedPress(event, start, { pathId: item.id, transform: { mode: "move" } });
    if (hit?.kind === "segment" && locked) return null;
    if (s.tool === "select" && hit?.kind === "segment") {
      const origin = s.pathPoints(), startLocal = api.local(start);
      if (!startLocal) return null;
      return { frame, target: item.id, move(e) {
        return api.scoped(() => {
        if (Math.hypot(...g.sub(point(e),start)) < 2 && !s.gesture.active) return;
        const p = api.local(point(e)); if (!p) return;
        transaction(() => {
          s.setPoints(controls.bend(origin,hit.index,hit.t,g.sub(p,startLocal),Number(item.properties.closed.get()) === 1));
          const next = (hit.index + 1) % item.vertexIds.length;
          for (const index of [hit.index,next]) item.vertexModes[item.vertexIds[index]] = "independent";
        });
      }); }, end() { s.gesture.finish(); }, cancel() { s.gesture.finish(true); } };
    }
    if (hit && ["anchor", "handle"].includes(hit.kind)) {
      const id = item.vertexIds[hit.index],
        key = selectionKey(id, hit.kind === "handle" ? hit.side : null);
      if (event.shiftKey) {
        if (s.selection.has(key)) {
          s.selection.delete(key);
          s.refresh();
          return null;
        }
        s.selection.add(key);
      } else if (!s.selection.has(key)) s.selection = new Set([key]);
      s.refresh();
      if (locked) return null;
      const origin = s.pathPoints(),
        startLocal = api.local(start),
        selection = new Set(s.selection),
        originalModes = { ...item.vertexModes };
      if (!startLocal) return null;
      let broken = null;
      return {
        frame,
        target: item.id,
        move(e) {
        return api.scoped(() => {
          if (Math.hypot(...g.sub(point(e), start)) < 2 && !s.gesture.active)
            return;
          const p = api.local(point(e));
          if (!p) return;
          transaction(() => {
            let delta = g.sub(p, startLocal);
            if (e.shiftKey) delta = g.constrain(delta);
            const points = g.vertices(g.values(origin));
            if (hit.kind === "anchor") {
              const target = g.add(origin[hit.index].point, delta),
                snapped = api.snap(
                  target,
                  [...selection].map((key) => selectionPart(key).id),
                );
              delta = g.sub(snapped, origin[hit.index].point);
              if (e.shiftKey) delta = g.constrain(delta);
              for (let i = 0; i < points.length; i++)
                if (selection.has(selectionKey(item.vertexIds[i])))
                  points[i].point = g.add(origin[i].point, delta);
              // Individually selected handles move with the same delta unless
              // their anchor is already moving, in which case relative handles stay.
              for (let i = 0; i < points.length; i++)
                if (!selection.has(selectionKey(item.vertexIds[i])))
                  for (const side of ["in", "out"])
                    if (selection.has(selectionKey(item.vertexIds[i], side)))
                      points[i] = g.handle(
                        points[i],
                        side,
                        g.add(origin[i][side], delta),
                        originalModes[item.vertexIds[i]] || "corner",
                      );
            } else {
              const mode = e.altKey
                ? "independent"
                : originalModes[id] || "independent";
              const opposite = hit.side === "in" ? "out" : "in";
              if (e.altKey) {
                broken = broken || s.pathPoints()[hit.index][opposite].slice();
                points[hit.index][opposite] = broken.slice();
              } else broken = null;
              let vector = g.add(origin[hit.index][hit.side], delta);
              if (e.shiftKey) vector = g.constrain(vector);
              points[hit.index] = g.handle(
                points[hit.index],
                hit.side,
                vector,
                mode,
              );
              s.setPoints(points);
              item.vertexModes[id] = mode;
              return;
            }
            s.setPoints(points);
          });
        });
        },
        end() {
          s.gesture.finish();
          s.refresh(true);
        },
        cancel() {
          s.gesture.finish(true);
          s.refresh(true);
        },
      };
    }
    // A drawn shape: select it (AE-style depth, see editor-pick.js) and drag
    // the whole selection. Shift toggles the clicked item in the selection.
    const editing = item?.kind === "path" && s.treeSelection.size === 1;
    const entry = api.itemAt(start);
    if (entry && !(s.pathInput && editing && entry.item.kind === "path")) {
      const target = pickTarget(s.layer.contents, entry.item.id, s.treeSelection);
      if (event.shiftKey) {
        if (s.treeSelection.has(target)) {
          s.treeSelection.delete(target);
          s.activeId = [...s.treeSelection].at(-1) || null;
          s.selection.clear();
          s.refresh();
          return null;
        }
        s.treeSelection.add(target);
        s.activeId = target;
        s.selection.clear();
        s.refresh();
      } else if (!s.treeSelection.has(target)) s.selectItem(target);
      return movableGesture(start, point);
    }
    // Empty space inside the selected box still drags the selection.
    if (!event.shiftKey && insideSelection(start)) return movableGesture(start, point);
    // Empty space: a marquee. With a path open for editing it selects
    // anchors; otherwise it selects whole top-level items.
    if (editing && gestures) return managedPress(event, start, { target: null, pathId: item.id });
    const beforeAnchors = new Set(s.selection),
      beforeItems = event.shiftKey ? new Set(s.treeSelection) : new Set(),
      pathEntry = editing ? api.active() : null;
    const marquee = startMarquee(beforeAnchors);
    if (!event.shiftKey) {
      s.selection.clear();
      if (!editing) {
        s.treeSelection.clear();
        s.activeId = null;
      }
      s.refresh();
    }
    s.marquee = { start, end: start };
    s.dirty = true;
    return {
      frame,
      target: s.activeId,
      move(e) {
      return api.scoped(() => {
        const end = point(e);
        s.marquee = { start, end };
        const lo = [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
          hi = [Math.max(start[0], end[0]), Math.max(start[1], end[1])];
        if (pathEntry) {
          const picked = pointsInRect(api.cssPoints(pathEntry).map((v, i) => ({
            point: v.point, key: selectionKey(pathEntry.item.vertexIds[i]),
          })), s.marquee);
          s.selection = applyMarquee(marquee, picked, event.shiftKey);
          s.syncPathSelection?.();
        } else if (Math.hypot(...g.sub(end, start)) >= 3) {
          const picked = new Set(beforeItems);
          for (const top of s.layer.contents) {
            const points = api.outlines(top.id).flatMap((leaf) => api.cssPoints(leaf).map((v) => v.point));
            if (!points.length) continue;
            const min = [Math.min(...points.map((v) => v[0])), Math.min(...points.map((v) => v[1]))],
              max = [Math.max(...points.map((v) => v[0])), Math.max(...points.map((v) => v[1]))];
            if (min[0] <= hi[0] && max[0] >= lo[0] && min[1] <= hi[1] && max[1] >= lo[1]) picked.add(top.id);
          }
          s.treeSelection = picked;
          s.activeId = [...picked].at(-1) || null;
          s.refresh();
        }
        s.dirty = true;
      });
      },
      end() {
        s.marquee = null;
        s.refresh();
      },
      cancel() {
        s.marquee = null;
        s.selection = beforeAnchors;
        s.refresh();
      },
    };
  }
  // One press shares a single scene snapshot across its hit, active, local
  // and outline reads. The returned gesture runs on later events, after this
  // scope has closed; each of its moves opens its own scope.
  function begin(event) {
    const gesture = api.scoped(() => beginInner(event));
    const controller = s.pathController;
    if (!gesture || !controller || gesture.managed) return gesture;
    controller.beginGesture({ kind: "pointer", pathId: gesture.target });
    return {
      ...gesture,
      move(e) {
        s.pointerPoint = point(e);
        s.pathInput?.trackPointer(s.pointerPoint);
        if (gesture.target && s.pathLocked?.(gesture.target) && !s.marquee) {
          pointer.commit();
          return;
        }
        gesture.move?.(e);
      },
      end(e) {
        s.snapGuide = null;
        if (!controller.disposed) controller.endGesture();
        gesture.end?.(e);
      },
      cancel(e) {
        s.snapGuide = null;
        if (!controller.disposed) controller.endGesture(true);
        gesture.cancel?.(e);
      },
    };
  }
  // Locked paths never move; when nothing movable is selected, no gesture starts.
  function movableGesture(start, point) {
    const ids = [...s.treeSelection].filter(id => !s.pathLocked?.(id));
    return ids.length ? xf.moveGesture(s, start, point, ids) : null;
  }
  function insideSelection(p) {
    const b = xf.selectedBox(s);
    if (!b || b.kind === "path") return false;
    const local = g.inverse(b.screen);
    if (!local) return false;
    const q = transform(p, local);
    return q[0] >= b.min[0] && q[0] <= b.max[0] && q[1] >= b.min[1] && q[1] <= b.max[1];
  }
  const pointer = createPointerMachine(
    canvas,
    begin,
    canvas.ownerDocument.defaultView,
    (error) => {
      s.gesture.finish(true);
      s.message(error.message);
    },
  );
  // Double-click: on an anchor toggles Corner/Smooth; on a shape it enters
  // the group and selects the drawn leaf (path anchors appear); on empty
  // space it steps out to the containing group.
  const double = (event) => {
    return api.scoped(() => {
    // The second press of a quick re-grab is a drag, not a double-click.
    if (s.tool !== "select" || !s.valid() || pointer.lastMoved) return;
    const p = point(event),
      item = s.active(),
      hit = s.treeSelection.size === 1 ? api.hit(p) : null;
    event.preventDefault();
    if (hit?.kind === "anchor") {
      toggleAnchorMode(item, hit.index);
      return;
    }
    if (pathCandidates(p).length) return;
    const entry = api.itemAt(p);
    if (entry) {
      if (entry.item.kind === "text") {
        if (s.textEdit?.activeOn?.(entry.item.id)) s.textEdit.selectWord(p);
        else s.editText(entry.item, p);
        return;
      }
      if (s.activeId !== entry.item.id || s.treeSelection.size !== 1) s.selectItem(entry.item.id);
      return;
    }
    const parent = s.activeId && parentOf(s.layer.contents, s.activeId);
    if (parent) s.selectItem(parent);
    else s.clearSelection?.();
    });
  };
  // Hover feedback: outline what a click would select and show the cursor
  // for the handle, anchor or shape under the pointer.
  function updateHover(p) {
    const navigation = navigationCursor();
    if (navigation) { canvas.style.cursor = navigation.css; return; }
    const target = api.hoverTarget(p);
    const controller = s.pathController;
    if (controller && !controller.disposed) controller.setHover(target);
    let cursor = api.cursorFor(target).css, id = null;
    if (s.tool !== "pen") {
      const box = api.pointBox();
      const handle = api.pointBoxHandle(p, box) || xf.handleAt(s, p);
      if (handle) cursor = xf.cursorFor(handle);
      else if (s.treeSelection.size === 1 && api.hit(p)) cursor = "pointer";
      else {
        const entry = api.itemAt(p);
        if (entry) {
          id = pickTarget(s.layer.contents, entry.item.id, s.treeSelection);
          cursor = "move";
        } else if (insideSelection(p) || box && p.every((v, i) => v >= box.min[i] && v <= box.max[i])) cursor = "move";
      }
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    if (s.hover !== id) { s.hover = id; s.dirty = true; }
  }
  const hover = (event) => api.scoped(() => {
    if (pointer.active || !s.valid()) return;
    const p = point(event);
    s.pathInput?.trackPointer(p);
    s.pointerPoint = p;
    updateHover(p);
  });
  function wheel(event) {
    if (!gestures || !s.valid() || !api.projection() || !Number.isFinite(event.deltaY)) return;
    if (gestures.active?.kind === "pan") { event.preventDefault(); event.stopPropagation(); return; }
    pointer.commit();
    s.finishNudge?.();
    event.preventDefault();
    event.stopPropagation();
    s.pointerPoint = point(event);
    gestures.wheel(s.pointerPoint, event.deltaY, event);
    updateCursor();
  }
  const leave = () => {
    s.pathInput?.notifyExternalSelection();
    s.pointerPoint = null;
    if (!s.pathController?.disposed) s.pathController?.clearHover();
    if (s.hover !== null) {
      s.hover = null;
      s.dirty = true;
    }
  };
  canvas.addEventListener("pointermove", hover);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("dblclick", double);
  canvas.addEventListener("wheel", wheel, { passive: false });
  return {
    get active() {
      return pointer.active;
    },
    cancel: () => pointer.cancel(),
    navigationCursor,
    setSpaceHeld(held) {
      if (!gestures) return false;
      if (gestures.spaceHeld === held && (held || gestures.active?.kind !== "pan")) return true;
      if (!held && gestures.active?.kind === "pan") pointer.commit();
      else if (held && pointer.active && gestures.active?.kind !== "pan") pointer.commit();
      gestures.setSpaceHeld(held);
      updateCursor();
      return true;
    },
    contextTarget(p) { return api.scoped(() => gestures?.requestContextMenu(p)); },
    commit: () => pointer.commit(),
    dispose() {
      pointer.dispose();
      canvas.removeEventListener("dblclick", double);
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("pointermove", hover);
      canvas.removeEventListener("pointerleave", leave);
    },
  };
}
module.exports = { createPointer };
