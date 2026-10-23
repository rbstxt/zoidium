"use strict";

function create(THREE, api, getAsset) {
  const root = "/plugins/native-fx/smart-motion-blur/";
  const passes = [],
    targets = [];
  let packed = null;
  const vertexShader = [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n");
  function text(name) {
    const value = getAsset("text", root + name + ".glsl");
    if (typeof value !== "string")
      throw new Error("[Zoidium] Missing Smart Motion Blur asset: " + name);
    return value;
  }
  function pass(name, values) {
    const uniforms = {
      uProject: { value: new THREE.Vector2(1, 1) },
      uLimit: { value: 256 },
    };
    for (const [key, value] of Object.entries(values)) {
      uniforms[key] = {
        value: Array.isArray(value) ? new THREE.Vector2(...value) : value,
      };
    }
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader: text("common") + "\n" + text(name),
      defines: packed ? { FLOW_PACKED: 1 } : {},
      precision: "highp",
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      premultipliedAlpha: true,
    });
    const result = new THREE.ShaderPass(material);
    passes.push(result);
    return result;
  }
  function target(width, height, field = false, nearest = field) {
    const result = api.createRenderTarget(THREE, width, height, {
      minFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
      magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type:
        field && packed === false
          ? THREE.HalfFloatType
          : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    targets.push(result);
    return result;
  }
  function selectStorage(renderer, forcePacked) {
    const gl = renderer.getContext();
    let half = false;
    if (
      !forcePacked &&
      renderer.extensions.get("OES_texture_half_float") &&
      renderer.extensions.get("OES_texture_half_float_linear")
    ) {
      const previous = renderer.getRenderTarget();
      const probe = api.createRenderTarget(THREE, 2, 2, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
      });
      try {
        renderer.setRenderTarget(probe);
        half =
          gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      } finally {
        renderer.setRenderTarget(previous);
        probe.dispose();
      }
    }
    packed = !half;
    for (const pass of passes) {
      pass.material.defines = packed ? { FLOW_PACKED: 1 } : {};
      pass.material.needsUpdate = true;
    }
    return packed ? "rgba8" : "half";
  }
  function draw(renderer, renderPass, output, values) {
    for (const [key, value] of Object.entries(values || {})) {
      if (Array.isArray(value)) renderPass.uniforms[key].value.set(...value);
      else renderPass.uniforms[key].value = value;
    }
    // All inputs are explicit uniforms. CM3's ShaderPass would try to assign
    // tDiffuse if readBuffer were non-null.
    renderPass.render(renderer, output, null, true);
  }
  function preserve(renderer, run) {
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    const color = renderer.getClearColor().clone();
    const alpha = renderer.getClearAlpha();
    try {
      renderer.autoClear = true;
      renderer.setClearColor(0, 0);
      return run();
    } finally {
      renderer.setClearColor(color, alpha);
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(previous);
    }
  }
  function clearTargets() {
    for (const target of targets) api.disposeTarget(target);
    targets.length = 0;
  }
  function dispose() {
    clearTargets();
    for (const pass of passes) api.disposePass(pass);
    passes.length = 0;
  }
  return {
    pass,
    target,
    draw,
    preserve,
    selectStorage,
    clearTargets,
    dispose,
    get packed() {
      return packed;
    },
  };
}
module.exports = { create };
