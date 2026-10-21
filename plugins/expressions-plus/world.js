"use strict";
const { ancestor, named } = require("./api.js");
const CAMERA_PLUS = "zoidium:camera-plus/camera";
function projectPoint(THREE, point, camera, resolution) {
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.getInverse(camera.matrixWorld);
  const v = new THREE.Vector3(...point).project(camera);
  return [(v.x + 1) * resolution[0] / 2, (1 - v.y) * resolution[1] / 2, v.z];
}
function unprojectPoint(THREE, point, camera, resolution) {
  camera.updateMatrixWorld(true);
  return new THREE.Vector3(point[0] * 2 / resolution[0] - 1, 1 - point[1] * 2 / resolution[1], point[2] ?? 0).unproject(camera).toArray();
}
function createWorldProvider({ PZ, THREE, createConstraintEvaluator }) {
  const is = type => n => typeof type === "function" && n instanceof type;
  const sceneOf = node => ancestor(node, is(PZ.layer.scene));
  const clipOf = node => ancestor(node, is(PZ.clip));
  const read = (p, frame, context, fallback) => p?.get ? context.read(p, frame) : fallback;
  const poseActive = new Set();
  function graph(scene, context, requested) {
    if (!scene) throw new Error("Expression could not find a 3D scene");
    const cache = context.cache;
    const key = requested || scene;
    if (cache.has(key)) return cache.get(key);
    if (poseActive.has(key)) throw new Error("Expression world-transform cycle detected");
    poseActive.add(key);
    try {
      const local = context.absolute - (clipOf(scene)?.start || 0);
      const byHost = new Map(), root = { objects: [], threeObj: new THREE.Object3D() };
      const parents = new Map(), ids = new Map(), required = new Set();
      function collect(nodes, parent) {
        for (const host of nodes || []) { parents.set(host, parent); const id = read(host.properties?.zoidiumId, local, context, ""); if (id) ids.set(id, host); collect(host.objects, host); }
      }
      collect(scene.objects, null);
      function need(host) { for (; host && !required.has(host); host = parents.get(host)) required.add(host); }
      need(requested);
      // Only sample the requested hierarchy and Track To dependencies. Eagerly
      // reading unrelated transforms would create false expression cycles.
      for (const host of required) need(ids.get(read(host.properties?.zoidiumTrackTo, local, context, "")));
      function add(host, parent) {
        const p = host.properties || {}, frame = local;
        let three = new THREE.Object3D();
        const node = { _host: host, threeObj: three, objects: [], properties: p };
        byHost.set(host, node); parent.objects.push(node);parent.threeObj.add(three);
        const sampled = required.has(host);
        const position = sampled ? read(p.position, frame, context, [0, 0, 0]) : [0, 0, 0];
        const rotation = sampled ? read(p.rotation, frame, context, [0, 0, 0]) : [0, 0, 0];
        const scale = sampled ? read(p.scale, frame, context, [1, 1, 1]) : [1, 1, 1];
        const order = read(p.eulerOrder, frame, context, host.threeObj?.rotation?.order || "XYZ");
        three.position.fromArray(position);three.rotation.set(...rotation, order);three.scale.fromArray(scale);
        if (sampled && host.threeObj?.isCamera && (host.type === 6 || host.type === CAMERA_PLUS || PZ.object3d.camera && host instanceof PZ.object3d.camera)) {
          // Both supported camera implementations reset their pose from the
          // frame before shake/vibrate. Their clone owns every transform and
          // projection write. Live materials, scene passes and poses are untouched.
          const shadow = Object.create(Object.getPrototypeOf(host));
          for (const key of Object.keys(host)) if (key !== "threeObj") Object.defineProperty(shadow, key, { value: host[key], writable: true, configurable: true, enumerable: true });
          shadow.threeObj = host.threeObj.clone(false);
          shadow.threeObj.parent = null;
          if (host.update) host.update.call(shadow, frame);
          three = shadow.threeObj;
          three.scale.set(1, 1, 1);
          parent.threeObj.remove(node.threeObj);parent.threeObj.add(three);node.threeObj = three;
        }
        for (const child of host.objects || []) add(child, node);
      }
      for (const host of scene.objects || []) add(host, root);
      root.threeObj.updateMatrixWorld(true);
      if (createConstraintEvaluator) {
        const value = (node, key, fallback) => read(node._host.properties?.[key], local, context, fallback);
        const evaluator = createConstraintEvaluator({ THREE, report() {}, store: {
          isAttached: node => required.has(node._host) && !!(node._host?.properties?.zoidiumTrackTo || node._host?.properties?.zoidiumId),
          readId: node => value(node, "zoidiumId", ""), readTarget: node => value(node, "zoidiumTrackTo", ""),
          readInfluence: node => value(node, "zoidiumInfluence", 100), readTrackAxis: node => value(node, "zoidiumTrackAxis", 2), readUpAxis: node => value(node, "zoidiumUpAxis", 1),
          classify: node => node._host?.type === 3 ? "light" : node._host?.properties?.rotation ? "rotation" : "none",
        } });
        evaluator.applyScene(root, local);
      }
      const result = { byHost, root, local };cache.set(key, result);return result;
    } finally { poseActive.delete(key); }
  }
  function cameras(scene, context) {
    const flat = [];
    const frame = context.absolute - (clipOf(scene)?.start || 0);
    function walk(objects) {
      for (const node of objects || []) {
        if (node._zoidiumMissingObject || node.__zoidiumRepeater) continue;
        if (read(node.properties?.enabled, frame, context, 1) !== 1) continue;
        if (node.threeObj?.isCamera && (node.type !== CAMERA_PLUS || read(node.properties.active, frame, context, 1) === 1)) flat.push(node);
        walk(node.objects);
      }
    }
    walk(scene.objects);
    const plus = flat.find(n => n.type === CAMERA_PLUS);
    const native = flat.filter(n => n.type !== CAMERA_PLUS);
    return scene.type === 9 ? flat[0] : plus || native.find(n => n.threeObj === scene.pass?.camera) || native.at(-1);
  }
  function cameraFor(scene, context) {
    const ownTrack = ancestor(scene, n => n?.clips && typeof n.track3d === "boolean");
    if (!ownTrack?.track3d) return cameras(scene, context);
    const candidates = [];
    function walk(layer, track, index, depth, insideCard) {
      if (!layer) return;
      if (PZ.layer.scene && layer instanceof PZ.layer.scene) {
        const camera = cameras(layer, context);
        if (camera && !insideCard) candidates.push({ camera, score: [layer.type === 9 ? 0 : 1, /camera/i.test(named(layer) + " " + named(track.getCurrentClip?.(context.absolute))) ? 0 : 1, depth, index] });
      } else if (layer.objects) {
        const card = insideCard || layer.effects?.some(e => e.type === "transform");
        for (const child of layer.objects) walk(child, track, index, depth + 1, card);
      }
    }
    Array.from(context.sequence?.videoTracks || []).forEach((track, index) => { if (track.enabled !== false) walk(track.getCurrentClip?.(context.absolute)?.object, track, index, 0, false); });
    candidates.sort((a, b) => { for (let i = 0; i < a.score.length; i++) if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i]; return 0; });
    return candidates[0]?.camera || cameras(scene, context);
  }
  return function worldMethods(node, context) {
    function scene() {
      return sceneOf(node) || Array.from(context.sequence?.videoTracks || []).map(t => t.getCurrentClip?.(context.absolute)?.object).find(is(PZ.layer.scene));
    }
    function object() { return ancestor(node, is(PZ.object3d)); }
    function matrix() {
      const host = object();
      if (!host) return new THREE.Matrix4();
      return graph(sceneOf(host), context, host).byHost.get(host).threeObj.matrixWorld;
    }
    function camera() {
      const host = cameraFor(scene(), context);
      if (!host) throw new Error("Expression could not find a rendering camera");
      return graph(sceneOf(host), context, host).byHost.get(host).threeObj;
    }
    function resolution() { return read(context.sequence?.properties?.resolution, context.absolute, context, [1920, 1080]); }
    function layerMatrix() {
      const owner = scene(), local = context.absolute - (clipOf(owner)?.start || 0), p = owner?.properties;
      const position = read(p?.position, local, context, [0, 0]), scale = read(p?.scale, local, context, [1, 1]), rotation = read(p?.rotation, local, context, 0);
      return new THREE.Matrix4().compose(new THREE.Vector3(position[0], position[1], 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rotation)), new THREE.Vector3(scale[0], scale[1], 1));
    }
    return {
      toWorld(point = [0, 0, 0]) { return new THREE.Vector3(...point).applyMatrix4(matrix()).toArray(); },
      fromWorld(point) { const m = matrix(); if (Math.abs(m.determinant()) < 1e-12) throw new Error("Expression cannot invert a zero-scale transform"); return new THREE.Vector3(...point).applyMatrix4(new THREE.Matrix4().getInverse(m)).toArray(); },
      worldPosition() { return new THREE.Vector3().setFromMatrixPosition(matrix()).toArray(); },
      worldRotation() { const q = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3();matrix().decompose(position, q, scale); const e = new THREE.Euler().setFromQuaternion(q, "XYZ");return [e.x, e.y, e.z]; },
      toScreen(point = [0, 0, 0]) {
        const world = new THREE.Vector3(...point).applyMatrix4(matrix()).toArray(), size = resolution();
        const pixel = projectPoint(THREE, world, camera(), size);
        const layer = new THREE.Vector3(pixel[0] - size[0] / 2, size[1] / 2 - pixel[1], 0).applyMatrix4(layerMatrix());
        return [layer.x + size[0] / 2, size[1] / 2 - layer.y, pixel[2]];
      },
      fromScreen(point) {
        const size = resolution(), lm = layerMatrix();
        if (Math.abs(lm.determinant()) < 1e-12) throw new Error("Expression cannot invert a zero-scale layer");
        const layer = new THREE.Vector3(point[0] - size[0] / 2, size[1] / 2 - point[1], 0).applyMatrix4(new THREE.Matrix4().getInverse(lm));
        const world = unprojectPoint(THREE, [layer.x + size[0] / 2, size[1] / 2 - layer.y, point[2] ?? 0], camera(), size);
        const m = matrix();if (Math.abs(m.determinant()) < 1e-12) throw new Error("Expression cannot invert a zero-scale transform");
        return new THREE.Vector3(...world).applyMatrix4(new THREE.Matrix4().getInverse(m)).toArray();
      },
    };
  };
}
module.exports = { createWorldProvider, projectPoint, unprojectPoint };
