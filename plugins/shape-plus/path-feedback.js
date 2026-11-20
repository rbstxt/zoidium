"use strict";
// Pen cursor priority, hover badges, vertex/endpoint drawing instructions,
// and validated display preferences for shared path editing (design
// "Geometry and feedback"). Pure data: every function returns cursor
// records or drawing instructions; nothing here touches the canvas or the
// DOM, so the overlay (P2.7) renders them and tests assert them without
// pixel comparisons.
//
// Consumed contracts (hover and selection records from merged wave modules):
// - hover `target`: the `pickPaths` hit shape from `path-projection.js`
//   (`{ kind: "anchor" | "handle" | "segment", pathId, vertexIndex, ... }`),
//   stored opaquely on the controller through `setHover`
//   (`path-controller.js`) and ordered front to back for the
//   `path-selection.js` overlap cycler. Anchor targets may carry
//   `isEndpoint`/`pathClosed` for paths the pointer is not drawing.
// - selection: vertex ID sets owned by `path-controller.js`; only
//   membership is read here, so arrays and Sets both work.
// - drawing: the controller drawing record (`{ points, ... }`, plus the
//   active path's `closed` flag supplied by the caller) for the in-progress
//   open path; only `points.length` and `closed` are read.
//
// Provided:
// - `resolvePenCursor`: the five Pen states in priority order, each with a
//   distinct cursor token and badge (`o`, `/`, `-`, `+`, none).
// - `resolveSelectCursor` / `navigationCursor`: Selection and viewport
//   navigation cursors, disjoint from the Pen tokens.
// - `vertexInstruction` / `handleInstruction` / `segmentInstruction` /
//   `directionInstruction` / `pathInstructions`: per-element drawing
//   instructions. Colour always supplements shape: every state keeps a
//   distinct shape (badge, ring, square) and colour only reinforces it.
// - `normalizePrefs` / `DEFAULT_PREFS`: local UI display preferences
//   (vertex and handle sizes in CSS pixels), validated with English errors.

// Display defaults in CSS pixels (design "Geometry and feedback"). Draw
// size is configurable; the fixed 9 px hit radius in `path-selection.js`
// never changes with these.
const DEFAULT_VERTEX_PX = 8;
const DEFAULT_HANDLE_PX = 6;
const DEFAULT_PREFS = Object.freeze({ vertexSize: DEFAULT_VERTEX_PX, handleSize: DEFAULT_HANDLE_PX });

// Validated preference range in CSS pixels. Out-of-range values fall back
// to the default with an English error instead of being clamped silently.
const PREFS_MIN_PX = 2;
const PREFS_MAX_PX = 32;

// Endpoint rings draw larger than plain vertices so the close/continue
// target reads at pointer distance.
const ENDPOINT_ENLARGE = 1.5;

// Pen cursor priority, highest first (design "Geometry and feedback"):
// endpoint close, endpoint continue, vertex delete, segment add, then the
// empty-canvas start. Each state has a distinct cursor token; the badge is
// drawn next to the pointer by the overlay.
const PEN_CURSOR_PRIORITY = Object.freeze([
  "endpoint-close",
  "endpoint-continue",
  "vertex-delete",
  "segment-add",
  "canvas-start",
]);

const PEN_BADGES = Object.freeze({
  "endpoint-close": "o",
  "endpoint-continue": "/",
  "vertex-delete": "-",
  "segment-add": "+",
  "canvas-start": null,
});

// Canvas colours. Every state below also carries a distinct shape or badge,
// so colour never carries meaning alone.
const COLORS = Object.freeze({
  vertex: "#ffffff",
  vertexOutline: "#1b1b1b",
  selected: "#58a6ff",
  hoverDelete: "#e5484d",
  hoverAdd: "#58a6ff",
  endpointRing: "#58a6ff",
  directionArrow: "rgba(88,166,255,.7)",
});

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Validate local UI display preferences. Returns `{ prefs, errors }` where
// `prefs` always holds usable sizes (invalid fields fall back to defaults)
// and `errors` holds one English message per rejected field.
function normalizePrefs(input) {
  const errors = [];
  const prefs = { ...DEFAULT_PREFS };
  if (input === undefined || input === null) return { prefs, errors };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { prefs, errors: ["Display preferences must be an object."] };
  }
  for (const key of ["vertexSize", "handleSize"]) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (!isFiniteNumber(value) || value < PREFS_MIN_PX || value > PREFS_MAX_PX) {
      errors.push(
        `${key} must be a number from ${PREFS_MIN_PX} to ${PREFS_MAX_PX} px.`,
      );
      continue;
    }
    prefs[key] = value;
  }
  return { prefs, errors };
}

function penRecord(state) {
  return {
    tool: "pen",
    state,
    badge: PEN_BADGES[state],
    cursor: "pen-" + state,
    css: "crosshair",
  };
}

// Resolve the Pen cursor for one hover target. `target` is a
// `pickPaths`-style hit (or null on empty canvas); `drawing` is the
// controller drawing record with the active path's `closed` flag attached
// by the caller. Priority: a vertex that is both the first and the last
// point of the in-progress path (a single-point start) closes, so
// endpoint-close wins every tie by being tested first.
function resolvePenCursor({ target = null, drawing = null } = {}) {
  if (target && target.kind === "anchor" && Number.isInteger(target.vertexIndex)) {
    const index = target.vertexIndex;
    if (drawing && drawing.closed !== true && Array.isArray(drawing.points)) {
      const first = 0;
      const last = drawing.points.length - 1;
      if (index === first) return penRecord("endpoint-close");
      if (index === last) return penRecord("endpoint-continue");
    }
    if (!drawing && target.isEndpoint === true && target.pathClosed === false) {
      return penRecord("endpoint-continue");
    }
    return penRecord("vertex-delete");
  }
  if (target && target.kind === "segment" && Number.isInteger(target.segmentIndex)) {
    return penRecord("segment-add");
  }
  return penRecord("canvas-start");
}

// Resolve the Selection (V) cursor. Hovering a vertex, handle, or segment
// shows a hover cursor; empty canvas (or an active marquee drag) shows the
// marquee cursor. Tokens never overlap the Pen family.
function resolveSelectCursor({ target = null, marquee = false } = {}) {
  if (marquee) {
    return { tool: "select", state: "marquee", badge: null, cursor: "select-marquee", css: "crosshair" };
  }
  if (
    target &&
    (target.kind === "anchor" || target.kind === "handle" || target.kind === "segment")
  ) {
    return { tool: "select", state: "hover", badge: null, cursor: "select-hover", css: "default" };
  }
  return { tool: "select", state: "canvas", badge: null, cursor: "select", css: "default" };
}

// Viewport navigation cursor while Space-pan is held (P2.6 hands the drag
// to the viewport and restores the prior tool on release). Tokens never
// overlap the Pen or Selection families.
function navigationCursor({ panning = false } = {}) {
  if (panning) {
    return { tool: "navigate", state: "panning", badge: null, cursor: "pan-active", css: "grabbing" };
  }
  return { tool: "navigate", state: "pan", badge: null, cursor: "pan", css: "grab" };
}

// One vertex drawing instruction. `intent` is the Pen meaning of hovering
// this vertex (`"close"`, `"continue"`, `"delete"`, or null). Shape carries
// the state: selected vertices are filled squares, other vertices hollow
// squares, and the first vertex always adds a double ring (filled when
// selected). Hover only changes colour, badge, and endpoint size, never
// the shape itself.
function vertexInstruction({ selected = false, isFirst = false, intent = null, prefs = {} } = {}) {
  const { prefs: sizes } = normalizePrefs(prefs);
  let shape;
  if (selected && isFirst) shape = "filled-double-ring";
  else if (selected) shape = "filled-square";
  else if (isFirst) shape = "double-ring";
  else shape = "hollow-square";
  let size = sizes.vertexSize;
  let color = selected ? COLORS.selected : COLORS.vertex;
  let badge = null;
  if (intent === "close" || intent === "continue") {
    size *= ENDPOINT_ENLARGE;
    badge = PEN_BADGES[intent === "close" ? "endpoint-close" : "endpoint-continue"];
    color = selected ? COLORS.selected : COLORS.endpointRing;
  } else if (intent === "delete") {
    color = COLORS.hoverDelete;
    badge = PEN_BADGES["vertex-delete"];
  }
  return { shape, size, color, outline: COLORS.vertexOutline, badge, ring: isFirst ? "double" : "single" };
}

// One handle-knob drawing instruction. Handles are circles (never squares,
// so they cannot be mistaken for vertices); selection fills them.
function handleInstruction({ selected = false, prefs = {} } = {}) {
  const { prefs: sizes } = normalizePrefs(prefs);
  return {
    shape: "circle",
    size: sizes.handleSize,
    color: selected ? COLORS.selected : COLORS.vertex,
    outline: COLORS.vertexOutline,
  };
}

// One segment drawing instruction. A hovered add-segment keeps its path
// shape and gains the highlight colour.
function segmentInstruction({ highlighted = false } = {}) {
  return {
    shape: "segment",
    highlighted,
    color: highlighted ? COLORS.hoverAdd : COLORS.vertex,
  };
}

// Open-path direction arrow near the drawing end: a subtle chevron along
// the last segment. Closed paths and single points have no direction, so
// they return null instead of an arrow.
function directionInstruction({ closed = false, points = [] } = {}) {
  if (closed) return null;
  if (!Array.isArray(points) || points.length < 2) return null;
  const from = points[points.length - 2];
  const to = points[points.length - 1];
  if (!Array.isArray(from) || !Array.isArray(to)) return null;
  return {
    shape: "direction-arrow",
    from: from.slice(0, 2),
    to: to.slice(0, 2),
    color: COLORS.directionArrow,
  };
}

// Whole-path drawing instructions for the overlay. `vertices` holds
// `{ id, point }` entries in path order; `selectedIds` is the controller
// vertex selection (array or Set); `hover` is null or
// `{ kind: "anchor", vertexIndex, intent }` / `{ kind: "segment",
// segmentIndex }` in path-local indices. Returns `{ vertices, segments,
// direction, prefs, errors }` with no pixel work.
function pathInstructions({ vertices = [], closed = false, selectedIds = [], hover = null, prefs = {} } = {}) {
  const { prefs: sizes, errors } = normalizePrefs(prefs);
  const selected = new Set(selectedIds);
  const vertexResults = vertices.map((vertex, index) => {
    const isFirst = index === 0;
    let intent = null;
    if (hover && hover.kind === "anchor" && hover.vertexIndex === index) {
      intent = hover.intent === "close" || hover.intent === "continue" || hover.intent === "delete"
        ? hover.intent
        : null;
    }
    return {
      index,
      id: vertex && vertex.id !== undefined ? vertex.id : null,
      ...vertexInstruction({ selected: selected.has(vertex && vertex.id), isFirst, intent, prefs: sizes }),
    };
  });
  const segmentCount = closed ? vertices.length : Math.max(0, vertices.length - 1);
  const segments = [];
  for (let index = 0; index < segmentCount; index++) {
    segments.push({
      index,
      ...segmentInstruction({ highlighted: !!hover && hover.kind === "segment" && hover.segmentIndex === index }),
    });
  }
  const direction = directionInstruction({
    closed,
    points: vertices.map((vertex) => (vertex ? vertex.point : null)),
  });
  return { vertices: vertexResults, segments, direction, prefs: sizes, errors };
}

module.exports = {
  DEFAULT_VERTEX_PX,
  DEFAULT_HANDLE_PX,
  DEFAULT_PREFS,
  PREFS_MIN_PX,
  PREFS_MAX_PX,
  ENDPOINT_ENLARGE,
  PEN_CURSOR_PRIORITY,
  PEN_BADGES,
  COLORS,
  normalizePrefs,
  resolvePenCursor,
  resolveSelectCursor,
  navigationCursor,
  vertexInstruction,
  handleInstruction,
  segmentInstruction,
  directionInstruction,
  pathInstructions,
};
