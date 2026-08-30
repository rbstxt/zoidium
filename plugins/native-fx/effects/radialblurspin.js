(this.defaultName = "Radial Blur (Spin)"),
  (this.shaderUrl = "/plugins/native-fx/shaders/fx_radialblurspin.glsl"),
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
    density: {
      dynamic: !0,
      name: "Angle",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      max: 2,
      min: -2,
      step: 0.05,
      decimals: 3,
    },
    dither: {
      dynamic: !0,
      name: "Dither",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      max: 1,
      min: 0,
      step: 0.05,
      decimals: 3,
    },
    decay: {
      dynamic: !0,
      name: "Decay",
      type: PZ.property.type.NUMBER,
      value: 0.9,
      max: 1,
      min: 0,
      step: 0.05,
      decimals: 3,
    },
    center: {
      dynamic: !0,
      group: !0,
      objects: [
        {
          dynamic: !0,
          name: "Center.X",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.05,
          decimals: 3,
        },
        {
          dynamic: !0,
          name: "Center.Y",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.05,
          decimals: 3,
        },
      ],
      name: "Center",
      type: PZ.property.type.VECTOR2,
    },
    overbright: {
      name: "Overbright",
      type: PZ.property.type.OPTION,
      value: 0,
      changed: function () {
        const effect = this.parentObject;
        if (!effect.pass) return;
        if (this.value === 0) effect.pass.material.defines.CONSTANT_BRIGHTNESS = 1;
        else delete effect.pass.material.defines.CONSTANT_BRIGHTNESS;
        effect.pass.material.needsUpdate = !0;
      },
      items: "off;on",
    },
    weight: {
      dynamic: !0,
      name: "Weight",
      type: PZ.property.type.NUMBER,
      value: 0.2,
      max: 1,
      min: 0,
      step: 0.05,
      decimals: 3,
    },
  }),
  this.properties.addAll(this.propertyDefinitions, this),
  (this.load = async function (data) {
    this.vertShader = new PZ.asset.shader(this.parentProject.assets.load(this.vertShader));
    const bundledFragmentShader = this._zoidiumGetAsset?.("text", this.shaderUrl);
    if (typeof bundledFragmentShader === "string") {
      this._zoidiumBundledFragShader = true;
      this.fragShader = { getShader: async () => bundledFragmentShader };
    } else {
      this._zoidiumBundledFragShader = false;
      this.fragShader = new PZ.asset.shader(this.parentProject.assets.load(this.fragShader));
    }
    const material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { type: "t", value: null },
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
        decay: { type: "f", value: 0.97 },
        density: { type: "f", value: 0.5 },
        dither: { type: "f", value: 1 },
        center: { type: "v2", value: new THREE.Vector2(0, 0) },
        weight: { type: "f", value: 1 },
      },
      vertexShader: await this.vertShader.getShader(),
      fragmentShader: await this.fragShader.getShader(),
    });
    material.premultipliedAlpha = !0;
    material.defines.DITHER = 1;
    material.defines.CONSTANT_BRIGHTNESS = 1;
    this.pass = new THREE.ShaderPass(material);
    this.properties.load(data && data.properties);
  }),
  (this.toJSON = function () {
    return { type: this.type, properties: this.properties };
  }),
  (this.unload = function () {
    this.parentProject.assets.unload(this.vertShader);
    if (!this._zoidiumBundledFragShader) this.parentProject.assets.unload(this.fragShader);
  }),
  (this.update = function (frame) {
    if (!this.pass) return;
    this.pass.enabled = this.properties.enabled.get(frame);
    this.pass.uniforms.decay.value = this.properties.decay.get(frame);
    this.pass.uniforms.density.value = this.properties.density.get(frame);
    this.pass.uniforms.dither.value = this.properties.dither.get(frame);
    this.pass.uniforms.weight.value = this.properties.weight.get(frame);
    const center = this.properties.center.get(frame);
    this.pass.uniforms.center.value.set(center[0], center[1]);
  }),
  (this.resize = function () {
    const resolution = this.parentLayer.properties.resolution.get();
    this.pass.uniforms.resolution.value.set(resolution[0], resolution[1]);
  });
