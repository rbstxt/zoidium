(this.defaultName = "Drop Shadow"),
  (this.shaderUrl = "/assets/shaders/fragment/fx_boxblur.glsl"),
  (this.vertShader = this.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    "/assets/shaders/vertex/common.glsl"
  )),
  (this.fragShader = this.parentProject.assets.createFromPreset(
    PZ.asset.type.SHADER,
    this.shaderUrl
  )),
  (this.propertyDefinitions = {
    enabled: {
      dynamic: !0,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    color: {
      dynamic: !0,
      name: "Shadow Color",
      type: PZ.property.type.COLOR,
      value: [0, 0, 0],
    },
    opacity: {
      dynamic: !0,
      name: "Opacity",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      max: 1,
      min: 0,
      step: 0.01,
    },
    angle: {
      dynamic: !0,
      name: "Angle",
      type: PZ.property.type.NUMBER,
      value: 135,
      max: 360,
      min: 0,
      step: 1,
    },
    distance: {
      dynamic: !0,
      name: "Distance",
      type: PZ.property.type.NUMBER,
      value: 10,
      max: 200,
      min: 0,
      step: 1,
    },
    blur: {
      dynamic: !0,
      name: "Blur",
      type: PZ.property.type.NUMBER,
      value: 10,
      max: 50,
      min: 0,
      step: 0.5,
    },
  }),
  this.properties.addAll(this.propertyDefinitions, this),
  (this.load = async function (data) {
    this.vertShader = new PZ.asset.shader(this.parentProject.assets.load(this.vertShader));
    this.fragShader = new PZ.asset.shader(this.parentProject.assets.load(this.fragShader));

    const blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { type: "t", value: null },
        resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        delta: { type: "f", value: 1 },
      },
      vertexShader: await this.vertShader.getShader(),
      fragmentShader: await this.fragShader.getShader(),
      transparent: true,
      premultipliedAlpha: true,
    });

    const passVertexShader = [
      "varying vec2 vUv;",
      "void main() {",
      "  vUv = uv;",
      "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
      "}",
    ].join("\n");
    this.shadowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        shadowColor: { value: new THREE.Vector3(0, 0, 0) },
        shadowOpacity: { value: 0.5 },
        offset: { value: new THREE.Vector2(0, 0) },
        uvScale: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: passVertexShader,
      fragmentShader: [
        "precision highp float;",
        "uniform sampler2D tDiffuse;",
        "uniform vec3 shadowColor;",
        "uniform float shadowOpacity;",
        "uniform vec2 offset;",
        "uniform vec2 uvScale;",
        "varying vec2 vUv;",
        "void main() {",
        "  vec2 uv = vUv * uvScale - offset;",
        "  if (uv.x < 0.0 || uv.x > uvScale.x || uv.y < 0.0 || uv.y > uvScale.y) {",
        "    gl_FragColor = vec4(0.0);",
        "    return;",
        "  }",
        "  vec4 texel = texture2D(tDiffuse, uv);",
        "  float alpha = texel.a * shadowOpacity;",
        "  gl_FragColor = vec4(shadowColor * alpha, alpha);",
        "}",
      ].join("\n"),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
    });
    this.shadowPass = new THREE.ShaderPass(this.shadowMaterial);

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tOriginal: { value: null },
        tShadow: { value: null },
        uvScale: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: passVertexShader,
      fragmentShader: [
        "precision highp float;",
        "uniform sampler2D tOriginal;",
        "uniform sampler2D tShadow;",
        "uniform vec2 uvScale;",
        "varying vec2 vUv;",
        "void main() {",
        "  vec2 uv = vUv * uvScale;",
        "  vec4 original = texture2D(tOriginal, uv);",
        "  vec4 shadow = texture2D(tShadow, uv);",
        "  gl_FragColor = original + shadow * (1.0 - original.a);",
        "}",
      ].join("\n"),
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.compositePass = new THREE.ShaderPass(this.compositeMaterial);

    this.blurMaterial_h = blurMaterial;
    this.blurMaterial_v = blurMaterial.clone();
    this.blurMaterial_h.defines = { BLUR_DIR: 0 };
    this.blurMaterial_v.defines = { BLUR_DIR: 1 };
    this.blurMaterial_h.needsUpdate = true;
    this.blurMaterial_v.needsUpdate = true;
    const targetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    };
    this.shadowBuffer = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    this.blurBuffer = new THREE.WebGLRenderTarget(1, 1, targetOptions);
    this.blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blurScene = new THREE.Scene();
    this.blurQuad = new THREE.Mesh(
      new THREE.PlaneBufferGeometry(2, 2),
      this.blurMaterial_h
    );
    this.blurScene.add(this.blurQuad);

    this.pass = {
      enabled: true,
      uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
      needsSwap: true,
      clear: false,
      renderToScreen: false,
      render: (renderer, writeBuffer, readBuffer) => {
        const width = readBuffer.width;
        const height = readBuffer.height;
        if (this.shadowBuffer.width !== width || this.shadowBuffer.height !== height) {
          this.shadowBuffer.setSize(width, height);
          this.blurBuffer.setSize(width, height);
        }

        const color = this.cachedColor || [0, 0, 0];
        const opacity = this.cachedOpacity || 0.5;
        const angle = this.cachedAngle || 135;
        const distance = this.cachedDistance || 10;
        const blur = this.cachedBlur || 10;
        const resolution = this.cachedResolution || [width, height];
        const radians = (angle * Math.PI) / 180;
        const offsetX = (Math.cos(radians) * distance) / resolution[0];
        const offsetY = (Math.sin(radians) * distance) / resolution[1];

        renderer.setClearColor(0x000000, 0);
        renderer.clearTarget(this.shadowBuffer, true, true, true);
        renderer.clearTarget(this.blurBuffer, true, true, true);
        this.shadowPass.uniforms.tDiffuse.value = readBuffer.texture;
        this.shadowPass.uniforms.shadowColor.value.set(color[0], color[1], color[2]);
        this.shadowPass.uniforms.shadowOpacity.value = opacity;
        this.shadowPass.uniforms.offset.value.set(offsetX, -offsetY);
        this.shadowPass.uniforms.uvScale.value.copy(this.pass.uniforms.uvScale.value);
        this.shadowPass.render(renderer, this.shadowBuffer, readBuffer, true);

        if (blur > 0) {
          const blurDelta = blur / 10;
          this.blurMaterial_h.uniforms.delta.value = blurDelta;
          this.blurMaterial_v.uniforms.delta.value = blurDelta;
          this.blurMaterial_h.uniforms.resolution.value.set(resolution[0], resolution[1]);
          this.blurMaterial_v.uniforms.resolution.value.set(resolution[0], resolution[1]);
          this.blurMaterial_h.uniforms.uvScale.value.copy(this.pass.uniforms.uvScale.value);
          this.blurMaterial_v.uniforms.uvScale.value.copy(this.pass.uniforms.uvScale.value);
          for (let iteration = 0; iteration < 3; iteration += 1) {
            this.blurQuad.material = this.blurMaterial_h;
            this.blurMaterial_h.uniforms.tDiffuse.value = this.shadowBuffer.texture;
            renderer.render(this.blurScene, this.blurCamera, this.blurBuffer, true);
            this.blurQuad.material = this.blurMaterial_v;
            this.blurMaterial_v.uniforms.tDiffuse.value = this.blurBuffer.texture;
            renderer.render(this.blurScene, this.blurCamera, this.shadowBuffer, true);
          }
        }

        renderer.setClearColor(0x000000, 0);
        renderer.clearTarget(writeBuffer, true, true, true);
        this.compositePass.uniforms.tOriginal.value = readBuffer.texture;
        this.compositePass.uniforms.tShadow.value = this.shadowBuffer.texture;
        this.compositePass.uniforms.uvScale.value.copy(this.pass.uniforms.uvScale.value);
        this.compositePass.render(renderer, writeBuffer, null, false);
      },
    };
    this.properties.load(data && data.properties);
  }),
  (this.toJSON = function () {
    return { type: this.type, properties: this.properties };
  }),
  (this.unload = function () {
    this.parentProject.assets.unload(this.vertShader);
    this.parentProject.assets.unload(this.fragShader);
    if (this.shadowBuffer) this.shadowBuffer.dispose();
    if (this.blurBuffer) this.blurBuffer.dispose();
  }),
  (this.update = function (frame) {
    if (!this.pass) return;
    this.cachedColor = this.properties.color.get(frame);
    this.cachedOpacity = this.properties.opacity.get(frame);
    this.cachedAngle = this.properties.angle.get(frame);
    this.cachedDistance = this.properties.distance.get(frame);
    this.cachedBlur = this.properties.blur.get(frame);
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
  }),
  (this.resize = function () {
    if (this.parentLayer && this.parentLayer.properties) {
      this.cachedResolution = this.parentLayer.properties.resolution.get();
    }
  });
