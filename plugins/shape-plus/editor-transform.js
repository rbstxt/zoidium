"use strict";
// Direct manipulation on the main preview: bounding boxes, move, scale and
// rotate. Groups edit their native Position/Scale/Rotation; Rectangle and
// Ellipse edit Size/Position; Polystar edits its radii/Rotation; Paths move
// their vertices. Every drag is one snapshot history transaction.
const { find } = require("./editor-tree-data.js");
const { matrix, identity, transform } = require("./compiler.js");
const { evaluate, verticesToCubics } = require("./path.js");
const g = require("./editor-geometry.js");
const MOVABLE = ["group", "rectangle", "ellipse", "polystar", "path"];
const HANDLE = 5, ROTATE_OFFSET = 24;
const linear = m => [m[0], m[1], m[2], m[3], 0, 0];
const rotate = (v, r) => [v[0] * Math.cos(r) - v[1] * Math.sin(r), v[0] * Math.sin(r) + v[1] * Math.cos(r)];
function descendants(item, result = new Set()) {
  for (const child of item.contents || []) { result.add(child.id); descendants(child, result); }
  return result;
}
function curvePoints(path) {
  const points = path.vertices.map(v => v.point);
  for (const cubic of verticesToCubics(path.vertices, path.closed))
    for (let i = 1; i < 8; i++) points.push(evaluate(cubic, i / 8));
  return points;
}
function parentMatrix(s, entry, frame = s.localFrame()) {
  return entry.ancestors.reduce((m, group) => g.multiply(m, matrix(group.evaluate(frame).properties)), identity);
}
// Box in the item's own editing space: a group's contents space, otherwise
// the item's parent space. `screen` maps that space to CSS pixels.
function box(s, id) {
  const entry = find(s.layer.contents, id), projection = s.canvasApi.projection();
  if (!entry || !projection || !MOVABLE.includes(entry.item.kind)) return null;
  const frame = s.localFrame(), item = entry.item, parent = parentMatrix(s, entry, frame);
  const p = item.evaluate(frame).properties;
  const space = item.kind === "group" ? g.multiply(parent, matrix(p)) : parent;
  const inverse = g.inverse(space);
  if (!inverse) return null;
  const inside = item.kind === "group" ? descendants(item) : new Set([id]);
  const points = s.canvasApi.entries().filter(e => e.enabled && inside.has(e.item.id))
    .flatMap(e => curvePoints(e.path).map(point => transform(point, g.multiply(inverse, e.matrix))));
  if (!points.length) return null;
  const min = [Math.min(...points.map(v => v[0])), Math.min(...points.map(v => v[1]))];
  const max = [Math.max(...points.map(v => v[0])), Math.max(...points.map(v => v[1]))];
  return { item, kind: item.kind, properties: p, parent, space, min, max, screen: g.multiply(projection, space), frame };
}
const at = (b, sx, sy) => [(b.min[0] + b.max[0]) / 2 + sx * (b.max[0] - b.min[0]) / 2, (b.min[1] + b.max[1]) / 2 + sy * (b.max[1] - b.min[1]) / 2];
function handles(b) {
  if (!b || b.kind === "path") return [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const width = Math.hypot(...g.sub(transform(at(b, 1, 0), b.screen), transform(at(b, -1, 0), b.screen)));
  const height = Math.hypot(...g.sub(transform(at(b, 0, 1), b.screen), transform(at(b, 0, -1), b.screen)));
  const edges = b.kind === "polystar" ? [] : [[0, 1], [1, 0], [0, -1], [-1, 0]].filter(([x, y]) => x ? height > 36 : width > 36);
  const list = [...corners, ...edges].map(([sx, sy]) => ({ sx, sy, point: transform(at(b, sx, sy), b.screen) }));
  if (["group", "polystar"].includes(b.kind)) {
    const center = transform(at(b, 0, 0), b.screen), top = transform(at(b, 0, 1), b.screen);
    let direction = g.sub(top, center);
    const length = Math.hypot(...direction);
    direction = length > 1e-6 ? g.mul(direction, 1 / length) : [0, -1];
    list.push({ rotate: true, point: g.add(top, g.mul(direction, ROTATE_OFFSET)), from: top });
  }
  return list;
}
function selectedBox(s) {
  return s.treeSelection.size === 1 ? box(s, [...s.treeSelection][0]) : null;
}
function handleAt(s, point) {
  const b = selectedBox(s);
  // Rotation is listed last but wins over a nearby corner on small boxes.
  const list = handles(b).reverse(), found = list.find(h => Math.hypot(...g.sub(h.point, point)) <= HANDLE + 3);
  return found ? { box: b, ...found } : null;
}
function cursorFor(h) {
  if (h.rotate) return "grab";
  const v = g.sub(h.point, transform(at(h.box, 0, 0), h.box.screen));
  const angle = ((Math.atan2(v[1], v[0]) * 180 / Math.PI) + 360) % 180;
  return angle < 22.5 || angle >= 157.5 ? "ew-resize" : angle < 67.5 ? "nwse-resize" : angle < 112.5 ? "ns-resize" : "nesw-resize";
}
function start(s, frame, work) {
  return {
    frame, target: s.activeId,
    move(e) { if (!s.gesture.active && !s.gesture.begin()) return; work(e); },
    end() { s.gesture.finish(); s.refresh(true); },
    cancel() { s.gesture.finish(true); s.refresh(true); },
  };
}
function moveDelta(s, items, delta, frame) {
  for (const { item, inverse, position, path } of items) {
    const local = transform(delta, inverse);
    if (path) {
      const points = g.vertices(path);
      for (const v of points) v.point = g.add(v.point, local);
      s.setValue(item.properties.path, g.values(points), frame);
    } else s.setValue(item.properties.position, g.add(position, local), frame);
  }
}
function moveTargets(s, ids, frame = s.localFrame()) {
  const projection = s.canvasApi.projection();
  if (!projection) return [];
  return ids.map(id => find(s.layer.contents, id)).filter(entry => entry && MOVABLE.includes(entry.item.kind))
    // A selected group already carries its selected descendants.
    .filter((entry, _i, list) => !entry.ancestors.some(a => list.some(other => other.item === a)))
    .map(entry => {
      const inverse = g.inverse(g.multiply(projection, parentMatrix(s, entry, frame)));
      if (!inverse) return null;
      return entry.item.kind === "path"
        ? { item: entry.item, inverse: linear(inverse), path: entry.item.properties.path.get(frame).slice() }
        : { item: entry.item, inverse: linear(inverse), position: entry.item.properties.position.get(frame).slice() };
    }).filter(Boolean);
}
function moveGesture(s, origin, point, ids) {
  const frame = s.localFrame(), items = moveTargets(s, ids, frame);
  if (!items.length) return null;
  const gesture = start(s, frame, e => {
    let delta = g.sub(point(e), origin);
    if (e.shiftKey) delta = g.constrain(delta);
    moveDelta(s, items, delta, frame);
  });
  const move = gesture.move;
  gesture.move = e => { if (s.gesture.active || Math.hypot(...g.sub(point(e), origin)) >= 3) move(e); };
  return gesture;
}
// Arrow keys: one composition pixel (ten with Shift) in each item's parent space.
function nudge(s, ids, delta) {
  const frame = s.localFrame();
  const items = moveTargets(s, ids, frame).map(t => ({ ...t, inverse: [1, 0, 0, 1, 0, 0] }));
  moveDelta(s, items, delta, frame);
  return items.length > 0;
}
function boxGesture(s, h, origin, point) {
  const b = h.box, frame = b.frame, item = b.item, p = b.properties;
  const toParent = g.inverse(g.multiply(s.canvasApi.projection(), b.parent));
  if (!toParent) return null;
  const parentPoint = e => transform(point(e), toParent);
  const q0 = transform(origin, toParent);
  const center = at(b, 0, 0);
  const set = (key, value) => s.setValue(item.properties[key], value, frame);
  if (h.rotate) {
    const own = item.kind === "group" ? matrix(p) : identity;
    const pivot = item.kind === "group" ? transform(center, own) : p.position;
    const a0 = Math.atan2(q0[1] - pivot[1], q0[0] - pivot[0]);
    return start(s, frame, e => {
      const q = parentPoint(e);
      let r = p.rotation + Math.atan2(q[1] - pivot[1], q[0] - pivot[0]) - a0;
      if (e.shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      set("rotation", r);
      if (item.kind === "group") {
        const offset = rotate(g.sub(center, p.anchor).map((v, i) => v * p.scale[i]), r);
        set("position", g.sub(pivot, offset));
      }
    });
  }
  const corner = at(b, h.sx, h.sy), opposite = at(b, -h.sx, -h.sy);
  if (item.kind === "polystar") {
    const d0 = Math.hypot(...g.sub(q0, p.position)) || 1;
    return start(s, frame, e => {
      const f = Math.max(1e-4, Math.hypot(...g.sub(parentPoint(e), p.position)) / d0);
      set("outerRadius", Math.max(0.01, p.outerRadius * f));
      set("innerRadius", Math.max(0, p.innerRadius * f));
    });
  }
  if (item.kind === "group") {
    const own = matrix(p);
    return start(s, frame, e => {
      const fixed = e.altKey ? center : opposite, fixedParent = transform(fixed, own);
      const v = rotate(g.sub(parentPoint(e), fixedParent), -p.rotation), d = g.sub(corner, fixed);
      let scale = p.scale.slice();
      if (h.sx && Math.abs(d[0]) > 1e-9) scale[0] = v[0] / d[0];
      if (h.sy && Math.abs(d[1]) > 1e-9) scale[1] = v[1] / d[1];
      if (e.shiftKey) {
        const ratios = scale.map((v, i) => v / (p.scale[i] || 1));
        const f = !h.sy || h.sx && Math.abs(ratios[0]) > Math.abs(ratios[1]) ? ratios[0] : ratios[1];
        scale = p.scale.map(v => v * f);
      }
      scale = scale.map(v => Math.abs(v) < 1e-4 ? (v < 0 ? -1e-4 : 1e-4) : v);
      set("scale", scale);
      const offset = rotate(g.sub(fixed, p.anchor).map((v, i) => v * scale[i]), p.rotation);
      set("position", g.sub(fixedParent, offset));
    });
  }
  // Rectangle / Ellipse: the opposite corner stays put (Alt: the center).
  return start(s, frame, e => {
    const q = parentPoint(e), size = p.size.slice(), position = p.position.slice();
    for (const axis of [0, 1]) {
      if (!(axis ? h.sy : h.sx)) continue;
      if (e.altKey) size[axis] = 2 * Math.abs(q[axis] - center[axis]);
      else { size[axis] = Math.abs(q[axis] - opposite[axis]); position[axis] = (q[axis] + opposite[axis]) / 2; }
    }
    if (e.shiftKey) {
      // Square/circle: the dragged extent applies to both axes. A moving
      // axis grows away from its fixed side; the other axis stays centered.
      const changed = h.sx && h.sy ? Math.max(...size) : h.sx ? size[0] : size[1];
      for (const axis of [0, 1]) {
        const side = axis ? h.sy : h.sx;
        size[axis] = changed;
        position[axis] = e.altKey || !side ? center[axis] : opposite[axis] + Math.sign(q[axis] - opposite[axis] || side) * changed / 2;
      }
    }
    set("size", size.map(v => Math.max(0.01, v)));
    set("position", position);
  });
}
module.exports = { MOVABLE, box, handles, handleAt, selectedBox, cursorFor, moveGesture, boxGesture, nudge, moveTargets, curvePoints, at };
