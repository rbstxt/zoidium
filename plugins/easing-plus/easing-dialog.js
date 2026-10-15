"use strict";

// Easing+ curve editor dialog: SVG graph rendering, overshoot gestures,
// presets and coordinate inputs. Created per activation with the plugin
// state; it draws through state.ui and commits through CM3 property
// operations, so undo and redo come from the host history.

// Overshoot is an intentional, two-stage gesture.  Keeping these in screen
// pixels makes the gesture feel the same on a compact popover and a large
// monitor, even though the graph's normalized scale changes with its size.
const OVERSHOOT_ARM_PX = 40;
const OVERSHOOT_RELEASE_PX = 24;

function loadCurves() {
  if (typeof require === "function") return require("./easing-curves.js");
  throw new Error("Easing+ dialog needs ./easing-curves.js.");
}

module.exports = function createDialogApi(state, options) {
  const curves = (options && options.curves) || loadCurves();
  const applyCurveToTarget = options && options.applyCurveToTarget;
  if (typeof applyCurveToTarget !== "function") {
    throw new Error("Easing+ dialog needs the host applyCurveToTarget.");
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
      bottom: Math.min(...values) < -curves.EPSILON,
      top: Math.max(...values) > 1 + curves.EPSILON,
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
    return curves.clamp(session.selectedSegment, 0, session.points.length - 2);
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
    session.coordinateControls.forEach((control, inputIndex) => control.set(curves.round(values[inputIndex], 4)));
  }

  function updateSegmentFromInputs(session) {
    const values = session.coordinateControls.map((control) => Number(control.get()));
    if (values.some((value) => !Number.isFinite(value))) return;
    const index = selectedSegment(session);
    const start = session.points[index];
    const end = session.points[index + 1];
    values[0] = curves.clamp(values[0], start.x, end.x);
    values[2] = curves.clamp(values[2], start.x, end.x);
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
    let y = curves.clamp(rawY, -2, 3);
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
      x = curves.clamp(x, session.points[index - 1].x + 0.015, session.points[index + 1].x - 0.015);
      y = curves.clamp(y, -2, 3);
      entry.x = x;
      entry.y = y;
    } else if (kind === "in") {
      const previous = session.points[index - 1];
      x = curves.clamp(x, previous.x, entry.x);
      entry.inX = x - entry.x;
      entry.inY = y - entry.y;
      session.selectedSegment = index - 1;
    } else {
      const next = session.points[index + 1];
      x = curves.clamp(x, entry.x, next.x);
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
      session.points = curves.clonePoints(preset.points);
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

  function createDialog(context) {
    closeDialog();
    const ui = state.ui;
    if (!ui || typeof ui.openWindow !== "function") {
      console.error("Easing+ requires the plugin window API (context.ui).");
      return;
    }

    // Always load the edited segment's existing curve so a saved custom
    // interpolation is shown again when the window is reopened. Every target
    // shares the playhead as its segment end, so the first target represents
    // the edited interval.
    const reference = context.targets[0];
    const initialPoints = curves.curveFromSegment(reference.property, reference.start, reference.end);
    const propertyName = context.property?.definition?.name || "";
    let session = null;

    state.dialog = null;
    const win = ui.openWindow({
      id: "curve-editor",
      title: "Easing+",
      subtitle: propertyName,
      className: "easing-plus-window",
      persistKey: "curve-editor",
      width: 560,
      height: 430,
      minWidth: 420,
      minHeight: 300,
      isValid: () => context.targets.every((target) => {
        try {
          return Boolean(target.property.parentObject);
        } catch (_error) {
          return false;
        }
      }),
      onClose: () => finishDialog(session),
      mount(body, handle) {
        const controls = ui.controls;
        const main = document.createElement("div");
        main.className = "easing-plus-main";

        const editor = document.createElement("section");
        editor.className = "easing-plus-editor";
        editor.setAttribute("aria-label", "Curve editor");
        const graphWrap = document.createElement("div");
        graphWrap.className = "easing-plus-graph-wrap";
        const graph = svgElement("svg", { class: "easing-plus-graph", preserveAspectRatio: "none" });
        graph.setAttribute("aria-label", "Bezier curve editor");
        graphWrap.appendChild(graph);
        editor.appendChild(graphWrap);
        const handles = document.createElement("div");
        handles.className = "easing-plus-handles";
        editor.appendChild(handles);

        const presets = controls.section({ title: "Presets" });
        presets.element.classList.add("easing-plus-presets");
        const grid = document.createElement("div");
        grid.className = "easing-plus-preset-grid";
        presets.body.appendChild(grid);

        main.appendChild(editor);
        main.appendChild(presets.element);
        body.appendChild(main);

        session = {
          ...context,
          dialogWindow: handle,
          graph,
          points: initialPoints,
          coordinateControls: [],
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
          resizeObserver: null,
        };
        state.dialog = session;

        // Handle coordinates are scrubbable CM3-style numbers. Dragging or
        // committing a typed value updates the curve immediately; the edit is
        // recorded once when the window closes.
        const coordinateLabels = [
          ["Out X", "Outgoing handle X of the edited segment's start"],
          ["Out Y", "Outgoing handle Y of the edited segment's start"],
          ["In X", "Incoming handle X of the edited segment's end"],
          ["In Y", "Incoming handle Y of the edited segment's end"],
        ];
        for (const [label, hint] of coordinateLabels) {
          const control = controls.number({
            label,
            hint,
            value: 0,
            step: 0.001,
            onInput: () => updateSegmentFromInputs(session),
            onChange: () => updateSegmentFromInputs(session),
          });
          session.coordinateControls.push(control);
          handles.appendChild(control.element);
        }

        graph.addEventListener("pointerdown", (event) => graphPointerDown(session, event));
        graph.addEventListener("pointermove", (event) => graphPointerMove(session, event));
        graph.addEventListener("pointerup", (event) => graphPointerUp(session, event));
        graph.addEventListener("pointercancel", (event) => graphPointerUp(session, event));
        session.pointerRelease = (event) => graphPointerUp(session, event);
        session.pointerLost = (event) => graphPointerUp(session, event);
        session.windowBlur = () => graphPointerUp(session);
        // Capture at the window as well as on the SVG. This covers releasing
        // the mouse outside the window and WebKit's lost-pointer-capture case.
        window.addEventListener("pointerup", session.pointerRelease, true);
        window.addEventListener("pointercancel", session.pointerRelease, true);
        window.addEventListener("blur", session.windowBlur);
        graph.addEventListener("lostpointercapture", session.pointerLost);

        curves.PRESETS.forEach((preset, index) => {
          const button = createPresetButton(session, preset, index);
          session.presetButtons.push(button);
          grid.appendChild(button);
        });

        renderGraph(session);
        // The plot's aspect follows the window size, so re-plot on resize.
        if (typeof ResizeObserver === "function") {
          session.resizeObserver = new ResizeObserver(() => {
            if (state.dialog === session) renderGraph(session);
          });
          session.resizeObserver.observe(graph);
        }

        return () => {
          session.resizeObserver?.disconnect();
          session.resizeObserver = null;
          window.removeEventListener("pointerup", session.pointerRelease, true);
          window.removeEventListener("pointercancel", session.pointerRelease, true);
          window.removeEventListener("blur", session.windowBlur);
          graph.removeEventListener("lostpointercapture", session.pointerLost);
        };
      },
    });
    if (!win) state.dialog = null;
  }

  // Closing the window (close button, Escape, or plugin teardown) commits the
  // edited curve once as a single native history operation.
  function finishDialog(session) {
    if (!session || state.dialog !== session) return;
    const active = document.activeElement;
    if (active && session.dialogWindow.element.contains(active)) active.blur();
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
    state.dialog = null;
  }

  function closeDialog() {
    state.dialog?.dialogWindow.close();
  }

  return {
    createDialog,
    finishDialog,
    closeDialog,
    graphBounds,
    miniGeometry,
    overshootForPoints,
    pathData,
  };
};
