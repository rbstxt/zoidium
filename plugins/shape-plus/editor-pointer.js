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
  // Click topology edits retain the same capture/rollback boundary as drags.
  // Commit at pointerup, so Escape or lost capture can undo a close or split.
  function clickEdit(work) {
    if (!s.gesture.begin()) return null;
    const finished = s.penFinished;
    try { work(); s.refresh(true); }
    catch (error) { s.gesture.finish(true); s.message(error.message); return null; }
    return {
      frame: s.localFrame(), target: s.activeId,
      end() { s.gesture.finish(); s.refresh(true); },
      cancel() {
        s.penFinished = finished; s.gesture.finish(true);
        s.selection.clear(); s.refresh(true);
      },
    };
  }
  function pen(event, start) {
    const hit = api.hit(start), item = s.active();
    if (hit?.kind === "anchor") return clickEdit(() => {
      if (hit.index === 0 && item.vertexIds.length > 1 && !item.properties.closed.get()) {
        channels(clone(item));
        item.properties.closed.set(1);
        s.penFinished = true;
        s.preview();
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
    try {
      let local;
      if (
        item?.kind === "path" &&
        !item.properties.closed.get() &&
        !s.penFinished
      ) {
        local = api.local(start);
        if (!local) {
          s.gesture.finish(true);
          return null;
        }
        local = api.snap(local);
        if (event.shiftKey)
          local = g.add(
            s.pathPoints().at(-1).point,
            g.constrain(g.sub(local, s.pathPoints().at(-1).point)),
          );
        s.topology({ kind: "append", id: s.nextId(), point: local });
      } else {
        local = api.local(start, { matrix: s.insertionMatrix() });
        if (!local) {
          s.gesture.finish(true);
          return null;
        }
        s.addItem("path", local);
        const snapped = api.snap(local, s.active().vertexIds);
        s.setPoints([{ point: snapped, in: [0, 0], out: [0, 0] }]);
        s.penFinished = false;
      }
      const path = s.active(),
        index = path.vertexIds.length - 1,
        id = path.vertexIds[index];
      s.selection = new Set([selectionKey(id)]);
      s.refresh(true);
      const origin = s.pathPoints(),
        frame = s.localFrame();
      let broken = null;
      return {
        frame,
        target: path.id,
        move(e) {
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
          path.vertexModes[id] = mode;
          s.setPoints(points);
        },
        end() {
          s.gesture.finish();
          s.refresh(true);
        },
        cancel() {
          s.gesture.finish(true);
          s.selection.clear();
          s.refresh(true);
        },
      };
    } catch (error) {
      s.gesture.finish(true);
      s.message(error.message);
      return null;
    }
  }
  function begin(event) {
    canvas.focus({ preventScroll: true });
    s.closeMenu?.();
    // An arrow-key nudge still holding the history transaction ends first, so
    // this press starts its own transaction instead of joining or losing it.
    s.finishNudge?.();
    if (!s.valid()) return null;
    const start = point(event);
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
    if (s.tool === "pen" && api.hit(start)?.kind !== "handle")
      return pen(event, start);
    const boxHandle = s.tool === "select" ? xf.handleAt(s, start) : null;
    if (boxHandle) return xf.boxGesture(s, boxHandle, start, point);
    const item = s.active(),
      hit = s.treeSelection.size === 1 ? api.hit(start) : null;
    const frame = s.localFrame();
    if (s.tool === "select" && hit?.kind === "segment") {
      const origin = s.pathPoints(), startLocal = api.local(start);
      if (!startLocal) return null;
      return { frame, target: item.id, move(e) {
        if (Math.hypot(...g.sub(point(e),start)) < 2 && !s.gesture.active) return;
        const p = api.local(point(e)); if (!p) return;
        transaction(() => {
          s.setPoints(controls.bend(origin,hit.index,hit.t,g.sub(p,startLocal),!!item.properties.closed.get()));
          const next = (hit.index + 1) % item.vertexIds.length;
          for (const index of [hit.index,next]) item.vertexModes[item.vertexIds[index]] = "independent";
        });
      }, end() { s.gesture.finish(); }, cancel() { s.gesture.finish(true); } };
    }
    if (hit && ["anchor", "handle"].includes(hit.kind)) {
      const id = item.vertexIds[hit.index],
        key = selectionKey(id, hit.kind === "handle" ? hit.side : null);
      if (event.shiftKey) {
        if (s.selection.has(key)) {
          s.selection.delete(key);
          s.dirty = true;
          return null;
        }
        s.selection.add(key);
      } else if (!s.selection.has(key)) s.selection = new Set([key]);
      s.refresh();
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
              item.vertexModes[id] = mode;
            }
            s.setPoints(points);
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
    const entry = api.itemAt(start);
    if (entry) {
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
      return xf.moveGesture(s, start, point, [...s.treeSelection]);
    }
    // Empty space inside the selected box still drags the selection.
    if (!event.shiftKey && insideSelection(start))
      return xf.moveGesture(s, start, point, [...s.treeSelection]);
    // Empty space: a marquee. With a path open for editing it selects
    // anchors; otherwise it selects whole top-level items.
    const editing = item?.kind === "path" && s.treeSelection.size === 1;
    let moved = false;
    const beforeAnchors = event.shiftKey ? new Set(s.selection) : new Set(),
      beforeItems = event.shiftKey ? new Set(s.treeSelection) : new Set(),
      pathEntry = editing ? api.active() : null;
    if (!event.shiftKey) {
      s.selection.clear();
      if (!editing) {
        s.treeSelection.clear();
        s.activeId = null;
        s.refresh();
      }
    }
    s.marquee = { start, end: start };
    s.dirty = true;
    return {
      frame,
      target: s.activeId,
      move(e) {
        const end = point(e);
        s.marquee = { start, end };
        moved = moved || Math.hypot(...g.sub(end, start)) >= 3;
        const lo = [Math.min(start[0], end[0]), Math.min(start[1], end[1])],
          hi = [Math.max(start[0], end[0]), Math.max(start[1], end[1])];
        const inside = (p) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
        if (pathEntry) {
          s.selection = new Set(beforeAnchors);
          api.cssPoints(pathEntry).forEach((v, i) => {
            if (inside(v.point)) s.selection.add(selectionKey(pathEntry.item.vertexIds[i]));
          });
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
      },
      end() {
        s.marquee = null;
        // A plain click on empty space deselects everything, like AE.
        if (editing && !moved && !event.shiftKey) s.clearSelection?.();
        s.refresh();
      },
      cancel() {
        s.marquee = null;
        s.selection = beforeAnchors;
        s.refresh();
      },
    };
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
    // The second press of a quick re-grab is a drag, not a double-click.
    if (s.tool !== "select" || !s.valid() || pointer.lastMoved) return;
    const p = point(event),
      item = s.active(),
      hit = s.treeSelection.size === 1 ? api.hit(p) : null;
    event.preventDefault();
    if (hit?.kind === "anchor") {
      s.selection = new Set([selectionKey(item.vertexIds[hit.index])]);
      s.setMode(
        item.vertexModes[item.vertexIds[hit.index]] === "corner" ||
          !item.vertexModes[item.vertexIds[hit.index]]
          ? "smooth"
          : "corner",
      );
      return;
    }
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
  };
  // Hover feedback: outline what a click would select and show the cursor
  // for the handle, anchor or shape under the pointer.
  const hover = (event) => {
    if (pointer.active || !s.valid()) return;
    const p = point(event);
    let cursor = "default",
      id = null;
    if (s.tool === "pen") cursor = "crosshair";
    else {
      const handle = xf.handleAt(s, p);
      if (handle) cursor = xf.cursorFor(handle);
      else if (s.treeSelection.size === 1 && api.hit(p)) cursor = "pointer";
      else {
        const entry = api.itemAt(p);
        if (entry) {
          id = pickTarget(s.layer.contents, entry.item.id, s.treeSelection);
          cursor = "move";
        } else if (insideSelection(p)) cursor = "move";
      }
    }
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    if (s.hover !== id) {
      s.hover = id;
      s.dirty = true;
    }
  };
  const leave = () => {
    if (s.hover !== null) {
      s.hover = null;
      s.dirty = true;
    }
  };
  canvas.addEventListener("pointermove", hover);
  canvas.addEventListener("pointerleave", leave);
  canvas.addEventListener("dblclick", double);
  return {
    get active() {
      return pointer.active;
    },
    cancel: () => pointer.cancel(),
    commit: () => pointer.commit(),
    dispose() {
      pointer.dispose();
      canvas.removeEventListener("dblclick", double);
      canvas.removeEventListener("pointermove", hover);
      canvas.removeEventListener("pointerleave", leave);
    },
  };
}
module.exports = { createPointer };
