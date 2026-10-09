// Camera motion blur integrates fresh renders at fixed shutter offsets. No
// history of rendered frames is retained. Targets are reused only as scratch.
parts.motion = (function () {
  const MAX_SAMPLES = 8;

  function sampleOffsets(samples, shutter) {
    const count = Math.max(1, Math.min(MAX_SAMPLES, Math.round(Number(samples) || 1)));
    const width = Math.max(0, Math.min(2, Number(shutter) || 0));
    return Array.from({ length: count }, (_, i) => ((i + 0.5) / count - 0.5) * width);
  }

  function createSceneMotionBlurClass(THREE) {
    class SceneMotionBlur {
      constructor() {
        this.sampleTarget = null;
        this.accumTarget = null;
        const makePass = () => new THREE.ShaderPass(new THREE.ShaderMaterial({
          uniforms: THREE.UniformsUtils.clone(THREE.CopyShader.uniforms),
          vertexShader: THREE.CopyShader.vertexShader,
          fragmentShader: THREE.CopyShader.fragmentShader,
          depthTest: false,
          depthWrite: false,
        }));
        this.addPass = makePass();
        this.addPass.material.transparent = true;
        this.addPass.material.blending = THREE.CustomBlending;
        this.addPass.material.blendSrc = THREE.OneFactor;
        this.addPass.material.blendDst = THREE.OneFactor;
        this.addPass.material.blendEquation = THREE.AddEquation;
        this.copyPass = makePass();
      }
      setSize(target) {
        if (this.sampleTarget && this.sampleTarget.width === target.width && this.sampleTarget.height === target.height) return;
        if (this.sampleTarget) this.sampleTarget.dispose();
        if (this.accumTarget) this.accumTarget.dispose();
        this.sampleTarget = new THREE.WebGLRenderTarget(target.width, target.height, {
          format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          depthBuffer: true, stencilBuffer: false,
        });
        this.accumTarget = new THREE.WebGLRenderTarget(target.width, target.height, {
          format: THREE.RGBAFormat, type: THREE.FloatType,
          minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
          depthBuffer: false, stencilBuffer: false,
        });
      }
      render(renderer, target, time, settings, evaluate, draw, forceClear) {
        this.setSize(target);
        this.sampleTarget.viewport.copy(target.viewport);
        this.accumTarget.viewport.copy(target.viewport);
        const offsets = sampleOffsets(settings.samples, settings.shutter);
        const color = renderer.getClearColor().clone();
        const alpha = renderer.getClearAlpha();
        try {
          renderer.setClearColor(0, 0);
          renderer.clearTarget(this.accumTarget, true, false, false);
          this.addPass.uniforms.opacity.value = 1 / offsets.length;
          for (const offset of offsets) {
            evaluate(time + offset);
            draw(this.sampleTarget, true);
            // Sample targets have the same physical size as the accumulation
            // target, even when the layer uses a smaller viewport.
            this.addPass.uniforms.uvScale?.value?.set(1, 1);
            this.addPass.render(renderer, this.accumTarget, this.sampleTarget, false);
          }
          this.copyPass.uniforms.uvScale?.value?.set(1, 1);
          this.copyPass.render(renderer, target, this.accumTarget, forceClear);
        } finally {
          try {
            evaluate(time);
          } finally {
            renderer.setClearColor(color, alpha);
          }
        }
      }
      unload() {
        if (this.sampleTarget) this.sampleTarget.dispose();
        if (this.accumTarget) this.accumTarget.dispose();
        this.sampleTarget = this.accumTarget = null;
        for (const pass of [this.addPass, this.copyPass]) {
          pass.material.dispose();
          pass.quad.geometry.dispose();
        }
      }
    }
    return SceneMotionBlur;
  }
  return { MAX_SAMPLES, sampleOffsets, createSceneMotionBlurClass };
})();
