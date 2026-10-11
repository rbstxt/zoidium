// Zoidium shared WebGL helpers.
//
// Render-target creation, size tracking, and disposal shared by multipass
// effects and camera compositing. Targets are scratch only: callers clear
// before every draw and never read history across renders, keeping the
// deterministic rendering contract in docs/plugin-api.md. Every function
// takes THREE explicitly so the helpers stay testable in Node. Load order:
// before zoidium/plugin-apis.js (see postInitScripts in
// zoidium/runtime-config.js). plugin-apis.js exposes this table as
// ZoidiumPluginApis.gl.
(function (global) {
  "use strict";

  function defaultTargetOptions() {
    return {
      minFilter: null,
      magFilter: null,
      format: null,
      depthBuffer: false,
      stencilBuffer: false,
    };
  }

  // Creates a WebGLRenderTarget with exactly the given options: unspecified
  // entries fall through to the caller's THREE defaults, so each call site
  // keeps its original depth/stencil behavior. Mirrors the Echo target shape
  // in plugins/native-fx/effects/echo.js (which passes depthBuffer and
  // stencilBuffer explicitly).
  function createRenderTarget(THREE, width, height, options) {
    var settings = options || {};
    var merged = {};
    Object.keys(settings).forEach(function (key) {
      merged[key] = settings[key];
    });
    var target = new THREE.WebGLRenderTarget(width, height, merged);
    // Non-mipmap filters never generate mipmaps; pinning the flag keeps
    // pooled scratch targets free of mipmap uploads.
    if (target.texture) target.texture.generateMipmaps = false;
    return target;
  }

  // True when the target already covers width x height.
  function sameSize(target, width, height) {
    return !!target && target.width === width && target.height === height;
  }

  // Resizes the target in place when its size differs. Returns true when the
  // target was resized. Mirrors the Echo ensureTargets path in
  // plugins/native-fx/effects/echo.js.
  function ensureSize(target, width, height) {
    if (!target || sameSize(target, width, height)) return false;
    target.setSize(width, height);
    return true;
  }

  // Disposes one target (or pass material) without throwing on nulls or
  // foreign objects.
  function disposeTarget(target) {
    if (target && typeof target.dispose === "function") {
      try {
        target.dispose();
      } catch (_error) {
        // Disposal must never break effect unload.
      }
    }
  }

  function disposeAll(targets) {
    if (!targets) return;
    Object.keys(targets).forEach(function (key) {
      disposeTarget(targets[key]);
    });
  }

  // Creates a plain copy ShaderPass from THREE.CopyShader (no blending).
  // Mirrors the motion-blur pass factory in
  // plugins/camera-plus/scene-motion-blur.js; callers set blending after.
  function createCopyPass(THREE) {
    var material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(THREE.CopyShader.uniforms),
      vertexShader: THREE.CopyShader.vertexShader,
      fragmentShader: THREE.CopyShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    return new THREE.ShaderPass(material);
  }

  // Disposes a ShaderPass: its material and its fullscreen quad geometry.
  function disposePass(pass) {
    if (!pass) return;
    if (pass.material) disposeTarget(pass.material);
    if (pass.quad && pass.quad.geometry) disposeTarget(pass.quad.geometry);
  }

  global.ZoidiumSharedGl = {
    defaultTargetOptions: defaultTargetOptions,
    createRenderTarget: createRenderTarget,
    sameSize: sameSize,
    ensureSize: ensureSize,
    disposeTarget: disposeTarget,
    disposeAll: disposeAll,
    createCopyPass: createCopyPass,
    disposePass: disposePass,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
