(function installTrackLock(global) {
  "use strict";

  const PZ = global.PZ;
  const switches = global.ZoidiumTrackSwitches;
  if (!PZ?.ui || !switches) return;
  const { isLocked } = switches;
  const replaying = new WeakSet();

  function wrap(prototype, name, patch) {
    const original = prototype?.[name];
    if (typeof original === "function") prototype[name] = patch(original);
  }

  const history = PZ.ui.history?.prototype;
  for (const name of ["undo", "redo", "discardOperation"]) {
    wrap(history, name, original => function () {
      replaying.add(this);
      try { return original.apply(this, arguments); }
      finally { replaying.delete(this); }
    });
  }

  function guard(prototype, name, editorOf, blocked) {
    wrap(prototype, name, original => function (...args) {
      const editor = editorOf(this);
      if (!replaying.has(editor?.history) && blocked.call(this, ...args)) return false;
      return original.apply(this, args);
    });
  }

  function linkedLocked(clip) {
    return isLocked(clip) || clip?.link?.clips?.some(isLocked);
  }

  const tracks = PZ.ui.timeline?.tracks?.prototype;
  const timelineEditor = panel => panel.timeline?.editor;
  function timelineTrack(panel, command, index) {
    const sequence = panel.timeline.sequence;
    return (command.type === 0 ? sequence.videoTracks : sequence.audioTracks)?.[index];
  }

  guard(tracks, "moveClip", timelineEditor, function (command) {
    return isLocked(timelineTrack(this, command, command.oldTrackIdx)) ||
      isLocked(timelineTrack(this, command, command.newTrackIdx ?? command.oldTrackIdx));
  });
  guard(tracks, "createClip", timelineEditor, function (command) {
    return isLocked(timelineTrack(this, command, command.newTrackIdx));
  });
  for (const name of ["deleteClip", "unlinkBeforeDeletion"]) {
    guard(tracks, name, timelineEditor, function (command) {
      const track = timelineTrack(this, command, command.oldTrackIdx);
      return isLocked(track) || linkedLocked(track?.clips?.[command.oldIdx]);
    });
  }
  guard(tracks, "deleteTrack", timelineEditor, function (command) {
    const track = timelineTrack(this, command, command.oldTrackIdx);
    return isLocked(track) || track?.clips?.some(linkedLocked);
  });
  for (const name of ["linkClip", "unlinkClip"]) {
    guard(tracks, name, timelineEditor, function (command) {
      return linkedLocked(this.timeline.sequence.addressLookup(command.clip, 1));
    });
  }
  for (const name of ["deleteClips", "splitClips", "linkClips", "unlinkClips"]) {
    guard(tracks, name, timelineEditor, elements => Array.from(elements).some(el => linkedLocked(el.pz_object)));
  }

  // The host can trim or replace overlapping clips after moving proxies.
  // Reject the batch before its first write if any destination is locked.
  function blockedProxies(proxies) {
    return Array.from(proxies).some(proxy => isLocked(proxy.pz_clip?.pz_object) || isLocked(proxy.parentElement?.pz_object));
  }
  for (const name of ["moveClipProxies", "insertClipProxies"]) {
    guard(tracks, name, timelineEditor, blockedProxies);
  }
  wrap(tracks, "clipDragStart", original => function (event) {
    const clip = event.currentTarget;
    if (isLocked(clip.pz_object)) {
      if (!event.shiftKey) {
        this.ctx.deselectClips();
        this.ctx.deselectHandles();
      }
      clip.classList.add("selected");
      this.ctx.selectClips();
      this.ctx.el.focus();
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    if (!event.altKey && linkedLocked(clip.pz_object)) return false;
    if ((event.shiftKey || clip.classList.contains("selected")) &&
        Array.from(this.ctx.container.querySelectorAll(".clip.selected")).some(el => isLocked(el.pz_object))) return false;
    return original.apply(this, arguments);
  });
  guard(tracks, "handleDragStart", ctx => timelineEditor(ctx.ctx), function (event) {
    const handle = event.currentTarget;
    const clip = handle.parentElement.pz_object;
    if (isLocked(clip) || !event.altKey && linkedLocked(clip)) return true;
    return (event.shiftKey || handle.classList.contains("selected")) &&
      Array.from(this.ctx.container.querySelectorAll(".handle.selected")).some(el => isLocked(el.parentElement.pz_object));
  });
  guard(tracks, "clipContextMenu", timelineEditor, event => isLocked(event.currentTarget.pz_object));

  const keys = PZ.ui.timeline?.keyframes?.prototype;
  const keyProperty = el => el?.parentElement?.pz_object;
  guard(keys, "keyframeDragStart", ctx => timelineEditor(ctx.ctx), function (event) {
    const key = event.currentTarget;
    if (isLocked(keyProperty(key))) return true;
    return (event.shiftKey || key.classList.contains("selected")) &&
      Array.from(this.ctx.container.querySelectorAll(".kfobject.selected")).some(el => isLocked(keyProperty(el)));
  });

  const graph = PZ.ui.graph?.prototype;
  function graphProperty(element) {
    return element?.parentElement?.parentElement?.pz_object;
  }
  for (const name of ["keyframeDragStart", "handleDragStart"]) {
    guard(graph, name, ctx => ctx.ctx.editor, function (event) {
      return isLocked(graphProperty(event.currentTarget)) ||
        Array.from(this.ctx.svg.querySelectorAll(".selected")).some(element => isLocked(graphProperty(element)));
    });
  }

  const properties = PZ.ui.properties?.prototype;
  const editorOf = panel => panel.editor;
  function lookup(panel, address) {
    return panel.editor.project.addressLookup(address);
  }
  for (const name of ["setAnimated", "setValue", "setControlPoints", "setTween", "setContinuousTangent",
    "setExpression", "createKeyframe", "deleteKeyframe", "moveKeyframe"]) {
    guard(properties, name, editorOf, function (command) {
      return isLocked(lookup(this, command.property));
    });
  }
  for (const name of ["startEdit", "reset", "toggleAnimation", "toggleKeyframe", "pasteKeyframes", "finishMove"]) {
    guard(properties, name, editorOf, isLocked);
  }

  const edit = PZ.ui.edit?.prototype;
  guard(edit, "createObject", editorOf, function (command) {
    return isLocked(lookup(this, command.newParentAddress));
  });
  for (const name of ["deleteObject", "moveObject"]) {
    guard(edit, name, editorOf, function (command) {
      const oldParent = lookup(this, command.oldParentAddress);
      return isLocked(oldParent) || isLocked(oldParent?.[command.oldIdx]) ||
        (command.newParentAddress != null && isLocked(lookup(this, command.newParentAddress)));
    });
  }
  for (const name of ["itemDragStart", "renameClick"]) {
    guard(edit, name, panel => (panel.ctx || panel).editor, event => isLocked(event.currentTarget.pz_object));
  }
  guard(edit, "generateAdd", editorOf, isLocked);

  const widget2d = PZ.ui.widget2d?.prototype;
  for (const name of ["dragStart", "resizeDragStart"]) {
    guard(widget2d, name, ctx => ctx.ctx.editor, function () { return isLocked(this.ctx.position); });
  }
  function refreshWidget2d(widget) {
    if (!widget?.el) return;
    widget.el.style.display = widget.position && widget.edit && !isLocked(widget.position) ? "" : "none";
  }
  wrap(widget2d, "create", original => function () {
    const result = original.apply(this, arguments);
    this.onEditChanged?.watch(() => refreshWidget2d(this));
    return result;
  });
  for (const name of ["objectsChanged", "update"]) {
    wrap(widget2d, name, original => function () {
      const result = original.apply(this, arguments);
      refreshWidget2d(this);
      return result;
    });
  }

  const widget3d = PZ.ui.widget3d?.prototype;
  guard(widget3d, "dragStart", editorOf, function () { return isLocked(this.position || this.objects?.[0]); });
  for (const name of ["drag", "dragEnd"]) {
    wrap(widget3d, name, original => function () {
      if (this.dragging) return original.apply(this, arguments);
    });
  }
  const gizmoLock = new WeakMap();
  wrap(widget3d, "updateMode", original => function () {
    const locked = isLocked(this.position || this.objects?.[0]);
    gizmoLock.set(this, locked);
    if (!locked) return original.apply(this, arguments);
    const object = this.threeObj;
    this.threeObj = null;
    try { return original.apply(this, arguments); }
    finally { this.threeObj = object; }
  });
  wrap(widget3d, "update", original => function () {
    const locked = isLocked(this.position || this.objects?.[0]);
    if (gizmoLock.get(this) !== locked) this.updateMode();
    return original.apply(this, arguments);
  });

  const rows = new Set();
  const rowRefs = new WeakMap();
  const disabled = new WeakMap();
  function refreshPropertyRow(row) {
    const locked = isLocked(row.pz_object);
    if (locked) row.setAttribute("aria-readonly", "true");
    else row.removeAttribute("aria-readonly");
    for (const control of row.querySelectorAll("button:not(.collapse), input, select, textarea, [contenteditable], [tabindex]")) {
      if (control.classList.contains("collapse")) continue;
      if (locked && !disabled.has(control)) {
        disabled.set(control, [control.getAttribute("tabindex"), control.getAttribute("contenteditable"), control.disabled]);
        if (typeof control.disabled === "boolean") control.disabled = true;
        if (control.hasAttribute("contenteditable")) control.contentEditable = "false";
        control.tabIndex = -1;
      } else if (!locked && disabled.has(control)) {
        const [tabIndex, editable, wasDisabled] = disabled.get(control);
        if (tabIndex === null) control.removeAttribute("tabindex");
        else control.setAttribute("tabindex", tabIndex);
        if (editable !== null) control.setAttribute("contenteditable", editable);
        if (typeof wasDisabled === "boolean") control.disabled = wasDisabled;
        disabled.delete(control);
      }
    }
  }

  wrap(edit, "generateListItem", original => function () {
    const row = original.apply(this, arguments);
    const ref = new WeakRef(row);
    rowRefs.set(row, ref);
    rows.add(ref);
    if (isLocked(row.pz_object)) refreshPropertyRow(row);
    return row;
  });
  wrap(edit, "unloadListItem", original => function (row) {
    rows.delete(rowRefs.get(row));
    return original.apply(this, arguments);
  });
  wrap(edit, "create", original => function () {
    const result = original.apply(this, arguments);
    const block = event => {
      const target = event.target;
      const row = target.closest?.("li");
      if (!row || !isLocked(row.pz_object) || target.closest(".collapse")) return;
      if (!row.children[1]?.contains(target) &&
          !target.closest("button, input, select, textarea, [contenteditable], [tabindex]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const name of ["pointerdown", "mousedown", "touchstart", "keydown", "click", "input", "change", "drop", "paste"]) {
      this.list.addEventListener(name, block, { capture: true, passive: false });
    }
    return result;
  });
  wrap(PZ.ui.controls, "createControls", original => function (row) {
    const result = original.apply(this, arguments);
    if (isLocked(row.pz_object)) refreshPropertyRow(row);
    return result;
  });

  const viewports = new Set();
  wrap(PZ.ui.viewport?.prototype, "create", original => function () {
    viewports.add(new WeakRef(this));
    return original.apply(this, arguments);
  });
  switches.canDeleteTrack = track => !isLocked(track) && !track.clips?.some(linkedLocked);
  switches.refreshLock = function (editor) {
    for (const ref of rows) {
      const row = ref.deref();
      if (row?.isConnected) refreshPropertyRow(row);
      else rows.delete(ref);
    }
    for (const ref of viewports) {
      const viewport = ref.deref();
      if (!viewport) viewports.delete(ref);
      else if (viewport.editor === editor) {
        refreshWidget2d(viewport.widget2d);
        viewport.widget3d?.updateMode();
      }
    }
  };
})(window);
