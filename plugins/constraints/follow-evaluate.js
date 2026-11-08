"use strict";

const graph = require("./constraint-graph.js");
const { sequenceScenes, sceneFrame, outputFrame } = require("./follow-scenes.js");
const { createEvaluator } = require("./track-to-evaluate.js");

function createFollowEvaluator({ PZ, THREE, store, trackEvaluator, report = console.warn }) {
  const warned = new WeakSet();
  const read = (host, key, frame, fallback) => host.properties?.[key]?.get?.(frame) ?? fallback;

  function hasFollow(scene) {
    return sequenceScenes(scene, PZ).some(entry => {
      const pending = Array.from(entry.scene.objects || []);
      while (pending.length) {
        const host = pending.pop();
        if (store.readFollow(host)) return true;
        pending.push(...(host.objects || []));
      }
      return false;
    });
  }

  function applyFollow(node, target) {
    const { host, frame, threeObj: three } = node;
    const local = Number(read(host, store.KEYS.followSpace, frame, 0)) === 1;
    const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    if (local) matrix.copy(target.threeObj.matrix);
    else matrix.copy(target.threeObj.matrixWorld);
    const p = read(host, store.KEYS.positionOffset, frame, [0, 0, 0]);
    const r = read(host, store.KEYS.rotationOffset, frame, [0, 0, 0]);
    const s = read(host, store.KEYS.scaleOffset, frame, [1, 1, 1]);
    if (r.some(value => value !== 0)) {
      matrix.decompose(position, rotation, scale);
      rotation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, three.rotation.order)));
      matrix.compose(position, rotation, scale);
    }
    matrix.elements[12] += p[0]; matrix.elements[13] += p[1]; matrix.elements[14] += p[2];
    matrix.scale(new THREE.Vector3(...s));
    if (!local && three.parent) {
      if (Math.abs(three.parent.matrixWorld.determinant()) < 1e-12) return;
      matrix.premultiply(new THREE.Matrix4().getInverse(three.parent.matrixWorld));
    }
    matrix.decompose(position, rotation, scale);
    if (![...position.toArray(), ...rotation.toArray(), ...scale.toArray()].every(Number.isFinite)) return;
    if (Number(read(host, store.KEYS.followPosition, frame, 1)) === 1) three.position.copy(position);
    if (Number(read(host, store.KEYS.followRotation, frame, 1)) === 1) three.quaternion.copy(rotation);
    if (Number(read(host, store.KEYS.followScale, frame, 1)) === 1) three.scale.copy(scale);
    three.updateMatrixWorld(true);
  }

  function fallback(node) {
    try {
      const pose = JSON.parse(read(node.host, store.KEYS.fallback, node.frame, ""));
      if (![pose.p, pose.q, pose.s].every(Array.isArray) || ![...pose.p, ...pose.q, ...pose.s].every(Number.isFinite)) return;
      node.threeObj.position.fromArray(pose.p);
      node.threeObj.quaternion.fromArray(pose.q);
      node.threeObj.scale.fromArray(pose.s);
      node.threeObj.updateMatrixWorld(true);
    } catch (_error) { /* An unresolved saved link without a fallback keeps its authored pose. */ }
  }

  function applyScene(scene, frame, sampleOffset = 0) {
    if (!hasFollow(scene)) return trackEvaluator.applyScene(scene, frame);
    const absolute = outputFrame(scene, frame, PZ, sampleOffset);
    const entries = sequenceScenes(scene, PZ);
    const root = { objects: [], threeObj: new THREE.Object3D() };
    const nodes = [], byHost = new Map(), byId = new Map();
    function add(host, parent, entry, time) {
      if (!host.threeObj) return;
      const nativeCamera = PZ.object3d.camera && host instanceof PZ.object3d.camera;
      const three = nativeCamera ? host.threeObj.clone(false) : new THREE.Object3D();
      const node = { host, scene: entry.scene, frame: time, parent, threeObj: three, objects: [], properties: host.properties };
      nodes.push(node); byHost.set(host, node); parent.objects.push(node); parent.threeObj.add(three);
      const id = store.readId(host);
      if (id) byId.set(id, node);
      three.position.fromArray(read(host, "position", time, [0, 0, 0]));
      three.rotation.set(...read(host, "rotation", time, [0, 0, 0]), read(host, "eulerOrder", time, host.threeObj.rotation.order));
      three.scale.fromArray(read(host, "scale", time, [1, 1, 1]));
      if (nativeCamera) {
        // Camera shake writes only to this detached camera. The live target
        // can belong to a scene that has never rendered at the requested time.
        const shadow = Object.create(host);
        shadow.threeObj = three;
        host.update.call(shadow, time);
      }
      if (store.classify(host) === "light") {
        three.target = new THREE.Object3D();
        three.target.position.fromArray(read(host, "target", time, [0, 0, 0]));
        root.threeObj.add(three.target);
      }
      for (const child of host.objects || []) add(child, node, entry, time);
    }
    for (const entry of entries) {
      const time = entry.scene === scene ? frame : sceneFrame(entry, absolute, PZ);
      for (const host of entry.scene.objects || []) add(host, root, entry, time);
    }
    root.threeObj.updateMatrixWorld(true);
    const active = new Map();
    for (const node of nodes) {
      const follow = byId.get(store.readFollow(node.host));
      const track = byId.get(store.readTarget(node.host));
      // Track To retains its same-scene contract.
      const targets = { follow, track: track?.scene === node.scene ? track : null };
      if (store.readFollow(node.host) && !follow) fallback(node);
      if (targets.follow || targets.track) active.set(node, targets);
    }
    const parentOf = node => node?.parent === root ? null : node?.parent;
    const constraints = Array.from(active, ([node, targets]) => ({ key: node,
      deps: [...new Set(Object.values(targets).flatMap(target => target ?
        graph.constraintDependencies(node, target, parentOf, candidate => active.has(candidate)) : []))],
    }));
    const { order, cyclic } = graph.orderConstraints(constraints);
    for (const node of cyclic) {
      if (!warned.has(node.host)) {
        warned.add(node.host);
        report("[Zoidium] Constraints: Follow or Track To was skipped because it forms a dependency cycle.");
      }
    }
    let tracking = null;
    const mirrorStore = {
      ...store, isAttached: () => true,
      readId: node => store.readId(node.host),
      readTarget: node => node === tracking ? store.readTarget(node.host) : "",
      readInfluence: node => store.readInfluence(node.host, node.frame),
      readTrackAxis: node => store.readTrackAxis(node.host),
      readUpAxis: node => store.readUpAxis(node.host),
      classify: node => store.classify(node.host),
    };
    const tracker = createEvaluator({ THREE, store: mirrorStore, report });
    for (const node of order) {
      const targets = active.get(node);
      if (targets.follow) applyFollow(node, targets.follow);
      if (targets.track) { tracking = node; tracker.applyScene(root, node.frame); }
    }
    // Only publish constrained transforms in the scene being evaluated. Other
    // scenes, materials, renderers and project data are never updated here.
    for (const node of nodes) {
      if (node.scene !== scene || (!active.has(node) && !store.readFollow(node.host))) continue;
      const three = node.host.threeObj, pose = node.threeObj;
      three.position.copy(pose.position); three.quaternion.copy(pose.quaternion); three.scale.copy(pose.scale);
      if (three.target && pose.target) three.target.position.copy(pose.target.position);
    }
    for (const host of scene.objects || []) host.threeObj?.updateMatrixWorld(true);
    return true;
  }

  function captureDeleted(deleted, editor, propertyOps = editor.properties) {
    const ids = new Set();
    function walk(host) {
      const id = store.readId(host);
      if (id) ids.add(id);
      for (const child of host.objects || []) walk(child);
      if (host.object) walk(host.object);
      for (const clip of host.clips || []) walk(clip);
    }
    walk(deleted);
    if (!ids.size) return;
    editor.project.forEachItemOfType(PZ.object3d, host => {
      if (!ids.has(store.readFollow(host))) return;
      const three = host.threeObj;
      if (!three) return;
      const value = JSON.stringify({ p: three.position.toArray(), q: three.quaternion.toArray(), s: three.scale.toArray() });
      propertyOps.setValue({ property: host.properties[store.KEYS.fallback].getAddress(), value });
    });
  }

  return { applyScene, hasFollow, captureDeleted, sequenceScenes: scene => sequenceScenes(scene, PZ) };
}

module.exports = { createFollowEvaluator };
