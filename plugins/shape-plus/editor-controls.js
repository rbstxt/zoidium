"use strict";
const { find } = require("./editor-tree-data.js");
const { matrix, identity } = require("./compiler.js");
const {
  multiply,
  sub,
  add,
  mul,
  vertices,
  values,
} = require("./editor-geometry.js");
function handles(s) {
  const entry = find(s.layer.contents, s.activeId);
  if (!entry) return [];
  const item = entry.item,
    p = item.evaluate(s.localFrame()).properties;
  const m = entry.ancestors.reduce(
    (m, g) => multiply(m, matrix(g.evaluate(s.localFrame()).properties)),
    identity,
  );
  const keys = item.kind.startsWith("gradient")
    ? ["startPoint", "endPoint"]
    : item.kind === "twist"
      ? ["center"]
      : ["repeater", "wiggleTransform"].includes(item.kind)
      ? ["anchor"]
      : [];
  return keys.map((key) => ({ key, point: p[key], matrix: m, item }));
}
function draw(s, context, color) {
  const list = handles(s);
  if (!list.length) return;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 1;
  context.beginPath();
  list.forEach((h, i) => {
    const point = s.canvasApi.screen(h.point, h.matrix);
    if (i) context.lineTo(...point);
    else context.moveTo(...point);
  });
  context.stroke();
  for (const h of list) {
    const p = s.canvasApi.screen(h.point, h.matrix);
    context.beginPath();
    context.arc(...p, 5, 0, 2 * Math.PI);
    context.stroke();
    context.beginPath();
    context.moveTo(p[0] - 8, p[1]);
    context.lineTo(p[0] + 8, p[1]);
    context.moveTo(p[0], p[1] - 8);
    context.lineTo(p[0], p[1] + 8);
    context.stroke();
  }
  context.restore();
}
function beginHandle(s, start, point) {
  const h = handles(s).find(
    (h) =>
      Math.hypot(...sub(s.canvasApi.screen(h.point, h.matrix), start)) <= 10,
  );
  if (!h) return null;
  const local = css => s.canvasApi.local(css, { matrix: h.matrix });
  if (!local(start)) return null;
  const origin = local(start),
    frame = s.localFrame();
  return {
    frame,
    target: h.item.id,
    move(e) {
      if (Math.hypot(...sub(point(e), start)) < 2 && !s.gesture.active) return;
      if (!s.gesture.active && !s.gesture.begin()) return;
      s.setValue(
        h.item.properties[h.key],
        add(h.point, sub(local(point(e)), origin)),
        frame,
      );
    },
    end() {
      s.gesture.finish();
    },
    cancel() {
      s.gesture.finish(true);
    },
  };
}
// Minimum-norm handle displacement makes the picked cubic parameter follow
// the pointer exactly while holding both endpoints fixed. Clamp away from
// endpoints, where anchor/handle tools have hit priority.
function bend(origin, index, t, delta, closed) {
  const result = vertices(values(origin)),
    next = (index + 1) % origin.length;
  if (!closed && next === 0) return result;
  t = Math.max(0.05, Math.min(0.95, t));
  const a = 3 * (1 - t) * (1 - t) * t,
    b = 3 * (1 - t) * t * t,
    d = a * a + b * b;
  result[index].out = add(origin[index].out, mul(delta, a / d));
  result[next].in = add(origin[next].in, mul(delta, b / d));
  return result;
}
module.exports = { handles, draw, beginHandle, bend };
