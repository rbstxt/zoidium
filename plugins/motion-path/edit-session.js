"use strict";
// One history entry per gesture. The session opens a CM3 history operation,
// creates the keys an edit needs through the native property operations,
// previews planned key lists by writing live keyframe fields, and on commit
// replays the final fields through propertyOps so undo/redo, the timeline,
// the Edit panel and Graph Editor 2 receive their normal notifications.
const c = require("./curves.js");
const edit = require("./path-edit.js");

function snapshot(axis) {
  return c.cloneKeys(Array.from(axis.keyframes));
}
function assign(key, from) {
  key.value = from.value;
  key.tween = from.tween;
  key.continuousTangent = from.continuousTangent;
  key.controlPoints[0][0] = from.controlPoints[0][0];
  key.controlPoints[0][1] = from.controlPoints[0][1];
  key.controlPoints[1][0] = from.controlPoints[1][0];
  key.controlPoints[1][1] = from.controlPoints[1][1];
}
function notify(axis, key) {
  try { axis.onKeyframeChanged.update(key); } catch (error) { console.warn("[Zoidium] motion-path: a keyframe view failed to refresh", error); }
}
function apply(ops, address, change) {
  const { frame, fields } = change;
  if (fields.tween !== undefined) ops.setTween({ property: address, frame, tween: fields.tween });
  // Setting a continuous tangent re-mirrors the control points natively, so
  // it runs before the final control points are written.
  if (fields.continuousTangent !== undefined) ops.setContinuousTangent({ property: address, frame, continuous: fields.continuousTangent });
  if (fields.controlPoints) ops.setControlPoints({ property: address, frame, controlPoints: fields.controlPoints });
  if (fields.value !== undefined) ops.setValue({ property: address, frame, value: fields.value });
}
function createSession({ PZ, editor, path, easings }) {
  const history = editor.history;
  if (history.operation !== null && history.operation !== undefined) return null;
  const ops = new PZ.ui.properties(editor);
  history.startOperation();
  const operation = history.operation;
  const axes = path.axes, frames = new Map(), base = new Map();
  let finished = false;
  const owned = () => history.operation === operation;
  // Structural edits (new keys, split control points) go into the operation
  // first; `base` then holds the fields the preview starts from.
  function ensure(axisIndex, needed) {
    const axis = axes[axisIndex];
    if (axis.expression || !owned()) return false;
    const have = frames.get(axisIndex) || new Set();
    const missing = needed.filter(f => !have.has(f));
    if (!missing.length && base.has(axisIndex)) return true;
    const address = axis.getAddress();
    const channel = { keys: Array.from(axis.keyframes), animated: !!axis.animated, editable: true };
    if (!channel.animated) {
      // CM3's stopwatch: the static key moves to the first edited frame.
      ops.toggleAnimation(axis, missing[0], false, true);
      channel.keys = Array.from(axis.keyframes);
      channel.animated = true;
    }
    const planned = c.insertKeys(channel.keys, missing, easings);
    if (planned !== channel.keys) {
      const d = edit.diff(channel.keys, planned);
      for (const change of d.change) apply(ops, address, change);
      for (const key of d.create) ops.createKeyframe({ property: address, data: c.cloneKey(key) });
    }
    for (const f of missing) have.add(f);
    frames.set(axisIndex, have);
    base.set(axisIndex, snapshot(axis));
    return true;
  }
  // Show planned key lists (null: the axis keeps its base fields).
  function preview(planned) {
    if (finished) return;
    for (const [axisIndex, keys] of base) {
      const axis = axes[axisIndex], target = planned[axisIndex] || keys;
      for (const key of target) {
        const live = axis.getKeyframe(key.frame);
        if (!live) continue;
        const before = c.cloneKey(live);
        assign(live, key);
        if (JSON.stringify(before) !== JSON.stringify(c.cloneKey(live))) notify(axis, live);
      }
    }
  }
  function restore() {
    for (const [axisIndex, keys] of base) {
      const axis = axes[axisIndex];
      for (const key of keys) {
        const live = axis.getKeyframe(key.frame);
        if (live) { assign(live, key); notify(axis, live); }
      }
    }
  }
  function changes() {
    const out = [];
    for (const [axisIndex, keys] of base) {
      const d = edit.diff(keys, snapshot(axes[axisIndex]));
      if (d.change.length) out.push({ axisIndex, change: d.change });
    }
    return out;
  }
  return {
    ensure,
    preview,
    base: index => base.get(index) || null,
    get finished() { return finished; },
    commit() {
      if (finished) return false;
      finished = true;
      const final = changes();
      if (!owned()) {
        // CM3's history does not nest: another operation replaced this one.
        // Never finish someone else's operation; keep what the preview shows.
        return false;
      }
      if (!final.length) { restore(); history.discardOperation(); return false; }
      restore();
      for (const { axisIndex, change } of final) {
        const address = axes[axisIndex].getAddress();
        for (const item of change) apply(ops, address, item);
      }
      history.finishOperation();
      return true;
    },
    cancel() {
      if (finished) return;
      finished = true;
      restore();
      if (owned()) history.discardOperation();
    },
  };
}
module.exports = { createSession };
