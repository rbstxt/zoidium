"use strict";
// Native property signals cover previews during a gesture. Project UI changes
// also cover completed operations, undo/redo, hierarchy edits and asset changes.
const SIGNALS = ["onChanged", "onListChanged", "onKeyframeCreated", "onKeyframeDeleted",
  "onKeyframeMoved", "onKeyframeChanged", "onExpressionChanged", "onAnimatedChanged"];
function createInvalidation(s) {
  const { window, document, editor, viewport } = s;
  const hooks = new Set(), removals = [];
  const dirty = () => s.requestDraw();
  function watch(signal, next) {
    if (signal?.watch && signal?.unwatch) next.add(signal);
  }
  function properties(owner, next, visited = new Set()) {
    if (!owner || typeof owner !== "object" || visited.has(owner)) return;
    visited.add(owner);
    for (const name of SIGNALS) watch(owner[name], next);
    const children = s.PZ?.propertyList && owner instanceof s.PZ.propertyList ? owner : owner.properties;
    for (const child of Object.values(children || {})) properties(child, next, visited);
    for (const child of owner.objects || []) properties(child, next, visited);
  }
  function sync(paths) {
    const next = new Set(), visited = new Set();
    for (const owner of [editor, viewport, viewport.widget2d, viewport.widget3d, viewport.helper3d]) {
      for (const name of ["onProjectChanged", "onSequenceChanged", "onEnabledChanged", "onObjectsChanged", "onEditChanged"])
        watch(owner?.[name], next);
      watch(owner?.objects?.onListChanged, next);
    }
    watch(editor.project?.ui?.onChanged, next);
    watch(viewport.options?.helper3dObjects?.onListChanged, next);
    properties(editor.sequence?.properties?.resolution, next);
    for (const path of paths) {
      properties(path.clip, next, visited);
      // Scene objects include the active camera and all possible camera parents.
      // Only observers are installed here; no property values are evaluated.
      for (let node = path.owner, depth = 0; node && depth < 64; node = node.parentObject, depth++)
        properties(node, next, visited);
    }
    for (const signal of hooks) if (!next.has(signal)) { signal.unwatch(dirty); hooks.delete(signal); }
    for (const signal of next) if (!hooks.has(signal)) { signal.watch(dirty); hooks.add(signal); }
  }
  function listen(target, name, fn, options) {
    target?.addEventListener(name, fn, options);
    removals.push(() => target?.removeEventListener(name, fn, options));
  }
  // UI controls such as Player+ and Shape+ also change plain host fields.
  // These events wake a stopped overlay after the native handler has run.
  for (const name of ["input", "change", "click", "keyup", "pointerup", "wheel"])
    listen(document, name, dirty, true);
  listen(document, "pointermove", event => { if (event.buttons) dirty(); }, true);
  listen(window, "resize", dirty);
  listen(window, "scroll", dirty, true);
  listen(viewport.controls, "change", dirty);
  const resize = window.ResizeObserver ? new window.ResizeObserver(dirty) : null;
  resize?.observe(viewport.el);
  resize?.observe(viewport.canvas);
  const children = window.MutationObserver ? new window.MutationObserver(dirty) : null;
  children?.observe(viewport.el, { childList: true });
  // CM3 has no observable playhead. Reuse its existing render callback to
  // wake paths entering a clip without running a second idle animation loop.
  let active = true, lastFrame;
  const hadOwnRender = Object.hasOwn(viewport, "_render"), original = viewport._render;
  function render() {
    const result = original.apply(this, arguments);
    const frame = editor.playback.currentFrame;
    if (active && frame !== lastFrame) {
      lastFrame = frame;
      if (!s.models.length) s.requestDraw();
    }
    return result;
  }
  if (typeof original === "function") viewport._render = render;
  return {
    sync,
    dispose() {
      active = false;
      if (viewport._render === render) {
        if (Object.hasOwn(viewport, "_render")) delete viewport._render;
        // A pre-existing instance override belongs to its installer.
        if (hadOwnRender) viewport._render = original;
      }
      for (const signal of hooks) signal.unwatch(dirty);
      hooks.clear();
      for (const remove of removals) remove();
      resize?.disconnect(); children?.disconnect();
    },
  };
}
module.exports = { createInvalidation };
