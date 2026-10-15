"use strict";

// Before 09b7c04, PBR+ left CM3's generated WorldUVGenerator coordinates
// untouched. Restore those original coordinates if a previous material used
// the shared layout on this geometry. This exception belongs only to saved PBR+.
function ensureMaterial(material, layout) {
  if (material.type !== "pbrplus" || material.zoidiumUvMode !== "legacy") {
    layout.ensureMaterial(material);
    return;
  }
  if (material.threeObj) delete material.threeObj.__zoidiumUvLayout;
  layout.releaseMaterial(material);
}

module.exports = { ensureMaterial };
