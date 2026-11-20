"use strict";
// host.data is a serialized path item; host.commit publishes one snapshot.
// adapter.sample and adapter.makeKey follow path-animation's detached-channel
// contract. adapter.certify({phase, before, after, operation, closed, beforeIds, afterIds}) must prove exact
// evaluation for every frame, including outside the keyed interval. For phase
// "synchronize" it proves channel values unchanged. For phase "topology" it
// proves the requested geometric relation, including the split parameter, for
// all frames. Sampling a few frames is not proof. Return true only for native
// interpolation and key metadata that support that proof. No certification
// means no write. The integration owns the native proof and its tests.
const animation = require("./path-animation.js");
const geometry = require("./editor-geometry.js");
const copy = (value) => JSON.parse(JSON.stringify(value));
function certify(adapter, phase, before, after, operation, closed, beforeIds, afterIds) {
  const result = adapter?.certify?.({ phase, before: copy(before), after: copy(after),
    operation: copy(operation), closed: Number(closed) === 1, beforeIds: copy(beforeIds), afterIds: copy(afterIds) });
  if (result === true) return;
  throw Error(typeof result === "string" ? result :
    "Cannot establish exact animation preservation for this topology change");
}
function synchronizeKeys(before, adapter) {
  const list = copy(before);
  if (!list.length || typeof adapter?.sample !== "function" || typeof adapter?.makeKey !== "function")
    throw Error("Cannot establish exact animation preservation without a native adapter");
  for (const channel of list) {
    const seen = new Set();
    for (const key of channel.keyframes) {
      if (!Number.isFinite(key.frame) || !Number.isFinite(key.value) || seen.has(key.frame))
        throw Error("Invalid path keyframes");
      seen.add(key.frame);
    }
  }
  const frames = [...new Set(list.flatMap((c) => c.keyframes.map((k) => k.frame)))].sort((a, b) => a - b);
  const additions = list.map((channel, index) => frames.map((frame) => {
    if (channel.keyframes.some((key) => key.frame === frame)) return null;
    const value = adapter.sample(copy(channel), frame, index);
    if (!Number.isFinite(value)) throw Error("Invalid sampled path value");
    const key = adapter.makeKey(copy(channel), frame, value, index);
    if (!key || key.frame !== frame || key.value !== value) throw Error("Invalid native key");
    return copy(key);
  }));
  list.forEach((channel, index) => {
    channel.keyframes.push(...additions[index].filter(Boolean));
    channel.keyframes.sort((a, b) => a.frame - b.frame);
  });
  return list;
}
function prepare(item, adapter, operation) {
  const before = animation.channels(item), list = synchronizeKeys(before, adapter);
  certify(adapter, "synchronize", before, list, operation, item.properties.closed, item.vertexIds, item.vertexIds);
  return list;
}
function validate(item, operation) {
  const ids = item.vertexIds, kind = operation?.kind;
  if (!Array.isArray(ids) || !ids.length) throw Error("Path needs stable vertex IDs");
  if (kind === "insert" || kind === "append") {
    if (ids.length >= 256) throw Error("A path supports at most 256 vertices");
    if (typeof operation.id !== "string" || !operation.id || operation.id.length > 128 || ids.includes(operation.id))
      throw Error("A new unique vertex ID is required");
    if (kind === "insert" && (!Number.isInteger(operation.index) || operation.index < 0 ||
      operation.index >= ids.length - (Number(item.properties.closed) === 1 ? 0 : 1) || !(operation.t > 0 && operation.t < 1)))
      throw Error("Invalid path split");
    if (kind === "append" && (!Array.isArray(operation.point) || operation.point.length !== 2 ||
      !operation.point.every(Number.isFinite))) throw Error("Invalid endpoint");
  } else if (kind === "delete") {
    if (!Array.isArray(operation.ids) || !operation.ids.length || new Set(operation.ids).size !== operation.ids.length ||
      operation.ids.some((id) => !ids.includes(id)) || operation.ids.length >= ids.length)
      throw Error("Invalid vertex deletion");
  } else if (kind === "first") {
    const index = ids.indexOf(operation.id);
    if (index < 0) throw Error("Unknown vertex ID");
    if (Number(item.properties.closed) !== 1 && index !== 0 && index !== ids.length - 1)
      throw Error("Choose an endpoint to set the first vertex of an open path.");
    if (index === 0) return false;
  } else if (kind === "reverse") {
    if (ids.length < 2) return false;
  } else throw Error("Unknown topology operation");
  return true;
}
function apply(host, operation, adapter) {
  // Check expressions even for a no-op, so unsupported paths never appear editable.
  animation.channels(host.data);
  if (!validate(host.data, operation)) return false;
  const result = copy(host.data), old = prepare(result, adapter, operation);
  const ids = result.vertexIds.slice(), modes = result.vertexModes || (result.vertexModes = {});
  let sources = ids.flatMap((_, i) => Array.from({ length: 6 }, (_, j) => i * 6 + j));
  if (operation.kind === "insert") {
    ids.splice(operation.index + 1, 0, operation.id);
    sources.splice((operation.index + 1) * 6, 0, ...sources.slice(operation.index * 6, operation.index * 6 + 6));
    modes[operation.id] = "smooth";
  } else if (operation.kind === "append") {
    ids.push(operation.id);
    sources.push(...sources.slice(0, 6));
    modes[operation.id] = "corner";
  } else if (operation.kind === "delete") {
    const removed = new Set(operation.ids);
    sources = sources.filter((_, i) => !removed.has(ids[Math.floor(i / 6)]));
    result.vertexIds = ids.filter((id) => !removed.has(id));
    operation.ids.forEach((id) => { delete modes[id]; });
  } else {
    const index = ids.indexOf(operation.id);
    const rotate = operation.kind === "first" && Number(result.properties.closed) === 1;
    const order = rotate ? [...ids.slice(index), ...ids.slice(0, index)] : ids.slice().reverse();
    sources = order.flatMap((id) => (rotate ? [0, 1, 2, 3, 4, 5] : [0, 1, 4, 5, 2, 3])
      .map((offset) => ids.indexOf(id) * 6 + offset));
    result.vertexIds = order;
  }
  const output = sources.map((index) => copy(old[index]));
  if (operation.kind === "insert" || operation.kind === "append") {
    for (let k = 0; k < old[0].keyframes.length; k++) {
      let points = geometry.vertices(old.map((channel) => channel.keyframes[k].value));
      points = operation.kind === "insert" ? geometry.insert(points, operation.index, operation.t, Number(result.properties.closed) === 1)
        : [...points, { point: operation.point.slice(), in: [0, 0], out: [0, 0] }];
      geometry.values(points).forEach((value, i) => { output[i].keyframes[k].value = value; });
    }
    result.vertexIds = ids;
  }
  certify(adapter, "topology", old, output, operation, result.properties.closed, host.data.vertexIds, result.vertexIds);
  result.properties.path.objects = output;
  delete result.properties.path.animated;
  delete result.properties.path.keyframes;
  host.commit(result);
  return true;
}
module.exports = { prepare, apply, synchronizeKeys };
