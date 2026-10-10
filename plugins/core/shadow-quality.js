(function installShadowQualityPatch(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumShadowQuality";

  // Cause of the striped self-shadowing on lit CM3 geometry:
  //
  // 1. CM3 materials are DoubleSide (side 2). In three r91 the shadow pass maps
  //    DoubleSide to DoubleSide, so the lit front faces are rendered into the
  //    shadow map too. A surface then compares its depth against a map that
  //    contains its own front face, and the comparison flickers on the sub-texel
  //    scale: shadow acne. Effector fracture pieces are cloned as DoubleSide too,
  //    which is why Voronoi cells look striped everywhere.
  // 2. CM3 sets shadow.bias to 0, so nothing separates the surface from its own
  //    depth sample. A large constant bias hides the acne but detaches shadows
  //    (peter-panning), because CM3's shadow camera uses near 5 and far 1500 and
  //    the depth buffer is nonlinear over that range.
  //
  // The fix applied here is a slope-scaled offset in the shadow depth pass only.
  // three r91 uses object.customDepthMaterial for a mesh's depth pass when it is
  // set. Every Mesh gets one shared MeshDepthMaterial with polygonOffset enabled,
  // so depth values are pushed away from the light in proportion to the surface
  // slope. Lit faces stop self-shadowing without a constant bias that would move
  // the shadows. Point lights use customDistanceMaterial instead, which does not
  // receive this offset, so they are left unchanged.

  // Offset applied to the shadow depth pass. factor scales with the surface
  // slope relative to the light, units is a constant minimum offset.
  const DEPTH_POLYGON_OFFSET_FACTOR = 2;
  const DEPTH_POLYGON_OFFSET_UNITS = 2;

  // Own values set through the accessor. A WeakMap keeps the storage private to
  // each mesh and lets meshes be collected without leaking the material.
  const ownDepthMaterials = new WeakMap();

  function createSharedDepthMaterial(THREE) {
    return new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      polygonOffset: true,
      polygonOffsetFactor: DEPTH_POLYGON_OFFSET_FACTOR,
      polygonOffsetUnits: DEPTH_POLYGON_OFFSET_UNITS,
    });
  }

  // Installs the shared offset depth material as the default for every Mesh.
  // Returns false when THREE is missing, already patched, or cannot be patched.
  function install(THREE) {
    if (!THREE || !THREE.Mesh || !THREE.Mesh.prototype || !THREE.MeshDepthMaterial) return false;
    if (!THREE.RGBADepthPacking) return false;

    const proto = THREE.Mesh.prototype;
    if (proto[PATCH_MARKER]) return false;

    const existing = Object.getOwnPropertyDescriptor(proto, "customDepthMaterial");
    if (existing && !existing.configurable) return false;

    let sharedDepthMaterial = null;
    function getSharedDepthMaterial() {
      if (!sharedDepthMaterial) sharedDepthMaterial = createSharedDepthMaterial(THREE);
      return sharedDepthMaterial;
    }

    Object.defineProperty(proto, "customDepthMaterial", {
      configurable: true,
      enumerable: false,
      get: function getCustomDepthMaterial() {
        // A value set on this mesh always wins, including one copied from another mesh.
        if (ownDepthMaterials.has(this)) return ownDepthMaterials.get(this);
        return getSharedDepthMaterial();
      },
      set: function setCustomDepthMaterial(value) {
        // undefined and null mean "not set": the mesh goes back to the shared material.
        if (value === undefined || value === null) {
          ownDepthMaterials.delete(this);
        } else {
          ownDepthMaterials.set(this, value);
        }
      },
    });
    proto[PATCH_MARKER] = true;
    return true;
  }

  if (typeof module === "object" && module.exports) {
    module.exports = {
      PATCH_MARKER,
      DEPTH_POLYGON_OFFSET_FACTOR,
      DEPTH_POLYGON_OFFSET_UNITS,
      install,
    };
    return;
  }

  install(global && global.THREE);
})(typeof window !== "undefined" ? window : null);
