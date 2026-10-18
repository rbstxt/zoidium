"use strict";

// Per-frame Track To evaluation for one 3D Scene layer.
//
// Runs as a post pass after CM3 has updated every object of the scene for the
// frame and computed the world matrices. Each constraint reads world
// positions of that same frame, so the result does not depend on object list
// order or on any earlier frame. Constraints are applied in dependency order
// (constrained ancestors first) and each application refreshes the world
// matrices of the constrained subtree before the next one reads them.

const math = require("./track-to-math.js");
const graph = require("./constraint-graph.js");

const IDENTITY_QUATERNION = [0, 0, 0, 1];
const IDENTITY_LINEAR = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function createEvaluator(options) {
  const THREE = options.THREE;
  const store = options.store;
  const report = options.report || ((message) => console.warn(message));
  const reportedCycles = new WeakSet();
  const reportedFailures = new WeakSet();
  const objectPosition = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();
  const aimPosition = new THREE.Vector3();
  const inverseParent = new THREE.Matrix4();

  function objectName(object) {
    try {
      const name = object?.properties?.name?.get?.();
      return typeof name === "string" && name ? name : "3D object";
    } catch (_error) {
      return "3D object";
    }
  }

  function childObjects(object) {
    const list = object?.objects;
    return list && typeof list.length === "number" ? list : null;
  }

  // Walks the scene once: parent links, id lookup and constrained objects.
  function collect(scene) {
    const parents = new Map();
    const byId = new Map();
    const trackers = [];
    const pending = [];
    const roots = childObjects(scene);
    if (!roots) return null;
    for (let i = roots.length - 1; i >= 0; i -= 1) pending.push([roots[i], null]);
    while (pending.length > 0) {
      const [object, parent] = pending.pop();
      if (!object || parents.has(object)) continue;
      parents.set(object, parent);
      if (store.isAttached(object)) {
        const id = store.readId(object);
        if (id && !byId.has(id)) byId.set(id, object);
        if (store.readTarget(object)) trackers.push(object);
      }
      const children = childObjects(object);
      if (children) {
        for (let i = children.length - 1; i >= 0; i -= 1) pending.push([children[i], object]);
      }
    }
    return { parents, byId, trackers };
  }

  function sceneOf(object, PZ) {
    try {
      return object?.tryGetParentOfType?.(PZ.layer.scene) || null;
    } catch (_error) {
      return null;
    }
  }

  // Target object of a constrained object within its own scene, or null.
  function resolveTarget(object, scene) {
    const id = store.readTarget(object);
    if (!id || !scene) return null;
    const info = collect(scene);
    const target = info?.byId.get(id) || null;
    return target && target !== object ? target : null;
  }

  function reportCycle(object) {
    if (reportedCycles.has(object)) return;
    reportedCycles.add(object);
    report(`[Zoidium] Constraints: Track To on "${objectName(object)}" was skipped because it forms a dependency cycle (an object cannot track its own descendant or a target moved by its own rotation).`);
  }

  function applyLight(object, target, frame) {
    const light = object.threeObj;
    const aim = light?.target;
    if (!aim) return;
    objectPosition.setFromMatrixPosition(light.matrixWorld);
    targetPosition.setFromMatrixPosition(target.threeObj.matrixWorld);
    aim.updateMatrixWorld(true);
    aimPosition.setFromMatrixPosition(aim.matrixWorld);
    const point = math.solveLightAim(
      objectPosition.toArray(),
      aimPosition.toArray(),
      targetPosition.toArray(),
      store.readInfluence(object, frame)
    );
    if (!point) return;
    aimPosition.fromArray(point);
    if (aim.parent) {
      inverseParent.getInverse(aim.parent.matrixWorld);
      aimPosition.applyMatrix4(inverseParent);
    }
    aim.position.copy(aimPosition);
    aim.updateMatrixWorld(true);
  }

  function ownRotation(object, frame) {
    const three = object.threeObj;
    let value = null;
    try {
      value = object.properties.rotation.get(frame);
    } catch (_error) {
      value = null;
    }
    if (!Array.isArray(value) || value.length < 3) {
      const q = three.quaternion;
      return { base: [q.x, q.y, q.z, q.w], extra: IDENTITY_QUATERNION };
    }
    const base = math.quaternionFromEuler(value[0], value[1], value[2], three.rotation.order);
    // Cameras add their own shake or vibrate after the rotation property on
    // every frame. Keep that offset on top of the constrained orientation.
    if (store.isCameraLike(object)) {
      const q = three.quaternion;
      const extra = math.multiplyQuaternions(math.conjugateQuaternion(base), [q.x, q.y, q.z, q.w]);
      return { base, extra: math.normalizeQuaternion(extra) };
    }
    return { base, extra: IDENTITY_QUATERNION };
  }

  function applyRotation(object, target, frame) {
    const three = object.threeObj;
    objectPosition.setFromMatrixPosition(three.matrixWorld);
    targetPosition.setFromMatrixPosition(target.threeObj.matrixWorld);
    const parentLinear = three.parent
      ? math.linearPartOfMatrix4(three.parent.matrixWorld.elements)
      : IDENTITY_LINEAR;
    const own = ownRotation(object, frame);
    const solved = math.solveTrackTo({
      direction: [
        targetPosition.x - objectPosition.x,
        targetPosition.y - objectPosition.y,
        targetPosition.z - objectPosition.z,
      ],
      parentLinear,
      own: own.base,
      influence: store.readInfluence(object, frame),
      trackAxis: store.readTrackAxis(object),
      upAxis: store.readUpAxis(object),
    });
    if (!solved) return;
    const result = math.normalizeQuaternion(math.multiplyQuaternions(solved, own.extra));
    if (!result.every(Number.isFinite)) return;
    three.quaternion.set(result[0], result[1], result[2], result[3]);
    three.updateMatrixWorld(true);
  }

  function isActive(object, target, frame) {
    if (!target || target === object || !target.threeObj || !object.threeObj) return false;
    if (store.classify(object) === "none") return false;
    return math.influenceWeight(store.readInfluence(object, frame)) > 0;
  }

  // Returns true when at least one constraint was applied.
  function applyScene(scene, frame) {
    const info = collect(scene);
    if (!info || info.trackers.length === 0) return false;
    const active = new Map();
    for (const object of info.trackers) {
      const target = info.byId.get(store.readTarget(object)) || null;
      if (isActive(object, target, frame)) active.set(object, target);
    }
    if (active.size === 0) return false;
    const parentOf = (object) => info.parents.get(object) || null;
    const nodes = [];
    for (const [object, target] of active) {
      nodes.push({
        key: object,
        deps: graph.constraintDependencies(object, target, parentOf, (candidate) => active.has(candidate)),
      });
    }
    const { order, cyclic } = graph.orderConstraints(nodes);
    for (const object of cyclic) reportCycle(object);
    let applied = false;
    for (const object of order) {
      const target = active.get(object);
      try {
        if (store.classify(object) === "light") applyLight(object, target, frame);
        else applyRotation(object, target, frame);
        applied = true;
      } catch (error) {
        if (!reportedFailures.has(object)) {
          reportedFailures.add(object);
          report(`[Zoidium] Constraints: Track To on "${objectName(object)}" failed and was skipped.`, error);
        }
      }
    }
    return applied;
  }

  function hasConstraints(scene) {
    const info = collect(scene);
    return Boolean(info && info.trackers.length > 0);
  }

  return { applyScene, hasConstraints, resolveTarget, sceneOf, collect };
}

module.exports = { createEvaluator };
