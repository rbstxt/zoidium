// Stateless sequence depth compositing, following Davidium depth-passes.js.
// Targets contain only the current sample and are cleared before every draw.
parts.sharedDepth = function ({ PZ, THREE, teardown, patchMethod, masterAt, CameraLayer }) {
  const owned = new Map();
  const SceneDof = parts.dof.createSceneDofClass(THREE);
  function state(compositor) {
    let entry = owned.get(compositor);
    if (!entry) {
      const dof = new SceneDof();
      // The sequence depth texture stores linear distance / 5000, rather than
      // the packed perspective depth produced by an individual Scene.
      dof.material.fragmentShader = dof.material.fragmentShader.replace('unpackDepth( texture2D( tDepth, uv ) )', 'texture2D( tDepth, uv ).r');
      entry = { dof, depth: null, sceneDepth: null, material: null };
      owned.set(compositor, entry);
    }
    const target = compositor.readBuffer;
    if (!entry.depth || entry.depth.width !== target.width || entry.depth.height !== target.height) {
      entry.depth?.dispose(); entry.sceneDepth?.dispose();
      entry.depth = new THREE.WebGLRenderTarget(target.width, target.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat });
      entry.sceneDepth = entry.depth.clone();
    }
    return entry;
  }
  function dispose(compositor) {
    const entry = owned.get(compositor);
    if (!entry) return;
    entry.dof.unload(); entry.depth?.dispose(); entry.sceneDepth?.dispose(); entry.material?.dispose();
    owned.delete(compositor);
  }
  teardown.push(() => { for (const compositor of owned.keys()) dispose(compositor); });
  if (PZ.compositor.prototype.unload) {
    const unload = PZ.compositor.prototype.unload;
    patchMethod(PZ.compositor.prototype, 'unload', function () { dispose(this); return unload.apply(this, arguments); }, teardown);
  }
  const originalLayer = PZ.compositor.prototype.renderLayer;
  patchMethod(PZ.compositor.prototype, 'renderLayer', function (layer) {
    if (!this.__cameraPlusGlobalDof || layer instanceof CameraLayer) return originalLayer.apply(this, arguments);
    const entry = state(this);
    const previous = this.__cameraPlusDepthLayer;
    const dof = layer.pass?.__cameraPlusDof;
    const globalDof = layer.pass?.__cameraPlusGlobalDof;
    this.__cameraPlusDepthLayer = layer;
    if (layer.pass) { layer.pass.__cameraPlusDof = null; layer.pass.__cameraPlusGlobalDof = true; }
    entry.sceneReady = false;
    try {
      if (layer instanceof PZ.layer.scene && layer.pass?.camera) {
        const material = layer.threeObj.overrideMaterial;
        try {
          layer.threeObj.overrideMaterial = entry.dof.depthMaterial;
          entry.sceneDepth.viewport.copy(this.readBuffer.viewport);
          this.renderer.render(layer.threeObj, layer.pass.camera, entry.sceneDepth, true);
          entry.sceneReady = true;
        } finally { layer.threeObj.overrideMaterial = material; }
      }
      return originalLayer.apply(this, arguments);
    } finally {
      this.__cameraPlusDepthLayer = previous;
      if (layer.pass) { layer.pass.__cameraPlusDof = dof; layer.pass.__cameraPlusGlobalDof = globalDof; }
    }
  }, teardown);
  const originalComposite = PZ.compositor.prototype.compositeScene;
  patchMethod(PZ.compositor.prototype, 'compositeScene', function () {
    const layer = this.__cameraPlusDepthLayer;
    if (!this.__cameraPlusGlobalDof || !layer || layer instanceof PZ.layer.composite || layer instanceof PZ.layer.adjustment) return originalComposite.apply(this, arguments);
    const entry = state(this);
    const old = layer.composite.quad.material;
    if (!entry.material || entry.material.vertexShader !== old.vertexShader) {
      entry.material?.dispose();
      entry.material = new THREE.ShaderMaterial({ vertexShader: old.vertexShader, fragmentShader: `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uvScale;
        uniform float opacity;
        uniform float distance;
        uniform float useScene;
        uniform float near;
        uniform float far;
        uniform float orthographic;
        varying vec2 vUvScaled;
        float unpackDepth(vec4 rgba) { return dot(rgba, (255. / 256.) / vec4(16777216., 65536., 256., 1.)); }
        void main() {
          float depth = distance;
          if (useScene > .5) {
            float d = unpackDepth(texture2D(tDepth, vUvScaled));
            depth = orthographic > .5 ? mix(near, far, d) : near * far / max(far - (far - near) * d, .0001);
          }
          float alpha = texture2D(tColor, vUvScaled).a * opacity;
          gl_FragColor = vec4(vec3(clamp(depth / 5000., 0., 1.) * alpha), alpha);
        }`, uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uvScale: { value: new THREE.Vector2(1, 1) }, opacity: { value: 1 },
        distance: { value: 80 }, useScene: { value: 0 }, near: { value: .1 }, far: { value: 5000 }, orthographic: { value: 0 },
      }, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false });
    }
    const uniforms = entry.material.uniforms;
    const camera = layer.pass?.camera;
    const master = this.__cameraPlusGlobalDof.master;
    const world = new THREE.Vector3(); master.camera.threeObj.getWorldPosition(world);
    uniforms.tColor.value = this.readBuffer.texture;
    uniforms.tDepth.value = entry.sceneDepth.texture;
    uniforms.uvScale.value.copy(old.uniforms.uvScale.value);
    uniforms.opacity.value = old.uniforms.opacity.value;
    uniforms.distance.value = Math.max(0, world.z - (layer.properties.depth?.get(layer.__cameraPlusTime) || 0));
    uniforms.useScene.value = entry.sceneReady ? 1 : 0;
    uniforms.near.value = camera?.near || .1;
    uniforms.far.value = camera?.far || 5000;
    uniforms.orthographic.value = camera?.isOrthographicCamera ? 1 : 0;
    const background = this.scene.background;
    const autoClear = this.renderer.autoClear;
    try {
      layer.composite.quad.material = entry.material;
      this.scene.background = null;
      this.renderer.autoClear = false;
      this.renderer.render(this.scene, this.camera, entry.depth, false);
    } finally {
      layer.composite.quad.material = old;
      this.scene.background = background;
      this.renderer.autoClear = autoClear;
    }
    return originalComposite.apply(this, arguments);
  }, teardown);
  return {
    begin(compositor, frame) {
      const sequence = compositor._sequence;
      const master = masterAt(sequence, frame);
      const settings = master instanceof Object && master.layer instanceof CameraLayer ? master.camera.readDepthOfField?.(master.local) : null;
      if (!settings || settings.aperture <= 0) return;
      compositor.__cameraPlusGlobalDof = { master, settings };
      const entry = state(compositor);
      const color = compositor.renderer.getClearColor().clone(); const alpha = compositor.renderer.getClearAlpha();
      try { compositor.renderer.setClearColor(0, 0); compositor.renderer.clearTarget(entry.depth, true, true, true); }
      finally { compositor.renderer.setClearColor(color, alpha); }
    },
    finish(compositor, count) {
      if (!compositor.__cameraPlusGlobalDof) return false;
      const entry = state(compositor);
      const settings = compositor.__cameraPlusGlobalDof.settings;
      const target = compositor.screenBuffers[0];
      compositor.copyPass.uniforms.tDiffuse.value = compositor.accumBuffers[0].texture;
      compositor.copyPass.uniforms.opacity.value = 1 / count;
      compositor.copyPass.render(compositor.renderer, target, null, true);
      entry.dof.configure(Object.assign({}, settings, { orthographic: true, near: 0, far: 5000 }));
      const uniforms = entry.dof.material.uniforms;
      uniforms.tColor.value = target.texture; uniforms.tDepth.value = entry.depth.texture;
      uniforms.resolution.value.set(target.width, target.height); uniforms.uvScale.value.set(1, 1);
      compositor.renderer.render(entry.dof.scene, entry.dof.camera, null, true);
      return true;
    },
    end(compositor) { compositor.__cameraPlusGlobalDof = null; },
  };
};
