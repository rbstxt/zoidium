"use strict";
// Pure temporal-curve helpers for one CM3 keyframes channel.
//
// A key is shaped like PZ.keyframe: { frame, value, tween, controlPoints:
// [[dtIn, dvIn], [dtOut, dvOut]], continuousTangent }. The segment from key A
// to the next key B uses B.tween: `tween & 255` indexes PZ.tween.easingList
// (0 is hold, 1 is linear) and `tween >> 8 === 1` marks a bezier segment whose
// control points are A.controlPoints[1] and B.controlPoints[0], both scaled by
// PZ.tween.correctCurve(A, B). `easings` is the easing function list (a
// function or null per index), so this file runs without CM3.
const BEZIER = 256;
const LINEAR = 1;
const DEFAULT_POINTS = [[-10, 0], [10, 0]];

function cloneKey(key) {
  return {
    frame: key.frame,
    value: key.value,
    tween: key.tween,
    controlPoints: [key.controlPoints[0].slice(), key.controlPoints[1].slice()],
    continuousTangent: key.continuousTangent !== false,
  };
}
const cloneKeys = keys => keys.map(cloneKey);
function makeKey(frame, value, tween) {
  return { frame, value, tween, controlPoints: [DEFAULT_POINTS[0].slice(), DEFAULT_POINTS[1].slice()], continuousTangent: true };
}
const isBezier = tween => (tween >> 8) === 1;
const isHold = (tween, easings) => !easings[tween & 255];
// The tween that makes a segment bezier while keeping a non-hold base easing.
function bezierTween(tween, easings) {
  const base = tween & 255;
  return BEZIER | (easings[base] ? base : LINEAR);
}
function segmentKind(tween, easings) {
  if (isHold(tween, easings)) return "hold";
  return isBezier(tween) ? "bezier" : "linear";
}
// PZ.tween.correctCurve: shrink both time offsets when they overlap.
function correction(left, right) {
  const length = right.frame - left.frame;
  const total = Math.abs(left.controlPoints[1][0]) + Math.abs(right.controlPoints[0][0]);
  return total > length ? length / total : 1;
}
function cubic(p0, p1, p2, p3, s) {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
}
// Time control points stay ordered after correction (dtOut >= 0, dtIn <= 0),
// so the time polynomial is monotonic and bisection finds its parameter.
function solveParameter(t0, t1, t2, t3, frame) {
  let lo = 0, hi = 1;
  const rising = t3 >= t0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2, t = cubic(t0, t1, t2, t3, mid);
    if ((t < frame) === rising) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function bezierPolygon(left, right) {
  const c = correction(left, right);
  return {
    t: [left.frame, left.frame + left.controlPoints[1][0] * c, right.frame + right.controlPoints[0][0] * c, right.frame],
    v: [left.value, left.value + left.controlPoints[1][1] * c, right.value + right.controlPoints[0][1] * c, right.value],
  };
}
// Index of the last key at or before frame, or -1.
function indexAtOrBefore(keys, frame) {
  let lo = 0, hi = keys.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= frame) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}
const keyIndex = (keys, frame) => {
  const i = indexAtOrBefore(keys, frame);
  return i >= 0 && keys[i].frame === frame ? i : -1;
};
// Mirrors PZ.property.dynamic.keyframes.get() without expressions.
function evaluate(keys, frame, easings) {
  if (!keys.length) return undefined;
  const i = indexAtOrBefore(keys, frame);
  if (i < 0) return keys[0].value;
  const left = keys[i], right = keys[i + 1];
  if (left.frame === frame || !right) return left.value;
  const fn = easings[right.tween & 255];
  if (!fn) return left.value;
  if (isBezier(right.tween)) {
    const p = bezierPolygon(left, right), s = solveParameter(p.t[0], p.t[1], p.t[2], p.t[3], frame);
    return cubic(p.v[0], p.v[1], p.v[2], p.v[3], s);
  }
  const s = Math.max((frame - left.frame) / (right.frame - left.frame), 0);
  return (right.value - left.value) * fn(s) + left.value;
}
const lerp = (a, b, s) => a + (b - a) * s;
// De Casteljau split of a bezier segment at parameter s.
function splitPolygon(p, s) {
  const a = lerp(p[0], p[1], s), b = lerp(p[1], p[2], s), c = lerp(p[2], p[3], s);
  const d = lerp(a, b, s), e = lerp(b, c, s), m = lerp(d, e, s);
  return { left: [p[0], a, d, m], right: [m, e, c, p[3]] };
}
// Insert a key at frame without changing the channel's values anywhere
// (exact for hold, linear and bezier segments and outside the key range;
// other easings keep CM3's own choice: the following key's tween). Returns
// the new key list (a copy) or the input when a key already exists there.
function insertKey(keys, frame, easings) {
  if (!keys.length || keyIndex(keys, frame) >= 0) return keys;
  const next = cloneKeys(keys), i = indexAtOrBefore(next, frame);
  if (i < 0) {
    // Before the first key the value is constant; the new segment's control
    // points only matter for that new segment, so flatten them.
    const first = next[0], key = makeKey(frame, first.value, first.tween);
    key.controlPoints[1][1] = 0; first.controlPoints[0][1] = 0;
    next.unshift(key);
    return next;
  }
  if (i === next.length - 1) {
    const last = next[i], key = makeKey(frame, last.value, last.tween);
    key.controlPoints[0][1] = 0; last.controlPoints[1][1] = 0;
    next.push(key);
    return next;
  }
  const left = next[i], right = next[i + 1];
  let key;
  if (isHold(right.tween, easings)) key = makeKey(frame, left.value, right.tween);
  else if (isBezier(right.tween)) {
    const p = bezierPolygon(left, right), s = solveParameter(p.t[0], p.t[1], p.t[2], p.t[3], frame);
    const t = splitPolygon(p.t, s), v = splitPolygon(p.v, s);
    key = makeKey(frame, v.left[3], right.tween);
    // Each half is a sub-curve of a monotonic segment, so its time offsets
    // never overlap and CM3 applies no correction to the stored offsets.
    left.controlPoints[1] = [t.left[1] - t.left[0], v.left[1] - v.left[0]];
    key.controlPoints[0] = [t.left[2] - frame, v.left[2] - v.left[3]];
    key.controlPoints[1] = [t.right[1] - frame, v.right[1] - v.right[0]];
    right.controlPoints[0] = [t.right[2] - t.right[3], v.right[2] - v.right[3]];
  } else key = makeKey(frame, evaluate(keys, frame, easings), right.tween);
  next.splice(i + 1, 0, key);
  return next;
}
function insertKeys(keys, frames, easings) {
  return frames.reduce((list, frame) => insertKey(list, frame, easings), keys);
}
// A usable time offset for one side of a key: the stored one when it points
// the right way, otherwise a third of the segment (CM3's bezier convention).
function timeOffset(key, side, length) {
  const dt = key.controlPoints[side][0];
  if (side === 0 ? dt < 0 : dt > 0) return dt;
  return (side === 0 ? -length : length) / 3;
}
// The adjacent segment on one side of the key at index: side 0 = incoming,
// side 1 = outgoing. Null at the ends of the channel.
function segment(keys, index, side) {
  const other = keys[index + (side === 0 ? -1 : 1)];
  if (!other) return null;
  const left = side === 0 ? other : keys[index], right = side === 0 ? keys[index] : other;
  return { left, right, key: keys[index], other, length: right.frame - left.frame };
}
// The spatial handle component of one channel: how far (in value units) the
// path's control point sits from the key. For bezier segments that is the
// corrected value offset; linear segments report their straight-line
// equivalent (the point a bezier conversion would start from).
function handleComponent(keys, index, side, easings) {
  const seg = segment(keys, index, side);
  if (!seg || !(seg.length > 0)) return null;
  const kind = segmentKind(seg.right.tween, easings);
  if (kind === "hold") return { kind, value: 0 };
  if (kind === "bezier") return { kind, value: seg.key.controlPoints[side][1] * correction(seg.left, seg.right) };
  const dt = timeOffset(seg.key, side, seg.length), otherDt = timeOffset(seg.other, 1 - side, seg.length);
  const total = Math.abs(dt) + Math.abs(otherDt), c = total > seg.length ? seg.length / total : 1;
  const slope = (seg.right.value - seg.left.value) / seg.length;
  return { kind, value: slope * dt * c };
}
// Turn a linear segment into the native bezier tween with control points on
// the straight line, so the channel keeps its values until a handle moves.
function convertToBezier(keys, index, side, easings) {
  const seg = segment(keys, index, side);
  if (!seg || segmentKind(seg.right.tween, easings) !== "linear") return false;
  const slope = (seg.right.value - seg.left.value) / seg.length;
  const leftDt = timeOffset(seg.left, 1, seg.length), rightDt = timeOffset(seg.right, 0, seg.length);
  seg.left.controlPoints[1] = [leftDt, slope * leftDt];
  seg.right.controlPoints[0] = [rightDt, slope * rightDt];
  seg.right.tween = bezierTween(seg.right.tween, easings);
  return true;
}
function convertToLinear(keys, index, side, easings) {
  const seg = segment(keys, index, side);
  if (!seg || segmentKind(seg.right.tween, easings) !== "bezier") return false;
  seg.right.tween = LINEAR;
  return true;
}
module.exports = {
  BEZIER, LINEAR, cloneKey, cloneKeys, makeKey, isBezier, isHold, bezierTween, segmentKind,
  correction, evaluate, indexAtOrBefore, keyIndex, insertKey, insertKeys, timeOffset, segment,
  handleComponent, convertToBezier, convertToLinear,
};
