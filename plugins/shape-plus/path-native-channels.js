"use strict";
// create(PZ) binds detached channel operations to CM3's property evaluator.
// Expressions need an owning native property and cannot be evaluated here.
const geometry = require("./editor-geometry.js");
const { synchronizeKeys } = require("./path-topology.js");
const copy = value => JSON.parse(JSON.stringify(value));
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function create(PZ) {
  function sample(channel, frame) {
    if (channel.expression) throw Error("Expression-driven paths cannot be sampled");
    if (!Number.isFinite(frame) || !Array.isArray(channel.keyframes) || !channel.keyframes.length)
      throw Error("Invalid path channel");
    const definition = { name: "Path channel", dynamic: true, type: PZ.property.type.NUMBER, value: 0 };
    const property = PZ.property.create ? PZ.property.create(definition) : new PZ.property(definition);
    property.load(copy(channel));
    property.sortKeyframes?.();
    return property.get(frame);
  }
  function makeKey(channel, frame, value) {
    if (channel.expression) throw Error("Expression-driven paths cannot be edited");
    const keys = channel.keyframes.slice().sort((a, b) => a.frame - b.frame);
    if (!keys.length || !Number.isFinite(frame) || !Number.isFinite(value)) throw Error("Invalid path key");
    const next = keys.find(key => key.frame >= frame) || keys[keys.length - 1];
    const key = new PZ.keyframe(value, frame, next.tween);
    return copy(key);
  }
  function shape(channel) {
    const result = copy(channel);
    result.keyframes.forEach(key => {
      delete key.value;
      // Native load supplies these defaults for grouped keys.
      if (JSON.stringify(key.controlPoints) === "[[-10,0],[10,0]]") delete key.controlPoints;
      if (key.continuousTangent === true) delete key.continuousTangent;
    });
    return JSON.stringify(ordered(result));
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
    if (["delete", "first", "reverse"].includes(operation.kind)) {
      sources = afterIds.flatMap(id => {
        const index = beforeIds.indexOf(id);
        if (index < 0) return [-1];
        const reverse = operation.kind === "reverse" || operation.kind === "first" && !closed;
        const offsets = reverse ? [0, 1, 4, 5, 2, 3] : [0, 1, 2, 3, 4, 5];
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
  function editLive(property, vertexCount, frame, values) {
    const axes = property.objects;
    if (!Array.isArray(values) || values.length !== axes.length || axes.length !== vertexCount * 6 ||
        !Number.isFinite(frame))
      throw Error("Path values do not match its channels");
    for (const value of values) {
      if (!Number.isFinite(value)) throw Error("Path values do not match its channels");
    }
    if (property.expression || axes.some(axis => axis.expression || axis.definition.readOnly || !axis.keyframes?.length))
      throw Error("Path channels are invalid or expression-driven");
    // Sample every channel before adding logical keys. The gesture already
    // owns the undo snapshot, so preview writes can reuse the live channels.
    const before = axes.map(axis => axis.get(frame));
    const changed = before.map((value, i) => value !== values[i]);
    if (!changed.includes(true)) return false;
    const animated = axes.some(axis => axis.animated);
    if (animated) {
      const additions = axes.map((axis, i) => {
        if (axis.hasKeyframe(frame)) return null;
        const closest = axis.keyframes[axis.getClosestKeyframeIndex(frame)];
        return new PZ.keyframe(before[i], frame, closest?.tween ?? axis.defaultTween);
      });
      additions.forEach((key, i) => {
        if (!key) return;
        axes[i].addKeyframe(key);
        axes[i].onKeyframeCreated?.update(key);
      });
    }
    axes.forEach((axis, i) => {
      if (!changed[i]) return;
      const writeFrame = animated ? frame : axis.keyframes[0].frame;
      axis.set(values[i], writeFrame);
      axis.onKeyframeChanged?.update(axis.keyframes[axis.getClosestKeyframeIndex(writeFrame)]);
    });
    return true;
  }
  function validatePair(pair, matrix) {
    const unchangedVectors = matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1;
    if (!unchangedVectors && pair.some(channel => !valid(channel)))
      throw Error("Cannot preserve curve-controlled or unsupported interpolation in this affine mapping");
  }
  function stopwatch(list, enabled, frame) {
    return list.map(channel => {
      if (!!channel.animated === enabled) return channel;
      const keyframes = enabled ? channel.keyframes : [copy(new PZ.keyframe(sample(channel, frame), 0, 1))];
      if (enabled && keyframes.length === 1) keyframes[0].frame = frame;
      return { ...channel, animated: enabled, keyframes };
    });
  }
  return {
    sample, makeKey, certify, editLive, validatePair, stopwatch,
    staticReadsKeyframes: typeof PZ.property.create === "function",
    samePairShape: (x, y) => shape(x) === shape(y),
    preparePair: pair => synchronizeKeys(pair, { sample, makeKey }),
    certifyPair: (before, after) => synchronize(before, after),
    encodePath: channels => ({ objects: channels }),
  };
}
// Mask validation requires grouped keys. Independent channel schedules cannot
// be represented by that encoding and must be rejected, never approximated.
function coercePath(path, encoding = "grouped") {
  if (!path || path.expression || !["grouped", "objects"].includes(encoding)) throw Error("Invalid path encoding");
  const result = copy(path);
  if (encoding === "objects") {
    if (result.objects) return result;
    if (!Array.isArray(result.keyframes) || !result.keyframes.length || !Array.isArray(result.keyframes[0].value))
      throw Error("Invalid grouped path");
    const count = result.keyframes[0].value.length;
    if (!count || result.keyframes.some(key => !Array.isArray(key.value) || key.value.length !== count)) throw Error("Invalid grouped path");
    result.objects = Array.from({ length: count }, (_, i) => ({ animated: !!result.animated,
      keyframes: result.keyframes.map(key => ({ ...copy(key), value: key.value[i] })) }));
    delete result.animated; delete result.keyframes;
    return result;
  }
  if (result.keyframes) return result;
  const channels = result.objects;
  if (!Array.isArray(channels) || !channels.length || channels.some(channel => !channel || channel.expression ||
    !Array.isArray(channel.keyframes) || !channel.keyframes.length)) throw Error("Invalid path channels");
  const structure = channel => {
    const item = copy(channel);
    item.keyframes.forEach(key => { delete key.value; });
    return JSON.stringify(item);
  };
  if (!channels.every(channel => structure(channel) === structure(channels[0])))
    throw Error("Cannot preserve independent channel keys in grouped mask storage");
  if (Object.keys(channels[0]).some(key => key !== "animated" && key !== "keyframes"))
    throw Error("Cannot preserve channel metadata in grouped mask storage");
  // CM3's grouped loader copies only frame, value, and tween to children.
  // Non-default curve handles or extra key metadata would disappear on load.
  for (const key of channels[0].keyframes) {
    if (Object.keys(key).some(name => !["frame", "value", "tween", "controlPoints", "continuousTangent"].includes(name)) ||
        (key.controlPoints && JSON.stringify(key.controlPoints) !== "[[-10,0],[10,0]]") || key.continuousTangent === false)
      throw Error("Cannot preserve key metadata in grouped mask storage");
  }
  result.animated = !!channels[0].animated;
  result.keyframes = channels[0].keyframes.map((key, i) => ({ ...copy(key), value: channels.map(channel => channel.keyframes[i].value) }));
  delete result.objects;
  return result;
}
module.exports = { create, coercePath };
