"use strict";
const { matrix, identity, transform } = require("./compiler.js");
const { multiply, inverse } = require("./editor-geometry.js");
// All coordinates here are CSS pixels. Renderer backing size, quality and DPR
// do not enter the mapping. The canvas rect already includes letterboxing.
function createMapping(rect, resolution, layer, groups = []) {
  const [width, height] = resolution;
  if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0)) return null;
  const display = [rect.width / width, 0, 0, -rect.height / height, rect.width / 2, rect.height / 2];
  const world = groups.reduce((m, group) => multiply(m, matrix(group)), matrix(layer));
  const forward = multiply(display, world), backward = inverse(forward);
  if (!backward || !forward.every(Number.isFinite)) return null;
  return {
    forward,
    screen: point => transform(point, forward),
    local: point => transform(point, backward),
    client: point => transform([point[0] - rect.left, point[1] - rect.top], backward),
  };
}
function displayMatrix(rect, resolution, properties) {
  return createMapping(rect, resolution, properties)?.forward || null;
}
module.exports = { createMapping, displayMatrix, identity };
