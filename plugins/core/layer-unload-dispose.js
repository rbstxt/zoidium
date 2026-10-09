(function (global) {
  "use strict";

  // CM3 layers create a composite quad (geometry and material) in their
  // constructor but never dispose it on unload, so every project reload or
  // deleted clip leaves GPU buffers behind. Release them after the original
  // unload. three.js re-uploads disposed resources if a layer is reused.
  //
  // CM3's built-in particles, shapes and text have the same gap.
  var PZ = global.PZ;
  if (!PZ) return;

  function disposeGeometry(mesh) {
    if (mesh && mesh.geometry && typeof mesh.geometry.dispose === "function") mesh.geometry.dispose();
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    disposeGeometry(mesh);
    if (mesh.material && typeof mesh.material.dispose === "function") mesh.material.dispose();
  }

  function wrapUnload(Type, getMesh, release) {
    release = release || disposeMesh;
    var prototype = Type && Type.prototype;
    var originalUnload = prototype && prototype.unload;
    if (typeof originalUnload !== "function" || originalUnload.__zoidiumDisposesMesh) return;
    var unload = function unloadAndDisposeMesh() {
      var result = originalUnload.apply(this, arguments);
      try {
        release(getMesh(this));
      } catch (error) {
        console.warn("[Zoidium] could not release GPU resources on unload:", error);
      }
      return result;
    };
    unload.__zoidiumDisposesMesh = true;
    prototype.unload = unload;
  }

  wrapUnload(PZ.layer, function (layer) {
    return layer && layer.composite && layer.composite.quad;
  });
  wrapUnload(PZ.object3d && PZ.object3d.particles, function (particles) {
    return particles && particles.threeObj;
  });
  // Shapes and text generate their geometry; their materials belong to a
  // separate PZ material object, so only the geometry is released here.
  function threeObj(object) {
    return object && object.threeObj;
  }
  wrapUnload(PZ.object3d && PZ.object3d.shape, threeObj, disposeGeometry);
  wrapUnload(PZ.object3d && PZ.object3d.text, threeObj, disposeGeometry);
})(window);
