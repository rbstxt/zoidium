"use strict";

const EasingPlus = (() => {
  const STYLE_ID = "zoidium-easing-plus-style";
  const STYLE_URL = "./plugins/easing-plus/easing-plus.css?v=6";
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

  function curveFromSegment(property, start, end) {
    const duration = end.frame - start.frame;
    if (!(duration > 0)) return cubic(0.333, 0.333, 0.667, 0.667);
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
    planned[0].outgoing = [outgoingX, outgoingValue - start.value];
    planned[1].incoming = [incomingX, incomingValue - end.value];
    return { frames, points: planned, equalValues: mapper.equal, valueScale: mapper.scale };
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

      // Easing+ always edits the outgoing segment from the current keyframe.
      // Panzoid returns the current keyframe when there is no next keyframe,
      // so the frame comparison below also excludes the final keyframe.
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
    return { editor, property, localFrame, targets };
  }

  function applyCurveToTarget(target, points, propertyOps) {
    const { property, start, end } = target;
    const plan = planCurve(property, start, end, points);
    if (!plan) throw new Error("この区間には適用できません。");
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

    const first = context.targets[0];
    const initialPoints = curveFromSegment(first.property, first.start, first.end);
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
      PRESETS,
    },
  };
})();

module.exports = EasingPlus;
