"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { matrix, transform, identity } = require("./compiler.js");
const { primitivePath } = require("./primitives.js");
const controls = require("./editor-controls.js");
const { displayMatrix } = require("./viewport-mapping.js");
const { verticesToCubics } = require("./path.js");
const { find } = require("./editor-tree-data.js");
const { PAINTS, paintScope } = require("./contents-ops.js");
const xf = require("./editor-transform.js");
const ACCENT = "#58a6ff", HOVER = "rgba(88,166,255,.85)";
// Only a group's own transform/enabled properties are read here. Calling
// item.evaluate() on a group would evaluate its whole subtree first, while the
// walk below evaluates every child again. This mirrors the own-property loop
// in model.js evaluate() without the child recursion or text layout.
function ownProperties(item, frame) {
  const properties = {};
  for (const key of Object.keys(item.properties)) {
    const value = item.properties[key].get(frame);
    if (typeof value === "number" && !Number.isFinite(value) || Array.isArray(value) && key !== "stops" && !value.every(Number.isFinite)) throw Error("Shape+ property must be finite");
    properties[key] = Array.isArray(value) ? value.slice() : value;
  }
  return properties;
}
function scene(
  contents,
  frame,
  parent = identity,
  enabled = true,
  result = [],
) {
  for (const item of contents) {
    if (item.kind === "group") {
      const p = ownProperties(item, frame),
        visible = enabled && p.enabled !== 0;
      scene(
        item.contents,
        frame,
        g.multiply(parent, matrix(p)),
        visible,
        result,
      );
      continue;
    }
    const evaluated = item.evaluate(frame),
      p = evaluated.properties,
      visible = enabled && p.enabled !== 0;
    if (item.kind === "text") {
      const layout = evaluated.textLayout;
      const points = layout.glyphs.flatMap(glyph => glyph.paths.flatMap(path => path.vertices.map(v => v.point)));
      const x = points.length ? Math.min(...points.map(p=>p[0])) : p.position[0], y = points.length ? Math.min(...points.map(p=>p[1])) : p.position[1];
      const right = points.length ? Math.max(...points.map(p=>p[0])) : x+200, top = points.length ? Math.max(...points.map(p=>p[1])) : y+100;
      result.push({ item, matrix: parent, enabled: visible, properties: p, path: { closed: true, vertices: [[x,y],[right,y],[right,top],[x,top]].map(point => ({point,in:[0,0],out:[0,0]})) } });
    }
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
  // The topmost drawn leaf under a CSS point. Earlier contents draw on top,
  // so the list is searched in order. Fill interiors (open paths close for
  // fills) and an 8 px band around every outline both count.
  function itemAt(point) {
    for (const e of entries()) {
      if (!e.enabled) continue;
      const points = cssPoints(e);
      if (g.hit(points, e.path.closed, point, 1, false)) return e;
      if (points.length < 3) continue;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      trace(points, true);
      const inside = context.isPointInPath(point[0], point[1]);
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
  // Outlines of every drawn leaf under an item (the item itself for a leaf).
  function outlines(id) {
    const entry = find(s.layer.contents, id);
    if (!entry) return [];
    const inside = new Set([id]);
    (function walk(item) { for (const child of item.contents || []) { inside.add(child.id); walk(child); } })(entry.item);
    return entries().filter((e) => e.enabled && inside.has(e.item.id));
  }
  function strokeOutline(e, color, width = 1, dash = []) {
    trace(cssPoints(e), e.path.closed);
    context.setLineDash(dash);
    context.lineWidth = width + 2;
    context.strokeStyle = "rgba(0,0,0,.55)";
    context.stroke();
    context.lineWidth = width;
    context.strokeStyle = color;
    context.stroke();
    context.setLineDash([]);
  }
  function square(p, fill, size = 4) {
    context.fillStyle = fill;
    context.strokeStyle = "#1b1b1b";
    context.lineWidth = 1;
    context.fillRect(p[0] - size, p[1] - size, size * 2, size * 2);
    context.strokeRect(p[0] - size + 0.5, p[1] - size + 0.5, size * 2 - 1, size * 2 - 1);
  }
  function drawBox(b) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => transform(xf.at(b, x, y), b.screen));
    context.beginPath();
    corners.forEach((p, i) => (i ? context.lineTo(...p) : context.moveTo(...p)));
    context.closePath();
    context.lineWidth = 1;
    context.strokeStyle = ACCENT;
    context.stroke();
    for (const h of xf.handles(b)) {
      if (h.rotate) {
        context.beginPath();
        context.moveTo(...h.from);
        context.lineTo(...h.point);
        context.strokeStyle = ACCENT;
        context.stroke();
        context.beginPath();
        context.arc(...h.point, 4.5, 0, Math.PI * 2);
        context.fillStyle = "#fff";
        context.fill();
        context.strokeStyle = "#1b1b1b";
        context.stroke();
      } else square(h.point, "#fff");
    }
  }
  function drawPath(e) {
    const points = cssPoints(e);
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
        context.strokeStyle = ACCENT;
        context.lineWidth = 1;
        context.moveTo(...v.point);
        context.lineTo(...p);
        context.stroke();
        context.beginPath();
        context.arc(...p, 3.5, 0, Math.PI * 2);
        context.fillStyle = s.selection.has(selectionKey(id, side)) ? ACCENT : "#fff";
        context.fill();
        context.strokeStyle = "#1b1b1b";
        context.stroke();
      }
      square(v.point, s.selection.has(selectionKey(id)) ? ACCENT : "#fff", 4);
    });
  }
  function draw() {
    if (!resize() || !view.width) return;
    const dpr = canvas.width / view.width;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    const selected = [...s.treeSelection];
    if (s.hover && !s.treeSelection.has(s.hover) && !s.pointer?.active)
      for (const e of outlines(s.hover)) strokeOutline(e, HOVER);
    let scope = null;
    for (const id of selected) {
      const item = s.find(id);
      if (!item) continue;
      if (PAINTS.includes(item.kind)) {
        // A selected fill/stroke shows exactly which paths it draws.
        scope = scope || paintScope(JSON.parse(JSON.stringify(s.layer.contents)));
        const targets = new Set(scope.get(id)?.targets || []);
        for (const e of entries()) if (targets.has(e.item.id)) strokeOutline(e, ACCENT, 1, [5, 4]);
        continue;
      }
      for (const e of outlines(id)) strokeOutline(e, ACCENT);
      if (item.kind === "path" && id === s.activeId && selected.length === 1) {
        const e = active();
        if (e?.enabled) drawPath(e);
      }
    }
    if (selected.length === 1 && !(s.tool === "pen" && !s.penFinished)) {
      const b = xf.selectedBox(s);
      if (b && b.kind !== "path") drawBox(b);
    }
    // Pen in progress on a path that is not the selection's leaf.
    if (s.tool === "pen" && !s.penFinished && s.active()?.kind === "path" && selected.length !== 1) {
      const e = active();
      if (e?.enabled) drawPath(e);
    }
    controls.draw(s, context, ACCENT);
    if (s.marquee) {
      const { start, end } = s.marquee;
      context.fillStyle = "rgba(88,166,255,.12)";
      context.strokeStyle = ACCENT;
      context.lineWidth = 1;
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
    itemAt,
    snap,
    outlines,
    projection: () => projection,
    dispose: () => observer.disconnect(),
  };
}
module.exports = { scene, createCanvas };
