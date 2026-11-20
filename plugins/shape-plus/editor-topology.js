"use strict";
const { clone } = require("./model.js");
const geometry = require("./editor-geometry.js");
const animation = require("./path-animation.js");
const nativeTopology = require("./path-topology.js");
function channels(data) {
  const path = data.properties.path;
  if (path.expression || path.objects?.some((c) => c.expression))
    throw Error("Expression-driven paths cannot be edited");
  const result =
    path.objects ||
    Array.from({ length: data.vertexIds.length * 6 }, (_, i) => ({
      animated: !!path.animated,
      keyframes: path.keyframes.map((k) => ({ ...k, value: k.value[i] })),
    }));
  const signature = JSON.stringify(result[0].keyframes.map((k) => k.frame));
  if (
    result.some(
      (c) =>
        JSON.stringify(c.keyframes.map((k) => k.frame)) !== signature ||
        !!c.animated !== !!result[0].animated,
    )
  )
    throw Error("Synchronize all Path channels before changing topology");
  return clone(result);
}
function topology(data, operation) {
  const result = clone(data),
    old = channels(result),
    ids = result.vertexIds.slice();
  if (operation.kind === "first") {
    const index = ids.indexOf(operation.id), closed = Number(result.properties.closed) === 1;
    if (index < 0) throw Error("Unknown vertex ID");
    if (index === 0) return result;
    if (!closed && index !== ids.length - 1)
      throw Error("Choose an endpoint to set the first vertex of an open path.");
    const order = closed ? [...ids.slice(index), ...ids.slice(0, index)] : ids.slice().reverse();
    const offsets = closed ? [0, 1, 2, 3, 4, 5] : [0, 1, 4, 5, 2, 3];
    const reorder = values => order.flatMap(id => offsets.map(offset => values[ids.indexOf(id) * 6 + offset]));
    const path = result.properties.path;
    result.vertexIds = order;
    if (path.objects) path.objects = reorder(path.objects);
    else for (const key of path.keyframes) key.value = reorder(key.value);
    return result;
  }
  const frames = old[0].keyframes.length;
  let sources = ids.flatMap((_, i) => [0, 1, 2, 3, 4, 5].map((j) => i * 6 + j));
  if (operation.kind === "insert") {
    if (ids.length >= 256) throw Error("A path supports at most 256 vertices");
    ids.splice(operation.index + 1, 0, operation.id);
    sources.splice(
      (operation.index + 1) * 6,
      0,
      ...[0, 1, 2, 3, 4, 5].map((j) => operation.index * 6 + j),
    );
    result.vertexModes[operation.id] = "smooth";
  } else if (operation.kind === "append") {
    if (ids.length >= 256) throw Error("A path supports at most 256 vertices");
    ids.push(operation.id);
    sources.push(0, 1, 2, 3, 4, 5);
    result.vertexModes[operation.id] = "corner";
  } else if (operation.kind === "delete") {
    const removed = new Set(operation.ids);
    sources = sources.filter((_, i) => !removed.has(ids[Math.floor(i / 6)]));
    result.vertexIds = ids.filter((id) => !removed.has(id));
    for (const id of removed) delete result.vertexModes[id];
    if (!result.vertexIds.length) return null;
  } else if (operation.kind === "reverse") {
    ids.reverse();
    sources = ids.flatMap((id) =>
      [0, 1, 4, 5, 2, 3].map((j) => result.vertexIds.indexOf(id) * 6 + j),
    );
  }
  const output = sources.map((index) => clone(old[index]));
  if (["insert", "append"].includes(operation.kind))
    for (let k = 0; k < frames; k++) {
      let points = geometry.vertices(old.map((c) => c.keyframes[k].value));
      points =
        operation.kind === "insert"
          ? geometry.insert(
              points,
              operation.index,
              operation.t,
              !!result.properties.closed,
            )
          : [
              ...points,
              { point: operation.point.slice(), in: [0, 0], out: [0, 0] },
            ];
      geometry.values(points).forEach((value, i) => {
        output[i].keyframes[k].value = value;
      });
    }
  result.vertexIds = operation.kind === "delete" ? result.vertexIds : ids;
  result.properties.path = { ...result.properties.path, objects: output };
  delete result.properties.path.keyframes;
  delete result.properties.path.animated;
  return result;
}
function applyTopology(host, data, operation, adapter) {
  const list = animation.channels(data);
  const animated = list.some(channel => channel.animated || channel.keyframes.length > 1);
  if (!animated) return false;
  if (operation.kind === "delete" && data.vertexIds.every(id => operation.ids.includes(id))) {
    // Deleting all vertices removes the whole path, as in the static editor.
    host.commit(null);
  } else nativeTopology.apply(host, operation, adapter);
  return true;
}
module.exports = { channels, topology, applyTopology };
