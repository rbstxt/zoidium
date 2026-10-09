"use strict";

// The worker and synchronous reference use the same pure geometry functions.
const core = require("./effector-core.js");
const fracture = require("./effector-fracture.js");
const { computeSmoothVertexNormals } = require("./effector-mesh.js");

function byteSize(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) {
    if (seen.has(value.buffer)) return 0;
    seen.add(value.buffer);
    return value.buffer.byteLength;
  }
  return Object.values(value).reduce((sum, item) => sum + byteSize(item, seen), 0);
}

function createStageCache(maxBytes = 64 * 1024 * 1024) {
  const entries = new Map();
  let bytes = 0;
  return {
    get(key, build) {
      let entry = entries.get(key);
      if (!entry) {
        const value = build();
        entry = { value, bytes: byteSize(value) };
        bytes += entry.bytes;
      } else entries.delete(key);
      entries.set(key, entry);
      while (entries.size > 4 || bytes > maxBytes) {
        const first = entries.keys().next().value;
        bytes -= entries.get(first).bytes;
        entries.delete(first);
      }
      return entry.value;
    },
    clear() { entries.clear(); bytes = 0; },
    forget(sourceId) {
      for (const [key, entry] of entries) if (key.startsWith(sourceId + ":")) {
        bytes -= entry.bytes; entries.delete(key);
      }
    },
  };
}

// Matches THREE r91 BufferGeometry.computeVertexNormals, including its Float32
// accumulation and normalization order. Smooth averaging is shared with preview.
function normalsFor(stage, positions) {
  const normal = new Float32Array(positions.length);
  if (!stage.smooth) {
    const face = (a, b, c) => {
      const cbx = positions[c] - positions[b], cby = positions[c + 1] - positions[b + 1], cbz = positions[c + 2] - positions[b + 2];
      const abx = positions[a] - positions[b], aby = positions[a + 1] - positions[b + 1], abz = positions[a + 2] - positions[b + 2];
      return [cby * abz - cbz * aby, cbz * abx - cbx * abz, cbx * aby - cby * abx];
    };
    if (stage.index) {
      const groups = stage.groups.length ? stage.groups : [{ start: 0, count: stage.index.length }];
      for (const group of groups) for (let i = group.start; i < group.start + group.count; i += 3) {
        const offsets = [stage.index[i] * 3, stage.index[i + 1] * 3, stage.index[i + 2] * 3];
        const n = face(...offsets);
        for (const offset of offsets) for (let axis = 0; axis < 3; axis++) normal[offset + axis] += n[axis];
      }
    } else {
      for (let offset = 0; offset < positions.length; offset += 9) {
        const n = face(offset, offset + 3, offset + 6);
        for (let corner = 0; corner < 3; corner++) normal.set(n, offset + corner * 3);
      }
    }
    for (let offset = 0; offset < normal.length; offset += 3) {
      const x = normal[offset], y = normal[offset + 1], z = normal[offset + 2];
      const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      normal[offset] = x * scale;
      normal[offset + 1] = y * scale;
      normal[offset + 2] = z * scale;
    }
  } else {
    computeSmoothVertexNormals({
      attributes: { position: { array: positions, count: positions.length / 3 }, normal: { array: normal } },
      groups: stage.groups,
    });
  }
  return normal;
}

function evaluateMesh(input, cache = createStageCache()) {
  const { base, commands, polygonCount, sourceId } = input;
  let topologyKey = sourceId + ":subdivide:" + polygonCount;
  let stage = polygonCount > 1 ? cache.get(topologyKey, () => core.subdivideStage(base, polygonCount)) : base;
  let work = new Float32Array(stage.positions);
  let prefix = topologyKey;
  const errors = [];
  for (const command of commands) {
    if (command.kind === "fracture") {
      const key = prefix + ":fracture:" + JSON.stringify(command.topology);
      const result = cache.get(key, () => fracture.buildVoronoiFracture(
        { positions: work, index: stage.index, uvs: stage.uvs }, command.topology, command.limits
      ));
      if (result.error) errors.push(result.error);
      else { stage = result; work = new Float32Array(stage.positions); topologyKey = key; }
    }
    const relation = command.relation;
    if (relation) {
      if (!relation.identity) core.transformPositions(work, relation.forward);
      if (command.kind === "twist") core.twistPositions(work, command.angle, command.axis, command.offset);
      if (command.kind === "warp") core.warpPositions(work, command.strength, command.axis, command.offset, command.field);
      if (command.kind === "fracture" && stage.pieceIds) fracture.applyFragmentMotion(work, stage, command.motion, relation.identity ? null : relation.forward);
      if (!relation.identity) core.transformPositions(work, relation.inverse);
    }
    prefix += ":" + JSON.stringify(command);
  }
  // Copy cached arrays before transferring ownership back to the main thread.
  const attributes = {};
  for (const [name, attribute] of Object.entries(stage.attributes)) {
    if (name !== "normal") attributes[name] = { array: new attribute.array.constructor(attribute.array), itemSize: attribute.itemSize, normalized: attribute.normalized };
  }
  attributes.normal = { array: normalsFor(stage, work), itemSize: 3, normalized: false };
  const bounds = core.boundsOf(work);
  const center = bounds.min.map((value, axis) => (value + bounds.max[axis]) * 0.5);
  let radiusSquared = 0;
  for (let i = 0; i < work.length; i += 3) {
    const x = work[i] - center[0], y = work[i + 1] - center[1], z = work[i + 2] - center[2];
    radiusSquared = Math.max(radiusSquared, x * x + y * y + z * z);
  }
  return { kind: stage.kind, smooth: stage.smooth, count: stage.count, positions: work, attributes,
    index: stage.index ? new stage.index.constructor(stage.index) : null,
    groups: stage.groups, topologyKey, errors, sphere: { center, radius: Math.sqrt(radiusSquared) } };
}

module.exports = { byteSize, createStageCache, evaluateMesh, normalsFor };
