"use strict";
const { selectionKey, selectionPart } = require("./editor-selection.js");
const g = require("./editor-geometry.js");
const { matrix, transform, identity } = require("./compiler.js");
const { primitivePath } = require("./primitives.js");
const controls = require("./editor-controls.js");
const { displayMatrix } = require("./viewport-mapping.js");
const { verticesToCubics, evaluate: evaluateCubic } = require("./path.js");
const { find } = require("./editor-tree-data.js");
const { PAINTS, paintScope } = require("./contents-ops.js");
const pathProjection = require("./path-projection.js");
const feedback = require("./path-feedback.js");
const { selectionBounds, snapPoint, constrainMoveDelta } = require("./path-transform.js");
const xf = require("./editor-transform.js");
const PREFS_KEY = "zoidium.shape-plus.path-display";
const prefsByWindow = new WeakMap();

function displayPreferences(window) {
  if (prefsByWindow.has(window)) return prefsByWindow.get(window);
  let stored;
  try { stored = JSON.parse(window?.localStorage?.getItem(PREFS_KEY) || "null"); }
  catch (_error) { /* Use defaults when storage is unavailable. */ }
  const prefs = feedback.normalizePrefs(stored).prefs;
  if (window) prefsByWindow.set(window, prefs);
  return prefs;
}

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
  const window = canvas.ownerDocument.defaultView;
  const prefs = displayPreferences(window);
  function setDisplaySize(key, value) {
    const next = feedback.normalizePrefs({ ...prefs, [key]: value });
    if (next.errors.length) {
      s.message(next.errors[0]);
      return false;
    }
    Object.assign(prefs, next.prefs);
    try { window.localStorage?.setItem(PREFS_KEY, JSON.stringify(prefs)); }
    catch (_error) { /* Retain the preference in this window. */ }
    s.dirty = true;
    return true;
  }
  const navigation = { x: 0, y: 0, scale: 1 };
  let projection = null, nativeCanvasStyle = null;
  let frameRect = null;
  // Operation-scoped scene snapshot. One read-only pointer event or one draw
  // shares a single scene build across hit, active lookup, local conversion,
  // snap and selection bounds. Each entry caches its CSS vertices and cubics
  // until the event ends or a mutation invalidates the scope.
  let scope = null;
  function ensureScope() {
    if (!scope)
      scope = { list: null, byId: null, css: null, shapes: null };
    if (!scope.list) {
      scope.list = scene(s.layer.contents, s.localFrame());
      scope.byId = new Map(scope.list.map((e) => [e.item.id, e]));
      scope.css = new Map();
      scope.shapes = new Map();
    }
    return scope;
  }
  function scoped(work) {
    if (scope) return work();
    scope = { list: null, byId: null, css: null, shapes: null };
    try {
      return work();
    } finally {
      scope = null;
    }
  }
  function invalidateScope() {
    if (scope) {
      scope.list = null;
      scope.byId = null;
      scope.css = null;
      scope.shapes = null;
    }
  }
  function entries() {
    if (scope) return ensureScope().list;
    return scene(s.layer.contents, s.localFrame());
  }
  function active() {
    if (scope) return ensureScope().byId.get(s.activeId);
    return entries().find((e) => e.item.id === s.activeId);
  }
  function screen(point, m = identity) {
    return transform(point, g.multiply(projection || identity, m));
  }
  function projected(entry) {
    return pathProjection.composeMapping(entry?.matrix, projection);
  }
  function local(point, entry = active()) {
    if (!projection) return null;
    const result = pathProjection.screenToLocal(point, { matrix: entry?.matrix, projection });
    if (!result.ok) {
      s.message?.(result.message);
      return null;
    }
    return result.local;
  }
  function cssPoints(entry) {
    if (!scope) return pathProjection.projectVertices(entry.path.vertices, entry.matrix, projection);
    const sc = ensureScope();
    if (!sc.css.has(entry))
      sc.css.set(entry, pathProjection.projectVertices(entry.path.vertices, entry.matrix, projection));
    return sc.css.get(entry);
  }
  function shapeFor(entry, closed) {
    const sc = ensureScope();
    if (!sc.shapes.has(entry)) sc.shapes.set(entry, new Map());
    const variants = sc.shapes.get(entry);
    if (!variants.has(closed)) variants.set(closed, verticesToCubics(cssPoints(entry), closed));
    return variants.get(closed);
  }
  function pickRecord(entry) {
    return { id: entry.item.id, matrix: entry.matrix, ...entry.path };
  }
  function showsHandle(path, index, side) {
    return path.closed || (s.tool === "pen" && !s.penFinished) ||
      !(side === "in" && index === 0 || side === "out" && index === path.vertices.length - 1);
  }
  function anchorPriority(path, index) {
    if (s.tool !== "pen" || path.closed) return 0;
    const last = path.vertices.length - 1;
    if (index === 0 && last > 0 && s.pathController?.drawing?.pathId === path.id) return -2;
    return index === 0 || index === last ? -1 : 0;
  }
  function pickPaths(point, activeOnly = false) {
    if (!projection) return { target: null, candidates: [] };
    const list = activeOnly ? [active()] : entries();
    const paths = list.filter(e => e?.enabled && e.item.kind === "path").map(pickRecord);
    const result = pathProjection.pickPaths(paths, point, {
      projection, anchorPriority,
      handleFilter: (path, index, side) => path.id === s.activeId && showsHandle(path, index, side),
    });
    const hit = result.target;
    if (!hit) return result;
    const path = paths.find(path => path.id === hit.pathId);
    const index = hit.vertexIndex ?? hit.segmentIndex;
    const isEndpoint = hit.kind === "anchor" && (index === 0 || index === path.vertices.length - 1);
    return { ...result, target: { ...hit, index, isEndpoint, pathClosed: !!path.closed } };
  }
  function hit(point) {
    return pickPaths(point, true).target;
  }
  // The topmost drawn leaf under a CSS point. Earlier contents draw on top,
  // so the list is searched in order. Fill interiors (open paths close for
  // fills) and a 9 px band around every outline both count.
  function itemAt(point) {
    if (!projection) return null;
    for (const e of entries()) {
      if (!e.enabled || !g.inverse(projected(e))) continue;
      if (pathProjection.pickPaths([pickRecord(e)], point, { projection, handleFilter: () => false }).target) return e;
      const points = cssPoints(e);
      if (points.length < 3) continue;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      trace(e, points, true);
      const inside = context.isPointInPath(point[0], point[1]);
      context.restore();
      if (inside) return e;
    }
    return null;
  }
  function trace(entry, points, closed) {
    context.beginPath();
    if (!points.length) return;
    context.moveTo(...points[0].point);
    // Inside a scope the cubics come from the snapshot instead of being
    // rebuilt per stroke or interior test; the input array is the cached
    // cssPoints result, so the segments are bit-identical.
    const cubics = scope ? shapeFor(entry, closed) : verticesToCubics(points, closed);
    for (const c of cubics)
      context.bezierCurveTo(...c[1], ...c[2], ...c[3]);
    if (closed) context.closePath();
  }
  function resize() {
    const nativeRect = s.viewport.canvas.getBoundingClientRect();
    const { x, y, scale } = navigation;
    const rect = { left: nativeRect.left - x, top: nativeRect.top - y,
      width: nativeRect.width / scale, height: nativeRect.height / scale };
    frameRect = { left: x, top: y, right: x + nativeRect.width, bottom: y + nativeRect.height };
    if (nativeCanvasStyle) clipPreview(rect);
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
    const base = !pathProjection.isPerspectiveView(s.viewport) && displayMatrix(rect, s.editor.sequence.properties.resolution.get(), {
      position: p.position.get(s.localFrame()), scale: p.scale.get(s.localFrame()), rotation: p.rotation.get(s.localFrame()),
    });
    // A path host may author in a different coordinate space than the layer
    // transform consumes (layer masks use top-left, y-down mask space while
    // the layer matrix expects centered, y-up input). The host supplies the
    // extra matrix; layers without one project exactly as before.
    const localToFrame = base ? pathProjection.composeMapping(s.layer.layerSpaceMatrix, base) : null;
    projection = localToFrame ? pathProjection.composeMapping(localToFrame, [scale, 0, 0, scale, x, y]) : null;
    if (!projection) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
    }
    return !!projection;
  }
  // CM3 has camera controls in perspective view. In the composited view
  // only the canvas presentation moves. The overlay stays in CSS pixels.
  function clipPreview(rect) {
    const inset = [ -frameRect.top, frameRect.right - rect.width,
      frameRect.bottom - rect.height, -frameRect.left ];
    s.viewport.canvas.style.clipPath = `inset(${inset.map(value => Math.max(0, value) / navigation.scale + "px").join(" ")})`;
  }
  function navigate() {
    const style = s.viewport.canvas.style;
    nativeCanvasStyle ??= { transform: style.transform || "", transformOrigin: style.transformOrigin || "", clipPath: style.clipPath || "" };
    style.transformOrigin = "0 0";
    style.transform = `translate(${navigation.x}px, ${navigation.y}px) scale(${navigation.scale})`;
    resize();
    s.pathInput?.notifyExternalSelection();
  }
  function panBy(dx, dy) {
    navigation.x += dx;
    navigation.y += dy;
    navigate();
  }
  function zoomAt(point, factor) {
    const scale = Math.min(16, Math.max(.25, navigation.scale * factor));
    const ratio = scale / navigation.scale;
    navigation.x = point[0] + (navigation.x - point[0]) * ratio;
    navigation.y = point[1] + (navigation.y - point[1]) * ratio;
    navigation.scale = scale;
    navigate();
  }
  function guides() {
    if (!frameRect) return [];
    const { left, right, top, bottom } = frameRect;
    return [
      { axis: "x", value: left }, { axis: "x", value: right },
      { axis: "y", value: top }, { axis: "y", value: bottom },
    ].filter(({ axis, value }) => value >= 0 && value <= (axis === "x" ? view.width : view.height));
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
    trace(e, cssPoints(e), e.path.closed);
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
      if (b.pivot && !h.rotate && (!h.sx || !h.sy)) continue;
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
  function pointBox() {
    const entry = active();
    if (!s.pathController || s.tool !== "select" || s.treeSelection.size !== 1 ||
        entry?.item.kind !== "path" || !projection) return null;
    const selection = s.maskSelection?.size() > 1 ? s.multiMaskVertices() :
      new Map([[entry.item.id, entry.item.vertexIds.filter(id => s.selection.has(selectionKey(id)))]]);
    const points = entries().flatMap(candidate => {
      const ids = selection.get(candidate.item.id);
      if (!ids?.length || !candidate.enabled || s.pathLocked?.(candidate.item.id) ||
          !g.inverse(projected(candidate))) return [];
      const wanted = new Set(ids);
      return cssPoints(candidate).filter((_v, i) => wanted.has(candidate.item.vertexIds[i]));
    });
    if (points.length < 2) return null;
    const { min, max, center } = selectionBounds(points.map(v => v.point));
    return { kind: "group", screen: identity, pivot: center,
      min: min.map(value => value - 12), max: max.map(value => value + 12) };
  }
  function pointBoxHandle(point, box) {
    const handle = xf.handles(box).reverse().find(h => (h.rotate || h.sx && h.sy) &&
      Math.hypot(...g.sub(h.point, point)) <= 8);
    return handle ? { ...handle, box } : null;
  }
  function drawSnapGuide(guide) {
    if (!guide) return;
    context.lineWidth = 1;
    context.strokeStyle = "#6ee7db";
    context.setLineDash([4, 3]);
    if (guide.point) circle(guide.point, 9, "#6ee7db");
    else {
      context.beginPath();
      for (const { axis, value } of guide.lines) {
        if (axis === "x") { context.moveTo(value, 0); context.lineTo(value, view.height); }
        else { context.moveTo(0, value); context.lineTo(view.width, value); }
      }
      context.stroke();
    }
    context.setLineDash([]);
  }
  function penCursor(target) {
    const drawing = s.pathController?.drawing;
    const path = drawing?.pathId === target?.pathId ? active()?.path : null;
    const vertexCount = path?.vertices.length;
    return feedback.resolvePenCursor({
      target,
      drawing: path ? { ...drawing, closed: path.closed, vertexCount, canClose: vertexCount > 1 } : null,
    });
  }
  function hoverTarget(point) {
    if (s.tool !== "pen") return pickPaths(point).target;
    const hit = pickPaths(point, true).target;
    if (hit) return hit;
    const other = pickPaths(point).target;
    return other?.isEndpoint && !other.pathClosed ? other : null;
  }
  function cursorFor(target) {
    if (s.tool === "pen") {
      if (target && s.pathLocked?.(target.pathId)) return { css: "not-allowed", badge: null };
      if (target?.kind === "handle") return { css: "pointer", badge: null };
      return penCursor(target);
    }
    return feedback.resolveSelectCursor({ target, marquee: !!s.marquee });
  }
  function circle(p, radius, color, fill = false) {
    context.beginPath();
    context.arc(...p, radius, 0, Math.PI * 2);
    if (fill) {
      context.fillStyle = color;
      context.fill();
    } else {
      context.strokeStyle = color;
      context.stroke();
    }
  }
  function drawVertex(point, instruction) {
    const { size, shape, color, outline, ring } = instruction;
    const [x, y] = point;
    const half = size / 2;
    const rect = [x - half, y - half, size, size];
    if (shape.startsWith("filled")) {
      context.fillStyle = color;
      context.fillRect(...rect);
    }
    context.lineWidth = 3;
    context.strokeStyle = outline;
    context.strokeRect(...rect);
    context.lineWidth = 1;
    context.strokeStyle = color;
    context.strokeRect(...rect);
    if (ring === "double" || instruction.badge === "o" || instruction.badge === "/") {
      const inner = half + 3;
      for (const radius of ring === "double" ? [inner, inner + 3] : [inner]) {
        context.lineWidth = 2;
        circle(point, radius, outline);
        context.lineWidth = 1;
        circle(point, radius, color);
      }
    }
  }
  function drawDirection(entry, instruction) {
    if (!instruction) return;
    const curve = shapeFor(entry, false).at(-1);
    if (!curve) return;
    const tip = evaluateCubic(curve, .7);
    const tangent = g.sub(tip, evaluateCubic(curve, .6));
    const length = Math.hypot(...tangent);
    if (length < .1 || Math.hypot(...g.sub(instruction.to, tip)) < 10) return;
    const [x, y] = tangent.map(value => value / length);
    context.beginPath();
    context.moveTo(tip[0] - 7 * x + 4 * y, tip[1] - 7 * y - 4 * x);
    context.lineTo(...tip);
    context.lineTo(tip[0] - 7 * x - 4 * y, tip[1] - 7 * y + 4 * x);
    context.lineWidth = 1.5;
    context.strokeStyle = instruction.color;
    context.stroke();
  }
  function drawPath(e, hover, intent) {
    const points = cssPoints(e);
    const selectedIds = [...s.selection].map(selectionPart).filter(part => !part.side).map(part => part.id);
    const instructions = feedback.pathInstructions({
      vertices: points.map((v, i) => ({ ...v, id: e.item.vertexIds[i] })),
      closed: e.path.closed,
      selectedIds,
      hover: hover?.pathId === e.item.id ? { ...hover, intent } : null,
      prefs,
    });
    drawDirection(e, instructions.direction);
    points.forEach((v, i) => {
      for (const side of ["in", "out"]) {
        if (!showsHandle(e.path, i, side) || Math.hypot(...v[side]) < 1e-8) continue;
        const selected = s.selection.has(selectionKey(e.item.vertexIds[i], side));
        const { size, color, outline } = feedback.handleInstruction({ selected, prefs });
        const p = g.add(v.point, v[side]);
        context.beginPath();
        context.strokeStyle = ACCENT;
        context.lineWidth = 1;
        context.moveTo(...v.point);
        context.lineTo(...p);
        context.stroke();
        if (selected) circle(p, size / 2, color, true);
        context.lineWidth = 2.5;
        circle(p, size / 2, outline);
        context.lineWidth = 1;
        circle(p, size / 2, color);
      }
    });
    instructions.vertices.forEach((instruction, i) => drawVertex(points[i].point, instruction));
  }
  function drawSegmentHighlight(hover) {
    const entry = ensureScope().byId.get(hover.pathId);
    if (!entry?.enabled) return;
    const curve = shapeFor(entry, entry.path.closed)[hover.segmentIndex];
    if (!curve) return;
    context.beginPath();
    context.moveTo(...curve[0]);
    context.bezierCurveTo(...curve[1], ...curve[2], ...curve[3]);
    context.lineWidth = 3;
    context.strokeStyle = feedback.segmentInstruction({ highlighted: true }).color;
    context.stroke();
  }
  function drawBadge(point, badge) {
    if (!point || badge === null || badge === undefined) return;
    const x = point[0] + (point[0] > view.width - 18 ? -15 : 11);
    const y = point[1] + (point[1] < 15 ? 20 : -8);
    context.font = "bold 13px sans-serif";
    context.lineWidth = 3;
    context.strokeStyle = "#1b1b1b";
    context.strokeText(badge, x, y);
    context.fillStyle = "#fff";
    context.fillText(badge, x, y);
  }
  function draw() {
    if (!resize() || !view.width) return;
    // One draw shares a single scene snapshot across outlines, active
    // lookup, selection bounds and control handles.
    scoped(() => {
    const dpr = canvas.width / view.width;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, view.width, view.height);
    const selected = [...s.treeSelection];
    const hover = s.tool === "pen" && !s.pointer?.active && s.pointerPoint
      ? hoverTarget(s.pointerPoint) : null;
    const cursor = cursorFor(hover);
    const intent = ({ "endpoint-close": "close", "endpoint-continue": "continue", "vertex-delete": "delete" })[cursor.state];
    if (s.pointerPoint && s.tool === "pen" && !s.pointer?.navigationCursor?.()) canvas.style.cursor = cursor.css;
    if (s.hover && !s.treeSelection.has(s.hover) && !s.pointer?.active)
      for (const e of outlines(s.hover)) strokeOutline(e, HOVER);
    let paint = null;
    if (s.tool === "select" && s.maskSelection?.size() > 1) {
      for (const [id, ids] of s.multiMaskVertices()) {
        if (id === s.activeId) continue;
        const entry = ensureScope().byId.get(id);
        if (!entry?.enabled) continue;
        strokeOutline(entry, ACCENT);
        if (!ids.length) continue;
        const points = cssPoints(entry), wanted = new Set(ids);
        const { vertices } = feedback.pathInstructions({
          vertices: points.map((v, i) => ({ ...v, id: entry.item.vertexIds[i] })),
          closed: entry.path.closed, selectedIds: ids, prefs,
        });
        vertices.forEach((instruction, i) => {
          if (wanted.has(entry.item.vertexIds[i])) drawVertex(points[i].point, instruction);
        });
      }
    }
    for (const id of selected) {
      const item = s.find(id);
      if (!item) continue;
      if (PAINTS.includes(item.kind)) {
        // A selected fill/stroke shows exactly which paths it draws.
        paint = paint || paintScope(JSON.parse(JSON.stringify(s.layer.contents)));
        const targets = new Set(paint.get(id)?.targets || []);
        for (const e of entries()) if (targets.has(e.item.id)) strokeOutline(e, ACCENT, 1, [5, 4]);
        continue;
      }
      for (const e of outlines(id)) strokeOutline(e, ACCENT);
      if (item.kind === "path" && id === s.activeId && selected.length === 1) {
        const e = active();
        if (e?.enabled) drawPath(e, hover, intent);
      }
    }
    if (selected.length === 1 && !(s.tool === "pen" && !s.penFinished)) {
      const pointSelection = pointBox();
      if (pointSelection) drawBox(pointSelection);
      else if (active()?.item.kind !== "path") {
        const b = xf.selectedBox(s);
        if (b && b.kind !== "path") drawBox(b);
      }
    }
    // Pen in progress on a path that is not the selection's leaf.
    if (s.tool === "pen" && !s.penFinished && s.active()?.kind === "path" && selected.length !== 1) {
      const e = active();
      if (e?.enabled) drawPath(e, hover, intent);
    }
    if (cursor.state === "segment-add") drawSegmentHighlight(hover);
    if (intent === "continue" && hover.pathId !== s.activeId) {
      drawVertex(hover.point, feedback.vertexInstruction({ intent, isFirst: hover.vertexIndex === 0, prefs }));
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
    // In-place text editing draws only the caret and selection highlight on
    // top of the real render; see plugins/shape-plus/text-inline.js.
    s.drawTextEdit?.(context);
    drawSnapGuide(s.snapGuide);
    if (!s.pointer?.active && !s.pointer?.navigationCursor?.()) drawBadge(s.pointerPoint, cursor.badge);
    });
  }
  function snap(point, exclude = [], origin = null, shift = false) {
    const entry = active();
    const mapping = projected(entry);
    if (!mapping) return point;
    const screenOrigin = origin && transform(origin, mapping);
    let world = transform(point, mapping);
    if (shift && screenOrigin) world = g.add(screenOrigin, constrainMoveDelta(g.sub(world, screenOrigin), { shift }));
    const excluded = new Set(exclude);
    const vertices = entries().filter(e => e.enabled && g.inverse(projected(e)))
      .flatMap(e => cssPoints(e).filter((_v, i) => !excluded.has(e.item.vertexIds?.[i])).map(v => v.point));
    const result = s.snap ? snapPoint(world, { vertices, guides: guides(), origin: screenOrigin }) : { point: world };
    s.snapGuide = result.guide || null;
    return local(result.point, entry) || point;
  }
  function gesturePaths() {
    if (!projection) return [];
    return entries().filter(entry => entry.enabled && entry.item.kind === "path").map(entry => ({
      ...pickRecord(entry), locked: !!s.pathLocked?.(entry.item.id),
      vertices: entry.path.vertices.map((vertex, i) => ({ ...vertex, id: entry.item.vertexIds[i] })),
    }));
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  return {
    view,
    draw,
    resize,
    entries,
    active,
    scoped,
    invalidateScene: invalidateScope,
    activeMatrix: () => [...(projection || []), ...(active()?.matrix || controls.handles(s)[0]?.matrix || [])],
    screen,
    local,
    cssPoints,
    hit,
    pickPaths,
    cursorFor,
    penCursor,
    hoverTarget,
    displayPrefs: () => ({ ...prefs }),
    setDisplaySize,
    itemAt,
    snap,
    pointBox,
    pointBoxHandle,
    gesturePaths,
    guides,
    panBy,
    zoomAt,
    outlines,
    projection: () => projection,
    dispose() {
      observer.disconnect();
      if (nativeCanvasStyle) Object.assign(s.viewport.canvas.style, nativeCanvasStyle);
    },
  };
}
module.exports = { scene, createCanvas };
