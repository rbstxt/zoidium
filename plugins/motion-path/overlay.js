"use strict";
// Screen-space model, drawing and hit testing of motion paths. Sizes are CSS
// pixels; the canvas backing store is scaled by devicePixelRatio only.
const edit = require("./path-edit.js");

const SIZE = { key: 7, handle: 7, tick: 2.5, current: 5, hitKey: 7, hitHandle: 7, line: 1.5, outline: 3.5 };
const COLOR = {
  line: "#9fd8ff", outline: "rgba(0, 0, 0, 0.72)", keyFill: "rgba(0, 0, 0, 0.55)",
  selected: "#ffffff", handle: "#ffd36b", current: "#ffffff",
};
const MAX_SAMPLES = 1500, MAX_TICKS = 900;

function channelsOf(path) {
  return path.axes.map(axis => ({
    keys: axis.keyframes,
    animated: !!axis.animated && !axis.expression,
    editable: !axis.expression,
  }));
}
function valueAt(path, frame) {
  return path.axes.map(axis => {
    const v = axis.get(frame);
    return Number.isFinite(v) ? v : 0;
  });
}
const add = (a, b) => a.map((x, i) => x + b[i]);
// Everything the overlay draws for one path, in client pixels.
function build(path, easings, selected) {
  const channels = channelsOf(path), frames = edit.pathFrames(channels);
  if (!frames.length) return null;
  const first = path.startFrame ?? 0, last = path.endFrame ?? path.length;
  const start = Math.max(first, frames[0]), end = Math.min(last, frames[frames.length - 1]);
  const spaceAt = frame => path.spaceAt?.(frame) || path.space;
  const line = [], ticks = [];
  if (end > start) {
    const steps = Math.min(MAX_SAMPLES, Math.max(1, Math.ceil(end - start)));
    for (let i = 0; i <= steps; i++) {
      const frame = start + (end - start) * i / steps;
      line.push(spaceAt(frame).toClient(valueAt(path, frame)));
    }
    if (end - start <= MAX_TICKS)
      for (let f = Math.ceil(start); f <= end; f++) {
        const p = spaceAt(f).toClient(valueAt(path, f));
        if (p) ticks.push(p);
      }
  }
  const keys = [];
  for (const frame of frames) {
    if (frame < first || frame >= last) continue;
    const space = spaceAt(frame), point = valueAt(path, frame), client = space.toClient(point);
    if (!client) continue;
    const info = edit.keyInfo(channels, frame, easings), handles = {};
    for (const [side, h] of [["in", info.in], ["out", info.out]]) {
      if (!h.visible) continue;
      const target = add(point, h.vector), at = space.toClient(target);
      if (at) handles[side] = { vector: h.vector, point: target, client: at };
    }
    keys.push({ frame, point, client, selected: !!selected?.has(frame), handles });
  }
  const local = path.local, current = spaceAt(local).toClient(valueAt(path, local));
  return { path, channels, frames, keys, line, ticks, current };
}
function stroke(ctx, width, color) {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function polyline(ctx, points, ox, oy) {
  ctx.beginPath();
  let open = false;
  for (const p of points) {
    if (!p) { open = false; continue; }
    if (open) ctx.lineTo(p[0] - ox, p[1] - oy);
    else ctx.moveTo(p[0] - ox, p[1] - oy);
    open = true;
  }
}
function square(ctx, p, size, ox, oy) {
  ctx.beginPath();
  ctx.rect(Math.round(p[0] - ox - size / 2) + 0.5, Math.round(p[1] - oy - size / 2) + 0.5, size - 1, size - 1);
}
function circle(ctx, p, r, ox, oy) {
  ctx.beginPath();
  ctx.arc(p[0] - ox, p[1] - oy, r, 0, Math.PI * 2);
}
// origin: client position of the canvas' top-left corner.
function draw(ctx, models, origin) {
  const ox = origin.left, oy = origin.top;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const m of models) {
    polyline(ctx, m.line, ox, oy);
    stroke(ctx, SIZE.outline, COLOR.outline);
    stroke(ctx, SIZE.line, COLOR.line);
    for (const t of m.ticks) {
      circle(ctx, t, SIZE.tick / 2 + 0.75, ox, oy); ctx.fillStyle = COLOR.outline; ctx.fill();
      circle(ctx, t, SIZE.tick / 2, ox, oy); ctx.fillStyle = COLOR.line; ctx.fill();
    }
    for (const k of m.keys) for (const side of ["in", "out"]) {
      const h = k.handles[side];
      if (!h) continue;
      polyline(ctx, [k.client, h.client], ox, oy);
      stroke(ctx, 3, COLOR.outline);
      stroke(ctx, 1, COLOR.handle);
      circle(ctx, h.client, SIZE.handle / 2 + 1, ox, oy); ctx.fillStyle = COLOR.outline; ctx.fill();
      circle(ctx, h.client, SIZE.handle / 2, ox, oy); ctx.fillStyle = COLOR.handle; ctx.fill();
    }
    if (m.current) {
      circle(ctx, m.current, SIZE.current, ox, oy);
      stroke(ctx, 3.5, COLOR.outline);
      stroke(ctx, 1.5, COLOR.current);
    }
    for (const k of m.keys) {
      square(ctx, k.client, SIZE.key + 2, ox, oy); ctx.fillStyle = COLOR.outline; ctx.fill();
      square(ctx, k.client, SIZE.key, ox, oy);
      ctx.fillStyle = k.selected ? COLOR.selected : COLOR.keyFill; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = k.selected ? COLOR.outline : COLOR.line; ctx.stroke();
    }
  }
}
// Topmost handle or key under a client point: handles before keys, later
// paths (drawn on top) first.
function hit(models, x, y) {
  for (let i = models.length - 1; i >= 0; i--) {
    const m = models[i];
    for (const k of m.keys) for (const side of ["out", "in"]) {
      const h = k.handles[side];
      if (h && Math.hypot(h.client[0] - x, h.client[1] - y) <= SIZE.hitHandle) return { model: m, key: k, side };
    }
    let best = null, distance = Infinity;
    for (const k of m.keys) {
      const d = Math.max(Math.abs(k.client[0] - x), Math.abs(k.client[1] - y));
      if (d <= SIZE.hitKey && d < distance) { best = k; distance = d; }
    }
    if (best) return { model: m, key: best, side: null };
  }
  return null;
}
module.exports = { build, draw, hit, channelsOf, valueAt, SIZE, COLOR };
