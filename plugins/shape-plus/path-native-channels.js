"use strict";
// create(PZ) binds detached channel operations to CM3's property evaluator.
// Expressions need an owning native property and cannot be evaluated here.
const geometry = require("./editor-geometry.js");
const copy = value => JSON.parse(JSON.stringify(value));
function create(PZ) {
  function sample(channel, frame) {
    if (channel.expression) throw Error("Expression-driven paths cannot be sampled");
    if (!Number.isFinite(frame) || !Array.isArray(channel.keyframes) || !channel.keyframes.length)
      throw Error("Invalid path channel");
    const property = PZ.property.create({ name: "Path channel", dynamic: true, type: PZ.property.type.NUMBER, value: 0 });
    property.load(copy(channel));
    property.sortKeyframes();
    return property.get(frame);
  }
  function makeKey(channel, frame, value) {
    if (channel.expression) throw Error("Expression-driven paths cannot be edited");
    const keys = channel.keyframes.slice().sort((a, b) => a.frame - b.frame);
    if (!keys.length || !Number.isFinite(frame) || !Number.isFinite(value)) throw Error("Invalid path key");
    const next = keys.find(key => key.frame >= frame) || keys[keys.length - 1];
    const key = new PZ.keyframe(value, frame, next.tween);
    return copy(key.toJSON());
  }
  function shape(channel) {
    const result = copy(channel);
    result.keyframes.forEach(key => { delete key.value; });
    return JSON.stringify(result);
  }
  function valid(channel) {
    return channel && !channel.expression && Array.isArray(channel.keyframes) && channel.keyframes.length &&
      channel.keyframes.every((key, i, keys) => Number.isFinite(key.frame) && Number.isFinite(key.value) &&
        Number.isInteger(key.tween) && key.tween >= 0 && key.tween <= 32 && (!i || keys[i - 1].frame < key.frame));
  }
  function synchronize(before, after) {
    if (before.length !== after.length) return false;
    return before.every((old, i) => {
      const next = after[i];
      if (!valid(old) || !valid(next) || old.animated !== next.animated) return false;
      if (!old.keyframes.every(key => next.keyframes.some(candidate => JSON.stringify(candidate) === JSON.stringify(key)))) return false;
      return next.keyframes.every(key => {
        if (old.keyframes.some(original => original.frame === key.frame)) return true;
        const right = old.keyframes.find(original => original.frame > key.frame);
        const left = old.keyframes.filter(original => original.frame < key.frame).at(-1);
        if (left && right && right.tween !== 0 && right.tween !== 1 && left.value !== right.value) return false;
        if (right && key.tween !== right.tween) return false;
        return key.value === sample(old, key.frame);
      });
    });
  }
  function certify(context) {
    const { phase, before, after, operation, closed, beforeIds, afterIds } = context || {};
    if (!Array.isArray(before) || !Array.isArray(after) || !before.every(valid) || !after.every(valid))
      return "Invalid or unsupported channel interpolation";
    if (phase === "synchronize") return synchronize(before, after) || "Synchronization changes interpolation";
    if (phase !== "topology" || !operation || !Array.isArray(beforeIds) || !Array.isArray(afterIds)) return "Invalid topology proof";
    let sources;
    if (operation.kind === "delete" || operation.kind === "first") {
      sources = afterIds.flatMap(id => {
        const index = beforeIds.indexOf(id);
        if (index < 0) return [-1];
        const offsets = operation.kind === "first" && !closed ? [0, 1, 4, 5, 2, 3] : [0, 1, 2, 3, 4, 5];
        return offsets.map(offset => index * 6 + offset);
      });
      return sources.length === after.length && sources.every((index, i) => index >= 0 &&
        JSON.stringify(before[index]) === JSON.stringify(after[i])) || "Topology changes channel data";
    }
    if (operation.kind !== "insert" && operation.kind !== "append") return "Unsupported topology operation";
    // Each transformed channel must use the same time basis. Key values then
    // remain linear combinations throughout each native eased segment.
    if (!before.every(channel => shape(channel) === shape(before[0])) ||
        !after.every(channel => shape(channel) === shape(before[0]))) return "Channels have different interpolation";
    for (let k = 0; k < before[0].keyframes.length; k++) {
      let points = geometry.vertices(before.map(channel => channel.keyframes[k].value));
      points = operation.kind === "insert" ? geometry.insert(points, operation.index, operation.t, closed) :
        [...points, { point: operation.point.slice(), in: [0, 0], out: [0, 0] }];
      const values = geometry.values(points);
      if (values.length !== after.length || values.some((value, i) => value !== after[i].keyframes[k].value))
        return "Topology values do not match the operation";
    }
    return true;
  }
  return { sample, makeKey, certify };
}
module.exports = { create };
