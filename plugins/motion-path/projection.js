"use strict";
// Mappings between a path's parent space and client (CSS pixel) coordinates.
// Every mapping uses CSS pixels from getBoundingClientRect(), so preview
// quality and devicePixelRatio never change handle positions or sizes.
//
// A space exposes toClient(point) -> [x, y] | null (null: behind the camera)
// and plane(anchor) -> (clientX, clientY) -> point | null, which maps a client
// position to the parent-space point on the drag plane through `anchor`.

// 2D layer space (sequence pixels, origin at the centre, y up) to client
// pixels, as CM3's widget2d maps a layer position.
function sequenceMapping(rect, resolution) {
  const ratio = rect.width / resolution[0];
  if (!(ratio > 0) || !(rect.height > 0)) return null;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  return {
    ratio,
    toClient: p => [cx + p[0] * ratio, cy - p[1] * ratio],
    fromClient: (x, y) => [(x - cx) / ratio, -(y - cy) / ratio],
  };
}
// A layer's own transform (CM3 order: scale, rotate, translate; rotation in
// radians, counter-clockwise with y up).
function layerTransform(position, scale, rotation) {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const a = cos * scale[0], b = sin * scale[0], c = -sin * scale[1], d = cos * scale[1];
  const det = a * d - b * c;
  return {
    forward: p => [a * p[0] + c * p[1] + position[0], b * p[0] + d * p[1] + position[1]],
    inverse: Math.abs(det) > 1e-12 ? p => {
      const x = p[0] - position[0], y = p[1] - position[1];
      return [(d * x - c * y) / det, (-b * x + a * y) / det];
    } : null,
  };
}
function planarSpace(mapping) {
  return {
    kind: "2d",
    toClient: p => mapping.toClient(p),
    plane: () => (x, y) => mapping.fromClient(x, y),
  };
}
// Normalized device coordinates to client pixels: either the viewport canvas
// itself (edit camera) or a scene layer composited by its 2D transform.
function canvasNdc(rect) {
  return {
    toClient: n => [rect.left + (n[0] + 1) / 2 * rect.width, rect.top + (1 - n[1]) / 2 * rect.height],
    toNdc: (x, y) => [(x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2],
  };
}
function layerNdc(mapping, layerResolution, transform) {
  if (!transform.inverse) return null;
  const hw = layerResolution[0] / 2, hh = layerResolution[1] / 2;
  return {
    toClient: n => mapping.toClient(transform.forward([n[0] * hw, n[1] * hh])),
    toNdc: (x, y) => {
      const p = transform.inverse(mapping.fromClient(x, y));
      return [p[0] / hw, p[1] / hh];
    },
  };
}
// 3D space: parent-space points go through `parent` (Matrix4, parent to
// world), the camera's view/projection, then `ndc` to client pixels.
function cameraSpace(THREE, { parent, view, projection, ndc }) {
  const viewProjection = new THREE.Matrix4().multiplyMatrices(projection, view);
  const toWorld = parent, fromWorld = new THREE.Matrix4().getInverse(parent);
  const unproject = new THREE.Matrix4().getInverse(viewProjection);
  const cameraWorld = new THREE.Matrix4().getInverse(view);
  const forward = new THREE.Vector3(0, 0, -1).transformDirection(cameraWorld);
  const v4 = new THREE.Vector4(), v3 = new THREE.Vector3();
  function clip(world) {
    v4.set(world.x, world.y, world.z, 1).applyMatrix4(viewProjection);
    return v4.w > 1e-9 && v4.z / v4.w >= -1 ? [v4.x / v4.w, v4.y / v4.w] : null;
  }
  return {
    kind: "3d",
    forward,
    toWorld: p => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(toWorld),
    toClient(p) {
      const n = clip(v3.set(p[0], p[1], p[2]).applyMatrix4(toWorld));
      return n ? ndc.toClient(n) : null;
    },
    // The drag plane passes through the anchor perpendicular to the view
    // direction; the hit point returns to parent space through every
    // ancestor transform.
    plane(anchor) {
      const origin = new THREE.Vector3(anchor[0], anchor[1], anchor[2]).applyMatrix4(toWorld);
      return (x, y) => {
        const n = ndc.toNdc(x, y);
        const near = new THREE.Vector3(n[0], n[1], -1).applyMatrix4(unproject);
        const far = new THREE.Vector3(n[0], n[1], 1).applyMatrix4(unproject);
        const dir = far.sub(near), denom = forward.dot(dir);
        if (Math.abs(denom) < 1e-12) return null;
        const t = forward.dot(origin.clone().sub(near)) / denom;
        const hit = near.add(dir.multiplyScalar(t)).applyMatrix4(fromWorld);
        return [hit.x, hit.y, hit.z].every(Number.isFinite) ? [hit.x, hit.y, hit.z] : null;
      };
    },
  };
}
// Parent-to-world matrix of a 3D object: the product of every ancestor's
// transform evaluated at `frame` from its properties (the same values CM3's
// update() writes into Three), falling back to the live Three matrix.
function ancestorMatrix(THREE, PZ, object, frame) {
  const chain = [];
  for (let node = object.parentObject, depth = 0; node instanceof PZ.object3d && depth < 64; node = node.parentObject, depth++)
    chain.unshift(node);
  const m = new THREE.Matrix4();
  for (const node of chain) m.multiply(localMatrix(THREE, node, frame));
  return m;
}
function read(property, frame, fallback) {
  try {
    const value = property?.get(frame);
    return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}
function localMatrix(THREE, node, frame) {
  const p = node.properties || {}, three = node.threeObj;
  if (!p.position && three) {
    three.updateMatrix();
    return three.matrix.clone();
  }
  const position = read(p.position, frame, [0, 0, 0]);
  const rotation = read(p.rotation, frame, [0, 0, 0]);
  const scale = read(p.scale, frame, [1, 1, 1]);
  const order = three?.rotation?.order || "XYZ";
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], order));
  return new THREE.Matrix4().compose(new THREE.Vector3(position[0], position[1], position[2]), q,
    new THREE.Vector3(scale[0], scale[1], scale[2]));
}
module.exports = {
  sequenceMapping, layerTransform, planarSpace, canvasNdc, layerNdc, cameraSpace, ancestorMatrix, localMatrix,
};
