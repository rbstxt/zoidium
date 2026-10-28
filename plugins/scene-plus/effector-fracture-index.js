"use strict";

// An edge can only regain boundary vertices inside its padded coordinate
// bounds. Search the sparsest sorted axis, then test the other coordinates.
// The caller retains the original projection and distance predicates.
function createEdgePointIndex(points, epsilon) {
  const ids = points.map((_, index) => index);
  const axes = points.length < 32 ? null : [0, 1, 2].map(axis =>
    ids.slice().sort((a, b) => points[a][axis] - points[b][axis] || a - b));

  function bound(order, axis, value, upper) {
    let low = 0, high = order.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const coordinate = points[order[middle]][axis];
      if (coordinate < value || (upper && coordinate === value)) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  return (a, b) => {
    if (!axes) return ids;
    const low = [], high = [];
    let selected = 0, smallest = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      // Include roundoff in a + t * (b - a), as well as the distance tolerance.
      const padding = epsilon * 4 + Math.max(Math.abs(a[axis]), Math.abs(b[axis]), 1) * Number.EPSILON * 32;
      low[axis] = Math.min(a[axis], b[axis]) - padding;
      high[axis] = Math.max(a[axis], b[axis]) + padding;
      const spread = points[axes[axis][points.length - 1]][axis] - points[axes[axis][0]][axis];
      const fraction = spread > 0 ? (high[axis] - low[axis]) / spread : Infinity;
      if (fraction < smallest) { selected = axis; smallest = fraction; }
    }
    const order = axes[selected];
    const start = bound(order, selected, low[selected], false);
    const end = bound(order, selected, high[selected], true);
    const candidates = [];
    for (let i = start; i < end; i++) {
      const id = order[i], p = points[id];
      if (p[0] >= low[0] && p[0] <= high[0] && p[1] >= low[1] && p[1] <= high[1] &&
        p[2] >= low[2] && p[2] <= high[2]) candidates.push(id);
    }
    return candidates;
  };
}

// Classify whole groups of original triangles before visiting their records.
// Clipped polygons and caps use the ordinary clipper, so interpolation roundoff
// never needs to fit the original source bounds.
function createPolygonPlaneIndex(polygons) {
  const order = polygons.map((_, i) => i);
  const bounds = polygons.map(polygon => {
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (const { p } of polygon.points) for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], p[axis]);
      high[axis] = Math.max(high[axis], p[axis]);
    }
    return { low, high };
  });
  function build(start, end) {
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], bounds[order[i]].low[axis]);
      high[axis] = Math.max(high[axis], bounds[order[i]].high[axis]);
    }
    const node = { start, end, low, high };
    if (end - start > 16) {
      let axis = 0;
      for (let i = 1; i < 3; i++) if (high[i] - low[i] > high[axis] - low[axis]) axis = i;
      const sorted = order.slice(start, end).sort((a, b) =>
        (bounds[a].low[axis] + bounds[a].high[axis]) - (bounds[b].low[axis] + bounds[b].high[axis]) || a - b);
      for (let i = 0; i < sorted.length; i++) order[start + i] = sorted[i];
      const middle = (start + end) >>> 1;
      node.left = build(start, middle); node.right = build(middle, end);
    }
    return node;
  }
  const root = build(0, order.length), sides = new Uint8Array(order.length);
  function side(box, plane, epsilon) {
    const { low, high } = box;
    const n = [plane.nx, plane.ny, plane.nz];
    let minimum = -plane.d, maximum = -plane.d, magnitude = Math.abs(plane.d);
    for (let axis = 0; axis < 3; axis++) {
      const a = n[axis] * low[axis], b = n[axis] * high[axis];
      minimum += Math.min(a, b); maximum += Math.max(a, b);
      magnitude += Math.max(Math.abs(a), Math.abs(b));
    }
    // The original dot product adds d last. Keep uncertain roundoff and all
    // epsilon boundary cases in the original clipper, including translations.
    const roundoff = magnitude * Number.EPSILON * 16;
    if (maximum < epsilon - roundoff) return 1;
    if (minimum > epsilon + roundoff) return 2;
    return 0;
  }
  function visit(node, plane, epsilon) {
    const classification = side(node, plane, epsilon);
    if (classification) {
      for (let i = node.start; i < node.end; i++) sides[order[i]] = classification;
    } else if (node.left) {
      visit(node.left, plane, epsilon); visit(node.right, plane, epsilon);
    } else {
      for (let i = node.start; i < node.end; i++) sides[order[i]] = side(bounds[order[i]], plane, epsilon);
    }
  }
  return (plane, epsilon) => { visit(root, plane, epsilon); return sides; };
}

module.exports = { createEdgePointIndex, createPolygonPlaneIndex };
