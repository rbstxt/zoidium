"use strict";

// CM3 presents a sequence only after drawing its layers into offscreen targets.
// A pending scene aborts that draw before the final canvas copy. The editing
// camera also updates its scene before touching the canvas.
function installPreviewHold(PZ, meshDeformer, editor) {
  const Type = PZ.ui?.viewport;
  const prototype = Type?.prototype;
  const pendingFrame = {};
  const badges = new Map();
  const patches = [];
  let viewport = null, disposed = false;

  function status(target, pending) {
    let badge = badges.get(target);
    if (!pending) { badge?.remove(); badges.delete(target); return; }
    if (badge) return;
    const canvas = target.renderer?.domElement || target.canvas;
    const document = canvas?.ownerDocument;
    if (!document) return;
    badge = document.createElement("div");
    badge.textContent = "Fracturing...";
    badge.setAttribute("role", "status");
    badge.setAttribute("aria-live", "polite");
    const rect = canvas.getBoundingClientRect();
    badge.style.cssText = "position:fixed;z-index:1000;pointer-events:none;padding:4px 8px;border-radius:4px;" +
      "background:rgba(20,24,32,.85);color:#eee;font:12px sans-serif;left:" + (rect.left + 12) +
      "px;top:" + (rect.top + 12) + "px";
    document.body.appendChild(badge);
    badges.set(target, badge);
  }

  function present(target, original, args) {
    // An instance wrapper can have captured our prototype wrapper. Only the
    // outermost guard owns the status and catches an incomplete presentation.
    if (disposed || viewport === target) return original.apply(target, args);
    const previousViewport = viewport, previousFrame = target.lastFrame;
    viewport = target;
    try {
      const result = original.apply(target, args);
      status(target, false);
      return result;
    } catch (error) {
      if (error !== pendingFrame) throw error;
      target.lastFrame = previousFrame;
      target.renderer?.setRenderTarget?.(null);
      status(target, true);
    } finally { viewport = previousViewport; }
  }

  function patch(target) {
    const original = target?._render;
    if (typeof original !== "function") return;
    const own = Object.hasOwn(target, "_render");
    const wrapped = function (...args) { return present(this, original, args); };
    target._render = wrapped;
    patches.push({ target, original, wrapped, own });
  }
  patch(prototype);
  const existing = new Set([editor?.mainViewport]);
  const document = editor?.mainViewport?.canvas?.ownerDocument;
  for (const canvas of document?.querySelectorAll?.("canvas") || []) {
    const panel = canvas.parentElement?.pz_panel;
    if (Type && panel instanceof Type) existing.add(panel);
  }
  // Motion Path and other plugins can already own an instance method that
  // captured _render before this plugin installed its prototype guard.
  for (const target of existing) if (target && Object.hasOwn(target, "_render")) patch(target);

  return {
    holdIfPending(meshes) {
      if (viewport && meshDeformer.pending(meshes).length) throw pendingFrame;
    },
    dispose() {
      disposed = true;
      for (const { target, original, wrapped, own } of patches.reverse()) if (target._render === wrapped) {
        if (own) target._render = original;
        else delete target._render;
      }
      for (const badge of badges.values()) badge.remove();
      badges.clear();
    },
  };
}

module.exports = { installPreviewHold };
