"use strict";
// Build-time editor metadata only. Never change native types, values, keys,
// expressions, property order, or shader source in the imported pack.
function applyControls(preset, mapping = {}) {
  for (const [name, metadata] of Object.entries(mapping)) {
    const property = preset.customProperties?.find(p => p.properties?.name === name);
    if (!property || property.type.type !== 0 || !property.type.dynamic) throw new Error("AlipFX control must name a dynamic NUMBER: " + name);
    if (!["checkbox", "dropdown", "slider", "angle", "seed"].includes(metadata.kind)) throw new Error("Unsupported AlipFX control kind: " + metadata.kind);
    property.type.zoidiumShader = { ...metadata };
    if (metadata.kind !== "angle") property.type.zoidiumControl = "shader-plus/" + metadata.kind;
  }
  return preset;
}
module.exports = { applyControls };
