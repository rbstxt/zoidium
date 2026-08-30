"use strict";

function readLayerInputDisplacementNumber(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function readLayerInputDisplacementVector(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    if (!Array.isArray(value) || value.length < fallback.length) return fallback;
    return fallback.map((defaultValue, index) => {
      const number = Number(value[index]);
      return Number.isFinite(number) ? number : defaultValue;
    });
  } catch (_error) {
    return fallback;
  }
}

function updateLayerInputDisplacementWrap(effect, frame) {
  if (!effect?.pass?.uniforms?.wrapMode) return;
  effect.pass.uniforms.wrapMode.value = readLayerInputDisplacementNumber(
    effect.properties.wrap,
    frame,
    2
  );
}

(this.defaultName = "Layer Input Displacement Map"),
  (this.__zoidiumLayerInputDisplacementEffect = true),
  (this.aspect = 16 / 9),
  (this.propertyDefinitions = {
    enabled: {
      dynamic: !0,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    source: {
      name: "Displacement Map Source",
      type: PZ.property.type.LIST,
      value: "",
      items: [{ name: "(No source)", value: "" }],
      _zoidiumLayerSource: true,
      changed: function () {
        const effect = this.parentObject;
        if (effect?._zoidiumLoading) return;
        PZ.layerInput?.setSource(effect, this.value || "");
      },
    },
    displacementOffset: {
      dynamic: !0,
      group: !0,
      objects: [
        {
          dynamic: !0,
          name: "Displacement offset.X",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.01,
          decimals: 3,
        },
        {
          dynamic: !0,
          name: "Displacement offset.Y",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.01,
          decimals: 3,
        },
      ],
      name: "Displacement offset",
      type: PZ.property.type.VECTOR2,
      step: 0.01,
      decimals: 3,
    },
    uDisplacement: {
      dynamic: !0,
      group: !0,
      objects: [
        {
          dynamic: !0,
          name: "X displacement.R",
          type: PZ.property.type.NUMBER,
          value: 1,
          min: -1,
          max: 1,
          decimals: 3,
        },
        {
          dynamic: !0,
          name: "X displacement.G",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1,
          max: 1,
          decimals: 3,
        },
        {
          dynamic: !0,
          name: "X displacement.B",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1,
          max: 1,
          decimals: 3,
        },
      ],
      name: "X displacement",
      type: PZ.property.type.VECTOR3,
    },
    vDisplacement: {
      dynamic: !0,
      group: !0,
      objects: [
        {
          dynamic: !0,
          name: "Y displacement.R",
          type: PZ.property.type.NUMBER,
          value: 1,
          min: -1,
          max: 1,
          decimals: 3,
        },
        {
          dynamic: !0,
          name: "Y displacement.G",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1,
          max: 1,
          decimals: 3,
        },
        {
          dynamic: !0,
          name: "Y displacement.B",
          type: PZ.property.type.NUMBER,
          value: 0,
          min: -1,
          max: 1,
          decimals: 3,
        },
      ],
      name: "Y displacement",
      type: PZ.property.type.VECTOR3,
    },
    amount: {
      dynamic: !0,
      name: "Amount",
      type: PZ.property.type.NUMBER,
      value: 0.1,
      step: 0.01,
      decimals: 3,
    },
    offset: {
      dynamic: !0,
      group: !0,
      objects: [
        {
          dynamic: !0,
          name: "Offset.X",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.05,
        },
        {
          dynamic: !0,
          name: "Offset.Y",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.05,
        },
      ],
      name: "Offset",
      type: PZ.property.type.VECTOR2,
    },
    scale: {
      dynamic: !0,
      group: !0,
      objects: [
        {
          dynamic: !0,
          name: "Scale.X",
          type: PZ.property.type.NUMBER,
          value: 1,
          min: 0.01,
          step: 0.05,
        },
        {
          dynamic: !0,
          name: "Scale.Y",
          type: PZ.property.type.NUMBER,
          value: 1,
          min: 0.01,
          step: 0.05,
        },
      ],
      name: "Scale",
      type: PZ.property.type.VECTOR2,
      linkRatio: !0,
    },
    rotation: {
      dynamic: !0,
      name: "Rotation",
      type: PZ.property.type.NUMBER,
      scaleFactor: Math.PI / 180,
      value: 0,
      step: 3,
      decimals: 1,
    },
    wrap: {
      name: "Wrap",
      items: ["clamp", "tile", "reflect"],
      value: 2,
      type: PZ.property.type.OPTION,
      changed: function () {
        updateLayerInputDisplacementWrap(this.parentObject, 0);
      },
    },
  }),
  this.properties.addAll(this.propertyDefinitions),
  (this.load = async function (data) {
    const effect = this;
    this._zoidiumLoading = true;
    this.aspect = 16 / 9;
    try {
      const bundledShader = this._zoidiumGetAsset?.(
        "text",
        "./plugins/layer-input/layer-input-displacement.glsl?v=3"
      );
      const response = typeof bundledShader === "string"
        ? null
        : await fetch("./plugins/layer-input/layer-input-displacement.glsl?v=3", {
            cache: "default",
          });
      if (response && !response.ok) {
        throw new Error(`HTTP ${response.status}: layer-input-displacement.glsl`);
      }
      const fragmentShader = typeof bundledShader === "string"
        ? bundledShader
        : await response.text();
      const emptySourceTexture = new THREE.DataTexture(
        new Uint8Array([0, 0, 0, 0]),
        1,
        1,
        THREE.RGBAFormat
      );
      emptySourceTexture.minFilter = THREE.LinearFilter;
      emptySourceTexture.magFilter = THREE.LinearFilter;
      emptySourceTexture.generateMipmaps = false;
      emptySourceTexture.needsUpdate = true;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { type: "t", value: null },
          tSource: { type: "t", value: emptySourceTexture },
          uDisplacement: { type: "v3", value: new THREE.Vector3(1, 0, 0) },
          vDisplacement: { type: "v3", value: new THREE.Vector3(1, 0, 0) },
          amount: { type: "f", value: 0.1 },
          uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
          offset: { type: "v2", value: new THREE.Vector2(0, 0) },
          uvTransform: { type: "m3", value: new THREE.Matrix3() },
          wrapMode: { type: "f", value: 2 },
          sourceReady: { type: "f", value: 0 },
        },
        vertexShader: [
          "uniform mat3 uvTransform;",
          "uniform vec2 uvScale;",
          "varying vec2 vUvScaled;",
          "varying vec2 bgCoord;",
          "void main() {",
          "  vUvScaled = (uvTransform * vec3(uv, 1.0)).xy;",
          "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
          "  bgCoord = (gl_Position.xy * 0.5 + 0.5) * uvScale;",
          "}",
        ].join("\n"),
        fragmentShader,
        premultipliedAlpha: true,
      });
      this.emptySourceTexture = emptySourceTexture;
      this.material = material;
      this.pass = new THREE.ShaderPass(material);
      this.pass.needsSwap = true;
      this.pass.render = function (renderer, writeBuffer, readBuffer, forceClear, delta, maskActive) {
        const source = PZ.layerInput?.resolveEffect(effect) || null;
        this.uniforms.tSource.value = source?.texture || emptySourceTexture;
        this.uniforms.sourceReady.value = source ? 1 : 0;
        return THREE.ShaderPass.prototype.render.call(
          this,
          renderer,
          writeBuffer,
          readBuffer,
          forceClear,
          delta,
          maskActive
        );
      };
      this.properties.load(data && data.properties);
      this.resize();
      this.update(0);
      PZ.layerInput?.registerConsumer(this);
    } finally {
      this._zoidiumLoading = false;
    }
  }),
  (this.toJSON = function () {
    return PZ.layerInput
      ? PZ.layerInput.serializeConsumer(this)
      : { type: this.type, properties: this.properties };
  }),
  (this.unload = function () {
    PZ.layerInput?.unregisterConsumer(this);
    this.material?.dispose?.();
    this.emptySourceTexture?.dispose?.();
    this.material = null;
    this.emptySourceTexture = null;
    this.pass = null;
  }),
  (this.update = function (frame) {
    const currentFrame = Number.isFinite(frame) ? frame : 0;
    if (!this.pass) return;
    const scale = readLayerInputDisplacementVector(this.properties.scale, currentFrame, [1, 1]);
    const scaleX = Math.abs(scale[0]) > 0.0001 ? scale[0] : 1;
    const scaleY = Math.abs(scale[1]) > 0.0001 ? scale[1] : 1;
    const aspect = Number.isFinite(this.aspect) && this.aspect > 0 ? this.aspect : 16 / 9;
    const aspectScaleX = aspect * scaleX;
    const displacementOffset = readLayerInputDisplacementVector(
      this.properties.displacementOffset,
      currentFrame,
      [0, 0]
    );
    const offset = readLayerInputDisplacementVector(this.properties.offset, currentFrame, [0, 0]);
    const rotation = readLayerInputDisplacementNumber(this.properties.rotation, currentFrame, 0);
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const inverseScaleX = 1 / scaleX;
    const inverseScaleY = 1 / scaleY;
    const transform = this.pass.uniforms.uvTransform.value;
    transform.set(
      inverseScaleX * cosine,
      inverseScaleY * sine * scaleY / (aspectScaleX || 1),
      -inverseScaleX * cosine * 0.5 -
        inverseScaleY * sine * scaleY / (aspectScaleX || 1) * 0.5 -
        offset[0] * cosine / (aspectScaleX || 1) -
        offset[1] * sine / (aspectScaleX || 1) +
        0.5,
      -inverseScaleX * sine * (aspectScaleX || 1) / scaleY,
      inverseScaleY * cosine,
      inverseScaleX * sine * (aspectScaleX || 1) / scaleY * 0.5 -
        inverseScaleY * cosine * 0.5 +
        offset[0] * sine / scaleY -
        offset[1] * cosine / scaleY +
        0.5,
      0,
      0,
      1
    );
    this.pass.uniforms.uDisplacement.value.set(
      ...readLayerInputDisplacementVector(this.properties.uDisplacement, currentFrame, [1, 0, 0])
    );
    this.pass.uniforms.vDisplacement.value.set(
      ...readLayerInputDisplacementVector(this.properties.vDisplacement, currentFrame, [1, 0, 0])
    );
    this.pass.uniforms.offset.value.set(displacementOffset[0], displacementOffset[1]);
    this.pass.uniforms.amount.value = readLayerInputDisplacementNumber(
      this.properties.amount,
      currentFrame,
      0.1
    );
    updateLayerInputDisplacementWrap(this, currentFrame);
    this.pass.enabled = readLayerInputDisplacementNumber(
      this.properties.enabled,
      currentFrame,
      1
    ) === 1;
  }),
  (this.resize = function () {
    try {
      const resolution = this.parentLayer?.properties?.resolution?.get?.();
      if (Array.isArray(resolution) && resolution[1]) this.aspect = resolution[0] / resolution[1];
    } catch (_error) {
      this.aspect = 16 / 9;
    }
  }),
  (this.prepare = async function () {});
