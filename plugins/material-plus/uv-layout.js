// Shared texture layout for Material+ materials.
//
// CM3 builds 3D Text and extruded shapes with Three.js TextGeometry /
// ExtrudeGeometry, whose WorldUVGenerator maps UVs in object units: caps use raw
// x/y and side walls project x|y against z, so curved and slanted walls shear.
// Every Material+ material that samples a texture through the mesh UVs uses
// this layout instead: caps use the text bounds, side walls unwrap along the
// outline (arc length in U, depth in V), and the text height sets the texture
// unit. The unwrap works on the finished geometry only: it rebuilds each
// outline from the side walls, so it needs no access to the font or the source
// shapes.
//
// The original UVs are stored on the geometry and restored when the last
// layout material leaves the object, so native CM3 materials keep their look.
// Effectors render a working copy; they publish the source geometry as
// `mesh.__zoidiumSourceGeometry` and rebuild when `__zoidiumUvRevision` changes.
return function createUvLayout() {
"use strict";

const UV_EPSILON = 1e-6;
const UV_DISTANCE_EPSILON = 1e-12;
const UV_QUANTIZE = 1e4;

/* --------------------------------------------------------------- UV unwrap */

function uvQuantize(x, y) {
  return `${Math.round(x * UV_QUANTIZE)},${Math.round(y * UV_QUANTIZE)}`;
}

// Rebuild the closed outline(s) of an extruded legacy Geometry from its side
// walls: the two lowest vertices of a wall triangle are consecutive outline
// points. This recovers the contour order without the original shapes.
function uvReconstructContours(geometry) {
  const vertices = geometry.vertices;
  const faces = geometry.faces;
  const nodes = new Map();
  const adjacency = new Map();

  function addEdge(a, b) {
    const keyA = uvQuantize(a.x, a.y);
    const keyB = uvQuantize(b.x, b.y);
    if (keyA === keyB) return;
    if (!nodes.has(keyA)) {
      nodes.set(keyA, { x: a.x, y: a.y });
      adjacency.set(keyA, new Set());
    }
    if (!nodes.has(keyB)) {
      nodes.set(keyB, { x: b.x, y: b.y });
      adjacency.set(keyB, new Set());
    }
    adjacency.get(keyA).add(keyB);
    adjacency.get(keyB).add(keyA);
  }

  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    const indices = [face.a, face.b, face.c];
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < indices.length; index += 1) {
      const z = vertices[indices[index]]?.z ?? 0;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (maxZ - minZ <= UV_EPSILON) continue; // cap plane

    const bottom = [];
    for (let index = 0; index < indices.length; index += 1) {
      if (Math.abs(vertices[indices[index]].z - minZ) <= UV_EPSILON) {
        bottom.push(vertices[indices[index]]);
      }
    }
    if (bottom.length === 2) addEdge(bottom[0], bottom[1]);
  }

  const visited = new Set();
  const contours = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const cycle = [];
    let previous = null;
    let current = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      cycle.push(nodes.get(current));
      const neighbors = Array.from(adjacency.get(current));
      let next = neighbors.find((key) => key !== previous && !visited.has(key));
      if (!next && neighbors.includes(start)) next = start;
      previous = current;
      current = next;
    }
    if (cycle.length >= 3) contours.push(cycle);
  }
  return contours;
}

function uvPrepareContours(contours) {
  const prepared = [];
  for (let index = 0; index < contours.length; index += 1) {
    const points = contours[index];
    if (!Array.isArray(points) || points.length < 2) continue;

    const cumulative = [0];
    let total = 0;
    for (let point = 0; point < points.length; point += 1) {
      const current = points[point];
      const next = points[(point + 1) % points.length];
      total += Math.hypot(next.x - current.x, next.y - current.y);
      cumulative.push(total);
    }
    if (!(total > 0)) continue;
    prepared.push({ points, cumulative, total });
  }
  return prepared;
}

// Keep segments in their original contour order. Bounding boxes skip distant
// ranges without changing the epsilon ties or the closing seam's first match.
// Spatially reordering nearest segments would change UVs on ambiguous walls.
function uvBuildOutlineIndex(prepared) {
  const segments = [];
  for (const contour of prepared) {
    for (let point = 0; point < contour.points.length; point += 1) {
      const a = contour.points[point];
      const b = contour.points[(point + 1) % contour.points.length];
      segments.push({ contour, point, index: segments.length,
        minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y),
        centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2 });
    }
  }
  function build(start, end) {
    const node = { start, end, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    if (end - start > 8) {
      const middle = Math.floor((start + end) / 2);
      node.left = build(start, middle);
      node.right = build(middle, end);
      node.minX = Math.min(node.left.minX, node.right.minX);
      node.minY = Math.min(node.left.minY, node.right.minY);
      node.maxX = Math.max(node.left.maxX, node.right.maxX);
      node.maxY = Math.max(node.left.maxY, node.right.maxY);
    } else {
      for (let index = start; index < end; index += 1) {
        const { contour, point } = segments[index];
        const a = contour.points[point];
        const b = contour.points[(point + 1) % contour.points.length];
        node.minX = Math.min(node.minX, a.x, b.x);
        node.minY = Math.min(node.minY, a.y, b.y);
        node.maxX = Math.max(node.maxX, a.x, b.x);
        node.maxY = Math.max(node.maxY, a.y, b.y);
      }
    }
    return node;
  }
  // Bevel rings can overlap throughout contour order. A second tree groups
  // segments spatially for nearest searches; the ordered tree remains the
  // exact fallback for epsilon transitions.
  function buildSpatial(entries) {
    const node = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const segment of entries) {
      node.minX = Math.min(node.minX, segment.minX);
      node.minY = Math.min(node.minY, segment.minY);
      node.maxX = Math.max(node.maxX, segment.maxX);
      node.maxY = Math.max(node.maxY, segment.maxY);
    }
    if (entries.length <= 8) node.indices = entries.map(segment => segment.index);
    else {
      const axis = node.maxX - node.minX >= node.maxY - node.minY ? "centerX" : "centerY";
      entries.sort((a, b) => a[axis] - b[axis] || a.index - b.index);
      const middle = Math.floor(entries.length / 2);
      node.left = buildSpatial(entries.slice(0, middle));
      node.right = buildSpatial(entries.slice(middle));
    }
    return node;
  }
  return { segments, root: build(0, segments.length), spatialRoot: buildSpatial(segments.slice()) };
}

// Every segment tied for the minimum distance is returned: the outline's
// closing point is shared by two segments and projects to arc 0 and arc total.
function uvOrderedCandidates(outline, x, y, scale) {
  let bestDistanceSquared = Infinity;
  const candidates = [];

  function visit(node) {
    const boxDx = Math.max(node.minX - x, 0, x - node.maxX);
    const boxDy = Math.max(node.minY - y, 0, y - node.maxY);
    // Extra slack makes pruning conservative at floating-point boundaries.
    const lowerBound = boxDx * boxDx + boxDy * boxDy;
    const slack = UV_DISTANCE_EPSILON + Number.EPSILON * 8 * Math.max(1, lowerBound);
    if (lowerBound > bestDistanceSquared + slack) return;
    if (node.left) {
      visit(node.left);
      visit(node.right);
      return;
    }
    for (let index = node.start; index < node.end; index += 1) {
      const { contour, point } = outline.segments[index];
      const points = contour.points;
      const a = points[point];
      const b = points[(point + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;

      let t = 0;
      if (lengthSquared > 0) {
        t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
      }

      const px = a.x + dx * t;
      const py = a.y + dy * t;
      const distanceSquared = (x - px) * (x - px) + (y - py) * (y - py);

      if (distanceSquared < bestDistanceSquared - UV_DISTANCE_EPSILON) {
        bestDistanceSquared = distanceSquared;
        candidates.length = 0;
      } else if (distanceSquared > bestDistanceSquared + UV_DISTANCE_EPSILON) {
        continue;
      }

      const arc = contour.cumulative[point] + Math.sqrt(lengthSquared) * t;
      candidates.push({
        arc,
        total: contour.total,
        u: scale > 0 ? arc / scale : contour.total > 0 ? arc / contour.total : 0,
        distanceSquared,
      });
    }
  }
  visit(outline.root);
  return candidates;
}

// Most queries have one nearest segment, or exact endpoint/seam ties. Find
// that neighborhood first instead of walking thousands of earlier segments.
// If distances lie in the epsilon transition band, use the ordered search:
// its non-transitive tolerance can depend on an earlier, farther segment.
function uvOutlineCandidates(outline, x, y, scale) {
  let minimum = Infinity;
  const nearby = [];
  function boxDistance(node) {
    const dx = Math.max(node.minX - x, 0, x - node.maxX);
    const dy = Math.max(node.minY - y, 0, y - node.maxY);
    return dx * dx + dy * dy;
  }
  function distance(index) {
    const { contour, point } = outline.segments[index];
    const a = contour.points[point];
    const b = contour.points[(point + 1) % contour.points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    let t = 0;
    if (lengthSquared > 0) {
      t = ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
    }
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    return { index, contour, point, t, lengthSquared,
      distanceSquared: (x - px) * (x - px) + (y - py) * (y - py) };
  }
  function visit(node, collect) {
    const lowerBound = boxDistance(node);
    const slack = UV_DISTANCE_EPSILON * 4 + Number.EPSILON * 8 * Math.max(1, lowerBound);
    if (lowerBound > minimum + slack) return;
    if (node.left) {
      // First pass uses spatial order; the collected matches are sorted back
      // into contour order before applying the original tie rules.
      const rightFirst = !collect && boxDistance(node.right) < boxDistance(node.left);
      visit(rightFirst ? node.right : node.left, collect);
      visit(rightFirst ? node.left : node.right, collect);
    } else {
      for (const index of node.indices) {
        const match = distance(index);
        if (collect) {
          if (match.distanceSquared <= minimum + UV_DISTANCE_EPSILON * 4) nearby.push(match);
        } else if (match.distanceSquared < minimum) minimum = match.distanceSquared;
      }
    }
  }
  visit(outline.spatialRoot, false);
  visit(outline.spatialRoot, true);
  if (nearby.some(match => match.distanceSquared > minimum + UV_DISTANCE_EPSILON / 2)) {
    return uvOrderedCandidates(outline, x, y, scale);
  }
  nearby.sort((a, b) => a.index - b.index);
  return nearby.map(({ contour, point, t, lengthSquared, distanceSquared }) => {
    const arc = contour.cumulative[point] + Math.sqrt(lengthSquared) * t;
    return { arc, total: contour.total,
      u: scale > 0 ? arc / scale : contour.total > 0 ? arc / contour.total : 0,
      distanceSquared };
  });
}

function uvNearestTo(candidates, anchorU) {
  let best = candidates[0];
  let bestDelta = Math.abs(best.u - anchorU);
  for (let index = 1; index < candidates.length; index += 1) {
    const delta = Math.abs(candidates[index].u - anchorU);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidates[index];
    }
  }
  return best;
}

function uvGeometryBounds(vertices) {
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
  };
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    if (!vertex) continue;
    if (vertex.x < bounds.minX) bounds.minX = vertex.x;
    if (vertex.y < bounds.minY) bounds.minY = vertex.y;
    if (vertex.z < bounds.minZ) bounds.minZ = vertex.z;
    if (vertex.x > bounds.maxX) bounds.maxX = vertex.x;
    if (vertex.y > bounds.maxY) bounds.maxY = vertex.y;
    if (vertex.z > bounds.maxZ) bounds.maxZ = vertex.z;
  }
  return bounds;
}

function uvFaceIndices(face) {
  const indices = [face.a, face.b, face.c];
  if (typeof face.d === "number") indices.push(face.d);
  return indices;
}

function uvIsEligibleGeometry(geometry) {
  if (!geometry || geometry.__zoidiumUvNormalized || geometry.__zoidiumUvSkipped) {
    return false;
  }
  if (geometry.type !== "TextGeometry" && geometry.type !== "ExtrudeGeometry") {
    return false;
  }
  if (!Array.isArray(geometry.vertices) || !Array.isArray(geometry.faces)) {
    return false;
  }
  const layers = geometry.faceVertexUvs;
  if (!layers || !Array.isArray(layers[0]) || layers[0].length === 0) return false;
  const options = geometry.parameters && geometry.parameters.options;
  if (options && options.extrudePath) return false;
  return true;
}

function uvNormalizeGeometry(geometry) {
  const vertices = geometry.vertices;
  const uvs = geometry.faceVertexUvs[0];
  const bounds = uvGeometryBounds(vertices);
  const sizeX = bounds.maxX - bounds.minX;
  const sizeY = bounds.maxY - bounds.minY;
  const sizeZ = bounds.maxZ - bounds.minZ;
  // One texel density on every face: the text height sets the texture unit.
  const scale = sizeY > 0 ? sizeY : sizeX > 0 ? sizeX : sizeZ > 0 ? sizeZ : 1;
  const prepared = uvPrepareContours(uvReconstructContours(geometry));
  if (prepared.length === 0) return false;
  const outline = uvBuildOutlineIndex(prepared);
  // A vertex is shared by multiple wall triangles. This cache lasts only for
  // this normalization, so all geometry, contour and scale inputs are current.
  const vertexCandidates = new Map();

  for (let faceIndex = 0; faceIndex < geometry.faces.length; faceIndex += 1) {
    const face = geometry.faces[faceIndex];
    const faceUvs = uvs[faceIndex];
    if (!face || !Array.isArray(faceUvs)) continue;

    const indices = uvFaceIndices(face);
    let minFaceZ = Infinity;
    let maxFaceZ = -Infinity;
    let centroidX = 0;
    let centroidY = 0;
    let counted = 0;
    for (let index = 0; index < indices.length; index += 1) {
      const vertex = vertices[indices[index]];
      if (!vertex) continue;
      if (vertex.z < minFaceZ) minFaceZ = vertex.z;
      if (vertex.z > maxFaceZ) maxFaceZ = vertex.z;
      centroidX += vertex.x;
      centroidY += vertex.y;
      counted += 1;
    }

    const isCap = maxFaceZ - minFaceZ <= UV_EPSILON;
    let anchorU = 0;
    if (!isCap && counted > 0) {
      const anchor = uvOutlineCandidates(
        outline,
        centroidX / counted,
        centroidY / counted,
        scale
      )[0];
      anchorU = anchor ? anchor.u : 0;
    }

    for (let index = 0; index < faceUvs.length; index += 1) {
      const uv = faceUvs[index];
      const vertex = vertices[indices[index]];
      if (!uv || !vertex || typeof uv.set !== "function") continue;

      if (isCap) {
        uv.set((vertex.x - bounds.minX) / scale, (vertex.y - bounds.minY) / scale);
        continue;
      }

      const vertexIndex = indices[index];
      let candidates = vertexCandidates.get(vertexIndex);
      if (!candidates) {
        candidates = uvOutlineCandidates(outline, vertex.x, vertex.y, scale);
        vertexCandidates.set(vertexIndex, candidates);
      }
      const match = candidates.length > 0 ? uvNearestTo(candidates, anchorU) : null;
      uv.set(match ? match.u : anchorU, (vertex.z - bounds.minZ) / scale);
    }
  }

  if (geometry.uvsNeedUpdate !== undefined) geometry.uvsNeedUpdate = true;
  return true;
}


function uvCloneFaceVertexUvs(geometry) {
  const layers = geometry.faceVertexUvs;
  if (!Array.isArray(layers)) return null;
  return layers.map((layer) =>
    Array.isArray(layer)
      ? layer.map((faceUvs) =>
          Array.isArray(faceUvs)
            ? faceUvs.map((uv) => (uv ? { x: uv.x, y: uv.y } : uv))
            : faceUvs
        )
      : layer
  );
}

function uvBumpRevision(geometry) {
  geometry.__zoidiumUvRevision = (geometry.__zoidiumUvRevision || 0) + 1;
}

function uvApplyToGeometry(geometry) {
  if (!uvIsEligibleGeometry(geometry)) return false;
  const original = uvCloneFaceVertexUvs(geometry);
  if (!original) return false;
  if (!uvNormalizeGeometry(geometry)) {
    // The outline could not be rebuilt (for example a curved path extrusion);
    // remember the decision so the per-frame check stays cheap.
    geometry.__zoidiumUvSkipped = true;
    return false;
  }
  geometry.__zoidiumUvOriginal = original;
  geometry.__zoidiumUvNormalized = true;
  uvBumpRevision(geometry);
  return true;
}

function uvRestoreGeometry(geometry) {
  if (!geometry) return;
  const original = geometry.__zoidiumUvOriginal;
  delete geometry.__zoidiumUvNormalized;
  delete geometry.__zoidiumUvOriginal;
  if (!original) return;
  const layers = geometry.faceVertexUvs;
  for (let layer = 0; layer < original.length; layer += 1) {
    const source = original[layer];
    const target = layers?.[layer];
    if (!Array.isArray(source) || !Array.isArray(target)) continue;
    for (let face = 0; face < source.length; face += 1) {
      const from = source[face];
      const to = target[face];
      if (!Array.isArray(from) || !Array.isArray(to)) continue;
      for (let index = 0; index < from.length; index += 1) {
        if (from[index] && to[index] && typeof to[index].set === "function") to[index].set(from[index].x, from[index].y);
      }
    }
  }
  if (geometry.uvsNeedUpdate !== undefined) geometry.uvsNeedUpdate = true;
  uvBumpRevision(geometry);
}

// Calls back with each mesh under root and the geometry that holds its UVs: an
// effector's source geometry rather than its working copy.
function uvForEachMesh(root, callback) {
  if (!root) return;
  const visit = (node) => {
    const geometry = node && (node.__zoidiumSourceGeometry || node.geometry);
    if (geometry) callback(node, geometry);
  };
  visit(root);
  if (typeof root.traverse === "function") {
    root.traverse((child) => {
      if (child !== root) visit(child);
    });
  }
}

function uvMeshMaterial(mesh) {
  return Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
}

// Call from the material's update. Cheap once the geometry is laid out.
function uvEnsureMaterial(material) {
  if (material.threeObj) material.threeObj.__zoidiumUvLayout = true;
  uvForEachMesh(material.parentObject?.threeObj, (_mesh, geometry) => {
    uvApplyToGeometry(geometry);
  });
}

// Call from the material's unload. Geometry that a different layout material
// now renders keeps its layout, so switching between Material+ types does not
// flash the native UVs.
function uvReleaseMaterial(material) {
  uvForEachMesh(material.parentObject?.threeObj, (mesh, geometry) => {
    const current = uvMeshMaterial(mesh);
    if (current && current !== material.threeObj && current.__zoidiumUvLayout) return;
    uvRestoreGeometry(geometry);
  });
}

return {
  isEligibleGeometry: uvIsEligibleGeometry,
  normalizeGeometry: uvNormalizeGeometry,
  prepareContours: uvPrepareContours,
  reconstructContours: uvReconstructContours,
  applyToGeometry: uvApplyToGeometry,
  restoreGeometry: uvRestoreGeometry,
  ensureMaterial: uvEnsureMaterial,
  releaseMaterial: uvReleaseMaterial,
};
};
