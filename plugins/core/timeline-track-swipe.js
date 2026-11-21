(function installTrackVisibilitySwipe(global) {
  "use strict";
  const prototype = global.PZ?.ui?.timeline?.tracks?.prototype;
  if (!prototype?.createTrackLabel) return;
  const create = prototype.createTrackLabel;
  const controls = new WeakMap();
  const targets = new WeakMap();
  let drag = null;

  function refresh(track) {
    const button = controls.get(track);
    if (!button) return;
    const enabled = track.enabled !== false;
    button.title = enabled ? "Disable track" : "Enable track";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(enabled));
    if (button.firstElementChild) button.firstElementChild.style.fill = enabled ? "#ccc" : "#8a2828";
  }
  function exchange(editor, project, command) {
    if (editor.project !== project) return;
    const track = project.addressLookup(command.address);
    if (!track) return;
    const previous = track.enabled !== false;
    track.enabled = command.value;
    editor.history.pushCommand(next => exchange(editor, project, next), { address: command.address, value: previous });
    refresh(track);
    project.ui?.onChanged?.update?.();
    global.ZoidiumEditSignals?.touch("track-visibility");
  }
  function apply(button) {
    const target = targets.get(button);
    if (!drag || !target || target.panel !== drag.panel || target.track.enabled === drag.value) return;
    exchange(drag.editor, drag.project, { address: target.track.getAddress(), value: drag.value });
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    apply(drag.document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".zoidium-track-visibility"));
  }
  function end(event) {
    if (!drag || event.type !== "blur" && event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    current.document.removeEventListener("pointermove", move, true);
    current.document.removeEventListener("pointerup", end, true);
    current.document.removeEventListener("pointercancel", end, true);
    current.document.defaultView?.removeEventListener?.("blur", end);
    current.editor.history.finishOperation();
  }
  function begin(event, target) {
    const editor = target.panel.timeline.editor;
    if (drag || event.button !== 0 || !editor?.project || editor.history.operation !== null) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
    drag = { ...target, editor, project: editor.project, document: event.currentTarget.ownerDocument,
      pointerId: event.pointerId, value: target.track.enabled === false };
    editor.history.startOperation();
    apply(event.currentTarget);
    drag.document.addEventListener("pointermove", move, true);
    drag.document.addEventListener("pointerup", end, true);
    drag.document.addEventListener("pointercancel", end, true);
    drag.document.defaultView?.addEventListener?.("blur", end);
  }
  prototype.createTrackLabel = function (track, type) {
    const label = create.apply(this, arguments);
    if (type !== 0) return label;
    const button = label.children[1];
    if (!button) return label;
    const target = { panel: this, track };
    controls.set(track, button); targets.set(button, target);
    button.classList?.add("zoidium-track-visibility");
    button.style.touchAction = "none";
    button.onpointerdown = event => begin(event, target);
    button.onclick = event => {
      event.stopPropagation();
      if (event.detail !== 0) return;
      const editor = this.timeline.editor;
      if (!editor?.project || editor.history.operation !== null) return;
      editor.history.startOperation();
      try { exchange(editor, editor.project, { address: track.getAddress(), value: track.enabled === false }); }
      finally { editor.history.finishOperation(); }
    };
    refresh(track);
    return label;
  };
})(window);
