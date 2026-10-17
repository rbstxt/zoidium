"use strict";
const topology = require("./topology.js");
const { check } = require("./geometry-budget.js");
// Union small spatially adjacent batches before the global sweep. This removes
// segment interiors before Clipper sees all the crossings of a freehand path.
// The same outlines, caps and joins feed both algorithms. Integer rounding is
// bounded by 1/1024 pixel and each paint still has disjoint triangles.
function stroke(paths, style, tolerance) {
  const profiled = style.dashPairs > 0 || style.startLength > 0 || style.endLength > 0 || style.waveAmount > 0;
  const source = profiled ? require("./stroke-profile.js").profile(paths, style) : paths;
  const polygons = require("./stroke-contours.js").contours(source, style, tolerance);
  const integers = topology.integerPaths(polygons.map(points => ({points,closed:true})),262144);
  check();
  const batches = [topology.intersectionBudget(() => topology.clip(integers, [], "add"))];
  const resolved = (batches[0] || []).map(polygon => ({ closed: true, points: polygon.map(p => [p.X / topology.GRID, p.Y / topology.GRID]) }));
  return topology.tessellate(resolved, "nonzero", false, 262144);
}
module.exports = { stroke };
