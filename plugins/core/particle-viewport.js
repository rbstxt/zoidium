(function (global) {
  "use strict";
  var PZ = global.PZ;
  var prototype = PZ && PZ.object3d && PZ.object3d.particles && PZ.object3d.particles.prototype;
  if (!prototype || prototype.__zoidiumParticleViewport) return;
  var load = prototype.load;
  prototype.load = function () {
    var result = load.apply(this, arguments);
    var points = this.threeObj;
    if (!points || points.__zoidiumParticleViewport) return result;
    var before = points.onBeforeRender;
    points.onBeforeRender = function (renderer) {
      if (before) before.apply(this, arguments);
      var value = this.material && this.material.uniforms && this.material.uniforms.resolution && this.material.uniforms.resolution.value;
      if (!value || !value.set) return;
      var target = renderer.getRenderTarget();
      var size = target ? (target.viewport || target) : renderer.getDrawingBufferSize();
      value.set(target && target.viewport ? size.z : size.width, target && target.viewport ? size.w : size.height);
    };
    points.__zoidiumParticleViewport = true;
    return result;
  };
  prototype.__zoidiumParticleViewport = true;
})(window);
