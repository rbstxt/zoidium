"use strict";
// Free transform of selected path points and their handle vectors (design
// "Geometry and feedback"). Move, scale, and rotate run in screen-space
// CSS pixels inside the selection bounding box and map back through each
// path's own inverse mapping, so nested and transformed parents edit
// correctly. The default pivot is the selection bounds centre. Modifier
// constraints (Shift) apply before snapping. Snapping targets unselected
// vertices, visible guides, and horizontal/vertical axes through the
// gesture origin with a 9 px screen threshold and deterministic priority:
// vertex, then guide, then axis. Locked geometry is never edited but still
// serves as a snap target. Every snap result carries guide metadata for
// the feedback layer (P2.3) to draw while snapped.
//
// Consumed contracts (real requires, both already merged):
// - `path-projection.js`: `projectVertices` for local-to-screen mapping,
//   `screenToLocal` for the per-path inverse used on drags, and
//   `composeMapping` to detect singular mappings without throwing.
// - `path-controller.js`: the vertex selection this module transforms is
//   read from the controller (`getSelection` returns vertex IDs per host
//   and path); P2.6 gestures resolve those IDs to the vertex indices this
//   module takes in `selection` via the host adapters.
//
// Pure logic: runs in Node and the browser.
const {
  projectVertices,
  screenToLocal,
  composeMapping,
} = require("./path-projection.js");

// Snap threshold in CSS pixels, shared with picking: the same 9 px radius
// that selects a point also attracts a dragged point.
const SNAP_THRESHOLD_PX = 9;
// Shift-constrained rotation snaps to 15-degree increments.
const ROTATE_SHIFT_STEP = Math.PI / 12;
// Shift-constrained moves snap direction to 45-degree increments, matching
// the item-move behaviour in `editor-transform.js`.
const MOVE_SHIFT_STEP = Math.PI / 4;

function isFinitePoint(point) {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1])
  );
}

function copyPoint(point) {
  return [point[0], point[1]];
}

// Screen-space bounding box of the selected anchors. Returns an
// `{ empty: true, count: 0 }` marker when there is nothing to transform
// instead of degenerate infinities.
function selectionBounds(points) {
  const list = Array.isArray(points) ? points : [];
  if (!list.length) return { empty: true, count: 0, min: null, max: null, center: null, size: null };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  list.forEach((point, index) => {
    if (!isFinitePoint(point)) throw Error("Selection bounds need finite screen points");
    if (point[0] < minX) minX = point[0];
    if (point[1] < minY) minY = point[1];
    if (point[0] > maxX) maxX = point[0];
    if (point[1] > maxY) maxY = point[1];
    void index;
  });
  const min = [minX, minY],
    max = [maxX, maxY];
  return {
    empty: false,
    count: list.length,
    min,
    max,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
    size: [maxX - minX, maxY - minY],
  };
}

// The default free-transform pivot: the selection bounds centre.
function defaultPivot(bounds) {
  if (!bounds || bounds.empty || !isFinitePoint(bounds.center)) {
    throw Error("A transform pivot needs a non-empty selection bounds");
  }
  return copyPoint(bounds.center);
}

// Shift locks a move to the nearest 45-degree direction, keeping its length.
function constrainMoveDelta(delta, modifiers = {}) {
  const base = [
    Number.isFinite(delta?.[0]) ? delta[0] : 0,
    Number.isFinite(delta?.[1]) ? delta[1] : 0,
  ];
  if (!modifiers || !modifiers.shift) return base;
  const length = Math.hypot(base[0], base[1]);
  if (length < 1e-12) return [0, 0];
  const snapped = Math.round(Math.atan2(base[1], base[0]) / MOVE_SHIFT_STEP) * MOVE_SHIFT_STEP;
  return [Math.cos(snapped) * length, Math.sin(snapped) * length];
}

// Shift forces uniform scaling: the axis that moves further from 1 wins.
function constrainScaleFactors(sx, sy, modifiers = {}) {
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    throw Error("Scale factors must be finite numbers");
  }
  if (!modifiers || !modifiers.shift) return [sx, sy];
  return Math.abs(sx - 1) >= Math.abs(sy - 1) ? [sx, sx] : [sy, sy];
}

// Shift snaps a rotation angle to 15-degree increments.
function constrainRotateAngle(angle, modifiers = {}) {
  if (!Number.isFinite(angle)) throw Error("Rotation angle must be a finite number");
  if (!modifiers || !modifiers.shift) return angle;
  return Math.round(angle / ROTATE_SHIFT_STEP) * ROTATE_SHIFT_STEP;
}

function movePoints(points, delta) {
  const offset = [Number.isFinite(delta?.[0]) ? delta[0] : 0, Number.isFinite(delta?.[1]) ? delta[1] : 0];
  return (points || []).map((point) => {
    if (!isFinitePoint(point)) throw Error("Moving points needs finite screen points");
    return [point[0] + offset[0], point[1] + offset[1]];
  });
}

function resolvePivot(points, pivot) {
  if (pivot === null || pivot === undefined) return defaultPivot(selectionBounds(points));
  if (!isFinitePoint(pivot)) throw Error("A transform pivot must hold two finite numbers");
  return copyPoint(pivot);
}

function scalePoints(points, options = {}) {
  const { sx = 1, sy = 1 } = options;
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw Error("Scale factors must be finite numbers");
  const pivot = resolvePivot(points || [], options.pivot);
  return (points || []).map((point) => {
    if (!isFinitePoint(point)) throw Error("Scaling points needs finite screen points");
    return [pivot[0] + (point[0] - pivot[0]) * sx, pivot[1] + (point[1] - pivot[1]) * sy];
  });
}

function rotatePoints(points, options = {}) {
  const { angle = 0 } = options;
  if (!Number.isFinite(angle)) throw Error("Rotation angle must be a finite number");
  const pivot = resolvePivot(points || [], options.pivot);
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  return (points || []).map((point) => {
    if (!isFinitePoint(point)) throw Error("Rotating points needs finite screen points");
    const dx = point[0] - pivot[0],
      dy = point[1] - pivot[1];
    return [pivot[0] + dx * cosine - dy * sine, pivot[1] + dx * sine + dy * cosine];
  });
}

// Screen-space handle-vector transform matching the point transform above:
// moves preserve vectors, scales multiply them per axis, rotations rotate
// them. The caller maps the result back through the path inverse as an
// offset (mapped knob minus mapped anchor), exactly like the projection
// of handle vectors in `path-projection.js`.
function transformHandleVector(vector, transform = {}) {
  const base = [Number.isFinite(vector?.[0]) ? vector[0] : 0, Number.isFinite(vector?.[1]) ? vector[1] : 0];
  const mode = transform.mode || "move";
  if (mode === "move") return base;
  if (mode === "scale") {
    const { sx = 1, sy = 1 } = transform;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw Error("Scale factors must be finite numbers");
    return [base[0] * sx, base[1] * sy];
  }
  if (mode === "rotate") {
    const { angle = 0 } = transform;
    if (!Number.isFinite(angle)) throw Error("Rotation angle must be a finite number");
    const cosine = Math.cos(angle),
      sine = Math.sin(angle);
    return [base[0] * cosine - base[1] * sine, base[0] * sine + base[1] * cosine];
  }
  throw Error("Unknown point transform mode " + mode);
}

function checkGuides(guides) {
  return (guides || []).map((guide) => {
    if (!guide || (guide.axis !== "x" && guide.axis !== "y") || !Number.isFinite(guide.value)) {
      throw Error("Snap guides must list { axis: x|y, value: finite number }");
    }
    return { axis: guide.axis, value: guide.value };
  });
}

function resolveAxis(coord, guideValues, axisValue, threshold) {
  let guideBest = null,
    guideDistance = Infinity;
  for (const value of guideValues) {
    const distance = Math.abs(coord - value);
    if (distance <= threshold && distance < guideDistance) {
      guideBest = value;
      guideDistance = distance;
    }
  }
  if (guideBest !== null) return { value: guideBest, kind: "guide" };
  if (axisValue !== null) {
    const distance = Math.abs(coord - axisValue);
    if (distance <= threshold) return { value: axisValue, kind: "axis" };
  }
  return null;
}

// Snap one screen point. `vertices` are unselected snap targets (locked
// paths included), `guides` are visible axis-aligned guides, and `origin`
// is the gesture origin whose horizontal/vertical axes attract the point.
// Priority is vertex, then guide, then axis; ties keep array order.
// The result always carries `guide` drawing metadata: a vertex marker or
// the snapped lines for the feedback layer to show while snapped.
function snapPoint(point, options = {}) {
  if (!isFinitePoint(point)) throw Error("Snapping needs a finite screen point");
  const threshold = options.threshold === undefined ? SNAP_THRESHOLD_PX : options.threshold;
  if (!(threshold > 0) || !Number.isFinite(threshold)) throw Error("Snapping needs a positive threshold");
  const targets = Array.isArray(options.vertices) ? options.vertices : [];
  let best = null,
    bestDistance = Infinity;
  for (const target of targets) {
    if (!isFinitePoint(target)) throw Error("Snap vertices must hold finite screen points");
    const distance = Math.hypot(target[0] - point[0], target[1] - point[1]);
    if (distance <= threshold && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  if (best) {
    const snapped = copyPoint(best);
    return {
      snapped: true,
      point: snapped,
      delta: [snapped[0] - point[0], snapped[1] - point[1]],
      kind: "vertex",
      target: snapped,
      guide: { kind: "vertex", point: snapped.slice() },
    };
  }
  const guides = checkGuides(options.guides);
  const origin =
    options.origin === null || options.origin === undefined
      ? null
      : isFinitePoint(options.origin)
        ? copyPoint(options.origin)
        : null;
  if (options.origin !== null && options.origin !== undefined && !origin) {
    throw Error("Snap origin must hold two finite numbers");
  }
  const guideX = guides.filter((guide) => guide.axis === "x").map((guide) => guide.value);
  const guideY = guides.filter((guide) => guide.axis === "y").map((guide) => guide.value);
  const foundX = resolveAxis(point[0], guideX, origin ? origin[0] : null, threshold);
  const foundY = resolveAxis(point[1], guideY, origin ? origin[1] : null, threshold);
  const guideHit = foundX?.kind === "guide" || foundY?.kind === "guide";
  const axisHit = foundX?.kind === "axis" || foundY?.kind === "axis";
  // Guides outrank axes as a whole: a guide snap never mixes with an axis.
  const pick = guideHit ? "guide" : axisHit ? "axis" : null;
  if (!pick) {
    return { snapped: false, point: copyPoint(point), delta: [0, 0], kind: "none", target: null, guide: null };
  }
  const lines = [];
  if (foundX && foundX.kind === pick) lines.push({ axis: "x", value: foundX.value });
  if (foundY && foundY.kind === pick) lines.push({ axis: "y", value: foundY.value });
  if (!lines.length) {
    return { snapped: false, point: copyPoint(point), delta: [0, 0], kind: "none", target: null, guide: null };
  }
  const snapped = [
    lines.some((line) => line.axis === "x") ? lines.find((line) => line.axis === "x").value : point[0],
    lines.some((line) => line.axis === "y") ? lines.find((line) => line.axis === "y").value : point[1],
  ];
  return {
    snapped: true,
    point: snapped,
    delta: [snapped[0] - point[0], snapped[1] - point[1]],
    kind: pick,
    target: { lines: lines.map((line) => ({ ...line })) },
    guide: { kind: pick, lines: lines.map((line) => ({ ...line })) },
  };
}

// Screen anchors of every unselected vertex: the vertex snap targets for a
// gesture. Locked paths contribute targets exactly like unlocked ones;
// `selection` maps path IDs to selected vertex indices.
function collectSnapVertices(projectedPaths, selection = {}) {
  const out = [];
  for (const path of projectedPaths || []) {
    const selected = new Set(selection?.[path.id] || []);
    (path.vertices || []).forEach((vertex, index) => {
      if (selected.has(index)) return;
      if (isFinitePoint(vertex?.point)) out.push(copyPoint(vertex.point));
    });
  }
  return out;
}

function unsnappedAt(point) {
  return { snapped: false, point: copyPoint(point), delta: [0, 0], kind: "none", target: null, guide: null };
}

function describeFailure(reason) {
  if (reason === "locked-selection") return "The selected points are locked, so they cannot be transformed.";
  if (reason === "empty-selection") return "Select at least one point to transform.";
  return "The path transform is singular, so the pointer cannot be mapped back to path coordinates.";
}

// Free-transform the selected vertices of every path. `paths` carry
// `{ id, matrix, locked, vertices: [{ point, in, out, ... }] }` where
// `matrix` is the path's combined host transform (null means identity);
// `selection` maps path IDs to selected vertex indices; `projection` is
// the shared viewport affine (null means identity). `gesture` is one of:
// - `{ mode: "move", delta, origin?, modifiers?, snap? }`
// - `{ mode: "scale", sx, sy, pivot?, handle?, modifiers?, snap? }`
// - `{ mode: "rotate", angle, pivot?, handle?, modifiers?, snap? }`
// `handle` is the dragged screen point the gesture started from (a
// bounding-box handle for scale/rotate); snapping moves it and the factors
// or angle are recomputed from the snapped position. Without a handle,
// snapping rigidly shifts the transformed result. `origin` is the pointer
// position at gesture start; its axes attract the dragged point. `snap`
// accepts `{ guides, origin, threshold, includeVertices }`; `snap: false`
// disables snapping. Locked paths are reported in `skippedLocked` and left
// untouched; singular mappings are reported in `failures`. Inputs are
// never mutated; edited paths return full new vertex arrays.
function freeTransform(input = {}) {
  const { paths, selection, projection = null, gesture = {} } = input;
  if (!Array.isArray(paths)) throw Error("Point transform needs a paths array");
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
    throw Error("Point transform needs a selection record");
  }
  const mode = gesture.mode;
  if (mode !== "move" && mode !== "scale" && mode !== "rotate") {
    throw Error("Unknown point transform mode " + mode);
  }
  const modifiers = gesture.modifiers || {};
  const byId = new Map();
  for (const path of paths) {
    if (!path || typeof path.id !== "string") throw Error("Point transform needs a string id per path");
    if (!Array.isArray(path.vertices)) throw Error("Point transform needs a vertices array per path");
    byId.set(path.id, path);
  }
  for (const [pathId, indices] of Object.entries(selection)) {
    const path = byId.get(pathId);
    if (!path) throw Error("Unknown path in selection " + pathId);
    if (!Array.isArray(indices)) throw Error("Selection for path " + pathId + " must list vertex indices");
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 0 || index >= path.vertices.length) {
        throw Error("Unknown vertex index " + index + " in path " + pathId);
      }
    }
  }
  const blank = (reason) => ({
    ok: false,
    reason,
    message: describeFailure(reason),
    mode,
    pivot: null,
    bounds: { empty: true, count: 0, min: null, max: null, center: null, size: null },
    constrained: null,
    applied: null,
    snap: unsnappedAt([0, 0]),
    paths: [],
    skippedLocked: [],
    failures: [],
  });
  // Project every path; singular mappings become per-path failures so one
  // broken parent transform never moves unrelated paths.
  const projected = [];
  const failures = [];
  for (const path of paths) {
    const mapping = composeMapping(path.matrix === undefined ? null : path.matrix, projection);
    if (!mapping) {
      failures.push({
        id: path.id,
        reason: "singular-mapping",
        message: describeFailure("singular-mapping"),
      });
      continue;
    }
    projected.push({
      id: path.id,
      locked: !!path.locked,
      matrix: path.matrix === undefined ? null : path.matrix,
      vertices: path.vertices,
      screen: projectVertices(path.vertices, path.matrix === undefined ? null : path.matrix, projection),
    });
  }
  // Gather the selected anchors in screen space.
  const selected = [];
  for (const entry of projected) {
    const indices = selection[entry.id] || [];
    for (const index of indices) {
      selected.push({
        pathId: entry.id,
        vertexIndex: index,
        anchor: copyPoint(entry.screen[index].point),
        handleIn: entry.screen[index].in.slice(),
        handleOut: entry.screen[index].out.slice(),
      });
    }
  }
  if (!selected.length) {
    const skippedLocked = [
      ...new Set(
        Object.keys(selection)
          .filter((pathId) => (selection[pathId] || []).length > 0)
          .map((pathId) => byId.get(pathId))
          .filter((path) => path && path.locked)
          .map((path) => path.id),
      ),
    ];
    const reason = failures.length ? failures[0].reason : skippedLocked.length ? "locked-selection" : "empty-selection";
    const result = blank(reason);
    result.message = failures.length ? failures[0].message : describeFailure(reason);
    result.skippedLocked = skippedLocked;
    result.failures = failures;
    return result;
  }
  const bounds = selectionBounds(selected.map((item) => item.anchor));
  const pivot =
    gesture.pivot === null || gesture.pivot === undefined
      ? copyPoint(bounds.center)
      : isFinitePoint(gesture.pivot)
        ? copyPoint(gesture.pivot)
        : null;
  if (!pivot) throw Error("A transform pivot must hold two finite numbers");
  const snapInput = gesture.snap === undefined ? {} : gesture.snap;
  const snapEnabled = snapInput !== false;
  const snapOptions = snapEnabled
    ? {
        guides: snapInput.guides || [],
        origin: snapInput.origin !== undefined ? snapInput.origin : gesture.origin,
        threshold: snapInput.threshold,
        includeVertices: snapInput.includeVertices !== undefined ? snapInput.includeVertices : true,
        extraVertices: Array.isArray(snapInput.vertices) ? snapInput.vertices : [],
      }
    : null;
  let snapTargets = [];
  if (snapEnabled) {
    const auto = snapOptions.includeVertices
      ? collectSnapVertices(
          projected.map((entry) => ({
            id: entry.id,
            vertices: entry.screen.map((vertex) => ({ point: vertex.point })),
          })),
          selection,
        )
      : [];
    snapTargets = [...auto, ...snapOptions.extraVertices];
  }
  const runSnap = (reference) =>
    snapEnabled
      ? snapPoint(reference, {
          vertices: snapTargets,
          guides: snapOptions.guides,
          origin: snapOptions.origin,
          threshold: snapOptions.threshold,
        })
      : unsnappedAt(reference);
  // Constrain first, then transform, then snap: snapping always sees the
  // constrained gesture.
  let transformed = null;
  let constrained = null;
  let applied = null;
  let snap = null;
  if (mode === "move") {
    const delta = constrainMoveDelta(gesture.delta || [0, 0], modifiers);
    constrained = { delta };
    const origin = isFinitePoint(gesture.origin) ? copyPoint(gesture.origin) : copyPoint(bounds.center);
    const reference = [origin[0] + delta[0], origin[1] + delta[1]];
    snap = runSnap(reference);
    const final = [delta[0] + snap.delta[0], delta[1] + snap.delta[1]];
    applied = { delta: final };
    transformed = selected.map((item) => ({
      ...item,
      anchor: [item.anchor[0] + final[0], item.anchor[1] + final[1]],
      handleIn: item.handleIn.slice(),
      handleOut: item.handleOut.slice(),
    }));
  } else if (mode === "scale") {
    const [rawSx, rawSy] = [gesture.sx === undefined ? 1 : gesture.sx, gesture.sy === undefined ? 1 : gesture.sy];
    const [fx, fy] = constrainScaleFactors(rawSx, rawSy, modifiers);
    constrained = { sx: fx, sy: fy };
    const handle = isFinitePoint(gesture.handle) ? copyPoint(gesture.handle) : null;
    let finalSx = fx,
      finalSy = fy;
    let shifted = [0, 0];
    if (handle) {
      const implied = [pivot[0] + (handle[0] - pivot[0]) * fx, pivot[1] + (handle[1] - pivot[1]) * fy];
      snap = runSnap(implied);
      const denomX = handle[0] - pivot[0],
        denomY = handle[1] - pivot[1];
      finalSx = Math.abs(denomX) > 1e-9 ? (snap.point[0] - pivot[0]) / denomX : fx;
      finalSy = Math.abs(denomY) > 1e-9 ? (snap.point[1] - pivot[1]) / denomY : fy;
    } else {
      const center = scalePoints(
        selected.map((item) => item.anchor),
        { pivot, sx: fx, sy: fy },
      );
      const middle = selectionBounds(center).center;
      snap = runSnap(middle);
      shifted = snap.delta;
    }
    applied = { sx: finalSx, sy: finalSy };
    transformed = selected.map((item) => ({
      ...item,
      anchor: [
        pivot[0] + (item.anchor[0] - pivot[0]) * finalSx + shifted[0],
        pivot[1] + (item.anchor[1] - pivot[1]) * finalSy + shifted[1],
      ],
      handleIn: transformHandleVector(item.handleIn, { mode: "scale", sx: finalSx, sy: finalSy }),
      handleOut: transformHandleVector(item.handleOut, { mode: "scale", sx: finalSx, sy: finalSy }),
    }));
  } else {
    const angle = constrainRotateAngle(gesture.angle === undefined ? 0 : gesture.angle, modifiers);
    constrained = { angle };
    const handle = isFinitePoint(gesture.handle) ? copyPoint(gesture.handle) : null;
    const radius = handle
      ? Math.hypot(handle[0] - pivot[0], handle[1] - pivot[1])
      : Math.max(1, ...selected.map((item) => Math.hypot(item.anchor[0] - pivot[0], item.anchor[1] - pivot[1])));
    let finalAngle = angle;
    let shifted = [0, 0];
    if (handle && radius > 1e-12) {
      const initialAngle = Math.atan2(handle[1] - pivot[1], handle[0] - pivot[0]);
      const direction = initialAngle + angle;
      const implied = [pivot[0] + Math.cos(direction) * radius, pivot[1] + Math.sin(direction) * radius];
      snap = runSnap(implied);
      if (snap.snapped) finalAngle = Math.atan2(snap.point[1] - pivot[1], snap.point[0] - pivot[0]) - initialAngle;
    } else {
      const turned = rotatePoints(
        selected.map((item) => item.anchor),
        { pivot, angle },
      );
      snap = runSnap(selectionBounds(turned).center);
      shifted = snap.delta;
    }
    applied = { angle: finalAngle };
    const cosine = Math.cos(finalAngle),
      sine = Math.sin(finalAngle);
    transformed = selected.map((item) => ({
      ...item,
      anchor: [
        pivot[0] + (item.anchor[0] - pivot[0]) * cosine - (item.anchor[1] - pivot[1]) * sine + shifted[0],
        pivot[1] + (item.anchor[0] - pivot[0]) * sine + (item.anchor[1] - pivot[1]) * cosine + shifted[1],
      ],
      handleIn: transformHandleVector(item.handleIn, { mode: "rotate", angle: finalAngle }),
      handleOut: transformHandleVector(item.handleOut, { mode: "rotate", angle: finalAngle }),
    }));
  }
  // Map the transformed screen geometry back through each path's inverse.
  // Locked paths are skipped as edit targets; their vertices above still
  // served as snap targets.
  const byPath = new Map();
  for (const item of transformed) {
    if (!byPath.has(item.pathId)) byPath.set(item.pathId, []);
    byPath.get(item.pathId).push(item);
  }
  const edited = [];
  const skippedLocked = [];
  for (const [pathId, items] of byPath) {
    const path = byId.get(pathId);
    if (path.locked) {
      skippedLocked.push(pathId);
      continue;
    }
    const matrix = path.matrix === undefined ? null : path.matrix;
    const next = path.vertices.map((vertex) => vertex);
    let failed = null;
    for (const item of items) {
      const anchor = screenToLocal(item.anchor, { matrix, projection });
      const knobIn = screenToLocal([item.anchor[0] + item.handleIn[0], item.anchor[1] + item.handleIn[1]], {
        matrix,
        projection,
      });
      const knobOut = screenToLocal([item.anchor[0] + item.handleOut[0], item.anchor[1] + item.handleOut[1]], {
        matrix,
        projection,
      });
      if (!anchor.ok || !knobIn.ok || !knobOut.ok) {
        failed = !anchor.ok ? anchor : !knobIn.ok ? knobIn : knobOut;
        break;
      }
      const source = path.vertices[item.vertexIndex];
      next[item.vertexIndex] = {
        ...source,
        point: [anchor.local[0], anchor.local[1]],
        in: mode === "move" ? copyPoint(source.in || [0, 0]) : [knobIn.local[0] - anchor.local[0], knobIn.local[1] - anchor.local[1]],
        out: mode === "move" ? copyPoint(source.out || [0, 0]) : [knobOut.local[0] - anchor.local[0], knobOut.local[1] - anchor.local[1]],
      };
    }
    if (failed) {
      failures.push({ id: pathId, reason: failed.reason || "singular-mapping", message: failed.message });
      continue;
    }
    edited.push({ id: pathId, vertices: next, changed: items.map((item) => item.vertexIndex) });
  }
  if (!edited.length) {
    const reason = failures.length ? failures[0].reason : "locked-selection";
    return {
      ok: false,
      reason,
      message: failures.length ? failures[0].message : describeFailure(reason),
      mode,
      pivot,
      bounds,
      constrained,
      applied,
      snap,
      paths: [],
      skippedLocked,
      failures,
    };
  }
  return {
    ok: true,
    reason: null,
    message: null,
    mode,
    pivot,
    bounds,
    constrained,
    applied,
    snap,
    paths: edited,
    skippedLocked,
    failures,
  };
}

module.exports = {
  SNAP_THRESHOLD_PX,
  ROTATE_SHIFT_STEP,
  MOVE_SHIFT_STEP,
  selectionBounds,
  defaultPivot,
  constrainMoveDelta,
  constrainScaleFactors,
  constrainRotateAngle,
  movePoints,
  scalePoints,
  rotatePoints,
  transformHandleVector,
  snapPoint,
  collectSnapVertices,
  freeTransform,
};
