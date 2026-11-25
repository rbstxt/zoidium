(function installMaterialRenderSide(global) {
  "use strict";
  const PZ = global.PZ;
  const Material = PZ && PZ.material;
  if (!Material || !Material.prototype || Material.prototype.__zoidiumMaterialRenderSide) return;

  // Three.js side values for the option order below.
  const FRONT = 0;
  const BOTH = 2;
  // Native materials that render textured or unlit surfaces without a side
  // row. Image and Custom Material already have one, so they keep their own.
  // A video material is one-sided today; a single color material is
  // double-sided today. These defaults preserve every project saved before
  // the row existed.
  const DEFAULT_SIDE = { video: FRONT, singlecolor: BOTH };
  const nativeLoad = Material.prototype.load;

  function applyRenderSide(material) {
    const threeObj = material && material.threeObj;
    const side = material && material.properties && material.properties.side;
    if (!threeObj || !side) return;
    const value = Math.max(0, Math.min(2, Math.round(Number(side.get()) || 0)));
    threeObj.side = value;
    threeObj.needsUpdate = true;
  }

  // The row is attached before the native material module loads its saved
  // properties, so CM3 stores a saved value and an old project keeps the
  // type's default. The module's own properties do not contain "side", so its
  // later addAll cannot replace this row.
  function attachRenderSide(material) {
    if (!material || !material.properties || material.properties.side) return;
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SIDE, material.type)) return;
    material.properties.addAll({
      side: {
        name: "Render side",
        type: PZ.property.type.OPTION,
        value: DEFAULT_SIDE[material.type],
        items: "front;back;both",
        changed: function () {
          applyRenderSide(this.parentObject);
        },
      },
    });
  }

  Material.prototype.load = function loadWithRenderSide() {
    attachRenderSide(this);
    return nativeLoad.apply(this, arguments);
  };
  Material.prototype.__zoidiumMaterialRenderSide = true;
})(window);
