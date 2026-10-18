"use strict";

// Relationship line: while a constrained object is selected in the editor,
// a thin dashed line joins it to its target. The line lives beside CM3's own
// selection helpers (BoxHelper, CameraHelper, light helpers): in the editor
// viewport's helper group, on Three layer 1. Scene cameras render layer 0
// only, so the line never appears in the preview output or in renders; it is
// visible in the 3D edit view, where CM3 draws its helpers.

const LINE_COLOR = 0x8ab4ff;
const DASH_SIZE = 2;
const GAP_SIZE = 1.5;

function installOverlay(options) {
  const PZ = options.PZ;
  const THREE = options.THREE;
  const store = options.store;
  const evaluator = options.evaluator;
  const prototype = PZ.ui?.viewport?.prototype;
  if (!prototype || typeof prototype._render !== "function" || !THREE.LineDashedMaterial) {
    return () => {};
  }
  const lines = new Map(); // viewport -> { line, object }
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();

  function removeLine(viewport) {
    const entry = lines.get(viewport);
    if (!entry) return;
    lines.delete(viewport);
    const line = entry.line;
    line.parent?.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  }

  function createLine(object) {
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    geometry.addAttribute("lineDistance", new THREE.BufferAttribute(new Float32Array(2), 1));
    const material = new THREE.LineDashedMaterial({
      color: LINE_COLOR,
      dashSize: DASH_SIZE,
      gapSize: GAP_SIZE,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.9,
    });
    const line = new THREE.Line(geometry, material);
    line.layers.set(1);
    line.frustumCulled = false;
    line.renderOrder = 1000;
    line.userData.zoidiumConstraintLine = true;
    line.onBeforeRender = function () {
      const scene = evaluator.sceneOf(object, PZ);
      const target = scene && object.threeObj ? evaluator.resolveTarget(object, scene) : null;
      const position = geometry.attributes.position;
      const distance = geometry.attributes.lineDistance;
      if (target && target.threeObj && object.parent) {
        start.setFromMatrixPosition(object.threeObj.matrixWorld);
        end.setFromMatrixPosition(target.threeObj.matrixWorld);
        if (line.parent) {
          // The helper group is a child of the scene; keep world coordinates.
          const inverse = new THREE.Matrix4().getInverse(line.parent.matrixWorld);
          start.applyMatrix4(inverse);
          end.applyMatrix4(inverse);
        }
      } else {
        start.set(0, 0, 0);
        end.set(0, 0, 0);
      }
      position.setXYZ(0, start.x, start.y, start.z);
      position.setXYZ(1, end.x, end.y, end.z);
      distance.setX(0, 0);
      distance.setX(1, start.distanceTo(end));
      position.needsUpdate = true;
      distance.needsUpdate = true;
    };
    return line;
  }

  function selectedObject(viewport) {
    const objects = viewport.helper3d?.objects;
    const selected = objects && objects.length === 1 ? objects[0] : null;
    if (!selected || !store.isAttached(selected) || store.classify(selected) === "none") return null;
    return store.readTarget(selected) ? selected : null;
  }

  // The viewport binds its render loop at construction, but calls _render
  // through the prototype on every animation frame.
  function syncLine(viewport) {
    const selected = viewport.threeObj ? selectedObject(viewport) : null;
    const entry = lines.get(viewport);
    if (entry && (entry.object !== selected || entry.line.parent !== viewport.threeObj)) removeLine(viewport);
    if (!selected || lines.has(viewport)) return;
    const line = createLine(selected);
    viewport.threeObj.add(line);
    lines.set(viewport, { line, object: selected });
  }

  const original = prototype._render;
  const patched = function renderWithConstraintLine() {
    try {
      syncLine(this);
    } catch (error) {
      if (!reported) {
        reported = true;
        console.warn("[Zoidium] Constraints: could not draw the relationship line.", error);
      }
    }
    return original.apply(this, arguments);
  };
  let reported = false;
  prototype._render = patched;

  return function disposeOverlay() {
    if (prototype._render === patched) prototype._render = original;
    for (const viewport of Array.from(lines.keys())) removeLine(viewport);
  };
}

module.exports = { installOverlay };
