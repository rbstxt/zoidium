"use strict";

const EasingPlus = (() => {
  const STYLE_ID = "zoidium-easing-plus-style";
  const STYLE_URL = "./plugins/easing-plus/easing-plus.css?v=19";
  const EPSILON = 1e-8;
  const BEZIER_TWEEN = 257;
  // Overshoot is an intentional, two-stage gesture.  Keeping these in screen
  // pixels makes the gesture feel the same on a compact popover and a large
  // monitor, even though the graph's normalized scale changes with its size.
  const OVERSHOOT_ARM_PX = 40;
  const OVERSHOOT_RELEASE_PX = 24;
  const state = {
    active: false,
    dialog: null,
    editor: null,
    originalEaseDropDown: null,
    patchedEaseDropDown: null,
    originalCorrectCurve: null,
    patchedCorrectCurve: null,
    keydown: null,
    easeButtons: new Set(),
    displayRows: new Set(),
    originalCreateKeyframeControls: null,
    patchedCreateKeyframeControls: null,
    originalMoveKeyframe: null,
    patchedMoveKeyframe: null,
    originalSetValue: null,
    patchedSetValue: null,
    originalStartMove: null,
    patchedStartMove: null,
    originalFinishMove: null,
    patchedFinishMove: null,
    originalScaleKeyframes: null,
    patchedScaleKeyframes: null,
    pendingDragShapes: new Map(),
  };

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

  function installShapePreservation() {
    const properties = window.PZ?.ui?.properties?.prototype;
    if (properties && typeof properties.moveKeyframe === "function" && !state.patchedMoveKeyframe) {
      state.originalMoveKeyframe = properties.moveKeyframe;
      state.patchedMoveKeyframe = function (argument) {
        const snapshots = snapshotForAddress(this, argument?.property);
        const result = state.originalMoveKeyframe.apply(this, arguments);
        restoreSnapshots(snapshots);
        return result;
      };
      properties.moveKeyframe = state.patchedMoveKeyframe;
    }
    if (properties && typeof properties.setValue === "function" && !state.patchedSetValue) {
      state.originalSetValue = properties.setValue;
      state.patchedSetValue = function (argument) {
        const snapshots = snapshotForAddress(this, argument?.property);
        const result = state.originalSetValue.apply(this, arguments);
        restoreSnapshots(snapshots);
        return result;
      };
      properties.setValue = state.patchedSetValue;
    }
    if (properties && typeof properties.startMove === "function" && !state.patchedStartMove) {
      state.originalStartMove = properties.startMove;
      state.patchedStartMove = function (channel, count) {
        try {
          for (const entry of easingChannelsOf(channel)) {
            state.pendingDragShapes.set(entry, snapshotChannelSegments(entry));
          }
        } catch (error) {
          // Never break a native drag for a snapshot failure.
        }
        return state.originalStartMove.apply(this, arguments);
      };
      properties.startMove = state.patchedStartMove;
    }
    if (properties && typeof properties.finishMove === "function" && !state.patchedFinishMove) {
      state.originalFinishMove = properties.finishMove;
      state.patchedFinishMove = function (channel) {
        const result = state.originalFinishMove.apply(this, arguments);
        try {
          for (const entry of easingChannelsOf(channel)) {
            const snapshot = state.pendingDragShapes.get(entry);
            if (snapshot) {
              restoreChannelSegments(entry, snapshot);
              state.pendingDragShapes.delete(entry);
            }
          }
        } catch (error) {
          console.error("Easing+ could not preserve the curve shape.", error);
        }
        return result;
      };
      properties.finishMove = state.patchedFinishMove;
    }
    const keyframesPrototype = window.PZ?.property?.dynamic?.keyframes?.prototype;
    if (
      keyframesPrototype &&
      typeof keyframesPrototype.scaleKeyframes === "function" &&
      !state.patchedScaleKeyframes
    ) {
      state.originalScaleKeyframes = keyframesPrototype.scaleKeyframes;
      state.patchedScaleKeyframes = function () {
        const snapshot = snapshotChannelSegments(this);
        const result = state.originalScaleKeyframes.apply(this, arguments);
        try {
          restoreChannelSegments(this, snapshot);
        } catch (error) {
          console.error("Easing+ could not preserve the curve shape.", error);
        }
        return result;
      };
      keyframesPrototype.scaleKeyframes = state.patchedScaleKeyframes;
    }
  }

  function uninstallShapePreservation() {
    const properties = window.PZ?.ui?.properties?.prototype;
    if (properties && state.patchedMoveKeyframe && properties.moveKeyframe === state.patchedMoveKeyframe) {
      properties.moveKeyframe = state.originalMoveKeyframe;
    }
    if (properties && state.patchedSetValue && properties.setValue === state.patchedSetValue) {
      properties.setValue = state.originalSetValue;
    }
    if (properties && state.patchedStartMove && properties.startMove === state.patchedStartMove) {
      properties.startMove = state.originalStartMove;
    }
    if (properties && state.patchedFinishMove && properties.finishMove === state.patchedFinishMove) {
      properties.finishMove = state.originalFinishMove;
    }
    const keyframesPrototype = window.PZ?.property?.dynamic?.keyframes?.prototype;
    if (
      keyframesPrototype &&
      state.patchedScaleKeyframes &&
      keyframesPrototype.scaleKeyframes === state.patchedScaleKeyframes
    ) {
      keyframesPrototype.scaleKeyframes = state.originalScaleKeyframes;
    }
    state.originalMoveKeyframe = null;
    state.patchedMoveKeyframe = null;
    state.originalSetValue = null;
    state.patchedSetValue = null;
    state.originalStartMove = null;
    state.patchedStartMove = null;
    state.originalFinishMove = null;
    state.patchedFinishMove = null;
    state.originalScaleKeyframes = null;
    state.patchedScaleKeyframes = null;
    state.pendingDragShapes.clear();
  }

  function resolveTargets(button) {
    const controlRow = button.parentElement;
    const interpolationButton = controlRow?.querySelector("button.pz-tweens");
    const interpolationIcon =
      interpolationButton?.querySelector("use")?.getAttribute("xlink:href") ||
      interpolationButton?.querySelector("use")?.getAttribute("href") ||
      "";
    if (
      !interpolationButton ||
      (interpolationButton.pz_value !== 1 && !interpolationIcon.endsWith("#interp_1"))
    ) {
      return null;
    }
    const propertyRow = controlRow?.parentElement?.parentElement;
    const property = propertyRow?.pz_object;
    const controls = propertyRow?.parentElement?.pz_controls;
    const editor = controls?.editor;
    if (!property || !editor || !window.PZ) return null;
    const localFrame = editor.playback.currentFrame - property.frameOffset;
    const properties =
      property instanceof window.PZ.property.dynamic.group ? Array.from(property.objects) : [property];
    const targets = [];
    for (const channel of properties) {
      if (!(channel instanceof window.PZ.property.dynamic.keyframes)) continue;
      const start = channel.getKeyframe(localFrame);
      if (!start) continue;

      // Easing+ always edits the outgoing segment from the current keyframe
      // to the next keyframe. The final keyframe has no outgoing segment, so
      // it keeps the standard control.
      const end = channel.getNextKeyframe(start.frame);
      if (
        !end ||
        end.frame <= start.frame ||
        !Number.isFinite(start.value) ||
        !Number.isFinite(end.value)
      ) {
        continue;
      }
      targets.push({ property: channel, start, end });
    }
    if (targets.length === 0) return null;
    return {
      editor,
      property,
      localFrame,
      targets,
    };
  }

  // The native easing control always keeps its SVG as children[0]; Panzoid's
  // refresh code calls PZ.ui.switchIcon(this.children[0], ...).  Easing+ only
  // changes the visual treatment with a pseudo-element, so those native
  // updates continue to work while the button clearly advertises the custom
  // editor as “Ez+”.
  function interpolationButtonFor(easeButton) {
    const row = easeButton?.parentElement;
    if (!row) return null;
    const buttons = row.querySelectorAll?.("button.pz-tweens") || [];
    for (const button of buttons) {
      if (button !== easeButton) return button;
    }
    return null;
  }

  // Native PZ.keyframe defaults: controlPoints[0] is the incoming handle and
  // controlPoints[1] is the outgoing handle.
  const NATIVE_INCOMING_DEFAULT = [-10, 0];
  const NATIVE_OUTGOING_DEFAULT = [10, 0];

  function siblingTweenButton(button) {
    const row = button?.parentElement;
    if (!row) return null;
    const buttons = row.querySelectorAll?.("button.pz-tweens") || [];
    for (const entry of buttons) {
      if (entry !== button) return entry;
    }
    return null;
  }

  function tweenButtonsInRow(row) {
    if (!row?.querySelectorAll) return {};
    const buttons = Array.from(row.querySelectorAll("button.pz-tweens"));
    return {
      interpolationButton:
        buttons.find((button) => button.title === "interpolation") || buttons[0] || null,
      easeButton: buttons.find((button) => button.title === "easing") || buttons[1] || null,
    };
  }

  // The keyframe row is outgoing-oriented: a pick made while the playhead is
  // on a keyframe edits the segment from that keyframe to the next one, so
  // normal easings apply from the current keyframe to the next keyframe,
  // exactly like Easing+ curves do. Only the final keyframe has no outgoing
  // segment, so picks there keep the native write to the keyframe itself.
  // Either way one pick touches exactly one segment; the previous segment
  // is never modified here.
  function pickTargetForSet(current, next) {
    return next ? "outgoing" : "current";
  }

  function keyframesAround(channel, localFrame) {
    let current = null;
    try {
      current = channel.getKeyframe?.(localFrame) || null;
    } catch (error) {
      current = null;
    }
    if (!current) return { current: null, next: null };
    let next = null;
    try {
      next = channel.getNextKeyframe?.(current.frame) || null;
    } catch (error) {
      next = null;
    }
    if (!next || !(next.frame > current.frame)) next = null;
    return { current, next };
  }

  function resolveTweenWrites(context, channels) {
    const resolved = [];
    for (const channel of channels) {
      try {
        const { current, next } = keyframesAround(channel, context.localFrame);
        if (!current) continue;
        let address = null;
        try {
          address = channel.getAddress();
        } catch (error) {
          address = null;
        }
        if (!address) continue;
        resolved.push({ channel, address, current, next });
      } catch (error) {
        console.error("Easing+ could not resolve the edited keyframe.", error);
      }
    }
    return resolved;
  }

  function resetOutgoingHandles(propertyOps, address, current, next) {
    const currentIncoming = current.controlPoints?.[0];
    const nextOutgoing = next.controlPoints?.[1];
    if (!Array.isArray(currentIncoming) || !Array.isArray(nextOutgoing)) return;
    propertyOps.setControlPoints({
      property: address,
      frame: current.frame,
      controlPoints: [currentIncoming.slice(), NATIVE_OUTGOING_DEFAULT.slice()],
    });
    propertyOps.setControlPoints({
      property: address,
      frame: next.frame,
      controlPoints: [NATIVE_INCOMING_DEFAULT.slice(), nextOutgoing.slice()],
    });
  }

  // Write one picked (interp, ease) pair for a single channel. Returns
  // "outgoing" when the pick was redirected to the outgoing segment and
  // "current" for the native write. A redirected write normalizes the
  // owned handles to the native defaults so a stale custom curve can never
  // resurface later; handles that already match the defaults are left alone.
  function executeTweenWrite(propertyOps, address, localFrame, current, next, newInterp, newEase) {
    const pickTween = (newInterp << 8) | newEase;
    if (pickTargetForSet(current, next) === "outgoing") {
      propertyOps.setTween({ property: address, frame: next.frame, tween: pickTween });
      if (!hasNativeBezierDefaults(current, next)) {
        resetOutgoingHandles(propertyOps, address, current, next);
      }
      return "outgoing";
    }
    propertyOps.setTween({ property: address, frame: localFrame, tween: pickTween });
    return "current";
  }

  function tweenSetContext(button) {
    const rowDiv = button?.parentElement;
    const propertyRow = rowDiv?.parentElement?.parentElement;
    const property = propertyRow?.pz_object;
    const controls = propertyRow?.parentElement?.pz_controls;
    const editor = controls?.editor;
    const propertyOps = controls?.propertyOps;
    if (!property || !controls || !editor || !propertyOps || !window.PZ) return null;
    let localFrame;
    try {
      localFrame = editor.playback.currentFrame - property.frameOffset;
    } catch (error) {
      return null;
    }
    if (!Number.isFinite(localFrame)) return null;
    return { property, controls, editor, propertyOps, localFrame };
  }

  function channelsEditedAtFrame(property, localFrame) {
    const dynamic = window.PZ?.property?.dynamic;
    if (
      dynamic?.group &&
      property instanceof dynamic.group &&
      Array.isArray(property.objects)
    ) {
      return property.objects.filter((entry) => {
        try {
          return !!entry?.hasKeyframe?.(localFrame);
        } catch (error) {
          return false;
        }
      });
    }
    return [property];
  }

  function patchedInterpSet(value) {
    const sibling = siblingTweenButton(this);
    const context = sibling ? tweenSetContext(this) : null;
    if (!context || typeof sibling.pz_value === "undefined") {
      return this.__easingPlusOriginalInterpSet.call(this, value);
    }
    const channels = channelsEditedAtFrame(context.property, context.localFrame);
    const resolved = resolveTweenWrites(context, channels);
    if (resolved.length === 0) {
      return this.__easingPlusOriginalInterpSet.call(this, value);
    }
    const easeValue = Number.isFinite(sibling.pz_value) ? sibling.pz_value : 0;
    const { editor, propertyOps } = context;
    editor.history.startOperation();
    try {
      // The row displays the outgoing segment (see applyOutgoingDisplay), so
      // the picked value is always what the buttons should show afterwards.
      let wroteAny = false;
      for (const entry of resolved) {
        try {
          executeTweenWrite(
            propertyOps,
            entry.address,
            context.localFrame,
            entry.current,
            entry.next,
            value,
            easeValue
          );
          wroteAny = true;
        } catch (error) {
          console.error("Easing+ could not apply the picked interpolation.", error);
        }
      }
      if (wroteAny) this.pz_update(value << 8, true);
    } finally {
      editor.history.finishOperation();
    }
  }

  function patchedEaseSet(value) {
    const sibling = siblingTweenButton(this);
    const context = sibling ? tweenSetContext(this) : null;
    if (!context || !Number.isFinite(sibling.pz_value)) {
      return this.__easingPlusOriginalEaseSet.call(this, value);
    }
    const channels = channelsEditedAtFrame(context.property, context.localFrame);
    const resolved = resolveTweenWrites(context, channels);
    if (resolved.length === 0) {
      return this.__easingPlusOriginalEaseSet.call(this, value);
    }
    const { editor, propertyOps } = context;
    editor.history.startOperation();
    try {
      let wroteAny = false;
      for (const entry of resolved) {
        try {
          executeTweenWrite(
            propertyOps,
            entry.address,
            context.localFrame,
            entry.current,
            entry.next,
            sibling.pz_value,
            value
          );
          wroteAny = true;
        } catch (error) {
          console.error("Easing+ could not apply the picked easing.", error);
        }
      }
      if (wroteAny) this.pz_update(value, true);
    } finally {
      editor.history.finishOperation();
    }
  }

  // Collect the tween each channel would display under the outgoing rule:
  // the next keyframe's tween when the playhead is on a keyframe that has
  // one, otherwise the keyframe's own tween (final keyframe). Channels
  // without a keyframe at the playhead are skipped, mirroring the native
  // row update. Returns null when nothing is on the playhead.
  function resolveDisplayTweens(channels, localFrame) {
    const shown = [];
    for (const channel of channels) {
      const { current, next } = keyframesAround(channel, localFrame);
      if (!current) continue;
      const candidate = next ? next.tween : current.tween;
      if (!Number.isFinite(candidate)) return null;
      shown.push(candidate);
    }
    return shown;
  }

  // Reapply the outgoing rule to a keyframe row after the native row update
  // ran. While the playhead is on a keyframe, the interpolation/easing
  // buttons show the outgoing segment so the display always matches what a
  // pick would edit. Between keyframes, on the final keyframe, and on any
  // mismatch between grouped channels, the native result is kept (or the
  // buttons are hidden on mismatch, exactly like the native update does).
  // Returns true when the display was overridden.
  function applyOutgoingDisplay(row) {
    try {
      const propertyRow = row?.parentElement?.parentElement;
      const property = propertyRow?.pz_object;
      const controls = propertyRow?.parentElement?.pz_controls;
      const editor = controls?.editor;
      if (!property || !editor || !window.PZ) return false;
      let localFrame;
      try {
        localFrame = editor.playback.currentFrame - property.frameOffset;
      } catch (error) {
        return false;
      }
      if (!Number.isFinite(localFrame)) return false;
      const dynamic = window.PZ.property?.dynamic;
      const grouped = !!dynamic?.group && property instanceof dynamic.group;
      const channels =
        grouped && Array.isArray(property.objects) ? property.objects : [property];
      const shown = resolveDisplayTweens(channels, localFrame);
      if (!shown || shown.length === 0) return false;
      const { interpolationButton, easeButton } = tweenButtonsInRow(row);
      if (!interpolationButton || !easeButton) return false;
      const first = shown[0];
      if (!shown.every((tween) => tween === first)) {
        interpolationButton.pz_update?.(-1, false);
        easeButton.pz_update?.(-1, false);
        return true;
      }
      // A channel on its final keyframe contributes its own tween above,
      // which is exactly what the native update shows, so reaching here
      // with no next keyframe anywhere reproduces the native display.
      let visible = true;
      if (!grouped) visible = !!property.definition?.interpolated;
      interpolationButton.pz_update?.(first, visible);
      easeButton.pz_update?.(first, visible);
      return true;
    } catch (error) {
      return false;
    }
  }

  function wrapRowDisplay(row) {
    if (!row || typeof row.pz_update !== "function" || row.__easingPlusOriginalRowUpdate) {
      return;
    }
    const original = row.pz_update;
    const patched = function () {
      const result = original.apply(this, arguments);
      try {
        applyOutgoingDisplay(this);
      } catch (error) {
        console.error("Easing+ could not refresh the easing display.", error);
      }
      return result;
    };
    row.__easingPlusOriginalRowUpdate = original;
    row.__easingPlusPatchedRowUpdate = patched;
    row.pz_update = patched;
    state.displayRows.add(row);
  }

  function unwrapRowDisplay(row) {
    if (
      row?.__easingPlusPatchedRowUpdate &&
      row.pz_update === row.__easingPlusPatchedRowUpdate
    ) {
      row.pz_update = row.__easingPlusOriginalRowUpdate;
    }
    delete row?.__easingPlusOriginalRowUpdate;
    delete row?.__easingPlusPatchedRowUpdate;
  }

  function wrapTweenButtonSets(row) {
    const { interpolationButton, easeButton } = tweenButtonsInRow(row);
    if (!interpolationButton || !easeButton) return;
    wrapRowDisplay(row);
    if (
      typeof interpolationButton.pz_set === "function" &&
      !interpolationButton.__easingPlusPatchedInterpSet
    ) {
      interpolationButton.__easingPlusOriginalInterpSet = interpolationButton.pz_set;
      interpolationButton.__easingPlusPatchedInterpSet = patchedInterpSet;
      interpolationButton.pz_set = patchedInterpSet;
      state.easeButtons.add(interpolationButton);
    }
    if (
      typeof easeButton.pz_set === "function" &&
      !easeButton.__easingPlusPatchedEaseSet
    ) {
      easeButton.__easingPlusOriginalEaseSet = easeButton.pz_set;
      easeButton.__easingPlusPatchedEaseSet = patchedEaseSet;
      easeButton.pz_set = patchedEaseSet;
      state.easeButtons.add(easeButton);
    }
  }

  function wrapExistingTweenButtonSets(root = document) {
    if (!root?.querySelectorAll) return;
    const seen = new Set();
    root.querySelectorAll('button.pz-tweens[title="interpolation"]').forEach((button) => {
      const row = button.parentElement;
      if (row && !seen.has(row)) {
        seen.add(row);
        wrapTweenButtonSets(row);
      }
    });
  }

  function unwrapTweenButtonSets(button) {
    if (
      button.__easingPlusPatchedInterpSet &&
      button.pz_set === button.__easingPlusPatchedInterpSet
    ) {
      button.pz_set = button.__easingPlusOriginalInterpSet;
    }
    if (
      button.__easingPlusPatchedEaseSet &&
      button.pz_set === button.__easingPlusPatchedEaseSet
    ) {
      button.pz_set = button.__easingPlusOriginalEaseSet;
    }
    delete button.__easingPlusPatchedInterpSet;
    delete button.__easingPlusOriginalInterpSet;
    delete button.__easingPlusPatchedEaseSet;
    delete button.__easingPlusOriginalEaseSet;
  }

  function isBezierEaseButton(easeButton) {
    const interpolationButton = interpolationButtonFor(easeButton);
    if (!interpolationButton) return false;
    if (interpolationButton.pz_value === 1) return true;
    const interpolationIcon =
      interpolationButton.querySelector?.("use")?.getAttribute("xlink:href") ||
      interpolationButton.querySelector?.("use")?.getAttribute("href") ||
      "";
    return interpolationIcon.endsWith("#interp_1");
  }

  function updateEaseButtonLabel(easeButton) {
    if (!easeButton || !easeButton.classList) return;
    if (isBezierEaseButton(easeButton)) {
      easeButton.dataset.easingPlus = "true";
      easeButton.classList.add("easing-plus-ease-button");
      if (!Object.prototype.hasOwnProperty.call(easeButton, "__easingPlusAriaLabel")) {
        easeButton.__easingPlusAriaLabel = easeButton.getAttribute("aria-label");
      }
      easeButton.setAttribute("aria-label", "Easing+");
      return;
    }
    delete easeButton.dataset.easingPlus;
    easeButton.classList.remove("easing-plus-ease-button");
    if (Object.prototype.hasOwnProperty.call(easeButton, "__easingPlusAriaLabel")) {
      const originalAriaLabel = easeButton.__easingPlusAriaLabel;
      if (originalAriaLabel == null) easeButton.removeAttribute("aria-label");
      else easeButton.setAttribute("aria-label", originalAriaLabel);
      delete easeButton.__easingPlusAriaLabel;
    }
  }

  function decorateEaseButton(easeButton) {
    if (!easeButton || !easeButton.classList) return;
    state.easeButtons.add(easeButton);
    if (
      typeof easeButton.pz_update === "function" &&
      !easeButton.__easingPlusPatchedEaseUpdate
    ) {
      const originalUpdate = easeButton.pz_update;
      const patchedUpdate = function () {
        const result = originalUpdate.apply(this, arguments);
        updateEaseButtonLabel(this);
        return result;
      };
      easeButton.__easingPlusOriginalEaseUpdate = originalUpdate;
      easeButton.__easingPlusPatchedEaseUpdate = patchedUpdate;
      easeButton.pz_update = patchedUpdate;
    }

    const interpolationButton = interpolationButtonFor(easeButton);
    if (
      interpolationButton &&
      typeof interpolationButton.pz_update === "function" &&
      !interpolationButton.__easingPlusPatchedInterpolationUpdate
    ) {
      const originalUpdate = interpolationButton.pz_update;
      const patchedUpdate = function () {
        const result = originalUpdate.apply(this, arguments);
        updateEaseButtonLabel(easeButton);
        return result;
      };
      interpolationButton.__easingPlusOriginalInterpolationUpdate = originalUpdate;
      interpolationButton.__easingPlusPatchedInterpolationUpdate = patchedUpdate;
      interpolationButton.pz_update = patchedUpdate;
      state.easeButtons.add(interpolationButton);
    }
    updateEaseButtonLabel(easeButton);
  }

  function decorateEaseButtons(root = document) {
    if (!root?.querySelectorAll) return;
    root
      .querySelectorAll(
        'button.pz-tweens[title="easing"], button.pz-tweens[data-easing-plus="true"]'
      )
      .forEach(decorateEaseButton);
  }

  function installEaseButtonLabels() {
    decorateEaseButtons();
    wrapExistingTweenButtonSets();
    const controls = window.PZ?.ui?.controls;
    if (typeof controls?.createKeyframeControls !== "function") return;
    state.originalCreateKeyframeControls = controls.createKeyframeControls;
    state.patchedCreateKeyframeControls = function () {
      const row = state.originalCreateKeyframeControls.apply(this, arguments);
      decorateEaseButtons(row);
      wrapTweenButtonSets(row);
      return row;
    };
    controls.createKeyframeControls = state.patchedCreateKeyframeControls;
  }

  function uninstallEaseButtonLabels() {
    if (
      window.PZ?.ui?.controls?.createKeyframeControls === state.patchedCreateKeyframeControls
    ) {
      window.PZ.ui.controls.createKeyframeControls = state.originalCreateKeyframeControls;
    }
    state.easeButtons.forEach((button) => {
      unwrapTweenButtonSets(button);
      if (
        button.__easingPlusPatchedEaseUpdate &&
        button.pz_update === button.__easingPlusPatchedEaseUpdate
      ) {
        button.pz_update = button.__easingPlusOriginalEaseUpdate;
      }
      if (
        button.__easingPlusPatchedInterpolationUpdate &&
        button.pz_update === button.__easingPlusPatchedInterpolationUpdate
      ) {
        button.pz_update = button.__easingPlusOriginalInterpolationUpdate;
      }
      delete button.__easingPlusPatchedEaseUpdate;
      delete button.__easingPlusOriginalEaseUpdate;
      delete button.__easingPlusPatchedInterpolationUpdate;
      delete button.__easingPlusOriginalInterpolationUpdate;
      delete button.dataset.easingPlus;
      button.classList?.remove("easing-plus-ease-button");
      if (Object.prototype.hasOwnProperty.call(button, "__easingPlusAriaLabel")) {
        const originalAriaLabel = button.__easingPlusAriaLabel;
        if (originalAriaLabel == null) button.removeAttribute("aria-label");
        else button.setAttribute("aria-label", originalAriaLabel);
        delete button.__easingPlusAriaLabel;
      }
    });
    state.easeButtons.clear();
    state.displayRows.forEach((row) => {
      try {
        unwrapRowDisplay(row);
      } catch (error) {
        // A detached row simply skips the restore.
      }
    });
    state.displayRows.clear();
    state.originalCreateKeyframeControls = null;
    state.patchedCreateKeyframeControls = null;
  }

  function applyCurveToTarget(target, points, propertyOps) {
    const { property, start, end } = target;
    const plan = planCurve(property, start, end, points);
    if (!plan) throw new Error("Easing+ cannot be applied to this keyframe range.");
    const address = property.getAddress();
    const startControlPoints = [start.controlPoints[0].slice(), plan.points[0].outgoing.slice()];
    const last = plan.points[plan.points.length - 1];
    const endControlPoints = [last.incoming.slice(), end.controlPoints[1].slice()];

    propertyOps.setControlPoints({
      property: address,
      frame: start.frame,
      controlPoints: startControlPoints,
    });

    propertyOps.setControlPoints({
      property: address,
      frame: end.frame,
      controlPoints: endControlPoints,
    });
    propertyOps.setTween({ property: address, frame: end.frame, tween: BEZIER_TWEEN });
    return plan;
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function overshootForPoints(points) {
    const values = [];
    for (const entry of points) {
      values.push(entry.y, entry.y + entry.inY, entry.y + entry.outY);
    }
    return {
      bottom: Math.min(...values) < -EPSILON,
      top: Math.max(...values) > 1 + EPSILON,
    };
  }

  function graphBounds(points, overshoot = overshootForPoints(points)) {
    const values = [0, 1];
    for (const entry of points) {
      values.push(entry.y, entry.y + entry.inY, entry.y + entry.outY);
    }
    const pointMin = Math.min(...values);
    const pointMax = Math.max(...values);
    const min = overshoot.bottom ? Math.min(-0.55, pointMin - 0.12) : -0.12;
    const max = overshoot.top ? Math.max(1.55, pointMax + 0.12) : 1.12;
    return { min, max };
  }

  function resetOvershootPull(session) {
    session.overshootPull = {
      bottom: { armed: false, offset: 0 },
      top: { armed: false, offset: 0 },
    };
  }

  function graphBoundaryClientY(session, value, rect) {
    return rect.top + (session.graphMapping.mapY(value) / session.graphSize.height) * rect.height;
  }

  function overshootSideValue(session, side, rawY, distance, boundary, rect) {
    const pull = session.drag.overshootPull[side];
    const outside = distance > 0;
    if (!outside) {
      pull.armed = false;
      pull.offset = 0;
      session.pendingOvershoot[side] = false;
      return boundary;
    }

    if (pull.armed) {
      // A small hysteresis band lets the user retreat from the edge without
      // accidentally toggling the mode on and off while still holding.
      if (distance < OVERSHOOT_RELEASE_PX) {
        pull.armed = false;
        pull.offset = 0;
        session.pendingOvershoot[side] = false;
        return boundary;
      }
      session.pendingOvershoot[side] = true;
      return rawY - pull.offset;
    }

    if (distance < OVERSHOOT_ARM_PX) {
      // Keep the real point exactly on the boundary until the gesture is
      // armed.  This makes a normal 0/1 edit impossible to accidentally save
      // as a tiny overshoot.
      session.pendingOvershoot[side] = false;
      return boundary;
    }

    // Arm at a continuous visual position, then let the pointer track the
    // raw curve.  The offset prevents a jump when the 40px threshold is
    // crossed, so releasing here cleanly starts overshoot mode.
    pull.armed = true;
    pull.offset = rawY - boundary;
    session.pendingOvershoot[side] = true;
    return boundary;
  }

  function snapDraggedPointY(session, value) {
    const { index, kind } = session.drag;
    const entry = session.points[index];
    if (!entry) return;
    if (kind === "anchor") {
      entry.y = value;
    } else if (kind === "in") {
      entry.inY = value - entry.y;
    } else {
      entry.outY = value - entry.y;
    }
  }

  function pathData(points, mapX, mapY) {
    let data = `M ${mapX(points[0].x)} ${mapY(points[0].y)}`;
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      data += ` C ${mapX(start.x + start.outX)} ${mapY(start.y + start.outY)}, `;
      data += `${mapX(end.x + end.inX)} ${mapY(end.y + end.inY)}, `;
      data += `${mapX(end.x)} ${mapY(end.y)}`;
    }
    return data;
  }

  function renderGraph(session) {
    const svg = session.graph;
    while (svg.firstChild) svg.firstChild.remove();
    const width = 520;
    const rect = svg.getBoundingClientRect();
    const height = rect.width > 0 && rect.height > 0 ? (width * rect.height) / rect.width : 420;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    // Keep the plotting area optically centered inside the editor.  The old
    // 38/24 inset made the left gutter visibly wider than the right one.
    const inset = { left: 28, right: 28, top: 18, bottom: 18 };
    const plotWidth = width - inset.left - inset.right;
    const plotHeight = height - inset.top - inset.bottom;
    const bounds = graphBounds(session.points, session.overshoot);
    const mapX = (value) => inset.left + value * plotWidth;
    const mapY = (value) =>
      inset.top + ((bounds.max - value) / (bounds.max - bounds.min)) * plotHeight;
    const unmapX = (value) => (value - inset.left) / plotWidth;
    const unmapY = (value) =>
      bounds.max - ((value - inset.top) / plotHeight) * (bounds.max - bounds.min);
    session.graphMapping = { mapX, mapY, unmapX, unmapY, bounds };
    session.graphSize = { width, height };

    const topZoneHeight = Math.max(0, mapY(1) - inset.top);
    const bottomZoneY = mapY(0);
    const bottomZoneHeight = Math.max(0, height - inset.bottom - bottomZoneY);
    if (session.overshoot.top || session.pendingOvershoot.top) {
      svg.appendChild(
        svgElement("rect", {
          class: session.pendingOvershoot.top
            ? "ep-overshoot-zone ep-overshoot-zone-pending"
            : "ep-overshoot-zone ep-overshoot-zone-active",
          x: inset.left,
          y: inset.top,
          width: plotWidth,
          height: topZoneHeight,
        })
      );
    }
    if (session.overshoot.bottom || session.pendingOvershoot.bottom) {
      svg.appendChild(
        svgElement("rect", {
          class: session.pendingOvershoot.bottom
            ? "ep-overshoot-zone ep-overshoot-zone-pending"
            : "ep-overshoot-zone ep-overshoot-zone-active",
          x: inset.left,
          y: bottomZoneY,
          width: plotWidth,
          height: bottomZoneHeight,
        })
      );
    }

    for (let index = 0; index <= 4; index += 1) {
      const x = mapX(index / 4);
      svg.appendChild(
        svgElement("line", {
          class: index === 0 || index === 4 ? "ep-axis-line" : "ep-grid-line",
          x1: x,
          y1: mapY(1),
          x2: x,
          y2: mapY(0),
        })
      );
    }
    for (let index = 0; index <= 4; index += 1) {
      const value = index / 4;
      const y = mapY(value);
      svg.appendChild(
        svgElement("line", {
          class: index === 0 || index === 4 ? "ep-axis-line" : "ep-grid-line",
          x1: inset.left,
          y1: y,
          x2: width - inset.right,
          y2: y,
        })
      );
    }

    const data = pathData(session.points, mapX, mapY);
    svg.appendChild(svgElement("path", { class: "ep-curve-shadow", d: data }));
    svg.appendChild(svgElement("path", { class: "ep-curve", d: data }));

    const handles = [];
    session.points.forEach((entry, index) => {
      if (index > 0) {
        const hx = mapX(entry.x + entry.inX);
        const hy = mapY(entry.y + entry.inY);
        svg.appendChild(
          svgElement("line", {
            class: "ep-guide",
            x1: mapX(entry.x),
            y1: mapY(entry.y),
            x2: hx,
            y2: hy,
          })
        );
        handles.push(svgElement("circle", {
          class: "ep-handle",
          cx: hx,
          cy: hy,
          r: 5,
          "data-index": index,
          "data-kind": "in",
        }));
      }
      if (index < session.points.length - 1) {
        const hx = mapX(entry.x + entry.outX);
        const hy = mapY(entry.y + entry.outY);
        svg.appendChild(
          svgElement("line", {
            class: "ep-guide",
            x1: mapX(entry.x),
            y1: mapY(entry.y),
            x2: hx,
            y2: hy,
          })
        );
        handles.push(svgElement("circle", {
          class: "ep-handle",
          cx: hx,
          cy: hy,
          r: 5,
          "data-index": index,
          "data-kind": "out",
        }));
      }
      const anchor = svgElement("circle", {
        class: "ep-anchor",
        cx: mapX(entry.x),
        cy: mapY(entry.y),
        r: index === 0 || index === session.points.length - 1 ? 7 : 6,
        "data-index": index,
        "data-kind": "anchor",
        "data-endpoint": index === 0 || index === session.points.length - 1,
        "data-selected": index === session.selectedAnchor,
      });
      svg.appendChild(anchor);
    });
    // Anchors are rendered first and handles last.  When a handle is moved
    // onto an endpoint, the endpoint must not steal its pointer hit target.
    handles.forEach((handle) => svg.appendChild(handle));
    updateCoordinateInputs(session);
  }

  function selectedSegment(session) {
    return clamp(session.selectedSegment, 0, session.points.length - 2);
  }

  function updateCoordinateInputs(session) {
    const index = selectedSegment(session);
    const start = session.points[index];
    const end = session.points[index + 1];
    const values = [
      start.x + start.outX,
      start.y + start.outY,
      end.x + end.inX,
      end.y + end.inY,
    ];
    session.coordinateInputs.forEach((input, inputIndex) => {
      if (document.activeElement !== input) input.value = round(values[inputIndex], 4);
    });
  }

  function updateSegmentFromInputs(session) {
    const values = session.coordinateInputs.map((input) => Number(input.value));
    if (values.some((value) => !Number.isFinite(value))) return;
    const index = selectedSegment(session);
    const start = session.points[index];
    const end = session.points[index + 1];
    values[0] = clamp(values[0], start.x, end.x);
    values[2] = clamp(values[2], start.x, end.x);
    start.outX = values[0] - start.x;
    start.outY = values[1] - start.y;
    end.inX = values[2] - end.x;
    end.inY = values[3] - end.y;
    session.overshoot = overshootForPoints(session.points);
    session.dirty = true;
    session.selectedPreset = -1;
    renderGraph(session);
    updatePresetSelection(session);
  }

  function graphPointerDown(session, event) {
    const target = event.target.closest("[data-kind]");
    if (!target) return;
    const index = Number(target.dataset.index);
    const kind = target.dataset.kind;
    session.pendingOvershoot = { bottom: false, top: false };
    resetOvershootPull(session);
    if (kind === "anchor") {
      session.selectedAnchor = index;
      session.selectedSegment = Math.min(index, session.points.length - 2);
      if (index === 0 || index === session.points.length - 1) {
        renderGraph(session);
        return;
      }
    }
    session.drag = {
      index,
      kind,
      pointerId: event.pointerId,
      overshootPull: session.overshootPull,
      overshootSide: null,
    };
    session.graph.setPointerCapture(event.pointerId);
    event.preventDefault();
    renderGraph(session);
  }

  function graphPointerMove(session, event) {
    if (!session.drag || session.drag.pointerId !== event.pointerId) return;
    // A release outside the SVG can leave a final pointermove as the only
    // event delivered by some WebKit builds.  Treat a mouse move with no
    // buttons as an implicit pointerup so a subsequent re-entry cannot keep
    // moving the curve.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      graphPointerUp(session, event);
      return;
    }
    const rect = session.graph.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / rect.width) * session.graphSize.width;
    const svgY = ((event.clientY - rect.top) / rect.height) * session.graphSize.height;
    let x = session.graphMapping.unmapX(svgX);
    const rawY = session.graphMapping.unmapY(svgY);
    let y = clamp(rawY, -2, 3);
    if (!session.overshoot.bottom && rawY < 0) {
      session.drag.overshootSide = "bottom";
      const boundary = graphBoundaryClientY(session, 0, rect);
      const distance = event.clientY - boundary;
      y = overshootSideValue(session, "bottom", rawY, distance, 0, rect);
      session.pendingOvershoot.top = false;
      session.drag.overshootPull.top.armed = false;
      session.drag.overshootPull.top.offset = 0;
    } else if (!session.overshoot.bottom) {
      session.pendingOvershoot.bottom = false;
      session.drag.overshootPull.bottom.armed = false;
      session.drag.overshootPull.bottom.offset = 0;
      if (rawY >= 0 && session.drag.overshootSide === "bottom") {
        session.drag.overshootSide = null;
      }
    }
    if (!session.overshoot.top && rawY > 1) {
      session.drag.overshootSide = "top";
      const boundary = graphBoundaryClientY(session, 1, rect);
      const distance = boundary - event.clientY;
      y = overshootSideValue(session, "top", rawY, distance, 1, rect);
      session.pendingOvershoot.bottom = false;
      session.drag.overshootPull.bottom.armed = false;
      session.drag.overshootPull.bottom.offset = 0;
    } else if (!session.overshoot.top) {
      session.pendingOvershoot.top = false;
      session.drag.overshootPull.top.armed = false;
      session.drag.overshootPull.top.offset = 0;
      if (rawY <= 1 && session.drag.overshootSide === "top") {
        session.drag.overshootSide = null;
      }
    }
    // Preserve the small resisted pull while the pointer is outside a
    // boundary; clamp only when the pointer is back in the normal range.
    if (!session.overshoot.bottom && rawY >= 0) y = Math.max(0, y);
    if (!session.overshoot.top && rawY <= 1) y = Math.min(1, y);
    const { index, kind } = session.drag;
    const entry = session.points[index];
    if (kind === "anchor") {
      x = clamp(x, session.points[index - 1].x + 0.015, session.points[index + 1].x - 0.015);
      y = clamp(y, -2, 3);
      entry.x = x;
      entry.y = y;
    } else if (kind === "in") {
      const previous = session.points[index - 1];
      x = clamp(x, previous.x, entry.x);
      entry.inX = x - entry.x;
      entry.inY = y - entry.y;
      session.selectedSegment = index - 1;
    } else {
      const next = session.points[index + 1];
      x = clamp(x, entry.x, next.x);
      entry.outX = x - entry.x;
      entry.outY = y - entry.y;
      session.selectedSegment = index;
    }
    session.dirty = true;
    session.selectedPreset = -1;
    renderGraph(session);
    updatePresetSelection(session);
  }

  function graphPointerUp(session, event) {
    if (!session.drag) return;
    if (event?.pointerId != null && session.drag.pointerId !== event.pointerId) return;
    if (session.pendingOvershoot.bottom) session.overshoot.bottom = true;
    if (session.pendingOvershoot.top) session.overshoot.top = true;
    // The resisted pull is only a visual affordance.  If the user releases
    // before arming, put the dragged control exactly back on 0 or 1 so a
    // near-boundary gesture can never turn into a tiny saved overshoot.
    if (
      session.drag.overshootSide === "bottom" &&
      !session.pendingOvershoot.bottom &&
      !session.overshoot.bottom
    ) {
      snapDraggedPointY(session, 0);
    }
    if (
      session.drag.overshootSide === "top" &&
      !session.pendingOvershoot.top &&
      !session.overshoot.top
    ) {
      snapDraggedPointY(session, 1);
    }
    const pointerId = session.drag.pointerId;
    session.pendingOvershoot = { bottom: false, top: false };
    resetOvershootPull(session);
    session.drag = null;
    if (pointerId != null && session.graph.hasPointerCapture(pointerId)) {
      session.graph.releasePointerCapture(pointerId);
    }
    renderGraph(session);
  }

  function miniGeometry(points) {
    const mapX = (value) => 7 + value * 54;
    const bounds = graphBounds(points);
    const mapY = (value) => 52 - ((value - bounds.min) / (bounds.max - bounds.min)) * 44;
    const start = points[0];
    const end = points[points.length - 1];
    return {
      path: pathData(points, mapX, mapY),
      start: [mapX(start.x), mapY(start.y)],
      firstControl: [mapX(start.x + start.outX), mapY(start.y + start.outY)],
      secondControl: [mapX(end.x + end.inX), mapY(end.y + end.inY)],
      end: [mapX(end.x), mapY(end.y)],
    };
  }

  function updatePresetSelection(session) {
    session.presetButtons.forEach((button, index) => {
      button.dataset.selected = String(index === session.selectedPreset);
    });
  }

  function createPresetButton(session, preset, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "easing-plus-preset";
    button.dataset.selected = "false";
    const preview = miniGeometry(preset.points);
    button.innerHTML = `
      <svg viewBox="0 0 68 60" aria-hidden="true">
        <line class="ep-mini-guide" x1="${preview.start[0]}" y1="${preview.start[1]}" x2="${preview.firstControl[0]}" y2="${preview.firstControl[1]}"></line>
        <line class="ep-mini-guide" x1="${preview.end[0]}" y1="${preview.end[1]}" x2="${preview.secondControl[0]}" y2="${preview.secondControl[1]}"></line>
        <path class="ep-mini-curve" d="${preview.path}"></path>
        <circle class="ep-mini-anchor" cx="${preview.start[0]}" cy="${preview.start[1]}" r="2.6"></circle>
        <circle class="ep-mini-anchor" cx="${preview.end[0]}" cy="${preview.end[1]}" r="2.6"></circle>
        <circle class="ep-mini-handle" cx="${preview.firstControl[0]}" cy="${preview.firstControl[1]}" r="2"></circle>
        <circle class="ep-mini-handle" cx="${preview.secondControl[0]}" cy="${preview.secondControl[1]}" r="2"></circle>
      </svg>
      <span>${preset.name}</span>`;
    button.addEventListener("click", () => {
      session.points = clonePoints(preset.points);
      session.overshoot = overshootForPoints(session.points);
      session.pendingOvershoot = { bottom: false, top: false };
      session.dirty = true;
      session.selectedPreset = index;
      session.selectedAnchor = 0;
      session.selectedSegment = 0;
      renderGraph(session);
      updatePresetSelection(session);
    });
    return button;
  }

  function positionDialog(session) {
    const dialog = session.root.querySelector(".easing-plus-dialog");
    const anchorRect = session.anchor.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    const gap = 7;
    const margin = 8;
    let left = anchorRect.right + gap;
    if (left + dialogRect.width > window.innerWidth - margin) {
      left = anchorRect.left - dialogRect.width - gap;
    }
    left = clamp(left, margin, Math.max(margin, window.innerWidth - dialogRect.width - margin));
    let top = anchorRect.top - 8;
    top = clamp(top, margin, Math.max(margin, window.innerHeight - dialogRect.height - margin));
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
  }

  function createDialog(context, anchor) {
    closeDialog();
    const shell = document.createElement("div");
    shell.className = "easing-plus-shell";
    shell.innerHTML = `
      <section class="easing-plus-dialog" role="dialog" aria-labelledby="easing-plus-title">
        <header class="easing-plus-header">
          <span class="easing-plus-title" id="easing-plus-title">Easing+</span>
          <button class="easing-plus-close" type="button" aria-label="Close">×</button>
        </header>
        <div class="easing-plus-main">
          <section class="easing-plus-editor" aria-label="Curve editor">
            <div class="easing-plus-graph-wrap">
              <svg class="easing-plus-graph" viewBox="0 0 520 420" preserveAspectRatio="none" aria-label="Bezier curve editor"></svg>
            </div>
            <div class="easing-plus-coordinates">
              <span class="easing-plus-coordinate-label">C</span>
              <input class="easing-plus-coordinate" type="number" step="0.01" aria-label="First control X">
              <input class="easing-plus-coordinate" type="number" step="0.01" aria-label="First control Y">
              <input class="easing-plus-coordinate" type="number" step="0.01" aria-label="Second control X">
              <input class="easing-plus-coordinate" type="number" step="0.01" aria-label="Second control Y">
            </div>
          </section>
          <aside class="easing-plus-presets" aria-label="Easing presets">
            <div class="easing-plus-presets-title">Presets</div>
            <div class="easing-plus-preset-grid"></div>
          </aside>
        </div>
      </section>`;
    document.body.appendChild(shell);

    // Always load the edited segment's existing curve so a saved custom
    // interpolation is shown again when the window is reopened. Every target
    // shares the playhead as its segment start, so the first target
    // represents the edited interval.
    const reference = context.targets[0];
    const initialPoints = curveFromSegment(reference.property, reference.start, reference.end);
    const session = {
      ...context,
      root: shell,
      anchor,
      graph: shell.querySelector(".easing-plus-graph"),
      points: initialPoints,
      coordinateInputs: Array.from(shell.querySelectorAll(".easing-plus-coordinate")),
      presetButtons: [],
      selectedAnchor: 0,
      selectedSegment: 0,
      selectedPreset: -1,
      drag: null,
      overshoot: overshootForPoints(initialPoints),
      pendingOvershoot: { bottom: false, top: false },
      overshootPull: {
        bottom: { armed: false, offset: 0 },
        top: { armed: false, offset: 0 },
      },
      dirty: false,
      reposition: null,
      pointerRelease: null,
      pointerLost: null,
      windowBlur: null,
    };
    state.dialog = session;

    shell.querySelector(".easing-plus-close").addEventListener("click", closeDialog);
    shell.addEventListener("click", (event) => {
      if (event.target === shell) closeDialog();
    });
    session.graph.addEventListener("pointerdown", (event) => graphPointerDown(session, event));
    session.graph.addEventListener("pointermove", (event) => graphPointerMove(session, event));
    session.graph.addEventListener("pointerup", (event) => graphPointerUp(session, event));
    session.graph.addEventListener("pointercancel", (event) => graphPointerUp(session, event));
    session.pointerRelease = (event) => graphPointerUp(session, event);
    session.pointerLost = (event) => graphPointerUp(session, event);
    session.windowBlur = () => graphPointerUp(session);
    // Capture at the window as well as on the SVG.  This covers releasing the
    // mouse outside the popover and WebKit's lost-pointer-capture edge case.
    window.addEventListener("pointerup", session.pointerRelease, true);
    window.addEventListener("pointercancel", session.pointerRelease, true);
    window.addEventListener("blur", session.windowBlur);
    session.graph.addEventListener("lostpointercapture", session.pointerLost);
    session.coordinateInputs.forEach((input) => {
      input.addEventListener("input", () => updateSegmentFromInputs(session));
      input.addEventListener("change", () => updateSegmentFromInputs(session));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
        event.stopPropagation();
      });
    });

    const grid = shell.querySelector(".easing-plus-preset-grid");
    PRESETS.forEach((preset, index) => {
      const button = createPresetButton(session, preset, index);
      session.presetButtons.push(button);
      grid.appendChild(button);
    });

    renderGraph(session);
    session.reposition = () => {
      positionDialog(session);
      renderGraph(session);
    };
    window.addEventListener("resize", session.reposition);
    positionDialog(session);
    requestAnimationFrame(session.reposition);
    shell.querySelector(".easing-plus-close").focus();
  }

  function closeDialog() {
    const session = state.dialog;
    if (!session) return;
    if (session.coordinateInputs.includes(document.activeElement)) document.activeElement.blur();
    if (session.dirty) {
      const propertyOps = new window.PZ.ui.properties(session.editor);
      session.editor.history.startOperation();
      try {
        session.targets.forEach((target) => applyCurveToTarget(target, session.points, propertyOps));
      } catch (error) {
        console.error("Easing+ could not apply the edited curve.", error);
      } finally {
        session.editor.history.finishOperation();
      }
    }
    if (session.reposition) window.removeEventListener("resize", session.reposition);
    if (session.pointerRelease) {
      window.removeEventListener("pointerup", session.pointerRelease, true);
      window.removeEventListener("pointercancel", session.pointerRelease, true);
    }
    if (session.windowBlur) window.removeEventListener("blur", session.windowBlur);
    if (session.pointerLost) session.graph.removeEventListener("lostpointercapture", session.pointerLost);
    session.root.remove();
    state.dialog = null;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const bundledStyle = state.getAsset?.("text", STYLE_URL);
    if (typeof bundledStyle === "string") {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = bundledStyle;
      document.head.appendChild(style);
      return;
    }
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    document.head.appendChild(link);
  }

  function uninstallStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }

  function activate(context) {
    if (state.active) return;
    state.active = true;
    state.getAsset = context.getAsset;
    state.editor = context.editor || window.CM;
    installStyle();
    state.originalCorrectCurve = window.PZ.tween.correctCurve;
    state.patchedCorrectCurve = function (start, end) {
      if (shouldPreserveCrossingX(start, end)) return 1;
      return state.originalCorrectCurve(start, end);
    };
    window.PZ.tween.correctCurve = state.patchedCorrectCurve;
    state.originalEaseDropDown = window.PZ.editor.showEaseDropDown;
    state.patchedEaseDropDown = function (button) {
      const targets = resolveTargets(button);
      if (!targets) return state.originalEaseDropDown.apply(this, arguments);
      createDialog(targets, button);
    };
    window.PZ.editor.showEaseDropDown = state.patchedEaseDropDown;
    installEaseButtonLabels();
    installShapePreservation();
    state.keydown = (event) => {
      if (event.key === "Escape" && state.dialog) {
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
      }
    };
    document.addEventListener("keydown", state.keydown, true);
  }

  function deactivate() {
    if (!state.active) return;
    closeDialog();
    uninstallEaseButtonLabels();
    uninstallShapePreservation();
    if (window.PZ?.editor?.showEaseDropDown === state.patchedEaseDropDown) {
      window.PZ.editor.showEaseDropDown = state.originalEaseDropDown;
    }
    if (window.PZ?.tween?.correctCurve === state.patchedCorrectCurve) {
      window.PZ.tween.correctCurve = state.originalCorrectCurve;
    }
    if (state.keydown) document.removeEventListener("keydown", state.keydown, true);
    uninstallStyle();
    state.active = false;
    state.editor = null;
    state.getAsset = null;
    state.originalEaseDropDown = null;
    state.patchedEaseDropDown = null;
    state.originalCorrectCurve = null;
    state.patchedCorrectCurve = null;
    state.keydown = null;
  }

  return {
    activate,
    deactivate,
    __test: {
      cubic,
      planCurve,
      createValueMapper,
      valueScaleFor,
      cubicValue,
      graphBounds,
      miniGeometry,
      overshootForPoints,
      shouldPreserveCrossingX,
      hasNativeBezierDefaults,
      pickTargetForSet,
      keyframesAround,
      resolveTweenWrites,
      executeTweenWrite,
      resolveDisplayTweens,
      applyOutgoingDisplay,
      rescaleSegmentHandles,
      snapshotChannelSegments,
      restoreChannelSegments,
      PRESETS,
    },
  };
})();

module.exports = EasingPlus;
