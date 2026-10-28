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
    let order, start = 0, end = points.length + 1;
    for (let axis = 0; axis < 3; axis++) {
      // Include roundoff in a + t * (b - a), as well as the distance tolerance.
      const padding = epsilon * 4 + Math.max(Math.abs(a[axis]), Math.abs(b[axis]), 1) * Number.EPSILON * 32;
      low[axis] = Math.min(a[axis], b[axis]) - padding;
      high[axis] = Math.max(a[axis], b[axis]) + padding;
      const first = bound(axes[axis], axis, low[axis], false);
      const last = bound(axes[axis], axis, high[axis], true);
      if (last - first < end - start) { order = axes[axis]; start = first; end = last; }
    }
    const candidates = [];
    for (let i = start; i < end; i++) {
      const id = order[i], p = points[id];
      if (p[0] >= low[0] && p[0] <= high[0] && p[1] >= low[1] && p[1] <= high[1] &&
        p[2] >= low[2] && p[2] <= high[2]) candidates.push(id);
    }
    return candidates;
  };
}

module.exports = { createEdgePointIndex };
