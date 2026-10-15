"use strict";

// Exact arbitrary-count template from be6ea2b^, also present in 78ee9e9.
const MAX_SMOOTH_TRIANGLES = 400000;
const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

function clampPolygonCount(value) {
  return Math.min(MAX_SMOOTH_TRIANGLES, Math.max(1, Math.round(finiteOr(value, 1))));
}

// Triangle templates for Smooth curve quality. Each template is three
// barycentric weight vectors. Splitting is deterministic and reaches any count
// from 1 to the request by quadrisection and then bisection.
const templateCache = new Map();

function midpoint(first, second) {
  return [
    0.5 * (first[0] + second[0]),
    0.5 * (first[1] + second[1]),
    0.5 * (first[2] + second[2]),
  ];
}

function splitFour([first, second, third]) {
  const firstSecond = midpoint(first, second);
  const secondThird = midpoint(second, third);
  const thirdFirst = midpoint(third, first);
  return [
    [first, firstSecond, thirdFirst],
    [firstSecond, second, secondThird],
    [thirdFirst, secondThird, third],
    [firstSecond, secondThird, thirdFirst],
  ];
}

function squaredDistance(first, second) {
  const x = first[0] - second[0];
  const y = first[1] - second[1];
  const z = first[2] - second[2];
  return x * x + y * y + z * z;
}

function splitTwo([first, second, third]) {
  const firstSecond = squaredDistance(first, second);
  const secondThird = squaredDistance(second, third);
  const thirdFirst = squaredDistance(third, first);
  if (firstSecond >= secondThird && firstSecond >= thirdFirst) {
    const edge = midpoint(first, second);
    return [[first, edge, third], [edge, second, third]];
  }
  if (secondThird >= thirdFirst) {
    const edge = midpoint(second, third);
    return [[second, edge, first], [edge, third, first]];
  }
  const edge = midpoint(third, first);
  return [[third, edge, second], [edge, first, second]];
}

function getSubdivisionTemplate(polygonCount) {
  const target = clampPolygonCount(polygonCount);
  if (templateCache.has(target)) return templateCache.get(target);
  let triangles = [{ vertices: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], depth: 0 }];
  while (triangles.length * 4 <= target) {
    const next = [];
    for (const triangle of triangles) {
      for (const vertices of splitFour(triangle.vertices)) {
        next.push({ vertices, depth: triangle.depth + 1 });
      }
    }
    triangles = next;
  }
  while (triangles.length < target) {
    let splitIndex = 0;
    for (let index = 1; index < triangles.length; index += 1) {
      if (triangles[index].depth < triangles[splitIndex].depth) splitIndex = index;
    }
    const triangle = triangles[splitIndex];
    const depth = triangle.depth + 1;
    triangles.splice(
      splitIndex,
      1,
      ...splitTwo(triangle.vertices).map((vertices) => ({ vertices, depth }))
    );
  }
  const result = triangles.map((triangle) => triangle.vertices);
  templateCache.set(target, result);
  return result;
}

function budgetSubdivision(requested, budget) {
  return Math.min(clampPolygonCount(requested), budget);
}

const CURVE_QUALITY_LOW = 0, CURVE_QUALITY_SMOOTH = 1;
const DEFAULT_SMOOTH_POLYGON_COUNT = 16, MIN_SMOOTH_POLYGON_COUNT = 1, MAX_SMOOTH_POLYGON_COUNT = 256;
function integerValue(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Math.round(Number.isFinite(number) ? number : fallback)));
}

function curvePolygonCount(effectors, frame, readers) {
  const { numberPropertyValue, optionPropertyValue } = readers;
  let polygonCount = CURVE_QUALITY_LOW;
  for (const effector of effectors) {
    if (!effector.properties?.curveQuality) continue;
    const intensityProperty = effector.properties.angle || effector.properties.amount;
    if (intensityProperty && !numberPropertyValue(intensityProperty, frame, 0)) continue;
    const quality = optionPropertyValue(effector.properties.curveQuality, frame, CURVE_QUALITY_SMOOTH);
    if (quality === CURVE_QUALITY_SMOOTH) {
      polygonCount = Math.max(
        polygonCount,
        integerValue(
          numberPropertyValue(effector.properties.polygonCount, frame, DEFAULT_SMOOTH_POLYGON_COUNT),
          DEFAULT_SMOOTH_POLYGON_COUNT,
          MIN_SMOOTH_POLYGON_COUNT,
          MAX_SMOOTH_POLYGON_COUNT
        )
      );
    }
  }
  return polygonCount;
}

module.exports = { getSubdivisionTemplate, budgetSubdivision, curvePolygonCount };
