"use strict";

// Scene deformation support: the cached mesh deformer, field guide
// helpers, deformer subdivision levels, and the CM3 scene update patch that
// evaluates every deformer chain in its own frame.

const { fieldFromProperties, numberPropertyValue, optionPropertyValue } = require("./scene-fields.js");
const {
  mapRenderNodes, restoreDeformedTree, traverseDeformMeshes,
} = require("./scene-clone.js");
const state = require("./scene-state.js");
const { installPreviewHold } = require("./effector-preview.js");
const { installFieldEdit } = require("./scene-field-edit.js");
const legacySubdivision = require("./legacy-subdivision.js");

function liveObjectLayer(object, PZ) {
  if (!object?.threeObj) return null;
  if (typeof object.tryGetParentOfType === "function") {
    if (!object.tryGetParentOfType(PZ.project)) return null;
    return object.tryGetParentOfType(PZ.layer);
  }
  return object.parentLayer || null;
}

function getMeshDeformer(THREE) {
  if (!state.meshDeformerCache || state.meshDeformerThree !== THREE) {
    state.meshDeformerCache = state.library.mesh.createMeshDeformer(THREE, state.meshJobs);
    state.meshDeformerThree = THREE;
  }
  return state.meshDeformerCache;
}

// Use the highest uniform subdivision level requested by active deformers.
function curvePolygonCount(effectors, frame) {
  return curveSubdivision(effectors, frame).polygonCount;
}

function curveSubdivision(effectors, frame) {
  let polygonCount = 1;
  let legacy = false;
  for (const effector of effectors) {
    const p = effector.properties;
    const intensity = p.angle || p.amount;
    if (intensity && !numberPropertyValue(intensity, frame, 0)) continue;
    const isLegacy = effector.zoidiumSubdivisionMode === "legacy" &&
      (effector.zoidiumLegacySubdivisionLevel === undefined ||
        optionPropertyValue(p.subdivision, frame, 2) === effector.zoidiumLegacySubdivisionLevel);
    let requested = 1;
    if (isLegacy) requested = legacySubdivision.curvePolygonCount([effector], frame, { numberPropertyValue, optionPropertyValue });
    else if (p.subdivision) requested = 4 ** state.library.core.clampIndex(optionPropertyValue(p.subdivision, frame, 2), 4);
    else if (p.curveQuality && optionPropertyValue(p.curveQuality, frame, 1)) requested = state.library.core.subdivisionPolygons(numberPropertyValue(p.polygonCount, frame, 16));
    if (requested > polygonCount) { polygonCount = requested; legacy = isLegacy; }
    else if (requested === polygonCount && isLegacy) legacy = true;
  }
  return { polygonCount, legacy };
}

// CM3 constructs BoxHelper at selection time. Field guides use that same
// editor-only layer, never the scene's render/export layer or a separate panel.
function installFieldHelpers(THREE) {
  const Original = THREE.BoxHelper, helpers = new Set();
  if (!Original || !THREE.LineSegments || !THREE.LineBasicMaterial) return () => {};
  const fieldEdit = installFieldEdit(globalThis.PZ || {}, THREE);
  function FieldHelper(root, color) {
    for (const helper of helpers) if (!helper.parent) {
      helper.geometry.dispose(); helper.material.dispose(); helpers.delete(helper);
    }
    const owner = root?.__zoidiumEffectorOwner;
    if (!owner) return new Original(root, color);
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(4096 * 3), 3));
    geometry.attributes.position.dynamic = true;
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: 0xffa040, depthTest: false, transparent: true, opacity: 0.8 });
    const helper = new THREE.LineSegments(geometry, material);
    helper.frustumCulled = false;
    helper.layers.set(1);
    helper.update = () => {
      const frame = owner._effectorFrame || 0;
      const field = state.library.core.fieldForBounds(fieldFromProperties(owner.properties, frame, owner._legacyField), owner._fieldBounds);
      const editing = fieldEdit.isEditing(owner);
      material.color?.setHex(editing ? 0x50e0d0 : 0xffa040);
      const key = JSON.stringify([field, editing]);
      if (helper._fieldKey !== key) {
        helper._fieldKey = key;
        const points = fieldGuidePoints(field);
        if (editing) for (let axis = 0; axis < 3; axis++) {
          for (const sign of [-1, 1]) points.push(...field.position.map((v, i) => v + (i === axis ? sign * 5 : 0)));
        }
        geometry.attributes.position.array.set(points);
        geometry.attributes.position.needsUpdate = true;
        geometry.setDrawRange(0, points.length / 3);
      }
      helper.matrixAutoUpdate = false;
      helper.matrix.copy(root.matrixWorld);
      helper.matrixWorld.copy(root.matrixWorld);
    };
    helper.onBeforeRender = helper.update;
    helper.update();
    helpers.add(helper);
    return helper;
  }
  FieldHelper.prototype = Original.prototype;
  THREE.BoxHelper = FieldHelper;
  return () => {
    fieldEdit.dispose();
    if (THREE.BoxHelper === FieldHelper) THREE.BoxHelper = Original;
    for (const helper of helpers) {
      helper.parent?.remove(helper); helper.geometry.dispose(); helper.material.dispose();
    }
    helpers.clear();
  };
}

function fieldGuidePoints(field) {
  const points = [], type = field?.type;
  if (!type || type === 5) return points;
  const legacy = (field.legacy || field.falloff === undefined) &&
    (field.rotation || [0, 0, 0]).every(v => !v) && (field.sweep ?? 100) === 100 &&
    (field.falloff ?? 100) === 100 && !field.curve && !field.invert;
  const scale = legacy ? field.scale : field.worldScale || field.scale;
  const radii = legacy && type === 3 ? [0, 1, 2].map(() => Math.max(Math.abs(scale[0]), 0.001)) :
    scale.map(v => Math.max(Math.abs(v), 0.001) / 2);
  const line = (a, b) => {
    for (const p of [a, b]) {
      const q = state.library.core.rotateXYZ(p, field.rotation || [0, 0, 0]);
      points.push(...q.map((v, i) => v + field.position[i]));
    }
  };
  const falloff = Math.max(0, Math.min(1, (field.falloff ?? 100) / 100));
  const extents = legacy && type === 2 ? [1, 2] : falloff > 0 && falloff < 1 ? [1, 1 - falloff] : [1];
  for (const ratio of extents) {
    const r = radii.map(v => v * ratio);
    if (type === 1) {
      const width = legacy ? Math.abs(scale[0]) : Math.max((field.high - field.low) * falloff, 0.001);
      const plane = legacy ? 0 : field.low - width + (field.high - field.low + width) * field.sweep / 100;
      for (const x of [plane, plane + width]) {
        const corners = [[x, -r[1], -r[2]], [x, r[1], -r[2]], [x, r[1], r[2]], [x, -r[1], r[2]]];
        for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4]);
      }
      break;
    }
    if (type === 2) {
      const corners = Array.from({ length: 8 }, (_, i) => r.map((v, a) => i & (1 << a) ? v : -v));
      for (let i = 0; i < 8; i++) for (let a = 0; a < 3; a++) if (!(i & (1 << a))) line(corners[i], corners[i | (1 << a)]);
    } else {
      const circle = (a, b, fixedAxis, fixedValue) => {
        for (let i = 0; i < 48; i++) {
          const p = [0, 0, 0], q = [0, 0, 0];
          p[a] = r[a] * Math.cos(i * Math.PI / 24); p[b] = r[b] * Math.sin(i * Math.PI / 24);
          q[a] = r[a] * Math.cos((i + 1) * Math.PI / 24); q[b] = r[b] * Math.sin((i + 1) * Math.PI / 24);
          if (fixedAxis !== undefined) p[fixedAxis] = q[fixedAxis] = fixedValue;
          line(p, q);
        }
      };
      if (type === 3) { circle(0, 1); circle(1, 2); circle(2, 0); }
      if (type === 4) {
        circle(0, 2, 1, -r[1]); circle(0, 2, 1, r[1]);
        for (const a of [0, 2]) for (const sign of [-1, 1]) {
          const p = [0, -r[1], 0], q = [0, r[1], 0]; p[a] = q[a] = sign * r[a]; line(p, q);
        }
      }
    }
  }
  return points;
}

function createDeformationSupport(PZ, THREE, editor) {
  const sceneClass = PZ.layer?.scene;
  const prototype = sceneClass?.prototype;
  if (!prototype || typeof prototype.update !== "function") {
    throw new Error("Effector requires the CM3 3D scene update API.");
  }
  if (prototype.__zoidiumEffectorDeformPatch) {
    return {
      deactivate() {},
      apply: prototype.__zoidiumEffectorDeformSupport?.apply,
      prepareObject: prototype.__zoidiumEffectorDeformSupport?.prepareObject,
    };
  }

  const layers = new Set();
  const affectedMeshes = new Map();
  const originalUpdate = prototype.update;
  const originalPrepare = prototype.prepare;
  const originalUnload = prototype.unload;
  const meshDeformer = getMeshDeformer(THREE);
  const disposeFieldHelpers = installFieldHelpers(THREE);
  const presentation = installPreviewHold(PZ, meshDeformer, editor);

  let project = editor?.project, generation = 0;
  let preparedLayers = new WeakSet();
  const previewPrepares = new Map();
  function releaseLayers() {
    generation += 1;
    for (const layer of layers) restore(layer);
    layers.clear();
    affectedMeshes.clear();
    preparedLayers = new WeakSet();
    previewPrepares.clear();
  }
  function projectChanged() {
    if (editor.project === project) return;
    project = editor.project;
    releaseLayers();
  }
  editor?.onProjectChanged?.watch(projectChanged);

  let preparingMeshes = null;
  let tasks = null;
  function deformMeshesUnder(root, chain, frame) {
    if (!chain.length) return;
    const { polygonCount, legacy } = curveSubdivision(chain.map((entry) => entry.effector), frame);
    traverseDeformMeshes(root, (mesh) => {
      preparingMeshes?.add(mesh);
      if (tasks) tasks.push({ mesh, chain, frame, polygonCount, legacy });
      else meshDeformer.deformMesh(mesh, chain, frame, polygonCount, legacy);
    });
  }

  // The chain lists enabled deformers from outermost to innermost. Each entry
  // keeps the render node that carries the deformer's transform, so deformers
  // evaluate in their own frame.
  function walkRenderedObject(object, chain, frame, renderRoot, nodes) {
    if (!object) return;
    const liveRoot = renderRoot || object.threeObj;
    if (liveRoot) liveRoot.__zoidiumEffectorTransformOwner = object;
    const isDeformer = typeof object.deformPositions === "function";
    const enabled = !object.properties?.enabled ||
      optionPropertyValue(object.properties.enabled, frame, 1) === 1;
    const nextChain = isDeformer && enabled
      ? chain.concat({ effector: object, node: renderRoot || object.threeObj })
      : chain;

    if (object.__zoidiumRepeater) {
      const sources = object.objects && typeof object.objects.length === "number"
        ? Array.from(object.objects)
        : [];
      const byRoot = new Map(sources.map(source => [source?.threeObj, source]));
      for (const instance of object._instanceRoots || []) {
        for (const clone of instance.clones || []) {
          const sourceObject = byRoot.get(clone.source);
          if (sourceObject) {
            walkRenderedObject(sourceObject, nextChain, frame, clone.clone,
              mapRenderNodes(clone.source, clone.clone));
          } else {
            deformMeshesUnder(clone.clone, nextChain, frame);
          }
        }
      }
      return;
    }

    if (object.objects && typeof object.objects.length === "number") {
      for (const child of object.objects) {
        const childRoot = nodes?.get(child?.threeObj) || null;
        walkRenderedObject(child, nextChain, frame, childRoot, nodes);
      }
      return;
    }
    deformMeshesUnder(renderRoot || object.threeObj, nextChain, frame);
  }

  function walk(objects, chain, frame) {
    if (!objects || typeof objects.length !== "number") return;
    for (const object of objects) {
      walkRenderedObject(object, chain, frame, object?.threeObj,
        mapRenderNodes(object?.threeObj, object?.threeObj));
    }
  }

  function restoreRenderedObject(object, seen) {
    if (!object || seen.has(object)) return;
    seen.add(object);
    if (object.__zoidiumRepeater) {
      for (const instance of object._instanceRoots || []) restoreDeformedTree(instance.root);
    }
    restoreDeformedTree(object.threeObj);
    if (object.objects && typeof object.objects.length === "number") {
      for (const child of object.objects) restoreRenderedObject(child, seen);
    }
  }

  function evaluateTree(run) {
    tasks = [];
    try {
      run();
      const bounds = new Map();
      for (const task of tasks) {
        // Empty chains only restore previously deformed geometry below. They
        // contribute no effector bounds and need no source conversion/staging.
        if (!task.chain.length) continue;
        const stage = meshDeformer.sourceStage(task.mesh);
        if (!stage) continue;
        for (const entry of task.chain) {
          const relation = state.library.core.relativeTransform(entry.node?.matrixWorld?.elements, task.mesh.matrixWorld?.elements);
          if (!relation) continue;
          let b = bounds.get(entry.node);
          if (!b) { b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; bounds.set(entry.node, b); }
          const m = relation.forward, p = stage.positions;
          for (let i = 0; i < p.length; i += 3) {
            const x = p[i], y = p[i + 1], z = p[i + 2];
            const qx = m ? m[0] * x + m[4] * y + m[8] * z + m[12] : x;
            const qy = m ? m[1] * x + m[5] * y + m[9] * z + m[13] : y;
            const qz = m ? m[2] * x + m[6] * y + m[10] * z + m[14] : z;
            b.min[0] = Math.min(b.min[0], qx); b.max[0] = Math.max(b.max[0], qx);
            b.min[1] = Math.min(b.min[1], qy); b.max[1] = Math.max(b.max[1], qy);
            b.min[2] = Math.min(b.min[2], qz); b.max[2] = Math.max(b.max[2], qz);
          }
        }
      }
      for (const [index, task] of tasks.entries()) {
        const chain = task.chain.map(entry => ({ ...entry, bounds: bounds.get(entry.node) }));
        for (const entry of chain) { entry.effector._fieldBounds = entry.bounds; entry.effector._effectorFrame = task.frame; }
        meshDeformer.deformMesh(task.mesh, chain, task.frame, task.polygonCount, task.legacy,
          (index + 1) / (tasks.length + 1) * 0.001);
      }
      return new Set(tasks.map(task => task.mesh));
    } finally { tasks = null; }
  }

  function hasActiveEffectors(objects, frame) {
    return Array.from(objects || []).some(object => object && (
      (typeof object.deformPositions === "function" && (!object.properties?.enabled ||
        optionPropertyValue(object.properties.enabled, frame, 1) === 1)) ||
      hasActiveEffectors(object.objects, frame)));
  }

  function apply(layer, frame) {
    if (!layer?.objects) return;
    frame = Number.isFinite(frame) ? frame : 0;
    const previous = affectedMeshes.get(layer);
    if (!hasActiveEffectors(layer.objects, frame)) {
      if (previous) for (const mesh of previous) meshDeformer.restoreMesh(mesh);
      affectedMeshes.delete(layer);
      layers.delete(layer);
      return;
    }
    layers.add(layer);
    // Before fonts and source assets are prepared, there may be no mesh to
    // queue yet. A preview must hold through that first preparation too.
    if (presentation.isPresenting() && !preparingMeshes && !preparedLayers.has(layer)) {
      if (!previewPrepares.has(layer)) {
        const started = generation;
        const task = Promise.resolve().then(() => layer.prepare(frame)).then(() => {
          if (started !== generation) return;
          const viewport = editor?.mainViewport;
          if (!viewport?.enabled) return;
          viewport.__zoidiumPlayerPlusRenderOnce = true;
          try { viewport._render?.(); } finally { viewport.__zoidiumPlayerPlusRenderOnce = false; }
        }).catch(error => {
          console.warn("[Zoidium] Effector preview preparation failed", error);
        }).finally(() => previewPrepares.delete(layer));
        previewPrepares.set(layer, task);
      }
      presentation.hold();
    }
    layer.threeObj?.updateMatrixWorld?.(true);
    const current = evaluateTree(() => walk(layer.objects, [], frame));
    if (previous) for (const mesh of previous) if (!current.has(mesh)) meshDeformer.restoreMesh(mesh);
    affectedMeshes.set(layer, current);
    presentation.holdIfPending(current);
  }

  function restore(layer) {
    if (!layer?.objects) return;
    for (const mesh of affectedMeshes.get(layer) || []) meshDeformer.restoreMesh(mesh);
    affectedMeshes.delete(layer);
    const seen = new Set();
    for (const object of layer.objects) restoreRenderedObject(object, seen);
  }

  // CM3 calls Scene.prepare from sequence.prepare before export getVideoFrame.
  // Update after child preparation to capture animated/generated source meshes.
  async function settle(evaluate) {
    const started = generation;
    for (;;) {
      if (started !== generation) return;
      const meshes = new Set();
      preparingMeshes = meshes;
      try { evaluate(); } finally { preparingMeshes = null; }
      const pending = meshDeformer.pending(meshes);
      if (!pending.length) return;
      await Promise.all(pending);
    }
  }

  async function prepareObject(object, frame) {
    if (!state.meshJobs || object.__zoidiumRepeater) return;
    const layer = liveObjectLayer(object, PZ);
    if (!layer) return;
    const started = object._prepareGeneration;
    // The outer effector prepares the full chain after its children are ready.
    for (let parent = object.parent; parent && parent !== object; parent = parent.parent) {
      if (typeof parent.deformPositions === "function" || parent.__zoidiumRepeater) return;
      if (parent === parent.parent) break;
    }
    object.update(frame);
    layer.threeObj?.updateMatrixWorld?.(true);
    await settle(() => {
      if (started !== object._prepareGeneration || liveObjectLayer(object, PZ) !== layer) return;
      const meshes = evaluateTree(() => walkRenderedObject(object, [], frame, object.threeObj,
        mapRenderNodes(object.threeObj, object.threeObj)));
      if (!meshes.size) return;
      // Object.prepare can finish before Scene.apply has ever run. These
      // working geometries also need restoration if the effector is removed.
      const previous = affectedMeshes.get(layer) || new Set();
      for (const mesh of meshes) previous.add(mesh);
      affectedMeshes.set(layer, previous);
      layers.add(layer);
    });
  }

  const patchedPrepare = async function prepareWithEffectors(frame, ...args) {
    const started = generation;
    await originalPrepare?.call(this, frame, ...args);
    if (started !== generation || !state.meshJobs) return;
    const affected = objects => Array.from(objects || []).some(object =>
      typeof object?.deformPositions === "function" || affected(object?.objects));
    if (!affected(this.objects)) return;
    originalUpdate.call(this, frame);
    await settle(() => apply(this, frame));
    if (started === generation) preparedLayers.add(this);
  };
  const patchedUnload = function unloadWithEffectors(...args) {
    restore(this);
    layers.delete(this);
    affectedMeshes.delete(this);
    return originalUnload?.apply(this, args);
  };
  prototype.prepare = patchedPrepare;
  prototype.unload = patchedUnload;

  const patchedUpdate = function updateWithEffectors(frame) {
    originalUpdate.call(this, frame);
    apply(this, frame);
  };
  patchedUpdate.__zoidiumEffectorDeformPatch = true;
  prototype.update = patchedUpdate;
  prototype.__zoidiumEffectorDeformPatch = true;
  prototype.__zoidiumEffectorDeformSupport = { apply, restore, prepareObject };

  return {
    apply,
    prepareObject,
    deactivate() {
      editor?.onProjectChanged?.unwatch(projectChanged);
      releaseLayers();
      disposeFieldHelpers();
      presentation.dispose();
      meshDeformer.dispose();
      if (prototype.prepare === patchedPrepare) prototype.prepare = originalPrepare;
      if (prototype.unload === patchedUnload) prototype.unload = originalUnload;
      if (prototype.update === patchedUpdate) prototype.update = originalUpdate;
      delete prototype.__zoidiumEffectorDeformPatch;
      delete prototype.__zoidiumEffectorDeformSupport;
    },
  };
}

module.exports = {
  getMeshDeformer, installFieldHelpers, fieldGuidePoints, curvePolygonCount,
  createDeformationSupport, liveObjectLayer
};
