"use strict";

// Easing+ curve math: normalized Bezier points, presets, value mapping and
// keyframe shape preservation helpers. Pure except for reading host keyframe
// objects passed in by callers; `window.PZ` is consulted only as an optional
// correction source. Loaded through the shared bundle loader and unit tested
// directly (see test/easing-plus-curves.test.js).

const EPSILON = 1e-8;
const BEZIER_TWEEN = 257;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const round = (value, digits = 4) => Number(value.toFixed(digits));

  function shouldPreserveCrossingX(start, end) {
    const duration = end.frame - start.frame;
    if (!(duration > 0)) return false;
    const x1 = start.controlPoints[1][0] / duration;
    const x2 = 1 + end.controlPoints[0][0] / duration;
    const normalized = x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1;
    return normalized && x1 > x2 + EPSILON;
  }

  function point(x, y, incoming = [0, 0], outgoing = [0, 0]) {
    return {
      x,
      y,
      inX: incoming[0],
      inY: incoming[1],
      outX: outgoing[0],
      outY: outgoing[1],
    };
  }

  function cubic(x1, y1, x2, y2) {
    return [point(0, 0, [0, 0], [x1, y1]), point(1, 1, [x2 - 1, y2 - 1])];
  }

  function clonePoints(points) {
    return points.map((entry) => ({ ...entry }));
  }

  const PRESETS = [
    { name: "Linear", points: cubic(0.333, 0.333, 0.667, 0.667) },
    { name: "Ease", points: cubic(0.25, 0.1, 0.25, 1) },
    { name: "Ease in", points: cubic(0.42, 0, 1, 1) },
    { name: "Ease out", points: cubic(0, 0, 0.58, 1) },
    { name: "Ease in-out", points: cubic(0.42, 0, 0.58, 1) },
    { name: "Soft", points: cubic(0.22, 0.08, 0.28, 1) },
    { name: "Swift in", points: cubic(0.72, 0, 0.92, 0.38) },
    { name: "Swift out", points: cubic(0.08, 0.62, 0.28, 1) },
    // Panzoid rescales crossing X handles (and their Y components) at runtime.
    // A shared midpoint is the stable native equivalent of a sharp crossed curve.
    { name: "Sharp", points: cubic(0.5, 0, 0.5, 1) },
    { name: "Expo in", points: cubic(0.9, 0.02, 0.98, 0.4) },
    { name: "Expo out", points: cubic(0.02, 0.6, 0.1, 0.98) },
    { name: "Sine", points: cubic(0.37, 0, 0.63, 1) },
  ];

  function cubicValue(p0, p1, p2, p3, amount) {
    const inverse = 1 - amount;
    return (
      inverse * inverse * inverse * p0 +
      3 * inverse * inverse * amount * p1 +
      3 * inverse * amount * amount * p2 +
      amount * amount * amount * p3
    );
  }

  function valueScaleFor(property, referenceValue) {
    const numericValues = property.keyframes
      .map((keyframe) => keyframe.value)
      .filter((value) => Number.isFinite(value));
    if (numericValues.length > 1) {
      const range = Math.max(...numericValues) - Math.min(...numericValues);
      if (range > EPSILON) return range;
    }
    const definition = property.definition || {};
    if (Number.isFinite(definition.max) && Number.isFinite(definition.min)) {
      const range = definition.max - definition.min;
      if (Math.abs(range) > EPSILON) return Math.abs(range);
    }
    if (Number.isFinite(definition.step) && Math.abs(definition.step) > EPSILON) {
      return Math.abs(definition.step) * 10;
    }
    const defaultValue = typeof definition.value === "number" ? definition.value : referenceValue;
    return Math.max(Math.abs(defaultValue || 0), 1);
  }

  function createValueMapper(property, start, end) {
    const delta = end.value - start.value;
    if (Math.abs(delta) > EPSILON) {
      return {
        equal: false,
        scale: delta,
        toActual(x, y) {
          return start.value + delta * y;
        },
        toNormalized(x, value) {
          return (value - start.value) / delta;
        },
      };
    }
    const scale = valueScaleFor(property, start.value);
    return {
      equal: true,
      scale,
      toActual(x, y) {
        return start.value + scale * (y - x);
      },
      toNormalized(x, value) {
        return x + (value - start.value) / scale;
      },
    };
  }

  function hasNativeBezierDefaults(start, end) {
    const outgoing = start?.controlPoints?.[1];
    const incoming = end?.controlPoints?.[0];
    return (
      Array.isArray(outgoing) &&
      Array.isArray(incoming) &&
      Math.abs(outgoing[0] - 10) < EPSILON &&
      Math.abs(outgoing[1]) < EPSILON &&
      Math.abs(incoming[0] + 10) < EPSILON &&
      Math.abs(incoming[1]) < EPSILON
    );
  }

  function curveFromSegment(property, start, end) {
    const duration = end.frame - start.frame;
    if (!(duration > 0)) return cubic(0.333, 0.333, 0.667, 0.667);
    // Panzoid stores a newly-created Bezier as frame-relative handles
    // [-10, 0] and [10, 0].  That representation is not a stable normalized
    // default across segment lengths, so Easing+ presents the neutral Linear
    // curve until the user changes the handles.
    if (hasNativeBezierDefaults(start, end)) {
      return clonePoints(PRESETS[0].points);
    }
    const correction = window.PZ?.tween?.correctCurve
      ? window.PZ.tween.correctCurve(start, end)
      : Math.min(
          1,
          duration /
            Math.max(
              EPSILON,
              Math.abs(start.controlPoints[1][0]) + Math.abs(end.controlPoints[0][0])
            )
        );
    const mapper = createValueMapper(property, start, end);
    const x1 = (start.controlPoints[1][0] * correction) / duration;
    const x2 = 1 + (end.controlPoints[0][0] * correction) / duration;
    const y1 = mapper.toNormalized(x1, start.value + start.controlPoints[1][1] * correction);
    const y2 = mapper.toNormalized(x2, end.value + end.controlPoints[0][1] * correction);
    return cubic(clamp(x1, 0, 1), y1, clamp(x2, 0, 1), y2);
  }

  function planCurve(property, start, end, points) {
    const duration = end.frame - start.frame;
    if (!(duration > 0) || points.length !== 2) return null;
    const frames = [start.frame, end.frame];
    const mapper = createValueMapper(property, start, end);
    const from = points[0];
    const to = points[1];
    const planned = points.map((entry, index) => ({
      frame: index === 0 ? start.frame : end.frame,
      value: index === 0 ? start.value : end.value,
      incoming: [0, 0],
      outgoing: [0, 0],
    }));
    const outgoingX = clamp(from.outX, 0, 1) * duration;
    const incomingX = -clamp(-to.inX, 0, 1) * duration;
    const outgoingControlX = outgoingX / duration;
    const incomingControlX = 1 + incomingX / duration;
    const outgoingValue = mapper.toActual(outgoingControlX, from.y + from.outY);
    const incomingValue = mapper.toActual(incomingControlX, to.y + to.inY);
    if (mapper.equal) {
      // Panzoid evaluates Bezier handles as absolute value offsets, so any
      // nonzero Y handle on an equal-value segment plays back as an
      // out-and-back motion.  Every other interpolation stays still when the
      // values match, so Easing+ stores zero Y offsets here: the segment
      // always plays flat at its value, whatever curve is drawn.
      planned[0].outgoing = [outgoingX, 0];
      planned[1].incoming = [incomingX, 0];
    } else {
      planned[0].outgoing = [outgoingX, outgoingValue - start.value];
      planned[1].incoming = [incomingX, incomingValue - end.value];
    }
    return { frames, points: planned, equalValues: mapper.equal, valueScale: mapper.scale };
  }

  // Panzoid stores Bezier handles as absolute frame/value offsets, so moving
  // a keyframe without touching the handles deforms the normalized curve.
  // While Easing+ is active, keyframe moves rescale the handles of affected
  // Bezier segments instead, preserving the edited shape.
  function rescaleSegmentHandles(before, after, handles) {
    const beforeDuration = before?.duration;
    const afterDuration = after?.duration;
    if (!(beforeDuration > 0) || !(afterDuration > 0)) return null;
    const outX = handles?.outX;
    const outY = handles?.outY;
    const inX = handles?.inX;
    const inY = handles?.inY;
    if (![outX, outY, inX, inY].every(Number.isFinite)) return null;
    const beforeDelta = before?.delta;
    const afterDelta = after?.delta;
    if (!Number.isFinite(beforeDelta) || !Number.isFinite(afterDelta)) return null;
    const xScale = afterDuration / beforeDuration;
    const beforeEqual = Math.abs(beforeDelta) <= EPSILON;
    const afterEqual = Math.abs(afterDelta) <= EPSILON;
    let newOutY = outY;
    let newInY = inY;
    if (!beforeEqual && !afterEqual) {
      const yScale = afterDelta / beforeDelta;
      newOutY = outY * yScale;
      newInY = inY * yScale;
    } else if (!beforeEqual && afterEqual) {
      // Collapsing to equal values flattens the segment so it keeps playing
      // still, matching what Easing+ stores for equal values.
      newOutY = 0;
      newInY = 0;
    }
    // Equal-to-anything keeps Y absolute (flat zeros stay zero), so the
    // previous timing is retained while the curve re-diverges or stays flat.
    return { outX: outX * xScale, outY: newOutY, inX: inX * xScale, inY: newInY };
  }

  function easingChannelsOf(target) {
    if (!target) return [];
    const dynamic = window.PZ?.property?.dynamic;
    if (dynamic?.keyframes && target instanceof dynamic.keyframes) return [target];
    if (dynamic?.group && target instanceof dynamic.group && Array.isArray(target.objects)) {
      return target.objects.filter((entry) => entry instanceof dynamic.keyframes);
    }
    if (Array.isArray(target.objects)) {
      return target.objects.filter((entry) => Array.isArray(entry?.keyframes));
    }
    if (Array.isArray(target.keyframes)) return [target];
    return [];
  }

  function snapshotChannelSegments(channel) {
    const keyframes = channel?.keyframes;
    if (!Array.isArray(keyframes) || keyframes.length < 2) return [];
    const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
    const entries = [];
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const start = sorted[index];
      const end = sorted[index + 1];
      if (!(end.frame - start.frame > 0)) continue;
      if (!Number.isFinite(end.tween) || end.tween >> 8 !== 1) continue;
      if (!Number.isFinite(start.value) || !Number.isFinite(end.value)) continue;
      const outgoing = start.controlPoints?.[1];
      const incoming = end.controlPoints?.[0];
      if (!Array.isArray(outgoing) || !Array.isArray(incoming)) continue;
      if (![...outgoing, ...incoming].every(Number.isFinite)) continue;
      // Fresh native Bezier handles stay absolute; Easing+ keeps presenting
      // them as the neutral Linear default.
      if (hasNativeBezierDefaults(start, end)) continue;
      entries.push({
        start,
        end,
        duration: end.frame - start.frame,
        delta: end.value - start.value,
        outX: outgoing[0],
        outY: outgoing[1],
        inX: incoming[0],
        inY: incoming[1],
      });
    }
    return entries;
  }

  function restoreChannelSegments(channel, snapshot) {
    if (!snapshot || snapshot.length === 0) return;
    const keyframes = channel?.keyframes;
    if (!Array.isArray(keyframes) || keyframes.length < 2) return;
    const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
    const touched = new Set();
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const start = sorted[index];
      const end = sorted[index + 1];
      if (!(end.frame - start.frame > 0)) continue;
      if (!Number.isFinite(end.tween) || end.tween >> 8 !== 1) continue;
      if (!Number.isFinite(start.value) || !Number.isFinite(end.value)) continue;
      const before = snapshot.find((entry) => entry.start === start && entry.end === end);
      // Segments formed by reordering or fresh keyframes keep native behavior.
      if (!before) continue;
      const rescaled = rescaleSegmentHandles(
        { duration: before.duration, delta: before.delta },
        { duration: end.frame - start.frame, delta: end.value - start.value },
        { outX: before.outX, outY: before.outY, inX: before.inX, inY: before.inY }
      );
      if (!rescaled) continue;
      const outgoing = start.controlPoints?.[1];
      const incoming = end.controlPoints?.[0];
      if (!Array.isArray(outgoing) || !Array.isArray(incoming)) continue;
      if (
        Math.abs(outgoing[0] - rescaled.outX) <= 1e-9 &&
        Math.abs(outgoing[1] - rescaled.outY) <= 1e-9 &&
        Math.abs(incoming[0] - rescaled.inX) <= 1e-9 &&
        Math.abs(incoming[1] - rescaled.inY) <= 1e-9
      ) {
        continue;
      }
      outgoing[0] = rescaled.outX;
      outgoing[1] = rescaled.outY;
      incoming[0] = rescaled.inX;
      incoming[1] = rescaled.inY;
      touched.add(start);
      touched.add(end);
    }
    // The surrounding move already pushed its history command; these direct
    // mutations fold the shape preservation into the same undoable step, and
    // undo re-runs the wrapped operation so the ratios invert back.
    touched.forEach((keyframe) => {
      try {
        channel.onKeyframeChanged?.update?.(keyframe);
      } catch (error) {
        // Never break a native keyframe move for a notification failure.
      }
    });
  }

  function snapshotForAddress(propertyOps, address) {
    try {
      const target = propertyOps?.editor?.project?.addressLookup(address);
      return easingChannelsOf(target).map((channel) => ({
        channel,
        segments: snapshotChannelSegments(channel),
      }));
    } catch (error) {
      return [];
    }
  }

  function restoreSnapshots(snapshots) {
    if (!Array.isArray(snapshots)) return;
    for (const entry of snapshots) {
      try {
        restoreChannelSegments(entry.channel, entry.segments);
      } catch (error) {
        console.error("Easing+ could not preserve the curve shape.", error);
      }
    }
  }

module.exports = {
  EPSILON,
  BEZIER_TWEEN,
  clamp,
  round,
  shouldPreserveCrossingX,
  point,
  cubic,
  clonePoints,
  PRESETS,
  cubicValue,
  valueScaleFor,
  createValueMapper,
  hasNativeBezierDefaults,
  curveFromSegment,
  planCurve,
  rescaleSegmentHandles,
  easingChannelsOf,
  snapshotChannelSegments,
  restoreChannelSegments,
  snapshotForAddress,
  restoreSnapshots,
};
