"use strict";

function readLayerInputProperty(property, frame, fallback) {
  try {
    const value = property?.get?.(frame);
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch (_error) {
    return fallback;
  }
}

(this.defaultName = "Layer Input"),
  (this.__zoidiumLayerInputEffect = true),
  (this.propertyDefinitions = {
    enabled: {
      dynamic: !0,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    source: {
      name: "Source Layer",
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
    opacity: {
      dynamic: !0,
      name: "Source Opacity",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      max: 1,
      step: 0.1,
    },
  }),
  this.properties.addAll(this.propertyDefinitions),
  (this.load = async function (data) {
    this._zoidiumLoading = true;
    this.cachedOpacity = 1;
    const bundledShader = this._zoidiumGetAsset?.(
      "text",
      "./plugins/layer-input/layer-input.glsl?v=3"
    );
    const response = typeof bundledShader === "string"
      ? null
      : await fetch("./plugins/layer-input/layer-input.glsl?v=3", {
          cache: "default",
        });
    if (response && !response.ok) throw new Error(`HTTP ${response.status}: layer-input.glsl`);
    const fragmentShader = typeof bundledShader === "string"
      ? bundledShader
      : await response.text();
    const effect = this;
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
        uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
        sourceReady: { type: "f", value: 0 },
        sourceOpacity: { type: "f", value: 1 },
      },
      vertexShader: [
        "uniform vec2 uvScale;",
        "varying vec2 vUvScaled;",
        "void main() {",
        "  vUvScaled = uv * uvScale;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}",
      ].join("\n"),
      fragmentShader,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.emptySourceTexture = emptySourceTexture;
    this.material = material;
    this.pass = new THREE.ShaderPass(material);
    this.pass.needsSwap = true;
    this.pass.render = function (renderer, writeBuffer, readBuffer, forceClear, delta, maskActive) {
      const source = PZ.layerInput?.resolveEffect(effect) || null;
      this.uniforms.tSource.value = source?.texture || emptySourceTexture;
      this.uniforms.sourceReady.value = source ? 1 : 0;
      this.uniforms.sourceOpacity.value = effect.cachedOpacity;
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
    this._zoidiumLoading = false;
    PZ.layerInput?.registerConsumer(this);
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
    this._zoidiumLocalFrame = Number.isFinite(frame) ? frame : 0;
    this.cachedOpacity = readLayerInputProperty(
      this.properties.opacity,
      this._zoidiumLocalFrame,
      1
    );
    this.pass &&
      (this.pass.enabled =
        readLayerInputProperty(this.properties.enabled, this._zoidiumLocalFrame, 1) === 1);
  }),
  (this.resize = function () {}),
  (this.prepare = async function () {});
