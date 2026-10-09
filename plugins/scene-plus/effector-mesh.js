"use strict";

// Mesh evaluation for Effector objects. Every frame each deformed mesh is
// rebuilt from its pristine source data, so the output depends only on the
// source geometry, the effector properties at the requested frame, and the
// transforms of the render nodes. No previous frame is read.
//
// Per-mesh state lives in a WeakMap, never in mesh.userData: Object3D.copy in
// three r91 JSON-clones userData, so state stored there would be serialized into
// every repeater clone.

const core = require("./effector-core.js");

const MAX_DERIVED_ENTRIES = 4;

function sameArray(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function createMeshDeformer(THREE) {
  const convertedGeometries = new WeakMap();
  const sourceStages = new WeakMap();
  const derivedStages = new WeakMap();
  const meshStates = new WeakMap();
  const warnings = new Set();

  function warnOnce(key, message) {
    if (warnings.has(key)) return;
    warnings.add(key);
    console.warn(message);
  }

  function toBufferGeometry(geometry) {
    if (!geometry.isGeometry) return geometry;
    let converted = convertedGeometries.get(geometry);
    if (!converted) {
      converted = new THREE.BufferGeometry().fromGeometry(geometry);
      convertedGeometries.set(geometry, converted);
    }
    return converted;
  }

  // A stage is an immutable snapshot of one mesh topology: positions plus
  // named attributes. Stages are never written to; per-frame output goes into
  // separate working arrays.
  function buildSourceStage(base) {
    const attributes = {};
    for (const name of Object.keys(base.attributes)) {
      const attribute = base.attributes[name];
      if (!attribute || !attribute.array || !attribute.itemSize || name === "position") continue;
      attributes[name] = {
        array: attribute.array,
        itemSize: attribute.itemSize,
        normalized: Boolean(attribute.normalized),
        ref: attribute,
      };
    }
    const positions = new Float32Array(base.attributes.position.array);
    const groups = (base.groups || []).map((group) => ({
      start: group.start,
      count: group.count,
      materialIndex: group.materialIndex,
    }));
    return {
      kind: "source",
      smooth: false,
      count: Math.floor(positions.length / 3),
      positions,
      attributes,
      index: base.index ? base.index.array : null,
      indexRef: base.index || null,
      groups,
      uvs: attributes.uv ? attributes.uv.array : null,
      ...core.boundsOf(positions),
    };
  }

  function sourceStage(geometry) {
    const base = toBufferGeometry(geometry);
    const position = base.attributes && base.attributes.position;
    if (!position || !position.array || position.itemSize !== 3) return null;
    const version = typeof position.version === "number" ? position.version : 0;
    const cached = sourceStages.get(base);
    if (cached && cached.version === version && cached.array === position.array) return cached.stage;
    const stage = buildSourceStage(base);
    sourceStages.set(base, { version, array: position.array, stage });
    return stage;
  }

  // Memoizes derived stages per owner stage. Entries keyed by input positions
  // are reused only while that input is unchanged, so upstream animation
  // rebuilds the derived stage and static upstream reuses it.
  function derive(owner, key, input, build) {
    let map = derivedStages.get(owner);
    if (!map) {
      map = new Map();
      derivedStages.set(owner, map);
    }
    const entry = map.get(key);
    if (entry && (input === null || sameArray(entry.input, input))) {
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    }
    const value = build();
    map.delete(key);
    map.set(key, { input: input ? new Float32Array(input) : null, value });
    while (map.size > MAX_DERIVED_ENTRIES) map.delete(map.keys().next().value);
    return value;
  }

  function subdivided(stage, polygonCount) {
    return derive(stage, "subdivide:" + polygonCount, null, () => core.subdivideStage(stage, polygonCount));
  }

  function buildWorking(stage) {
    const geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(new Float32Array(stage.positions), 3));
    for (const name of Object.keys(stage.attributes)) {
      const attribute = stage.attributes[name];
      if (name === "normal") {
        // Normals are always rewritten, so this array must be owned.
        geometry.addAttribute(name, new THREE.BufferAttribute(new Float32Array(attribute.array), attribute.itemSize, attribute.normalized));
      } else if (attribute.ref && stage.kind === "source") {
        geometry.addAttribute(name, attribute.ref);
      } else {
        geometry.addAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize, attribute.normalized));
      }
    }
    if (stage.indexRef) geometry.setIndex(stage.indexRef);
    for (const group of stage.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    return geometry;
  }

  function recomputeNormals(geometry, stage) {
    if (stage.smooth) {
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      computeSmoothVertexNormals(geometry);
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
  }

  // Averages face normals across coincident vertices of the same material group.
  function computeSmoothVertexNormals(geometry) {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    if (!position || !normal) return;
    const sums = new Map();
    const groupOf = (vertex) => {
      for (const group of geometry.groups || []) {
        if (vertex >= group.start && vertex < group.start + group.count) return group.materialIndex || 0;
      }
      return 0;
    };
    const keyFor = (vertex) => {
      const x = position.array[vertex * 3];
      const y = position.array[vertex * 3 + 1];
      const z = position.array[vertex * 3 + 2];
      return groupOf(vertex) + ":" + Math.round(x * 100000) + ":" + Math.round(y * 100000) + ":" + Math.round(z * 100000);
    };
    for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
      const a = [position.array[vertex * 3], position.array[vertex * 3 + 1], position.array[vertex * 3 + 2]];
      const b = [position.array[vertex * 3 + 3], position.array[vertex * 3 + 4], position.array[vertex * 3 + 5]];
      const c = [position.array[vertex * 3 + 6], position.array[vertex * 3 + 7], position.array[vertex * 3 + 8]];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const face = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      for (let offset = 0; offset < 3; offset += 1) {
        const key = keyFor(vertex + offset);
        const sum = sums.get(key) || [0, 0, 0];
        sum[0] += face[0];
        sum[1] += face[1];
        sum[2] += face[2];
        sums.set(key, sum);
      }
    }
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const sum = sums.get(keyFor(vertex)) || [0, 0, 1];
      const length = Math.hypot(sum[0], sum[1], sum[2]) || 1;
      normal.array[vertex * 3] = sum[0] / length;
      normal.array[vertex * 3 + 1] = sum[1] / length;
      normal.array[vertex * 3 + 2] = sum[2] / length;
    }
    normal.needsUpdate = true;
  }

  function syncMaterial(mesh, state, wantFracture, vertexColors) {
    if (!wantFracture) {
      if (state.material) {
        if (mesh.material === state.material.clone) mesh.material = state.material.original;
        state.material.clone.dispose();
        state.material = null;
      }
      return;
    }
    const current = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!current) return;
    const original = state.material && current === state.material.clone ? state.material.original : current;
    if (!state.material || state.material.original !== original) {
      if (state.material) state.material.clone.dispose();
      const clone = original.clone();
      clone.side = THREE.DoubleSide;
      state.material = { original, clone, vertexColors: null };
    }
    const material = state.material;
    if (material.vertexColors !== Boolean(vertexColors)) {
      material.clone.vertexColors = Boolean(vertexColors);
      material.clone.needsUpdate = true;
      material.vertexColors = Boolean(vertexColors);
    }
    // Shader uniforms are copied by reference so animated custom materials keep
    // following their original material after cloning.
    if (material.clone.uniforms && original.uniforms) {
      for (const name of Object.keys(material.clone.uniforms)) {
        if (original.uniforms[name]) material.clone.uniforms[name].value = original.uniforms[name].value;
      }
    }
    if (mesh.material !== material.clone) mesh.material = material.clone;
  }

  function releaseState(mesh, state) {
    meshStates.delete(mesh);
    if (state.material) {
      if (mesh.material === state.material.clone) mesh.material = state.material.original;
      state.material.clone.dispose();
      state.material = null;
    }
    if (mesh.geometry === state.working) mesh.geometry = state.source;
    if (state.working) state.working.dispose();
    state.working = null;
  }

  function restoreMesh(mesh) {
    const state = meshStates.get(mesh);
    if (state) releaseState(mesh, state);
  }

  function restoreTree(root) {
    root?.traverse?.((node) => {
      if (node && node.isMesh) restoreMesh(node);
    });
  }

  // Evaluates one mesh. `chain` lists {effector, node} outer to inner. The
  // deformers run in their own local space (node.matrixWorld relative to the
  // mesh), so transformed effectors and nested groups act in their own frame.
  function deformMesh(mesh, chain, frame, requestedPolygonCount) {
    let state = meshStates.get(mesh);
    if (!chain.length) {
      if (state) releaseState(mesh, state);
      return;
    }
    if (state && mesh.geometry !== state.working) {
      // Something else replaced the geometry; the old working copy is stale.
      releaseState(mesh, state);
      state = null;
    }
    const source = mesh.geometry;
    if (!source) return;
    const base = sourceStage(state ? state.source : source);
    if (!base || !base.count) return;

    const triangleCount = Math.max(1, Math.floor(base.count / 3));
    const budget = Math.floor(core.MAX_SMOOTH_TRIANGLES / triangleCount);
    let polygonCount = Math.min(core.clampPolygonCount(requestedPolygonCount), budget);
    if (polygonCount < core.SMOOTH_TRIANGLE_BUDGET_MIN_POLYGONS) polygonCount = 1;
    let stage = polygonCount > 1 ? subdivided(base, polygonCount) : base;

    // Reuse the per-mesh scratch buffer when the topology is unchanged. Effectors
    // may return a different array, so the buffer is only reused when it fits.
    const scratch = state && state.workBuffer && state.workBuffer.length === stage.positions.length
      ? state.workBuffer
      : new Float32Array(stage.positions.length);
    scratch.set(stage.positions);
    let work = scratch;
    let surfaceColors = null;
    for (const entry of chain) {
      const effector = entry.effector;
      if (typeof effector.produceStage === "function") {
        const next = effector.produceStage(work, stage, frame, derive);
        if (next) {
          stage = next;
          work = new Float32Array(next.positions);
        }
      }
      if (typeof effector.surfaceOptions === "function") {
        surfaceColors = effector.surfaceOptions(frame) || surfaceColors;
      }
      if (typeof effector.deformPositions !== "function") continue;
      const deformerWorld = entry.node && entry.node.matrixWorld ? entry.node.matrixWorld.elements : null;
      const meshWorld = mesh.matrixWorld ? mesh.matrixWorld.elements : null;
      const relation = core.relativeTransform(deformerWorld, meshWorld);
      if (!relation) continue;
      if (relation.identity) {
        work = effector.deformPositions(work, frame, { stage, matrix: null }) || work;
      } else {
        core.transformPositions(work, relation.forward);
        work = effector.deformPositions(work, frame, { stage, matrix: relation.forward }) || work;
        core.transformPositions(work, relation.inverse);
      }
    }

    const next = state || { source, working: null, stage: null, material: null };
    if (!next.working || next.stage !== stage) {
      if (next.working) next.working.dispose();
      next.working = buildWorking(stage);
      next.stage = stage;
      next.fresh = true;
    }
    const attribute = next.working.attributes.position;
    const target = attribute.array;
    let changed = next.fresh === true || target.length !== work.length;
    if (!changed) {
      for (let index = 0; index < target.length; index += 1) {
        if (target[index] !== work[index]) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      target.set(work);
      attribute.needsUpdate = true;
      recomputeNormals(next.working, stage);
    }
    next.fresh = false;
    next.workBuffer = work.length === stage.positions.length ? work : null;
    if (mesh.geometry !== next.working) mesh.geometry = next.working;
    syncMaterial(mesh, next, stage.kind === "fracture", surfaceColors ? surfaceColors.vertexColors : false);
    meshStates.set(mesh, next);
  }

  return {
    deformMesh,
    restoreMesh,
    restoreTree,
    warnOnce,
  };
}

module.exports = { createMeshDeformer };
