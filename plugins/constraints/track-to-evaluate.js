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

const IDENTITY_LINEAR = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function createEvaluator(options) {
  const THREE = options.THREE;
  const store = options.store;
  const report = options.report || ((message) => console.warn(message));
  const indexes = new WeakMap(), events = new WeakMap();
  let revision = 0;
  const PZ = options.PZ, patch = options.patch;
  function observe(event) {
    // The structural observables visited by collect() are wrapped per
    // instance, so projects without constraints keep the native shared update
    // untouched. Passing patch opts into cached indexing; without it every
    // call re-collects. This is also the path of the evaluator embedded in
    // the Expressions+ world provider, which never installs hooks.
    if (!event || !patch || !PZ?.observable || !(event instanceof PZ.observable)) return false;
    if (!events.has(event)) {
      // A re-activated provider adopts the live root instead of chaining a
      // wrapper around a previous provider's stale delegation.
      let native = event.update;
      while (typeof native === "function" && native.zoidiumTrackToRoot !== undefined) native = native.zoidiumTrackToRoot;
      if (typeof native === "function") {
        const wrapped = function () {
          revision++;
          return native.apply(this, arguments);
        };
        wrapped.zoidiumTrackToRoot = native;
        event.update = wrapped;
      }
      events.set(event, native);
    }
    return true;
  }
  function invalidate() { revision++; }
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
    const previous = indexes.get(scene);
    if (previous?.cacheable && previous.revision === revision) return previous;
    let cacheable = Boolean(patch && PZ?.observable);
    const parents = new Map();
    const byId = new Map();
    const trackers = [];
    const pending = [];
    const roots = childObjects(scene);
    if (!roots) return null;
    if (!observe(roots.onListChanged)) cacheable = false;
    for (let i = roots.length - 1; i >= 0; i -= 1) pending.push([roots[i], null]);
    while (pending.length > 0) {
      const [object, parent] = pending.pop();
      if (!object || parents.has(object)) continue;
      parents.set(object, parent);
      if (!observe(object.onParentChanged)) cacheable = false;
      if (!observe(object.properties?.onListChanged)) cacheable = false;
      if (store.isAttached(object)) {
        for (const key of ["zoidiumId", "zoidiumTrackTo"]) {
          const property = object.properties?.[key];
          // Unobservable or dynamic identity fields cannot be cached safely.
          if (!(PZ?.property?.static && property instanceof PZ.property.static && observe(property.onChanged))) cacheable = false;
        }
        const id = store.readId(object);
        if (id && !byId.has(id)) byId.set(id, object);
        if (store.readTarget(object)) trackers.push(object);
      }
      const children = childObjects(object);
      if (children) {
        if (!observe(children.onListChanged)) cacheable = false;
        for (let i = children.length - 1; i >= 0; i -= 1) pending.push([children[i], object]);
      }
    }
    const result = { parents, byId, trackers, revision, cacheable };
    indexes.set(scene, result);
    return result;
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

  function ownRotation(object) {
    // Read the evaluated pose, including transforms applied by other plugins.
    // Native scene.update resets that pose on every frame before this pass.
    const q = object.threeObj.quaternion;
    return [q.x, q.y, q.z, q.w];
  }

  function applyRotation(object, target, frame) {
    const three = object.threeObj;
    objectPosition.setFromMatrixPosition(three.matrixWorld);
    targetPosition.setFromMatrixPosition(target.threeObj.matrixWorld);
    const parentLinear = three.parent
      ? math.linearPartOfMatrix4(three.parent.matrixWorld.elements)
      : IDENTITY_LINEAR;
    const own = ownRotation(object);
    const solved = math.solveTrackTo({
      direction: [
        targetPosition.x - objectPosition.x,
        targetPosition.y - objectPosition.y,
        targetPosition.z - objectPosition.z,
      ],
      parentLinear,
      own,
      influence: store.readInfluence(object, frame),
      trackAxis: store.readTrackAxis(object),
      upAxis: store.readUpAxis(object),
    });
    if (!solved) return;
    const result = math.normalizeQuaternion(solved);
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

  return { applyScene, hasConstraints, resolveTarget, sceneOf, collect, invalidate };
}

module.exports = { createEvaluator };
