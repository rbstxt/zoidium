"use strict";
// Contract: host.data is a serialized path item with stable vertexIds and
// properties.path. host.commit(next) publishes one complete snapshot and records
// one history entry. The caller owns gesture cancellation and batches drag
// updates before committing. adapter.sample(channel, frame, index) uses native
// interpolation; adapter.makeKey(channel, frame, value, index) creates a native
// key including its tween and control data. Both receive detached snapshots.
// Grouped native storage is split into six channels per vertex only on a write.
const copy = (value) => JSON.parse(JSON.stringify(value));
function channels(item) {
  const path = item?.properties?.path, ids = item?.vertexIds;
  if (!path || !Array.isArray(ids) || new Set(ids).size !== ids.length)
    throw Error("Path needs stable vertex IDs");
  if (path.expression) throw Error("Expression-driven paths cannot be edited");
  const count = ids.length * 6;
  const result = path.objects ? copy(path.objects) : Array.from({ length: count }, (_, index) => ({
    animated: !!path.animated,
    keyframes: (path.keyframes || []).map((key) => ({ ...copy(key), value: key.value[index] })),
  }));
  if (result.length !== count || result.some((c) => c.expression || !Array.isArray(c.keyframes) || !c.keyframes.length))
    throw Error("Path channels are invalid or expression-driven");
  return result;
}
function frames(item) {
  return [...new Set(channels(item).flatMap((channel) => channel.keyframes.map((key) => key.frame)))].sort((a, b) => a - b);
}
function enabled(list) { return list.some((channel) => channel.animated); }
function diamond(item, frame) {
  const list = channels(item);
  if (!enabled(list)) return "hollow";
  return list.some((channel) => channel.keyframes.some((key) => key.frame === frame)) ? "filled" : "outlined";
}
function timeOffset(clip = {}) { return (clip.start || 0) - (clip.offset || 0); }
function previous(item, projectFrame, clip) {
  const offset = timeOffset(clip);
  const matches = frames(item).map((frame) => frame + offset).filter((frame) => frame < projectFrame);
  return matches.length ? matches[matches.length - 1] : null;
}
function next(item, projectFrame, clip) {
  const offset = timeOffset(clip);
  return frames(item).map((frame) => frame + offset).find((frame) => frame > projectFrame) ?? null;
}
function samples(list, frame, adapter) {
  return list.map((channel, index) => adapter.sample(copy(channel), frame, index));
}
function insert(list, frame, values, adapter) {
  // Prepare every key before changing any channel, including its tween data.
  const additions = list.map((channel, index) => channel.keyframes.some((key) => key.frame === frame)
    ? null : adapter.makeKey(copy(channel), frame, values[index], index));
  additions.forEach((key, index) => {
    if (!key) return;
    if (key.frame !== frame || key.value !== values[index]) throw Error("Invalid native key");
    list[index].keyframes.push(copy(key));
    list[index].keyframes.sort((a, b) => a.frame - b.frame);
  });
}
function publish(host, list) {
  const item = copy(host.data), path = item.properties.path;
  path.objects = list;
  delete path.animated;
  delete path.keyframes;
  host.commit(item);
}
function edit(host, frame, values, adapter) {
  const list = channels(host.data);
  if (!Array.isArray(values) || values.length !== list.length || values.some((value) => !Number.isFinite(value)))
    throw Error("Path values do not match its channels");
  const before = samples(list, frame, adapter);
  if (values.every((value, index) => value === before[index])) return false;
  if (enabled(list)) {
    insert(list, frame, before, adapter);
    list.forEach((channel, index) => {
      if (values[index] !== before[index]) {
        channel.keyframes.find((entry) => entry.frame === frame).value = values[index];
        if (!channel.animated) channel.keyframes[0].value = values[index];
      }
    });
  } else {
    list.forEach((channel, index) => { if (values[index] !== before[index]) channel.keyframes[0].value = values[index]; });
  }
  publish(host, list);
  return true;
}
function setEnabled(host, value, frame, adapter) {
  const list = channels(host.data), target = !!value;
  if (list.every((channel) => !!channel.animated === target)) return false;
  if (target) insert(list, frame, samples(list, frame, adapter), adapter);
  list.forEach((channel) => { channel.animated = target; });
  publish(host, list);
  return true;
}
function toggleKey(host, frame, adapter) {
  const list = channels(host.data);
  if (!enabled(list)) return false;
  if (list.some((channel) => channel.keyframes.some((key) => key.frame === frame))) {
    if (list.some((channel) => channel.keyframes.length === 1 && channel.keyframes[0].frame === frame)) return false;
    list.forEach((channel) => { channel.keyframes = channel.keyframes.filter((key) => key.frame !== frame); });
  } else insert(list, frame, samples(list, frame, adapter), adapter);
  publish(host, list);
  return true;
}
module.exports = { channels, frames, diamond, previous, next, edit, setEnabled, toggleKey };
