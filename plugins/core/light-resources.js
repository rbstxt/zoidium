(function installLightResourceCleanup(global) {
  "use strict";
  const prototype = global.PZ?.object3d?.light?.prototype;
  if (!prototype?.unload || prototype.__zoidiumLightResourceCleanup) return;
  const original = prototype.unload;
  prototype.unload = function unload() {
    const result = original.apply(this, arguments);
    // CM3 leaves the shadow render target allocated when it removes a light.
    // Undo loads a new light and renders its shadow again at the same quality.
    const shadow = this.threeObj?.shadow;
    if (shadow?.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
    return result;
  };
  prototype.__zoidiumLightResourceCleanup = true;
})(typeof window !== "undefined" ? window : globalThis);
