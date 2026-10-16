"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { matrix, transform, identity, compile } = require("./compiler.js");
const { primitivePath } = require("./primitives.js");
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
    else if (!["fill", "stroke"].includes(item.kind))
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
    view = { x: 0, y: 0, zoom: 1, width: 1, height: 1 };
  let first = true;
  function entries() {
    return scene(s.layer.contents, s.localFrame());
  }
  function active() {
    return entries().find((e) => e.item.id === s.activeId);
  }
  function screen(point, m = identity) {
    const p = transform(point, m);
    return [view.x + p[0] * view.zoom, view.y - p[1] * view.zoom];
  }
  function local(point, entry = active()) {
    const inv = g.inverse(entry?.matrix || identity);
    if (!inv) return null;
    return transform(
      [(point[0] - view.x) / view.zoom, (view.y - point[1]) / view.zoom],
      inv,
    );
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
      ? g.hit(cssPoints(entry), entry.path.closed, point, 1)
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
  function fit() {
    const [w, h] = s.layer.properties.resolution.get();
    view.zoom = Math.max(
      0.005,
      Math.min(8, (view.width - 80) / w, (view.height - 80) / h),
    );
    view.x = view.width / 2;
    view.y = view.height / 2;
    s.dirty = true;
  }
  function resize() {
    const r = canvas.getBoundingClientRect(),
      dpr = canvas.ownerDocument.defaultView.devicePixelRatio || 1;
    if (r.width <= 0 || r.height <= 0) return;
    const old = [view.width, view.height];
    view.width = r.width;
    view.height = r.height;
    if (
      canvas.width !== Math.round(r.width * dpr) ||
      canvas.height !== Math.round(r.height * dpr)
    ) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    if (first) {
      first = false;
      fit();
    } else {
      view.x += (view.width - old[0]) / 2;
      view.y += (view.height - old[1]) / 2;
    }
    s.dirty = true;
  }
  function drawCommands(commands, opacity = 1) {
    for (const command of commands) {
      if (command.kind === "isolation") {
        drawCommands(command.commands, opacity * command.opacity);
        continue;
      }
      context.globalAlpha = opacity * command.opacity;
      context.fillStyle = `rgb(${command.color.map((v) => Math.round(v * 255)).join(",")})`;
      context.beginPath();
      const p = command.positions;
      for (let i = 0; i < p.length; i += 9) {
        context.moveTo(p[i], p[i + 1]);
        context.lineTo(p[i + 3], p[i + 4]);
        context.lineTo(p[i + 6], p[i + 7]);
        context.closePath();
      }
      context.fill();
    }
  }
  function draw() {
    const dpr = canvas.width / view.width,
      theme = getComputedStyle(canvas),
      color = (key) => theme.getPropertyValue(key).trim();
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    context.fillStyle = color("--zui-bg-sunken");
    context.fillRect(0, 0, view.width, view.height);
    const [w, h] = s.layer.properties.resolution.get(),
      top = screen([-w / 2, h / 2]);
    context.fillStyle = color("--zui-bg-title");
    context.fillRect(...top, w * view.zoom, h * view.zoom);
    if (s.grid) {
      let spacing = s.spacing;
      while (spacing * view.zoom < 12) spacing *= 2;
      context.strokeStyle = color("--zui-border-soft");
      context.lineWidth = 1;
      context.beginPath();
      for (
        let x =
          ((view.x % (spacing * view.zoom)) + spacing * view.zoom) %
          (spacing * view.zoom);
        x < view.width;
        x += spacing * view.zoom
      ) {
        context.moveTo(x, 0);
        context.lineTo(x, view.height);
      }
      for (
        let y =
          ((view.y % (spacing * view.zoom)) + spacing * view.zoom) %
          (spacing * view.zoom);
        y < view.height;
        y += spacing * view.zoom
      ) {
        context.moveTo(0, y);
        context.lineTo(view.width, y);
      }
      context.stroke();
    }
    context.save();
    context.translate(view.x, view.y);
    context.scale(view.zoom, -view.zoom);
    try {
      drawCommands(
        compile(
          Array.from(s.layer.contents, (n) => n.evaluate(s.localFrame())),
          0.6 / view.zoom,
        ).commands,
      );
    } catch (error) {
      s.message(error.message);
    }
    context.restore();
    context.globalAlpha = 1;
    context.strokeStyle = color("--zui-text-faint");
    context.lineWidth = 1;
    context.strokeRect(...top, w * view.zoom, h * view.zoom);
    context.fillStyle = color("--zui-text-muted");
    context.font = "12px " + theme.fontFamily;
    context.fillText(w + " × " + h, top[0] + 6, top[1] - 8);
    const accent = color("--zui-accent-strong"),
      entry = active();
    for (const e of entries()) {
      if (!e.enabled) continue;
      const selected = s.treeSelection.has(e.item.id);
      if (!selected && e !== entry && e.item.id !== s.activeId) continue;
      const points = cssPoints(e);
      trace(points, e.path.closed);
      context.strokeStyle = accent;
      context.lineWidth = 1.25;
      context.stroke();
      if (e.item.kind !== "path") {
        for (const h of primitiveHandles(e)) {
          const p = screen(h.point, e.matrix);
          context.fillStyle = color("--zui-bg-input");
          context.fillRect(p[0] - 4, p[1] - 4, 8, 8);
          context.strokeRect(p[0] - 4, p[1] - 4, 8, 8);
        }
        continue;
      }
      points.forEach((v, i) => {
        const id = e.item.vertexIds[i];
        for (const side of ["in", "out"]) {
          if (
            !e.path.closed &&
            ((side === "in" && i === 0) ||
              (side === "out" && i === points.length - 1))
          )
            continue;
          if (Math.hypot(...v[side]) < 1e-8) continue;
          const p = g.add(v.point, v[side]);
          context.beginPath();
          context.moveTo(...v.point);
          context.lineTo(...p);
          context.stroke();
          context.beginPath();
          context.arc(...p, 3.5, 0, Math.PI * 2);
          context.fillStyle = s.selection.has(selectionKey(id, side))
            ? accent
            : color("--zui-bg-input");
          context.fill();
          context.stroke();
        }
        context.fillStyle = s.selection.has(selectionKey(id))
          ? accent
          : color("--zui-bg-input");
        context.fillRect(v.point[0] - 4, v.point[1] - 4, 8, 8);
        context.strokeRect(v.point[0] - 4, v.point[1] - 4, 8, 8);
      });
    }
    if (s.marquee) {
      const { start, end } = s.marquee;
      context.fillStyle = "rgb(" + color("--zui-accent-rgb") + " / .12)";
      context.strokeStyle = accent;
      context.fillRect(...start, end[0] - start[0], end[1] - start[1]);
      context.strokeRect(...start, end[0] - start[0], end[1] - start[1]);
    }
    s.zoomLabel.textContent = Math.round(view.zoom * 100) + "%";
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
    const result = point.slice();
    for (let axis = 0; axis < 2; axis++) {
      const candidate = point.slice();
      candidate[axis] = Math.round(point[axis] / s.spacing) * s.spacing;
      if (Math.hypot(...g.sub(screen(candidate, entry?.matrix), world)) <= 8)
        result[axis] = candidate[axis];
    }
    return result;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  return {
    view,
    draw,
    resize,
    fit,
    entries,
    active,
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
