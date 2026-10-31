"use strict";
const { triangulate: sweep } = require("./text-fill.js");
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
function area(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += cross(points[i], points[(i + 1) % points.length]);
  return sum / 2;
}
// Horizontal arrangement: split slabs at every vertex AND segment crossing.
// Within a slab edge order is fixed, so winding transitions bound disjoint
// trapezoids. This resolves holes, overlaps and self-intersections explicitly.
// No triangle overlaps another interior: alpha is applied once per paint.
// The sweep (spatial intersection pruning plus active-edge tracking) is
// shared with text-fill.js. Generic fills call it without text grouping, so
// every contour stays in one compound arrangement with the same triangles,
// in the same emission order, and with the same work-budget charges.
function triangulate(contours, rule = "nonzero") {
  return sweep(contours, rule);
}
module.exports = { area, triangulate };
