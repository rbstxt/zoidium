(function installTrackSwitches(global) {
  "use strict";

  const PZ = global.PZ;
  const prototype = PZ?.ui?.timeline?.tracks?.prototype;
  if (!prototype?.createTrackLabel) return;
  const create = prototype.createTrackLabel;
  const controls = new WeakMap();
  const targets = new WeakMap();
  let drag = null;

  const columns = {
    visibility: { field: "enabled", on: "Disable track", off: "Enable track" },
    solo: { field: "zoidiumSolo", on: "Unsolo track", off: "Solo track" },
    lock: { field: "zoidiumLocked", on: "Unlock track", off: "Lock track" },
  };

  function isOn(track, column) {
    const value = track[columns[column].field];
    return column === "visibility" ? value !== false : value === true;
  }

  function refreshButton(track, column, button) {
    const active = isOn(track, column);
    button.title = active ? columns[column].on : columns[column].off;
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(active));
    const icon = button.firstElementChild;
    if (!icon) return;
    if (column === "visibility") {
      icon.style.fill = active ? "var(--zui-text, #ccc)" : "var(--zui-toggle-on, #8a2828)";
    } else {
      icon.style.color = active ? "var(--zui-accent, #70c29d)" : "var(--zui-text-muted, #999)";
      icon.style.fill = "none";
    }
    if (column === "solo") icon.firstElementChild.setAttribute("fill", active ? "currentColor" : "none");
    if (column === "lock") {
      icon.firstElementChild.setAttribute("d", active ? "M6 7V5a2 2 0 1 1 4 0v2" : "M6 7V5a2 2 0 0 1 3.9-.6");
    }
  }

  function refresh(track) {
    for (const ref of controls.get(track) || []) {
      const button = ref.deref();
      if (button) refreshButton(track, targets.get(button).column, button);
      else controls.get(track).delete(ref);
    }
  }

  function exchange(panel, project, command) {
    const { editor, sequence } = panel.timeline;
    if (editor.project !== project) return;
    const track = project.addressLookup(command.address);
    if (!track) return;
    const previous = isOn(track, command.column);
    track[columns[command.column].field] = command.value;
    editor.history.pushCommand(next => exchange(panel, project, next), { ...command, value: previous });
    refresh(track);
    if (command.column === "lock") global.ZoidiumTrackSwitches?.refreshLock?.(editor);
    if (command.column === "solo" || track.type === 1 && command.column === "visibility") {
      PZ.schedule?.zoidiumAnalyzeWithoutSeeking?.(panel.timeline, sequence);
    }
    if (command.column !== "lock" && Number.isFinite(editor.playback?.currentFrame)) {
      sequence?.update?.(editor.playback.currentFrame);
    }
    global.ZoidiumEditSignals?.touch("track-" + command.column);
  }

  function apply(button) {
    const target = targets.get(button);
    if (!drag || drag.editor.history.operation !== drag.operation || !target ||
        target.panel !== drag.panel || target.column !== drag.column ||
        isOn(target.track, target.column) === drag.value) return;
    exchange(drag.panel, drag.project, { address: target.track.getAddress(), column: target.column, value: drag.value });
  }

  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { clientX: x, clientY: y } = event;
    const from = drag.point;
    drag.point = { x, y };
    const steps = from && Number.isFinite(from.x + from.y + x + y)
      ? Math.max(1, Math.ceil(Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) / 8)) : 1;
    try {
      // Pointer events can span more than one row. Sample along the last
      // movement so skipped events do not skip a switch in the same column.
      for (let step = 1; step <= steps; step++) {
        const px = steps === 1 ? x : from.x + (x - from.x) * step / steps;
        const py = steps === 1 ? y : from.y + (y - from.y) * step / steps;
        apply(drag.document.elementFromPoint(px, py)?.closest?.(".zoidium-track-switch"));
      }
    } catch (error) { end(event); throw error; }
  }

  function end(event) {
    if (!drag || event.type !== "blur" && event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    current.document.removeEventListener("pointermove", move, true);
    current.document.removeEventListener("pointerup", end, true);
    current.document.removeEventListener("pointercancel", end, true);
    current.document.defaultView?.removeEventListener?.("blur", end);
    if (current.editor.history.operation === current.operation) current.editor.history.finishOperation();
  }

  function begin(event, target) {
    const editor = target.panel.timeline.editor;
    if (drag || event.button !== 0 || event.isPrimary === false || !editor?.project || editor.history.operation !== null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    drag = { ...target, editor, project: editor.project, document: event.currentTarget.ownerDocument,
      pointerId: event.pointerId, point: { x: event.clientX, y: event.clientY },
      value: !isOn(target.track, target.column) };
    editor.history.startOperation();
    drag.operation = editor.history.operation;
    drag.document.addEventListener("pointermove", move, true);
    drag.document.addEventListener("pointerup", end, true);
    drag.document.addEventListener("pointercancel", end, true);
    drag.document.defaultView?.addEventListener?.("blur", end);
    try { apply(event.currentTarget); }
    catch (error) { end(event); throw error; }
  }

  function addSwitch(button, panel, track, column) {
    const target = { panel, track, column };
    if (!controls.has(track)) controls.set(track, new Set());
    controls.get(track).add(new WeakRef(button));
    targets.set(button, target);
    button.classList.add("zoidium-track-switch", "zoidium-track-" + column);
    button.style.touchAction = "none";
    button.onpointerdown = event => begin(event, target);
    button.onclick = event => {
      event.stopPropagation();
      if (event.detail !== 0) return;
      const editor = panel.timeline.editor;
      if (!editor?.project || editor.history.operation !== null) return;
      editor.history.startOperation();
      try { exchange(panel, editor.project, { address: track.getAddress(), column, value: !isOn(track, column) }); }
      finally { editor.history.finishOperation(); }
    };
    refreshButton(track, column, button);
  }

  function createSwitch(document, column) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("actionbutton");
    button.style.cssText = "width:16px;height:16px;vertical-align:inherit";
    const ns = "http://www.w3.org/2000/svg";
    const icon = document.createElementNS(ns, "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.5");
    icon.style.cssText = "width:16px;height:16px;display:block";
    const symbol = document.createElementNS(ns, column === "solo" ? "circle" : "path");
    icon.appendChild(symbol);
    if (column === "solo") {
      symbol.setAttribute("cx", "8");
      symbol.setAttribute("cy", "8");
      symbol.setAttribute("r", "3");
    } else {
      const body = document.createElementNS(ns, "rect");
      body.setAttribute("x", "4");
      body.setAttribute("y", "7");
      body.setAttribute("width", "8");
      body.setAttribute("height", "6");
      body.setAttribute("rx", "1");
      icon.appendChild(body);
    }
    button.appendChild(icon);
    return button;
  }

  prototype.createTrackLabel = function (track, type) {
    const label = create.apply(this, arguments);
    const remove = label.lastElementChild;
    const eye = label.children[1];
    if (eye && eye !== remove) {
      if (type === 0) eye.classList.add("zoidium-video-track-visibility");
      addSwitch(eye, this, track, "visibility");
    }
    for (const column of ["solo", "lock"]) {
      const button = createSwitch(label.ownerDocument, column);
      label.insertBefore(button, remove);
      addSwitch(button, this, track, column);
    }
    label.style.gridTemplateColumns = ["1fr", ...Array(label.children.length - 1).fill("auto")].join(" ");
    const deleteTrack = remove.onclick;
    remove.onclick = function () {
      if (global.ZoidiumTrackSwitches?.canDeleteTrack?.(track) === false) return;
      return deleteTrack?.apply(this, arguments);
    };
    return label;
  };
})(window);
