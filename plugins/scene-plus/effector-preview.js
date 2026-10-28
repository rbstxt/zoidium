"use strict";

// CM3 presents a sequence only after drawing its layers into offscreen targets.
// A pending scene aborts that draw before the final canvas copy. The editing
// camera also updates its scene before touching the canvas.
function installPreviewHold(PZ, meshDeformer) {
  const prototype = PZ.ui?.viewport?.prototype;
  const original = prototype?._render;
  const pendingFrame = {};
  const badges = new Map();
  let viewport = null;

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

  function draw(...args) {
    const previousViewport = viewport, previousFrame = this.lastFrame;
    viewport = this;
    try {
      const result = original.apply(this, args);
      status(this, false);
      return result;
    } catch (error) {
      if (error !== pendingFrame) throw error;
      this.lastFrame = previousFrame;
      this.renderer?.setRenderTarget?.(null);
      status(this, true);
    } finally { viewport = previousViewport; }
  }
  if (original) prototype._render = draw;

  return {
    holdIfPending(meshes) {
      if (viewport && meshDeformer.pending(meshes).length) throw pendingFrame;
    },
    dispose() {
      if (prototype?._render === draw) prototype._render = original;
      for (const badge of badges.values()) badge.remove();
      badges.clear();
    },
  };
}

module.exports = { installPreviewHold };
