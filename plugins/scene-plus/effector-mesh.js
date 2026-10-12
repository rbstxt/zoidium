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

function createMeshDeformer(THREE, jobs) {
  const convertedGeometries = new WeakMap();
  const sourceStages = new WeakMap();
  const derivedStages = new WeakMap();
  const meshStates = new WeakMap();
  const warnings = new Set();
  const liveMeshes = new Set();
  let sourceSerial = 0;

  function warnOnce(key, message) {
    if (warnings.has(key)) return;
    warnings.add(key);
    console.warn(message);
  }

  // Material+ rewrites the UVs of legacy text geometry in place and bumps
  // `__zoidiumUvRevision`; a new revision needs a fresh conversion.
  function toBufferGeometry(geometry) {
    if (!geometry.isGeometry) return geometry;
    const revision = geometry.__zoidiumUvRevision || 0;
    let converted = convertedGeometries.get(geometry);
    if (!converted || converted.revision !== revision) {
      converted = { buffer: new THREE.BufferGeometry().fromGeometry(geometry), revision };
      convertedGeometries.set(geometry, converted);
    }
    return converted.buffer;
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
        array: new attribute.array.constructor(attribute.array),
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
    const pieces = core.connectedPieces({ positions, count: positions.length / 3, index: base.index?.array });
    return {
      ...pieces,
      sourceId: ++sourceSerial,
      kind: "source",
      smooth: false,
      count: Math.floor(positions.length / 3),
      positions,
      attributes,
      index: base.index ? new base.index.array.constructor(base.index.array) : null,
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
    const names = Object.keys(base.attributes).sort();
    const refs = [base.index, ...names.map(name => base.attributes[name])];
    const versions = refs.map(attribute => attribute?.version || 0);
    const arrays = refs.map(attribute => attribute?.array);
    const layout = JSON.stringify([names, base.groups, ...refs.map(attribute => [attribute?.itemSize, attribute?.normalized])]);
    const cached = sourceStages.get(base);
    if (cached && cached.layout === layout && arrays.every((array, i) => array === cached.arrays[i] && versions[i] === cached.versions[i])) return cached.stage;
    const stage = buildSourceStage(base);
    sourceStages.set(base, { versions, arrays, layout, stage });
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
    // THREE r91 otherwise reallocates the GPU buffer on every changed frame.
    geometry.attributes.position.dynamic = true;
    for (const name of Object.keys(stage.attributes)) {
      const attribute = stage.attributes[name];
      if (name === "normal") {
        // Normals are always rewritten, so this array must be owned.
        geometry.addAttribute(name, new THREE.BufferAttribute(new Float32Array(attribute.array), attribute.itemSize, attribute.normalized));
        geometry.attributes[name].dynamic = true;
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

  function recomputeNormals(geometry, stage, rigid) {
    if (rigid && geometry.attributes.normal && computeFractureNormals(stage, geometry.attributes.position.array, geometry.attributes.normal.array)) {
      geometry.attributes.normal.needsUpdate = true;
      geometry.computeBoundingSphere();
      return;
    }
    if (stage.smooth || (!stage.index && stage.attributes.normal)) {
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      computeSmoothVertexNormals(geometry, stage);
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
  }

  // Material properties that the fracture clone keeps for itself. `_listeners`
  // holds the renderer's dispose hook, which must stay per material.
  const CLONE_OWN_KEYS = new Set(["id", "uuid", "name", "type", "side", "vertexColors", "uniforms", "version", "userData", "_listeners"]);

  // The clone takes the original's current values every frame: CM3 materials
  // write colors, numbers and maps into their THREE material on update, and
  // replace maps when an image changes. Textures and other objects are shared
  // by reference; colors and vectors are copied into the clone's own instances.
  function copyMaterialState(original, clone) {
    for (const key of Object.keys(original)) {
      if (CLONE_OWN_KEYS.has(key)) continue;
      const value = original[key];
      const target = clone[key];
      if (value && target && target !== value && !value.isTexture && typeof target.copy === "function" &&
        value.constructor === target.constructor) target.copy(value);
      else clone[key] = value;
    }
  }

  // Fracture output renders with two clones of the mesh's material: group 0
  // (the cut walls of the source surface) and group 1 (inner cap faces). Caps
  // meet the walls exactly along the cuts, so at equal depth they speckled
  // through resting pieces; the cap clone is drawn with a polygon offset that
  // lets the wall win there.
  function releaseMaterial(mesh, state) {
    if (!state.material) return;
    if (mesh.material === state.material.shown) mesh.material = state.material.original;
    for (const clone of state.material.shown) clone.dispose();
    state.material = null;
  }

  function syncMaterial(mesh, state, wantFracture, vertexColors) {
    if (!wantFracture) {
      releaseMaterial(mesh, state);
      return;
    }
    const current = mesh.material === state.material?.shown ? state.material.original
      : Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!current) return;
    const original = current;
    if (!state.material || state.material.original !== original) {
      releaseMaterial(mesh, state);
      const shown = [original.clone(), original.clone()];
      state.material = { original, clone: shown[0], shown, vertexColors: null, version: original.version };
    }
    const material = state.material;
    const recompile = material.version !== original.version || material.vertexColors !== Boolean(vertexColors);
    material.version = original.version;
    material.vertexColors = Boolean(vertexColors);
    material.shown.forEach((clone, index) => {
      copyMaterialState(original, clone);
      clone.side = THREE.DoubleSide;
      // The original asked for a recompile (map added, transparency, defines).
      if (recompile) {
        clone.vertexColors = Boolean(vertexColors);
        clone.needsUpdate = true;
      }
      if (index === 1) {
        clone.polygonOffset = true;
        clone.polygonOffsetFactor = 1;
        clone.polygonOffsetUnits = 1;
      }
      // Shader uniforms are copied by reference so animated custom materials
      // keep following their original material after cloning.
      if (clone.uniforms && original.uniforms) {
        for (const name of Object.keys(clone.uniforms)) {
          if (original.uniforms[name]) clone.uniforms[name].value = original.uniforms[name].value;
        }
      }
    });
    if (mesh.material !== material.shown) mesh.material = material.shown;
  }

  // Material+ lays out UVs on the source geometry, not on the working copy.
  function rememberState(mesh, state) {
    meshStates.set(mesh, state);
    mesh.__zoidiumSourceGeometry = state.source;
  }

  function releaseState(mesh, state) {
    meshStates.delete(mesh);
    delete mesh.__zoidiumSourceGeometry;
    releaseMaterial(mesh, state);
    if (mesh.geometry === state.working) mesh.geometry = state.source;
    if (state.working) state.working.dispose();
    state.working = null;
  }

  function restoreMesh(mesh) {
    jobs?.release(mesh);
    liveMeshes.delete(mesh);
    const state = meshStates.get(mesh);
    if (state) releaseState(mesh, state);
    if (state?.sourceId && !Array.from(liveMeshes).some(other => meshStates.get(other)?.sourceId === state.sourceId)) {
      jobs?.forget?.(state.sourceId);
    }
  }

  function restoreTree(root) {
    root?.traverse?.((node) => {
      if (node && node.isMesh) restoreMesh(node);
    });
  }

  // Sample native object transforms without updating the scene or touching any
  // live render nodes. Generated clone/character offsets retain their matrices.
  function worldAt(node, time, memo) {
    if (!THREE.Matrix4 || !THREE.Quaternion || !THREE.Euler || !node?.matrix) return node?.matrixWorld?.elements;
    if (memo.has(node)) return memo.get(node);
    const local = node.matrix.clone();
    const owner = node.__zoidiumEffectorTransformOwner;
    const properties = owner?.properties;
    if (properties?.position && properties?.rotation && properties?.scale) {
      // Optional host transform properties can be unavailable on source objects.
      const read = (name, fallback) => { try { return properties[name].get(time); } catch (_) { return fallback; } };
      const p = read("position", [0, 0, 0]), r = read("rotation", [0, 0, 0]), scale = read("scale", [1, 1, 1]);
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, node.rotation?.order || "XYZ"));
      local.compose(new THREE.Vector3(...p), rotation, new THREE.Vector3(...scale));
    }
    const parent = node.parent ? worldAt(node.parent, time, memo) : null;
    if (parent) local.premultiply(new THREE.Matrix4().fromArray(parent));
    const result = Array.from(local.elements); memo.set(node, result); return result;
  }

  // Evaluates one mesh. `chain` lists {effector, node} outer to inner. The
  // deformers run in their own local space (node.matrixWorld relative to the
  // mesh), so transformed effectors and nested groups act in their own frame.
  function deformMesh(mesh, chain, frame, requestedPolygonCount) {
    let state = meshStates.get(mesh);
    if (!chain.length) {
      jobs?.release(mesh);
      liveMeshes.delete(mesh);
      if (state) releaseState(mesh, state);
      return;
    }
    if (state && mesh.geometry !== state.working && !(state.asyncPending && mesh.geometry === state.source)) {
      // Something else replaced the geometry; the old working copy is stale.
      jobs?.release(mesh);
      if (jobs && (state.asyncKey || state.asyncPending)) {
        // Retain the material clone so changing source geometry does not drop
        // THREE's last reference to its compiled shader program.
        if (mesh.geometry !== state.source) {
          state.working?.dispose();
          state.working = null;
          state.source = mesh.geometry;
          state.asyncKey = null;
          state.topologyKey = null;
        }
        state.asyncPending = true;
      } else {
        releaseState(mesh, state);
        state = null;
      }
    }
    const source = mesh.geometry;
    if (!source) return;
    const base = sourceStage(state ? state.source : source);
    if (!base || !base.count) return;

    const triangleCount = Math.max(1, Math.floor((base.index ? base.index.length : base.count) / 3));
    const budget = Math.floor(core.MAX_SMOOTH_TRIANGLES / triangleCount);
    let polygonCount = core.budgetSubdivision(requestedPolygonCount, budget);
    if (polygonCount < core.SMOOTH_TRIANGLE_BUDGET_MIN_POLYGONS) polygonCount = 1;
    // Fracture and large curved meshes include topology, deformation, and normal
    // averaging in the worker. Small Twist/Warp previews keep their cheap path.
    if (jobs && (chain.some(entry => typeof entry.effector.produceStage === "function") ||
      chain.some(entry => ["plain", "delay"].includes(entry.effector.workerCommand?.(frame)?.kind)) || triangleCount * polygonCount >= 5000) && chain.every(entry => typeof entry.effector.workerCommand === "function")) {
      let historyBudget = 96;
      const sampledWorlds = new Map();
      const world = (node, time) => {
        if (time === frame) return node?.matrixWorld?.elements;
        if (!sampledWorlds.has(time)) sampledWorlds.set(time, new Map());
        return worldAt(node, time, sampledWorlds.get(time));
      };
      const sampleCommands = (time, length) => chain.slice(0, length).map((entry, index) => {
        const command = { ...entry.effector.workerCommand(time), bounds: entry.bounds,
          relation: core.relativeTransform(world(entry.node, time), world(mesh, time)) };
        command.field = core.fieldForBounds(command.field, entry.bounds);
        if (command.motion) command.motion.field = core.fieldForBounds(command.motion.field, entry.bounds);
        if (command.kind === "delay" && command.strength > 0) {
          command.history = [];
          for (let i = 0; i < command.window && historyBudget > 0; i++) {
            historyBudget--; command.history.push(sampleCommands(Math.max(0, time - i - 1), index));
          }
        }
        return command;
      });
      const commands = sampleCommands(frame, chain.length);
      const key = base.sourceId + ":" + polygonCount + ":" + JSON.stringify(commands);
      const lastFracture = commands.map(command => command.kind).lastIndexOf("fracture");
      const topologyInputs = lastFracture < 0 ? [] : [commands.slice(0, lastFracture),
        commands[lastFracture].topology, commands[lastFracture].limits];
      const buildKey = base.sourceId + ":" + polygonCount + ":" + JSON.stringify(topologyInputs);
      const colors = chain.reduce((options, entry) => entry.effector.surfaceOptions?.(frame) || options, null);
      if (state?.asyncKey === key) {
        jobs.release(mesh);
        state.asyncPending = false;
        mesh.geometry = state.working;
        syncMaterial(mesh, state, state.fractured, colors?.vertexColors || false);
        return;
      }
      const attributes = {};
      for (const [name, attribute] of Object.entries(base.attributes)) {
        attributes[name] = { array: attribute.array, itemSize: attribute.itemSize, normalized: attribute.normalized };
      }
      const input = { sourceId: base.sourceId, polygonCount, commands, buildKey,
        base: { ...base, attributes, indexRef: null } };
      const entry = jobs.request(mesh, key, input);
      liveMeshes.add(mesh);
      // While the exact frame is in the worker, keep showing the newest result of
      // the same topology so edits and playback update continuously. Export
      // waits for the exact result through pending().
      const completed = entry?.status === "done" ? entry : jobs.latest?.(buildKey);
      if (!completed) {
        // Nothing of this topology has finished yet: show the pristine source.
        const pending = state || { source, working: null, material: null };
        pending.asyncPending = true;
        pending.sourceId = base.sourceId;
        mesh.geometry = pending.source;
        if (pending.material && mesh.material === pending.material.shown) mesh.material = pending.material.original;
        rememberState(mesh, pending);
        return;
      }
      const exact = completed === entry;
      const result = completed.value;
      for (const error of result.errors) warnOnce(error, "Effector skipped a fracture build: " + error + ".");
      const next = state || { source, working: null, material: null };
      const completedKey = completed.key || key;
      if (next.asyncKey !== completedKey) {
        if (!next.working || next.topologyKey !== result.topologyKey) {
          next.working?.dispose();
          next.working = buildWorking({ ...result, indexRef: result.index ? new THREE.BufferAttribute(result.index, 1) : null });
        } else {
          next.working.attributes.position.array.set(result.positions);
          next.working.attributes.normal.array.set(result.attributes.normal.array);
          next.working.attributes.position.needsUpdate = true;
          next.working.attributes.normal.needsUpdate = true;
        }
        next.working.boundingSphere = new THREE.Sphere(new THREE.Vector3(...result.sphere.center), result.sphere.radius);
        next.asyncKey = completedKey;
        next.topologyKey = result.topologyKey;
      }
      next.stage = null;
      next.sourceId = base.sourceId;
      next.asyncPending = !exact;
      next.fractured = result.kind === "fracture";
      mesh.geometry = next.working;
      syncMaterial(mesh, next, result.kind === "fracture", colors?.vertexColors || false);
      rememberState(mesh, next);
      if (exact) jobs.release(mesh);
      return;
    }
    jobs?.release(mesh);
    liveMeshes.delete(mesh);
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
        work = effector.deformPositions(work, frame, { stage, matrix: null, bounds: entry.bounds }) || work;
      } else {
        core.transformPositions(work, relation.forward);
        work = effector.deformPositions(work, frame, { stage, matrix: relation.forward, bounds: entry.bounds }) || work;
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
      // Fracture motion and Plain move whole pieces; Twist and Warp bend them.
      const rigid = chain.every(entry => typeof entry.effector.produceStage === "function" ||
        ["plain", "delay"].includes(entry.effector.workerCommand?.(frame)?.kind));
      recomputeNormals(next.working, stage, rigid);
    }
    next.fresh = false;
    next.workBuffer = work.length === stage.positions.length ? work : null;
    if (mesh.geometry !== next.working) mesh.geometry = next.working;
    syncMaterial(mesh, next, stage.kind === "fracture", surfaceColors ? surfaceColors.vertexColors : false);
    rememberState(mesh, next);
  }

  return {
    deformMesh,
    sourceStage(mesh) { return sourceStage(meshStates.get(mesh)?.source || mesh.geometry); },
    restoreMesh,
    restoreTree,
    warnOnce,
    pending(meshes) { return jobs ? jobs.pending(meshes) : []; },
    dispose() {
      for (const mesh of liveMeshes) restoreMesh(mesh);
      jobs?.dispose();
    },
    jobStats() { return jobs?.stats(); },
  };
}

// Vertices that share a position, source normal, fracture piece and material
// group are averaged together. Deformation keeps coincident vertices
// coincident, so that sharing belongs to the stage topology: it is built once
// per stage from the rest positions, and each frame only accumulates face
// normals into the shared slots.
const weldsByStage = new WeakMap();
const weldsBySource = new Map();

function buildWeld(positions, count, groups, stage) {
  const groupIds = new Int32Array(count);
  // The first group containing a vertex wins.
  for (let g = (groups || []).length - 1; g >= 0; g -= 1) {
    const group = groups[g];
    const end = Math.min(count, group.start + group.count);
    for (let vertex = Math.max(0, group.start); vertex < end; vertex += 1) groupIds[vertex] = group.materialIndex || 0;
  }
  const source = stage?.attributes?.normal?.array;
  const pieces = stage?.pieceIds;
  const slots = new Int32Array(count);
  const lookup = new Map();
  for (let vertex = 0; vertex < count; vertex += 1) {
    const hardEdge = source ? Math.round(source[vertex * 3] * 10000) + ":" + Math.round(source[vertex * 3 + 1] * 10000) + ":" + Math.round(source[vertex * 3 + 2] * 10000) : "";
    const key = hardEdge + ":" + (pieces?.[vertex] || 0) + ":" + groupIds[vertex] + ":" +
      Math.round(positions[vertex * 3] * 100000) + ":" + Math.round(positions[vertex * 3 + 1] * 100000) + ":" + Math.round(positions[vertex * 3 + 2] * 100000);
    let slot = lookup.get(key);
    if (slot === undefined) {
      slot = lookup.size;
      lookup.set(key, slot);
    }
    slots[vertex] = slot;
  }
  return { slots, slotCount: lookup.size };
}

function weldFor(positions, count, groups, stage) {
  const rest = stage?.positions;
  if (!rest || rest.length !== count * 3) return buildWeld(positions, count, groups, stage);
  let weld = weldsByStage.get(stage);
  if (weld) return weld;
  // Worker messages clone the source stage every frame; its sourceId names
  // the same immutable content.
  const sourceKey = stage.kind === "source" && stage.sourceId !== undefined ? stage.sourceId + ":" + count : null;
  weld = sourceKey ? weldsBySource.get(sourceKey) : null;
  if (!weld) {
    weld = buildWeld(rest, count, groups, stage);
    if (sourceKey) {
      weldsBySource.set(sourceKey, weld);
      while (weldsBySource.size > 8) weldsBySource.delete(weldsBySource.keys().next().value);
    }
  }
  weldsByStage.set(stage, weld);
  return weld;
}

// Average deformed faces at coincident vertices while retaining source normal
// discontinuities, material seams, and separate fracture pieces.
// A single scratch buffer bounds retained memory by the largest weld layout.
// Each call clears its active range; no normals or frame history are cached.
let normalSums = new Float64Array(0);

function computeSmoothVertexNormals(geometry, stage) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!position || !normal) return;
  const array = position.array;
  const count = position.count;
  const { slots, slotCount } = weldFor(array, count, geometry.groups, stage);
  const size = slotCount * 3;
  if (normalSums.length < size) normalSums = new Float64Array(size);
  const sums = normalSums;
  sums.fill(0, 0, size);
  const covered = count - count % 3;
  for (let vertex = 0; vertex < covered; vertex += 3) {
    const a = vertex * 3;
    const abx = array[a + 3] - array[a], aby = array[a + 4] - array[a + 1], abz = array[a + 5] - array[a + 2];
    const acx = array[a + 6] - array[a], acy = array[a + 7] - array[a + 1], acz = array[a + 8] - array[a + 2];
    const fx = aby * acz - abz * acy, fy = abz * acx - abx * acz, fz = abx * acy - aby * acx;
    for (let corner = 0; corner < 3; corner += 1) {
      const slot = slots[vertex + corner] * 3;
      sums[slot] += fx;
      sums[slot + 1] += fy;
      sums[slot + 2] += fz;
    }
  }
  // Coincident vertices read exactly the same accumulated Float64 values.
  // Normalize each slot once, preserving the original division and cast order.
  for (let slot = 0; slot < size; slot += 3) {
    const x = sums[slot], y = sums[slot + 1], z = sums[slot + 2];
    const length = Math.hypot(x, y, z) || 1;
    sums[slot] = x / length;
    sums[slot + 1] = y / length;
    sums[slot + 2] = z / length;
  }
  const out = normal.array;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (vertex >= covered) {
      out[vertex * 3] = 0;
      out[vertex * 3 + 1] = 0;
      out[vertex * 3 + 2] = 1;
      continue;
    }
    const slot = slots[vertex] * 3;
    out[vertex * 3] = sums[slot];
    out[vertex * 3 + 1] = sums[slot + 1];
    out[vertex * 3 + 2] = sums[slot + 2];
  }
  normal.needsUpdate = true;
}

// Fracture pieces move as whole pieces (rotation, translation and scale per
// piece; Plain adds per-axis scale), so their normals are the stage's source
// normals carried through each piece's transform. Recomputing them from the
// deformed faces would shade every cut differently: the clipped walls are full
// of slivers, and pieces resting against each other would show seams that the
// unfractured surface does not have. Each piece's transform is measured from
// four of its rest vertices: the corners of its largest triangle and the vertex
// farthest from that triangle's plane (the triangle's normal for flat pieces).
const fractureReferences = new WeakMap();

function cross(ax, ay, az, bx, by, bz) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function pieceReferences(stage) {
  let references = fractureReferences.get(stage);
  if (references) return references;
  const rest = stage.positions, ids = stage.pieceIds;
  const count = stage.pieceCount || 1;
  const best = new Float64Array(count).fill(-1);
  const triangles = new Int32Array(count).fill(-1);
  for (let vertex = 0; vertex + 2 < stage.count; vertex += 3) {
    const piece = ids[vertex];
    const a = vertex * 3;
    const n = cross(rest[a + 3] - rest[a], rest[a + 4] - rest[a + 1], rest[a + 5] - rest[a + 2],
      rest[a + 6] - rest[a], rest[a + 7] - rest[a + 1], rest[a + 8] - rest[a + 2]);
    const area = n[0] * n[0] + n[1] * n[1] + n[2] * n[2];
    if (area > best[piece]) { best[piece] = area; triangles[piece] = vertex; }
  }
  const apex = new Int32Array(count).fill(-1);
  const height = new Float64Array(count);
  const normals = new Float64Array(count * 3);
  for (let piece = 0; piece < count; piece += 1) {
    const vertex = triangles[piece];
    if (vertex < 0) continue;
    const a = vertex * 3;
    const n = cross(rest[a + 3] - rest[a], rest[a + 4] - rest[a + 1], rest[a + 5] - rest[a + 2],
      rest[a + 6] - rest[a], rest[a + 7] - rest[a + 1], rest[a + 8] - rest[a + 2]);
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    normals.set([n[0] / length, n[1] / length, n[2] / length], piece * 3);
  }
  for (let vertex = 0; vertex < stage.count; vertex += 1) {
    const piece = ids[vertex], corner = triangles[piece];
    if (corner < 0) continue;
    const a = corner * 3, v = vertex * 3, n = piece * 3;
    const distance = Math.abs((rest[v] - rest[a]) * normals[n] + (rest[v + 1] - rest[a + 1]) * normals[n + 1] + (rest[v + 2] - rest[a + 2]) * normals[n + 2]);
    if (distance > height[piece]) { height[piece] = distance; apex[piece] = vertex; }
  }
  // A piece thinner than this against its own size is treated as flat.
  for (let piece = 0; piece < count; piece += 1) {
    if (triangles[piece] >= 0 && height[piece] <= 1e-4 * Math.sqrt(Math.sqrt(best[piece]))) apex[piece] = -1;
  }
  references = { triangles, apex };
  fractureReferences.set(stage, references);
  return references;
}

// The three edge vectors from a piece's reference corner; the third is the
// scaled triangle normal when the piece is flat.
function pieceFrame(positions, corner, apex) {
  const a = corner * 3;
  const u = [positions[a + 3] - positions[a], positions[a + 4] - positions[a + 1], positions[a + 5] - positions[a + 2]];
  const v = [positions[a + 6] - positions[a], positions[a + 7] - positions[a + 1], positions[a + 8] - positions[a + 2]];
  let w;
  if (apex >= 0) {
    const d = apex * 3;
    w = [positions[d] - positions[a], positions[d + 1] - positions[a + 1], positions[d + 2] - positions[a + 2]];
  } else {
    const n = cross(...u, ...v);
    const length = Math.hypot(n[0], n[1], n[2]);
    const size = Math.sqrt(length) / (length || 1);
    w = [n[0] * size, n[1] * size, n[2] * size];
  }
  return [u, v, w];
}

// Writes normalized normals into `out` and returns true, or returns false when
// the stage is not a fracture with source normals.
function computeFractureNormals(stage, positions, out) {
  const source = stage?.attributes?.normal?.array;
  if (stage?.kind !== "fracture" || stage.index || !stage.pieceIds || !source || !stage.positions ||
    stage.positions.length !== positions.length || out.length !== positions.length) return false;
  const { triangles, apex } = pieceReferences(stage);
  const count = stage.pieceCount || 1;
  // Normal matrix of each piece: inverse transpose of deformed * rest^-1,
  // applied as rest^T then deformed^-T (columns v'×w', w'×u', u'×v' over det').
  const matrices = new Float64Array(count * 18);
  const valid = new Uint8Array(count);
  for (let piece = 0; piece < count; piece += 1) {
    if (triangles[piece] < 0) continue;
    const [ur, vr, wr] = pieceFrame(stage.positions, triangles[piece], apex[piece]);
    const [u, v, w] = pieceFrame(positions, triangles[piece], apex[piece]);
    const vw = cross(...v, ...w), wu = cross(...w, ...u), uv = cross(...u, ...v);
    const det = u[0] * vw[0] + u[1] * vw[1] + u[2] * vw[2];
    if (!(Math.abs(det) > 1e-20)) continue;
    const m = piece * 18;
    matrices.set([...ur, ...vr, ...wr], m);
    matrices.set([...vw, ...wu, ...uv].map(value => value / det), m + 9);
    valid[piece] = 1;
  }
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const o = vertex * 3;
    const piece = stage.pieceIds[vertex];
    let x = source[o], y = source[o + 1], z = source[o + 2];
    if (valid[piece]) {
      const m = piece * 18;
      const k0 = matrices[m] * x + matrices[m + 1] * y + matrices[m + 2] * z;
      const k1 = matrices[m + 3] * x + matrices[m + 4] * y + matrices[m + 5] * z;
      const k2 = matrices[m + 6] * x + matrices[m + 7] * y + matrices[m + 8] * z;
      x = k0 * matrices[m + 9] + k1 * matrices[m + 12] + k2 * matrices[m + 15];
      y = k0 * matrices[m + 10] + k1 * matrices[m + 13] + k2 * matrices[m + 16];
      z = k0 * matrices[m + 11] + k1 * matrices[m + 14] + k2 * matrices[m + 17];
    }
    const length = Math.hypot(x, y, z) || 1;
    out[o] = x / length;
    out[o + 1] = y / length;
    out[o + 2] = z / length;
  }
  return true;
}

module.exports = { createMeshDeformer, computeSmoothVertexNormals, computeFractureNormals };
