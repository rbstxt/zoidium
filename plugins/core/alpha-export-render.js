(function (global) {
  "use strict";

  function withUnblendedCopy(compositor, noBlending, draw) {
    const material = compositor.copyPass.material;
    const blending = material.blending;
    material.blending = noBlending;
    try { return draw(); }
    finally { material.blending = blending; }
  }

  function drawTransparentSequence(compositor, noBlending, display, draw) {
    const { renderer } = compositor;
    const clear = compositor.clear;
    const ownClear = Object.hasOwn(compositor, "clear");
    const render = renderer.render;
    const color = renderer.getClearColor().clone();
    const alpha = renderer.getClearAlpha();
    let sequenceStarted = false;

    compositor.clear = function (index) {
      // The native and shared-camera compositors start each shutter sample here.
      if (index !== 0 || renderer.getClearAlpha() !== 1) return clear.apply(this, arguments);
      sequenceStarted = true;
      renderer.setClearColor(0, 0);
      try { return clear.apply(this, arguments); }
      finally { renderer.setClearColor(0, 1); }
    };
    renderer.render = function (scene, camera, target, forceClear) {
      if (!sequenceStarted || target !== null || forceClear !== true) return render.apply(this, arguments);
      return withUnblendedCopy(compositor, noBlending, () => display
        ? display(render, scene, camera, forceClear)
        : render.apply(this, arguments));
    };
    try {
      renderer.setClearColor(0, 0); // Seed the motion-blur accumulator.
      return draw();
    } finally {
      renderer.render = render;
      if (ownClear) compositor.clear = clear;
      else delete compositor.clear;
      renderer.setClearColor(color, alpha);
    }
  }

  function constructWithAlpha(THREE, enabled, construct) {
    if (!enabled) return construct();
    const Renderer = THREE.WebGLRenderer;
    const rgbaRenderers = new Proxy(Renderer, {
      construct(target, [options, ...args], newTarget) {
        // Only the native export renderer asks for a persistent drawing buffer.
        if (options?.preserveDrawingBuffer && !options.context) {
          options = { ...options, alpha: true, premultipliedAlpha: true };
          THREE.WebGLRenderer = Renderer;
        }
        return Reflect.construct(target, [options, ...args], newTarget);
      },
    });
    THREE.WebGLRenderer = rgbaRenderers;
    try { return construct(); }
    finally { THREE.WebGLRenderer = Renderer; }
  }

  function withPremultipliedInput(compositor, index, noBlending, draw) {
    const pass = compositor.copyPass;
    const render = pass.render;
    const owned = Object.hasOwn(pass, "render");
    pass.render = function (_renderer, target, source) {
      const premultiplied = target === compositor.readBuffer &&
        (source ? source === compositor.screenBuffers[index] : pass.uniforms.tDiffuse.value?.premultiplyAlpha);
      return premultiplied
        ? withUnblendedCopy(compositor, noBlending, () => render.apply(this, arguments))
        : render.apply(this, arguments);
    };
    try { return draw(); }
    finally {
      if (owned) pass.render = render;
      else delete pass.render;
    }
  }

  const alphaRenderers = new WeakSet();
  const api = { constructWithAlpha, drawTransparentSequence, withPremultipliedInput, alphaRenderers };

  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  const { PZ, THREE } = global;
  PZ.zoidium ||= {};
  PZ.zoidium.alphaExportRender = api;
  const prototype = PZ.compositor?.prototype;
  const renderLayer = prototype?.renderLayer;
  if (!renderLayer) return;
  prototype.renderLayer = function (_layer, index) {
    if (!alphaRenderers.has(this.renderer)) return renderLayer.apply(this, arguments);
    return withPremultipliedInput(this, index, THREE.NoBlending, () => renderLayer.apply(this, arguments));
  };
})(globalThis);
