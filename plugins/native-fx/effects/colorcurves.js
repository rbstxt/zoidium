"use strict";

(function (global, effect) {
  const CONTROL_ID = "native-fx/color-curves";
  const SHADER_URL = "/plugins/native-fx/shaders/fx_colorcurves.glsl";
  const STYLE_URL = "/plugins/native-fx/colorcurves.css";
  const STYLE_ID = "zoidium-color-curves-style";
  const curveRequire = global.ZoidiumPluginApis.modules.createRequire(effect._zoidiumGetAsset, { root: "./plugins/" });
  const { buildLut, createCurveControl, defaultValue } = curveRequire("./material-plus/graph-curves.js");
  const LUT_SIZE = 256;

  function installStyle(getAsset) {
    if (!global.document || global.document.getElementById(STYLE_ID)) return;
    const bundled = typeof getAsset === "function" ? getAsset("text", STYLE_URL) : null;
    if (typeof bundled === "string") {
      const style = global.document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = bundled + "\n" + getAsset("text", "/plugins/native-fx/curve-options.css");
      global.document.head.appendChild(style);
      return;
    }
    const link = global.document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = STYLE_URL;
    global.document.head.appendChild(link);
  }

  const ColorCurves = global.ZoidiumColorCurves || Object.freeze({
    buildLut,
    createCurveControl,
    defaultValue,
    install(getAsset) {
      installStyle(getAsset);
      global.ZoidiumPluginApis.propertyControls.register(CONTROL_ID, {
        type: global.PZ.property.type.TEXT,
        create: createCurveControl,
      });
    },
  });
  global.ZoidiumColorCurves = ColorCurves;
  ColorCurves.install(effect._zoidiumGetAsset);

  global.ZoidiumPluginApis.defineFilter.call(effect, {
    displayName: "Color Curves",
    fragShaderUrl: SHADER_URL,
    uniforms: {
      uvScale: { type: "v2", value: new global.THREE.Vector2(1, 1) },
      curveLUT: { type: "t", value: null },
    },
    properties: {
      enabled: {
        dynamic: true,
        name: "Enabled",
        type: global.PZ.property.type.OPTION,
        value: 1,
        items: "off;on",
      },
      curves: {
        name: "Curves",
        type: global.PZ.property.type.TEXT,
        value: ColorCurves.defaultValue,
        zoidiumControl: CONTROL_ID,
        changed() {
          if (this.parentObject) this.parentObject._zoidiumCurvesDirty = true;
        },
      },
    },
    onLoad(effect) {
      const texture = new global.THREE.DataTexture(
        ColorCurves.buildLut(effect.properties.curves.get()),
        LUT_SIZE,
        1,
        global.THREE.RGBAFormat,
        global.THREE.UnsignedByteType
      );
      texture.name = "Zoidium Color Curves LUT";
      texture.wrapS = global.THREE.ClampToEdgeWrapping;
      texture.wrapT = global.THREE.ClampToEdgeWrapping;
      texture.minFilter = global.THREE.LinearFilter;
      texture.magFilter = global.THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      effect._zoidiumCurveTexture = texture;
      effect._zoidiumCurveValue = null;
      effect._zoidiumCurvesDirty = true;
      effect.pass.uniforms.curveLUT.value = texture;
    },
    onUnload(effect) {
      effect._zoidiumCurveTexture?.dispose();
      effect._zoidiumCurveTexture = null;
    },
    update(frame, uniforms) {
      this.pass.enabled = this.properties.enabled.get(frame) === 1;
      const value = this.properties.curves.get();
      if (!this._zoidiumCurvesDirty && value === this._zoidiumCurveValue) return;
      this._zoidiumCurveTexture.image.data.set(ColorCurves.buildLut(value));
      this._zoidiumCurveTexture.needsUpdate = true;
      uniforms.curveLUT.value = this._zoidiumCurveTexture;
      this._zoidiumCurveValue = value;
      this._zoidiumCurvesDirty = false;
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this, this);
