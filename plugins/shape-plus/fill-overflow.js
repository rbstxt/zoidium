"use strict";
const { check } = require("./geometry-budget.js");

// The original 4096-edge cap bounds CPU arrangement work. GPU geometry is an
// unindexed Float32 position buffer. Overflow can use more edges without
// changing flattening tolerance, provided work and allocation stay bounded.
function triangulate(contours, rule, sweep) {
  let vertices = 0, edges = 0, pairs = 0, visits = 0;
  const budget = {
    pair() {
      if (++pairs > 4000000) throw Error("Shape+ intersection work budget exceeded");
      if ((pairs & 255) === 0) check();
    },
    slab(count) {
      visits += count;
      if (visits > 16000000) throw Error("Shape+ arrangement work budget exceeded");
    },
  };
  const boxes = [];
  for (const [index, points] of contours.entries()) {
    if (points.length < 3) continue;
    vertices += points.length;
    if (vertices > 131072) throw Error("Shape+ polygon vertex budget exceeded");
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (!a.concat(b).every(Number.isFinite)) throw Error("Shape+ nonfinite polygon");
      left = Math.min(left, a[0]); right = Math.max(right, a[0]);
      bottom = Math.min(bottom, a[1]); top = Math.max(top, a[1]);
      if (a[1] !== b[1] && ++edges > 65536) throw Error("Shape+ polygon edge budget exceeded");
      if ((i & 255) === 0) check();
    }
    boxes.push({ index, left, right, bottom, top, parent: boxes.length });
  }
  const root = index => {
    while (boxes[index].parent !== index) {
      boxes[index].parent = boxes[boxes[index].parent].parent;
      index = boxes[index].parent;
    }
    return index;
  };
  const ordered = boxes.map((box, index) => ({ ...box, node: index }))
    .sort((a, b) => a.left - b.left || a.index - b.index);
  // Bounds include touching contours and nested holes. Components with
  // disjoint bounds cannot affect each other's winding for either fill rule.
  // Keep all intersecting bounds together, including transformed glyphs.
  for (let i = 0; i < ordered.length; i++) {
    check();
    for (let j = i + 1; j < ordered.length && ordered[j].left <= ordered[i].right + 1e-9; j++) {
      budget.pair();
      const a = ordered[i], b = ordered[j];
      if (b.bottom > a.top + 1e-9 || b.top < a.bottom - 1e-9) continue;
      const first = root(a.node), second = root(b.node);
      if (first !== second) boxes[second].parent = first;
    }
  }
  const components = new Map();
  for (let i = 0; i < boxes.length; i++) {
    const key = root(i);
    if (!components.has(key)) components.set(key, []);
    components.get(key).push(contours[boxes[i].index]);
  }
  const positions = [];
  for (const component of components.values()) {
    const part = sweep(component, rule, undefined, budget);
    if (positions.length + part.length > 1800000) throw Error("Shape+ triangle budget exceeded");
    // Avoid an argument-count limit when a connected component is large.
    for (const coordinate of part) positions.push(coordinate);
  }
  return positions;
}
module.exports = { triangulate };
