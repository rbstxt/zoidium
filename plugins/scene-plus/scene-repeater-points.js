"use strict";

// Clone-position points: an editor-only marker at the transform origin of
// every copy of the selected repeater. Positions come from the same pure
// transform the repeater renders with, before effectors deform the clones.

const {
  MAX_REPEATS, getRepeaterCount, getTransform, numberValue,
} = require("./scene-values.js");

const POINT_COLOR = 0x7fd7ff;
const POINT_SIZE = 6;

// Pure copy origins for the overlay and its tests. Echo copies reuse the
// source at its own frame and stay at the repeater origin.
function repeaterPointPositions(repeater, frame) {
  if (!repeater || !repeater.__zoidiumRepeater) return [];
  const mode = repeater._mode || "step";
  const count = getRepeaterCount(mode, repeater.repeaterProperties, frame);
  if (mode === "echo") {
    return Array.from({ length: count }, () => [0, 0, 0]);
  }
  const controls = typeof repeater.readControls === "function"
    ? repeater.readControls(frame)
    : {};
  const seed = numberValue(repeater.repeaterProperties?.seed?.get?.(), 1);
  const positions = [];
  for (let index = 0; index < count; index += 1) {
    positions.push(getTransform(mode, index, count, controls, seed).position);
  }
  return positions;
}

function installRepeaterPoints(THREE, editor) {
  const list = editor?.mainViewport?.helper3d?.objects;
  if (
    !THREE?.Points || !THREE?.BufferGeometry || !THREE?.BufferAttribute ||
    !THREE?.PointsMaterial || !list?.onListChanged
  ) {
    return () => {};
  }
  let owner = null;
  let points = null;
  let disposed = false;

  function release() {
    if (points) {
      points.parent?.remove?.(points);
      points.geometry?.dispose?.();
      points.material?.dispose?.();
    }
    points = null;
    owner = null;
  }

  function attached(target) {
    const root = target?.threeObj;
    return Boolean(root && root.parent && !target._zoidiumMissingObject);
  }

  function update() {
    if (disposed) return;
    if (owner && !attached(owner)) {
      release();
      return;
    }
    if (!owner || !points) return;
    const frame = numberValue(editor?.playback?.currentFrame, 0);
    const positions = repeaterPointPositions(owner, frame);
    const array = points.geometry.attributes.position.array;
    const length = Math.min(positions.length, MAX_REPEATS, array.length / 3);
    for (let index = 0; index < length; index += 1) {
      const position = positions[index];
      array[index * 3] = position[0];
      array[index * 3 + 1] = position[1];
      array[index * 3 + 2] = position[2];
    }
    points.geometry.setDrawRange?.(0, length);
    points.geometry.attributes.position.needsUpdate = true;
    owner.threeObj.updateMatrixWorld?.(true);
    points.matrix?.copy?.(owner.threeObj.matrixWorld);
    points.matrixWorld?.copy?.(points.matrix);
  }

  function refreshSelection() {
    if (disposed) return;
    const target = list.length === 1 && list[0]?.__zoidiumRepeater ? list[0] : null;
    if (target === owner && points) return;
    release();
    owner = target;
    const scene = editor?.mainViewport?.threeObj;
    if (!owner || !scene?.add) return;
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(MAX_REPEATS * 3), 3),
    );
    geometry.setDrawRange?.(0, 0);
    const material = new THREE.PointsMaterial({
      color: POINT_COLOR,
      size: POINT_SIZE,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });
    points = new THREE.Points(geometry, material);
    points.name = "Zoidium repeater copies";
    points.frustumCulled = false;
    points.matrixAutoUpdate = false;
    // Only the editor camera enables helper layer 1, so exports and the
    // preview frame cache never draw these points.
    points.layers?.set?.(1);
    points.onBeforeRender = update;
    scene.add(points);
    update();
  }

  const observed = [list.onListChanged, editor?.onProjectChanged].filter(Boolean);
  for (const observable of observed) observable.watch?.(refreshSelection);
  refreshSelection();

  return function dispose() {
    if (disposed) return;
    disposed = true;
    for (const observable of observed) observable.unwatch?.(refreshSelection);
    release();
  };
}

module.exports = {
  POINT_COLOR, POINT_SIZE, repeaterPointPositions, installRepeaterPoints,
};
