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

  // CM3's Displacement Map unload() disposes its input texture uniform
  // whenever a map image is set, but that uniform stays null until the
  // effect first renders. Unloading a never-rendered effect (a deleted clip,
  // a reload, the idle preview prefetch graph) threw and skipped releasing
  // its shaders. Let the original run with a no-op stand-in for that null.
  var NO_TEXTURE = { dispose: function () {} };
  function guardDisplacementUnload(effect) {
    var unload = effect.unload;
    if (typeof unload !== "function" || unload.__zoidiumGuarded) return;
    effect.unload = function () {
      var input = this.pass && this.pass.uniforms && this.pass.uniforms.tDiffuse;
      var missing = Boolean(this.texture && input && input.value == null);
      if (missing) input.value = NO_TEXTURE;
      try {
        return unload.apply(this, arguments);
      } finally {
        if (missing && input.value === NO_TEXTURE) input.value = null;
      }
    };
    effect.unload.__zoidiumGuarded = true;
  }

  // CM3 caches each effect's source as a Promise of a constructor body in
  // PZ.effect.fnList and calls it on the new effect before load().
  function guardedEffectSource(source) {
    if (!source || typeof source.then !== "function" || source.__zoidiumGuarded) return source;
    var guarded = source.then(function (body) {
      return function () {
        var result = body.apply(this, arguments);
        guardDisplacementUnload(this);
        return result;
      };
    });
    guarded.__zoidiumGuarded = true;
    return guarded;
  }

  var fnList = PZ.effect && PZ.effect.fnList;
  var installed = fnList && Object.getOwnPropertyDescriptor(fnList, "displacementmap");
  if (fnList && !(installed && installed.get)) {
    var displacementSource = guardedEffectSource(fnList.displacementmap);
    Object.defineProperty(fnList, "displacementmap", {
      configurable: true,
      enumerable: true,
      get: function () { return displacementSource; },
      set: function (value) { displacementSource = guardedEffectSource(value); },
    });
  }
})(window);
