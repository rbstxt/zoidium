"use strict";

// Effector core math. Pure functions over plain typed arrays and column-major
// 4x4 matrices: no THREE, PZ, or DOM access, so every deformer can be tested
// in Node and evaluated identically for any frame, playback order, or cache
// state. Positions are flat Float32Array [x, y, z, ...].

const MAX_SMOOTH_TRIANGLES = 400000;
const SMOOTH_TRIANGLE_BUDGET_MIN_POLYGONS = 2;
const TINY = 1e-9;
const SERIES_LIMIT = 1e-4;
// Rotation planes used by a twist about each axis (X, Y, Z).
const TWIST_PLANES = [
  [1, 2],
  [2, 0],
  [0, 1],
];

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampIndex(value, maximum) {
  const number = Math.round(finiteOr(value, 0));
  return number < 0 ? 0 : number > maximum ? maximum : number;
}

function clampUnit(value) {
  if (!(value > 0)) return 0;
  return value < 1 ? value : 1;
}

// Deterministic hash in [0, 1). The same seed, index, and channel always give
// the same value; no Math.random or clock is involved.
function hash01(seed, index, channel) {
  let value = (Math.trunc(finiteOr(seed, 0)) | 0) ^ Math.imul((index | 0) + 1, 0x45d9f3b);
  value ^= Math.imul((channel | 0) + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

// Uniformly distributed unit vector derived from three hash channels.
function hashUnitVector(seed, index, channel) {
  const x = 2 * hash01(seed, index, channel) - 1;
  const y = 2 * hash01(seed, index, channel + 1) - 1;
  const z = 2 * hash01(seed, index, channel + 2) - 1;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (!(length > TINY)) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

// Min and max of one component across a flat position array.
function axisBounds(positions, axis) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = axis; index < positions.length; index += 3) {
    const value = positions[index];
    if (!Number.isFinite(value)) continue;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return minimum <= maximum ? [minimum, maximum] : null;
}

function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis];
      if (!Number.isFinite(value)) continue;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  if (min[0] > max[0]) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  return { min, max };
}

// Field weights in [0, 1]. Type 0 is infinite (always 1), 1 is linear along
// X, 2 is a box, and 3 is a sphere. Zero or negative scales are clamped to a
// tiny positive magnitude, and non-finite results collapse to zero so a
// degenerate field can never introduce NaN into a vertex.
function fieldWeight(x, y, z, type, position, scale) {
  if (!type) return 1;
  const sx = Math.max(Math.abs(scale[0]), TINY);
  const sy = Math.max(Math.abs(scale[1]), TINY);
  const sz = Math.max(Math.abs(scale[2]), TINY);
  let weight = 1;
  if (type === 1) {
    const dx = x - position[0];
    weight = 1 - Math.max(0, dx) / sx;
  } else if (type === 2) {
    const dx = Math.abs(x - position[0]) / (0.5 * sx);
    const dy = Math.abs(y - position[1]) / (0.5 * sy);
    const dz = Math.abs(z - position[2]) / (0.5 * sz);
    const distance = Math.max(dx, dy, dz);
    weight = distance <= 1 ? 1 : 1 - (distance - 1);
  } else if (type === 3) {
    const dx = x - position[0];
    const dy = y - position[1];
    const dz = z - position[2];
    weight = 1 - Math.sqrt(dx * dx + dy * dy + dz * dz) / sx;
  }
  return Number.isFinite(weight) ? clampUnit(weight) : 0;
}

// Rotates vertices about one axis by a continuous angle (radians). The pivot is
// the midpoint of the object's extent along the axis plus an offset, and the
// angle scales linearly across the extent, so the transform is continuous.
// Positions are changed in place. Zero size or zero angle is an identity.
function twistPositions(positions, angle, axis, offset) {
  if (!angle || !Number.isFinite(angle)) return positions;
  const along = clampIndex(axis, 2);
  const bounds = axisBounds(positions, along);
  if (!bounds) return positions;
  const size = bounds[1] - bounds[0];
  if (!(size > 0) || !Number.isFinite(size)) return positions;
  const pivot = 0.5 * (bounds[0] + bounds[1]) + finiteOr(offset, 0);
  const [first, second] = TWIST_PLANES[along];
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const theta = angle * ((positions[index + along] - pivot) / size);
    const cosine = Math.cos(theta);
    const sine = Math.sin(theta);
    const firstValue = positions[index + first];
    const secondValue = positions[index + second];
    positions[index + first] = firstValue * cosine - secondValue * sine;
    positions[index + second] = firstValue * sine + secondValue * cosine;
  }
  return positions;
}

// sin(t) / t with a series near zero, so the bend stays finite as the
// curvature approaches zero.
function sincSeries(theta) {
  if (Math.abs(theta) < SERIES_LIMIT) return 1 - (theta * theta) / 6;
  return Math.sin(theta) / theta;
}

// (1 - cos t) / t with a series near zero.
function oneMinusCosOverSeries(theta) {
  if (Math.abs(theta) < SERIES_LIMIT) return theta / 2;
  return (1 - Math.cos(theta)) / theta;
}

// Bends vertices into an arc. Strength is the total angle across the object's
// extent (radians). With a field, each vertex's curvature is multiplied by its
// field weight. Algebraically this equals sin(k s) / k and (1 - cos(k s)) / k
// with s = x - pivot, rewritten with sinc so the zero-curvature limit is exact.
function warpPositions(positions, strength, axis, offset, field) {
  if (!strength || !Number.isFinite(strength)) return positions;
  const alongAxis = 0;
  const bendAxis = clampIndex(axis, 1) === 1 ? 2 : 1;
  const bounds = axisBounds(positions, alongAxis);
  if (!bounds) return positions;
  const size = bounds[1] - bounds[0];
  if (!(size > 0) || !Number.isFinite(size)) return positions;
  const pivot = 0.5 * (bounds[0] + bounds[1]) + finiteOr(offset, 0);
  const curvature = strength / size;
  const fieldType = field ? clampIndex(field.type, 3) : 0;
  const fieldPosition = field ? field.position : null;
  const fieldScale = field ? field.scale : null;
  for (let index = 0; index + 2 < positions.length; index += 3) {
    let weight = 1;
    if (fieldType) {
      weight = fieldWeight(
        positions[index],
        positions[index + 1],
        positions[index + 2],
        fieldType,
        fieldPosition,
        fieldScale
      );
      if (weight <= 0) continue;
    }
    const effective = curvature * weight;
    if (!effective) continue;
    const along = positions[index + alongAxis] - pivot;
    const theta = effective * along;
    positions[index + alongAxis] = pivot + along * sincSeries(theta);
    positions[index + bendAxis] += along * oneMinusCosOverSeries(theta);
  }
  return positions;
}

// Column-major 4x4 helpers. Matrices are arrays or typed arrays of 16 values
// as produced by THREE.Matrix4.elements.
function multiplyMatrices(a, b) {
  const out = new Float64Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

// General 4x4 inverse (cofactor expansion). Returns null when singular.
function invertMatrix(m) {
  const inv = new Float64Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const determinant = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < TINY) return null;
  const scale = 1 / determinant;
  for (let index = 0; index < 16; index += 1) inv[index] *= scale;
  return inv;
}

function isIdentityMatrix(m) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let index = 0; index < 16; index += 1) {
    if (Math.abs(m[index] - identity[index]) > 1e-9) return false;
  }
  return true;
}

// Transform that maps mesh-local points into the deformer's local space and
// back. Returns null when the deformer's transform is singular (for example a
// zero scale), so the caller can skip that deformer instead of dividing by zero.
function relativeTransform(deformerWorld, meshWorld) {
  if (!deformerWorld || !meshWorld) return { forward: null, inverse: null, identity: true };
  const deformerInverse = invertMatrix(deformerWorld);
  if (!deformerInverse) return null;
  const forward = multiplyMatrices(deformerInverse, meshWorld);
  if (isIdentityMatrix(forward)) return { forward: null, inverse: null, identity: true };
  const inverse = invertMatrix(forward);
  if (!inverse) return null;
  return { forward, inverse, identity: false };
}

// Applies an affine column-major matrix to a flat position array in place.
function transformPositions(positions, m) {
  for (let index = 0; index + 2 < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    const z = positions[index + 2];
    positions[index] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[index + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[index + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return positions;
}

function transformPoint(point, m) {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

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

function materialIndexAt(groups, offset) {
  for (const group of groups || []) {
    if (offset >= group.start && offset < group.start + group.count) {
      return Number.isFinite(group.materialIndex) ? group.materialIndex : 0;
    }
  }
  return 0;
}

// Refines every source triangle into `polygonCount` smaller triangles with
// linearly interpolated attributes. Nonlinear deformers can only bend the
// vertices they receive, so refinement is what makes Smooth curves look smooth.
// The result is a new non-indexed stage; the input stage is not modified.
function subdivideStage(stage, polygonCount) {
  const template = getSubdivisionTemplate(polygonCount);
  const index = stage.index;
  const sourceIndexCount = index ? index.length : stage.count;
  const triangleCount = Math.floor(sourceIndexCount / 3);
  const sourcePositions = stage.positions;
  const names = Object.keys(stage.attributes || {});
  const outputCount = triangleCount * template.length * 3;
  const positions = new Float32Array(outputCount * 3);
  const attributes = {};
  for (const name of names) {
    const attribute = stage.attributes[name];
    attributes[name] = {
      array: new Float32Array(outputCount * attribute.itemSize),
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
    };
  }
  const groups = [];
  let output = 0;
  const finite = (value) => (Number.isFinite(value) ? value : 0);

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const sources = [
      index ? Number(index[offset]) : offset,
      index ? Number(index[offset + 1]) : offset + 1,
      index ? Number(index[offset + 2]) : offset + 2,
    ];
    const start = output;
    const materialIndex = materialIndexAt(stage.groups, offset);
    for (const weights of template) {
      for (const vertexWeights of weights) {
        for (let component = 0; component < 3; component += 1) {
          positions[output * 3 + component] =
            vertexWeights[0] * finite(sourcePositions[sources[0] * 3 + component]) +
            vertexWeights[1] * finite(sourcePositions[sources[1] * 3 + component]) +
            vertexWeights[2] * finite(sourcePositions[sources[2] * 3 + component]);
        }
        for (const name of names) {
          const attribute = stage.attributes[name];
          const target = attributes[name].array;
          for (let component = 0; component < attribute.itemSize; component += 1) {
            target[output * attribute.itemSize + component] =
              vertexWeights[0] * finite(attribute.array[sources[0] * attribute.itemSize + component]) +
              vertexWeights[1] * finite(attribute.array[sources[1] * attribute.itemSize + component]) +
              vertexWeights[2] * finite(attribute.array[sources[2] * attribute.itemSize + component]);
          }
        }
        output += 1;
      }
    }
    const previous = groups[groups.length - 1];
    if (previous && previous.materialIndex === materialIndex && previous.start + previous.count === start) {
      previous.count += output - start;
    } else {
      groups.push({ start, count: output - start, materialIndex });
    }
  }

  return {
    kind: "subdivided",
    smooth: true,
    count: output,
    positions,
    attributes,
    index: null,
    indexRef: null,
    groups,
    uvs: attributes.uv ? attributes.uv.array : null,
    ...boundsOf(positions),
  };
}

module.exports = {
  MAX_SMOOTH_TRIANGLES,
  SMOOTH_TRIANGLE_BUDGET_MIN_POLYGONS,
  TWIST_PLANES,
  boundsOf,
  clampIndex,
  clampPolygonCount,
  clampUnit,
  fieldWeight,
  finiteOr,
  hash01,
  hashUnitVector,
  invertMatrix,
  isIdentityMatrix,
  multiplyMatrices,
  oneMinusCosOverSeries,
  relativeTransform,
  sincSeries,
  subdivideStage,
  transformPoint,
  transformPositions,
  twistPositions,
  warpPositions,
  getSubdivisionTemplate,
};
