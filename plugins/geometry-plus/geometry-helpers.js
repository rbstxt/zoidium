"use strict";

// Geometry+ shared value helpers: finite-number reads with fallbacks. Pure
// and dependency-free; every other Geometry+ file builds on these.

const markGeometryDirty = function () {
  if (this.parentObject) {
    this.parentObject.geometryNeedsUpdate = true;
    this.parentObject._geometrySignature = undefined;
  }
};

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function vectorValue(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  return [
    numberValue(value[0], fallback[0]),
    numberValue(value[1], fallback[1]),
    numberValue(value[2], fallback[2]),
  ];
}

function integerValue(value, fallback, minimum) {
  return Math.max(minimum, Math.round(numberValue(value, fallback)));
}
module.exports = {
  markGeometryDirty,
  numberValue,
  vectorValue,
  integerValue,
};
