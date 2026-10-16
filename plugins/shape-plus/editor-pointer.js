"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { createPointerMachine } = require("./editor-pointer-machine.js");
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
  function pen(event, start) {
    const hit = api.hit(start),
      item = s.active();
    if (hit?.kind === "anchor") {
      if (
        hit.index === 0 &&
        item.vertexIds.length > 1 &&
        !item.properties.closed.get()
      ) {
        s.closePath();
        s.penFinished = true;
      } else {
        s.selection = new Set([selectionKey(item.vertexIds[hit.index])]);
        s.deleteAnchors();
      }
      return null;
    }
    if (hit?.kind === "segment") {
      const id = s.nextId();
      s.mutate(() =>
        s.topology({
          kind: "insert",
          index: hit.index,
          t: Math.max(0.000001, Math.min(0.999999, hit.t)),
          id,
        }),
      );
      s.selection = new Set([selectionKey(id)]);
      s.refresh(true);
      return null;
    }
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
    if (!s.valid()) return null;
    const start = point(event);
    if (event.button === 1 || s.space || s.tool === "hand") {
      const origin = [api.view.x, api.view.y];
      return {
        move(e) {
          const delta = g.sub(point(e), start);
          api.view.x = origin[0] + delta[0];
          api.view.y = origin[1] + delta[1];
          s.dirty = true;
        },
        end() {},
        cancel() {
          api.view.x = origin[0];
          api.view.y = origin[1];
          s.dirty = true;
        },
      };
    }
    s.editor.playback.speed = 0;
    if (s.tool === "pen" && api.hit(start)?.kind !== "handle")
      return pen(event, start);
    let hit = api.hit(start),
      item = s.active(),
      size = api.sizeHit(start);
    if (!hit && !size) {
      const entry = api.itemAt(start);
      if (entry) {
        if (entry.item.id !== s.activeId) {
          s.selectItem(entry.item.id, false);
          item = s.active();
          hit = api.hit(start);
          size = api.sizeHit(start);
        }
      } else item = null;
    }
    const frame = s.localFrame();
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
    if (
      item &&
      item.kind !== "path" &&
      (size || api.itemAt(start)?.item.id === item.id)
    ) {
      const local = api.local(start);
      if (!local) return null;
      const position = item.properties.position.get(frame).slice(),
        initialSize = item.properties.size?.get(frame).slice(),
        radius = item.properties.outerRadius?.get(frame),
        inner = item.properties.innerRadius?.get(frame);
      return {
        frame,
        target: item.id,
        move(e) {
          if (Math.hypot(...g.sub(point(e), start)) < 2 && !s.gesture.active)
            return;
          const p = api.local(point(e));
          if (!p) return;
          transaction(() => {
            if (size) {
              const delta = g.sub(p, position);
              if (initialSize) {
                let next = delta.map((v) => Math.max(0.01, Math.abs(v) * 2));
                if (e.shiftKey) next = [Math.max(...next), Math.max(...next)];
                s.setValue(item.properties.size, next, frame);
              } else {
                const next = Math.max(0.01, Math.hypot(...delta) / Math.SQRT2);
                s.setValue(item.properties.outerRadius, next, frame);
                if (radius > 0)
                  s.setValue(
                    item.properties.innerRadius,
                    (inner * next) / radius,
                    frame,
                  );
              }
            } else {
              let delta = g.sub(p, local);
              if (e.shiftKey) delta = g.constrain(delta);
              s.setValue(
                item.properties.position,
                api.snap(g.add(position, delta)),
                frame,
              );
            }
          });
        },
        end() {
          s.gesture.finish();
        },
        cancel() {
          s.gesture.finish(true);
        },
      };
    }
    // Empty canvas and unselected path interiors start a marquee. Shift adds
    // to the existing anchor/handle selection without a history operation.
    const before = event.shiftKey ? new Set(s.selection) : new Set(),
      entry = api.active();
    if (!event.shiftKey) s.selection.clear();
    s.marquee = { start, end: start };
    s.dirty = true;
    return {
      frame,
      target: s.activeId,
      move(e) {
        const end = point(e);
        s.marquee = { start, end };
        s.selection = new Set(before);
        const inside = (p) =>
          p[0] >= Math.min(start[0], end[0]) &&
          p[0] <= Math.max(start[0], end[0]) &&
          p[1] >= Math.min(start[1], end[1]) &&
          p[1] <= Math.max(start[1], end[1]);
        if (entry?.item.kind === "path")
          api.cssPoints(entry).forEach((v, i) => {
            if (inside(v.point))
              s.selection.add(selectionKey(entry.item.vertexIds[i]));
          });
        s.dirty = true;
      },
      end() {
        s.marquee = null;
        s.refresh();
      },
      cancel() {
        s.marquee = null;
        s.selection = before;
        s.refresh();
      },
    };
  }
  const pointer = createPointerMachine(
    canvas,
    (event) => {
      const gesture = begin(event);
      if (gesture && gesture.frame !== undefined)
        gesture.matrix = JSON.stringify(api.active()?.matrix);
      return gesture;
    },
    canvas.ownerDocument.defaultView,
    (error) => {
      s.gesture.finish(true);
      s.message(error.message);
    },
  );
  const wheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (pointer.active) return;
    const p = point(event),
      view = api.view,
      old = view.zoom;
    view.zoom = Math.min(
      64,
      Math.max(
        0.005,
        old * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.002)),
      ),
    );
    view.x = p[0] - ((p[0] - view.x) * view.zoom) / old;
    view.y = p[1] - ((p[1] - view.y) * view.zoom) / old;
    s.dirty = true;
  };
  const double = (event) => {
    const hit = api.hit(point(event)),
      item = s.active();
    if (s.tool !== "select" || hit?.kind !== "anchor") return;
    s.selection = new Set([selectionKey(item.vertexIds[hit.index])]);
    s.setMode(
      item.vertexModes[item.vertexIds[hit.index]] === "corner" ||
        !item.vertexModes[item.vertexIds[hit.index]]
        ? "smooth"
        : "corner",
    );
    event.preventDefault();
  };
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("dblclick", double);
  return {
    get active() {
      return pointer.active;
    },
    cancel: () => pointer.cancel(),
    dispose() {
      pointer.dispose();
      canvas.removeEventListener("wheel", wheel);
      canvas.removeEventListener("dblclick", double);
    },
  };
}
module.exports = { createPointer };
