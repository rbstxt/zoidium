"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { matrix, transform, identity } = require("./compiler.js");
const { primitivePath } = require("./primitives.js");
const controls = require("./editor-controls.js");
const { displayMatrix } = require("./viewport-mapping.js");
const { verticesToCubics } = require("./path.js");
function scene(
  contents,
  frame,
  parent = identity,
  enabled = true,
  result = [],
) {
  for (const item of contents) {
    const p = item.evaluate(frame).properties,
      visible = enabled && p.enabled !== 0;
    if (item.kind === "group")
      scene(
        item.contents,
        frame,
        g.multiply(parent, matrix(p)),
        visible,
        result,
      );
    else if (["path", "rectangle", "ellipse", "polystar"].includes(item.kind))
      result.push({
        item,
        matrix: parent,
        enabled: visible,
        path: primitivePath({
          id: item.id,
          kind: item.kind,
          vertexIds: item.vertexIds,
          properties: p,
        }),
        properties: p,
      });
  }
  return result;
}
function createCanvas(s, canvas) {
  const context = canvas.getContext("2d"),
    view = { width: 1, height: 1 };
  let projection = null;
  function entries() {
    return scene(s.layer.contents, s.localFrame());
  }
  function active() {
    return entries().find((e) => e.item.id === s.activeId);
  }
  function screen(point, m = identity) {
    return transform(point, g.multiply(projection || identity, m));
  }
  function local(point, entry = active()) {
    if (!projection) return null;
    const inv = g.inverse(g.multiply(projection, entry?.matrix || identity));
    return inv ? transform(point, inv) : null;
  }
  function cssPoints(entry) {
    return entry.path.vertices.map((v) => ({
      point: screen(v.point, entry.matrix),
      in: g.sub(
        screen(g.add(v.point, v.in), entry.matrix),
        screen(v.point, entry.matrix),
      ),
      out: g.sub(
        screen(g.add(v.point, v.out), entry.matrix),
        screen(v.point, entry.matrix),
      ),
    }));
  }
  function hit(point) {
    const entry = active();
    return entry?.enabled && entry.item.kind === "path"
      ? g.hit(
          cssPoints(entry),
          entry.path.closed,
          point,
          1,
          true,
          s.tool === "pen" && !s.penFinished,
        )
      : null;
  }
  function primitiveHandles(entry = active()) {
    if (!entry || entry.item.kind === "path") return [];
    const p = entry.properties,
      half = p.size
        ? p.size.map((v) => Math.abs(v) / 2)
        : [p.outerRadius, p.outerRadius];
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map((sign) => ({
      sign,
      point: g.add(
        p.position,
        g.mul([half[0] * sign[0], half[1] * sign[1]], 1),
      ),
    }));
  }
  function sizeHit(point) {
    const entry = active();
    if (!entry?.enabled) return null;
    return (
      primitiveHandles(entry).find(
        (h) => Math.hypot(...g.sub(screen(h.point, entry.matrix), point)) <= 8,
      ) || null
    );
  }
  function itemAt(point) {
    const selected = active();
    if (selected?.enabled && selected.item.kind !== "path") {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      trace(cssPoints(selected), selected.path.closed);
      const inside = context.isPointInPath(point[0], point[1]);
      context.restore();
      if (inside) return selected;
    }
    const list = entries()
      .filter((e) => e.enabled)
      .reverse();
    for (const e of list) {
      const points = cssPoints(e);
      if (g.hit(points, e.path.closed, point, 1, false)) return e;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      trace(points, e.path.closed);
      const inside = e.path.closed && context.isPointInPath(point[0], point[1]);
      context.restore();
      if (inside) return e;
    }
    return null;
  }
  function trace(points, closed) {
    context.beginPath();
    if (!points.length) return;
    context.moveTo(...points[0].point);
    for (const c of verticesToCubics(points, closed))
      context.bezierCurveTo(...c[1], ...c[2], ...c[3]);
    if (closed) context.closePath();
  }
  function resize() {
    const rect = s.viewport.canvas.getBoundingClientRect();
    const parent = s.viewport.el.getBoundingClientRect();
    const dpr = canvas.ownerDocument.defaultView.devicePixelRatio || 1;
    Object.assign(canvas.style, {
      left: rect.left - parent.left - s.viewport.el.clientLeft + "px", top: rect.top - parent.top - s.viewport.el.clientTop + "px",
      width: rect.width + "px", height: rect.height + "px",
    });
    view.width = rect.width; view.height = rect.height;
    const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const p = s.layer.properties;
    projection = displayMatrix(rect, s.editor.sequence.properties.resolution.get(), {
      position: p.position.get(s.localFrame()), scale: p.scale.get(s.localFrame()), rotation: p.rotation.get(s.localFrame()),
    });
    return !!projection;
  }
  function draw() {
    if (!resize() || !view.width) return;
    const dpr = canvas.width / view.width;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    const accent = "#ccc", entry = active();
    context.strokeStyle = accent;
    context.lineWidth = 1;
    for (const e of entries()) {
      if (!e.enabled) continue;
      const selected = s.treeSelection.has(e.item.id);
      if (!selected && e !== entry && e.item.id !== s.activeId) continue;
      const points = cssPoints(e);
      trace(points, e.path.closed);
      context.strokeStyle = accent;
      context.strokeStyle = "#666";
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = accent;
      context.lineWidth = 1;
      context.stroke();
      if (e.item.kind !== "path") {
        for (const h of primitiveHandles(e)) {
          const p = screen(h.point, e.matrix);
          context.strokeStyle = "#555";
          context.fillStyle = "#ccc";
          context.fillRect(p[0] - 5, p[1] - 5, 10, 10);
          context.strokeRect(p[0] - 5, p[1] - 5, 10, 10);
        }
        continue;
      }
      points.forEach((v, i) => {
        const id = e.item.vertexIds[i];
        for (const side of ["in", "out"]) {
          if (
            !e.path.closed &&
            (s.tool !== "pen" || s.penFinished) &&
            ((side === "in" && i === 0) ||
              (side === "out" && i === points.length - 1))
          )
            continue;
          if (Math.hypot(...v[side]) < 1e-8) continue;
          const p = g.add(v.point, v[side]);
          context.beginPath();
          context.strokeStyle = accent;
          context.moveTo(...v.point);
          context.lineTo(...p);
          context.stroke();
          context.beginPath();
          context.arc(...p, 4, 0, Math.PI * 2);
          context.fillStyle = s.selection.has(selectionKey(id, side))
            ? "#555"
            : "#ccc";
          context.fill();
          context.strokeStyle = "#555";
          context.stroke();
        }
        context.fillStyle = s.selection.has(selectionKey(id))
          ? "#555"
          : "#ccc";
        context.strokeStyle = "#555";
        context.fillRect(v.point[0] - 5, v.point[1] - 5, 10, 10);
        context.strokeRect(v.point[0] - 5, v.point[1] - 5, 10, 10);
      });
    }
    controls.draw(s, context, accent);
    if (s.marquee) {
      const { start, end } = s.marquee;
      context.fillStyle = "rgba(204,204,204,.12)";
      context.strokeStyle = accent;
      context.fillRect(...start, end[0] - start[0], end[1] - start[1]);
      context.strokeRect(...start, end[0] - start[0], end[1] - start[1]);
    }
  }
  function snap(point, exclude = []) {
    if (!s.snap) return point;
    const entry = active(),
      world = screen(point, entry?.matrix),
      excluded = new Set(exclude);
    let closest = null,
      distance = 8;
    for (const other of entries().filter((e) => e.enabled))
      other.path.vertices.forEach((v, i) => {
        if (
          other.item.id === s.activeId &&
          excluded.has(other.item.vertexIds[i])
        )
          return;
        const p = screen(v.point, other.matrix),
          d = Math.hypot(...g.sub(world, p));
        if (d < distance) {
          closest = p;
          distance = d;
        }
      });
    if (closest) return local(closest, entry);
    return point;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  return {
    view,
    draw,
    resize,
    entries,
    active,
    activeMatrix: () => [...(projection || []), ...(active()?.matrix || controls.handles(s)[0]?.matrix || [])],
    screen,
    local,
    cssPoints,
    hit,
    sizeHit,
    itemAt,
    snap,
    primitiveHandles,
    dispose: () => observer.disconnect(),
  };
}
module.exports = { scene, createCanvas };
