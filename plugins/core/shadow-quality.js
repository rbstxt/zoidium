(function installShadowQualityPatch(global) {
  "use strict";

  const PATCH_MARKER = "__zoidiumShadowQuality";

  // Three r91 stores spot/directional shadow depth in an RGBA color texture.
  // Hardware polygonOffset affects depth testing, not the gl_FragCoord.z value
  // packed into that texture. Apply the slope offset to the packed value too.
  // Keep the light's constant bias at zero so contact shadows stay attached.
  const DEPTH_POLYGON_OFFSET_FACTOR = 2;
  const DEPTH_POLYGON_OFFSET_UNITS = 2;

  function offsetPackedDepth(shader) {
    shader.fragmentShader = shader.fragmentShader.replace(
      "packDepthToRGBA( gl_FragCoord.z )",
      "packDepthToRGBA( min( 1.0 - 1.0 / 16777216.0, gl_FragCoord.z + " +
        DEPTH_POLYGON_OFFSET_FACTOR.toFixed(1) +
        " * max( abs( dFdx( gl_FragCoord.z ) ), abs( dFdy( gl_FragCoord.z ) ) ) + " +
        (DEPTH_POLYGON_OFFSET_UNITS / 16777216).toExponential(8) + " ) )"
    );
  }

  // Own values set through the accessor. A WeakMap keeps the storage private to
  // each mesh and lets meshes be collected without leaking the material.
  const ownDepthMaterials = new WeakMap();
  const sceneOwners = new WeakMap();

  // The native scene owns every mesh in each light's depth pass. Resolve its
  // mode through the live THREE ancestry so generated and reparented meshes
  // agree without per-mesh flags or stale material assignments.
  function installSceneMode(PZ) {
    const proto = PZ?.layer?.scene?.prototype;
    if (!proto?.load || !proto.toJSON || proto.__zoidiumShadowMode) return false;
    const load = proto.load, toJSON = proto.toJSON;
    proto.load = function (data) {
      this.zoidiumShadowMode = data?.zoidiumShadowMode === "legacy" ? "legacy" : "current";
      const result = load.apply(this, arguments);
      if (this.threeObj) sceneOwners.set(this.threeObj, this);
      return result;
    };
    proto.toJSON = function () {
      return { ...toJSON.apply(this, arguments), zoidiumShadowMode: this.zoidiumShadowMode || "current" };
    };
    proto.__zoidiumShadowMode = true;
    return true;
  }

  function legacyScene(mesh) {
    for (let node = mesh; node; node = node.parent) {
      const owner = sceneOwners.get(node);
      if (owner) return owner.zoidiumShadowMode === "legacy";
    }
    return false;
  }

  function createSharedDepthMaterial(THREE) {
    const material = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      polygonOffset: true,
      polygonOffsetFactor: DEPTH_POLYGON_OFFSET_FACTOR,
      polygonOffsetUnits: DEPTH_POLYGON_OFFSET_UNITS,
    });
    material.extensions = { ...material.extensions, derivatives: true };
    material.onBeforeCompile = offsetPackedDepth;
    return material;
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
        // Undefined selects Three r91's original depth material and packing,
        // exactly as before 17e05e6. Do not substitute another custom shader.
        if (legacyScene(this)) return undefined;
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
      offsetPackedDepth,
      install,
      installSceneMode,
    };
    return;
  }

  installSceneMode(global && global.PZ);
  install(global && global.THREE);
})(typeof window !== "undefined" ? window : null);
