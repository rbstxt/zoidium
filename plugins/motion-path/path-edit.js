"use strict";
// Pure planning for motion-path edits. A path is a list of channels (one per
// position axis) of { keys, animated, editable }. Planners never mutate their
// input: they return new key lists per channel (null = channel unchanged).
//
// Spatial handles. CM3 has no spatial interpolation: every axis has its own
// temporal curve. The handle of a path key on axis `a` is the axis's
// corrected value offset, `correctCurve(left, right) * controlPoints[side][1]`
// in the property's units (pixels for 2D layers, parent-space units for 3D
// objects). When every axis of a segment is bezier with equal time offsets,
// the drawn path is exactly the spatial cubic through those control points.
// Dragging a handle rewrites only the value offsets; time offsets (and with
// them the timing of the move) are untouched.
const c = require("./curves.js");
const EPSILON = 1e-9;

function pathFrames(channels) {
  const frames = new Set();
  for (const ch of channels) if (ch.animated) for (const key of ch.keys) frames.add(key.frame);
  return [...frames].sort((a, b) => a - b);
}
// The frames that must carry a key on an edited axis so the edit stays between
// the neighbouring path keys, as with a unified position property.
function neighbourhood(frames, frame) {
  const i = frames.indexOf(frame), out = [frame];
  if (i > 0) out.push(frames[i - 1]);
  if (i >= 0 && i < frames.length - 1) out.push(frames[i + 1]);
  return out;
}
function materialFrames(frames, selected) {
  const out = new Set();
  for (const frame of selected) for (const f of neighbourhood(frames, frame)) out.add(f);
  return [...out].sort((a, b) => a - b);
}
// Keys a channel needs before it is edited at `frames`. A static channel is
// treated as constant keys at those frames; animated channels split exactly.
function materialize(channel, frames, easings) {
  if (!channel.editable) return null;
  if (!channel.animated) {
    const value = channel.keys.length ? channel.keys[0].value : 0;
    return frames.map(frame => c.makeKey(frame, value, c.LINEAR));
  }
  const keys = c.insertKeys(channel.keys, frames, easings);
  return keys === channel.keys ? null : keys;
}
function handleInfo(channels, frame, side, easings) {
  const components = channels.map(ch => {
    if (!ch.animated) return { kind: "static", value: 0 };
    const keys = c.insertKey(ch.keys, frame, easings), index = c.keyIndex(keys, frame);
    const info = c.handleComponent(keys, index, side, easings);
    return info ? { ...info, editable: ch.editable } : null;
  });
  const present = components.filter(Boolean);
  return {
    exists: present.some(x => x.kind !== "static"),
    visible: present.some(x => x.kind === "bezier"),
    vector: components.map(x => (x ? x.value : 0)),
    kinds: components.map(x => (x ? x.kind : null)),
  };
}
function keyInfo(channels, frame, easings) {
  return { frame, in: handleInfo(channels, frame, 0, easings), out: handleInfo(channels, frame, 1, easings) };
}
// Move the value at each selected frame by delta[axis] (0 leaves an axis).
// Channels must already carry keys at the selected frames.
function moveKeys(channels, frames, delta) {
  return channels.map((ch, axis) => {
    if (!ch.editable || !delta[axis]) return null;
    const keys = c.cloneKeys(ch.keys);
    for (const frame of frames) {
      const i = c.keyIndex(keys, frame);
      if (i >= 0) keys[i].value += delta[axis];
    }
    return keys;
  });
}
function mirror(key, side) {
  const dt = key.controlPoints[side][0], other = key.controlPoints[1 - side];
  if (!dt) return;
  // Keep the temporal slope on both sides: the curve stays smooth in time and
  // the spatial in/out handles stay collinear. With CM3's default symmetric
  // time offsets this is the native full mirror.
  other[1] = key.controlPoints[side][1] * (other[0] / dt);
}
// Set the spatial handle on `side` (0 in, 1 out) of the key at frame.
// target[axis] is the wanted spatial component, or null to leave the axis.
// Linear segments on touched axes become bezier; Alt (breakTangent) clears
// continuousTangent on every axis key at the frame instead of mirroring.
function setHandle(channels, frame, side, target, { breakTangent = false, easings }) {
  return channels.map((ch, axis) => {
    if (!ch.editable || !ch.animated) return null;
    const keys = c.cloneKeys(ch.keys), index = c.keyIndex(keys, frame);
    if (index < 0) return null;
    const key = keys[index];
    let changed = false;
    if (breakTangent && key.continuousTangent) { key.continuousTangent = false; changed = true; }
    const wanted = target[axis];
    const seg = c.segment(keys, index, side);
    if (wanted === null || wanted === undefined || !seg || !(seg.length > 0)) return changed ? keys : null;
    const kind = c.segmentKind(seg.right.tween, easings);
    if (kind === "hold") return changed ? keys : null;
    const current = c.handleComponent(keys, index, side, easings).value;
    if (Math.abs(current - wanted) <= EPSILON && kind === "bezier") return changed ? keys : null;
    if (kind === "linear") c.convertToBezier(keys, index, side, easings);
    key.controlPoints[side][1] = wanted / c.correction(seg.left, seg.right);
    const opposite = c.segment(keys, index, 1 - side);
    if (key.continuousTangent && !breakTangent && opposite && c.isBezier(opposite.right.tween)) mirror(key, side);
    return keys;
  });
}
// Alt-drag on a key: both adjacent segments become bezier on every editable
// axis (starting from their straight-line shape) with a continuous tangent.
function pullHandles(channels, frame, easings) {
  return channels.map(ch => {
    if (!ch.editable || !ch.animated) return null;
    const keys = c.cloneKeys(ch.keys), index = c.keyIndex(keys, frame);
    if (index < 0) return null;
    let changed = false;
    for (const side of [0, 1]) changed = c.convertToBezier(keys, index, side, easings) || changed;
    if (!keys[index].continuousTangent) { keys[index].continuousTangent = true; changed = true; }
    return changed ? keys : null;
  });
}
// Alt-click: a key with any bezier side becomes linear on both sides; a
// linear key becomes bezier with smooth (Catmull-Rom style) handles.
function toggleKey(channels, frame, easings) {
  const info = keyInfo(channels, frame, easings);
  const toLinear = info.in.visible || info.out.visible;
  return channels.map(ch => {
    if (!ch.editable || !ch.animated) return null;
    const keys = c.cloneKeys(ch.keys), index = c.keyIndex(keys, frame);
    if (index < 0) return null;
    let changed = false;
    if (toLinear) {
      for (const side of [0, 1]) changed = c.convertToLinear(keys, index, side, easings) || changed;
      return changed ? keys : null;
    }
    const key = keys[index], prev = keys[index - 1], next = keys[index + 1];
    const a = prev || key, b = next || key;
    const slope = b.frame > a.frame ? (b.value - a.value) / (b.frame - a.frame) : 0;
    for (const side of [0, 1]) {
      if (!c.convertToBezier(keys, index, side, easings)) continue;
      changed = true;
      key.controlPoints[side][1] = slope * key.controlPoints[side][0];
    }
    if (changed) key.continuousTangent = true;
    return changed ? keys : null;
  });
}
// Field-level differences between a live key list and a planned one: keys to
// create (frames missing live) and per-frame field changes. Planned lists
// never drop keys.
function diff(live, planned) {
  const create = [], change = [];
  for (const key of planned) {
    const i = c.keyIndex(live, key.frame);
    if (i < 0) { create.push(key); continue; }
    const old = live[i], fields = {};
    if (old.value !== key.value) fields.value = key.value;
    if (old.tween !== key.tween) fields.tween = key.tween;
    if ((old.continuousTangent !== false) !== key.continuousTangent) fields.continuousTangent = key.continuousTangent;
    const a = old.controlPoints, b = key.controlPoints;
    if (a[0][0] !== b[0][0] || a[0][1] !== b[0][1] || a[1][0] !== b[1][0] || a[1][1] !== b[1][1])
      fields.controlPoints = [b[0].slice(), b[1].slice()];
    if (Object.keys(fields).length) change.push({ frame: key.frame, fields });
  }
  return { create, change };
}
// Shift constrains a drag to its dominant axis.
function constrain(delta, enabled) {
  if (!enabled) return delta.slice();
  let best = 0;
  for (let i = 1; i < delta.length; i++) if (Math.abs(delta[i]) > Math.abs(delta[best])) best = i;
  return delta.map((value, i) => (i === best ? value : 0));
}
module.exports = {
  pathFrames, neighbourhood, materialFrames, materialize, handleInfo, keyInfo,
  moveKeys, setHandle, pullHandles, toggleKey, diff, constrain, mirror,
};
