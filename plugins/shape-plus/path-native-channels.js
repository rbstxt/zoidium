"use strict";
// create(PZ) binds detached channel operations to CM3's property evaluator.
// Expressions need an owning native property and cannot be evaluated here.
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
  return { sample, makeKey };
}
module.exports = { create };
