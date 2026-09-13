(function installCompositeVideoMaterialsPatch(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumCompositeVideoMaterialsPatch";
  const MAX_DEPTH = 64;

  // CM3 schedules video playback from PZ.schedule.updateSchedules, which only
  // reads clip.object.videoMaterials for the clip's own layer. PZ.layer.scene
  // owns that array; PZ.layer.composite holds child layers but has no
  // videoMaterials of its own, so a Video material on an object inside a Scene
  // nested in a Composite is registered on the inner Scene and never reaches
  // the scheduler. This patch aggregates descendant video materials onto the
  // composite so the existing scheduler finds them through the composite clip.

  function collectVideoMaterials(container, PZ, out, depth) {
    if (!container || depth > MAX_DEPTH) return out;
    const list = container.objects;
    if (!list) return out;

    for (let index = 0; index < list.length; index += 1) {
      const layer = list[index];
      if (!layer) continue;

      if (PZ && PZ.layer && PZ.layer.composite && layer instanceof PZ.layer.composite) {
        collectVideoMaterials(layer, PZ, out, depth + 1);
        continue;
      }

      const materials = layer.videoMaterials;
      if (!Array.isArray(materials)) continue;
      for (let material = 0; material < materials.length; material += 1) {
        if (materials[material]) out.push(materials[material]);
      }
    }

    return out;
  }

  function compositeVideoMaterials(composite, PZ) {
    return collectVideoMaterials(composite, PZ, [], 0);
  }

  function install(PZ) {
    const composite = PZ && PZ.layer && PZ.layer.composite;
    if (!composite || !composite.prototype) return false;
    if (composite.prototype[PATCH_MARKER]) return false;

    const existing = Object.getOwnPropertyDescriptor(composite.prototype, "videoMaterials");
    if (existing && !existing.configurable) return false;

    Object.defineProperty(composite.prototype, "videoMaterials", {
      configurable: true,
      enumerable: false,
      get: function getCompositeVideoMaterials() {
        return compositeVideoMaterials(this, PZ);
      },
    });
    composite.prototype[PATCH_MARKER] = true;
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      collectVideoMaterials,
      compositeVideoMaterials,
      install,
    };
    return;
  }

  install(global && global.PZ);
})(typeof window !== "undefined" ? window : null);
