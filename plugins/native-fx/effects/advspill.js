"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Advanced Spill Suppressor: removes key-colour spill (typically green) from
// foreground edges. Standard suppresses the excess of the key colour's
// dominant channel over the larger of the other two. Ultra additionally limits
// suppression to hues near the key colour (Tolerance), narrows the spill
// limit (Spill Range), and can put the removed light back as neutral
// brightness (Spill Color Correction, Luma Correction) or grey the pixel
// (Desaturate).
//
// The reference analyses the whole frame to pick the dominant channel in
// Standard mode; this port uses the dominant channel of the Key Color
// instead, which matches for green/blue screens and keeps the effect a
// deterministic single pass with no frame analysis.

function aspPrimary(color) {
  var r = color[0];
  var g = color[1];
  var b = color[2];
  if (g >= r && g >= b) return [1, 0, 2];
  if (b >= r && b >= g) return [2, 0, 1];
  return [0, 1, 2];
}

function aspHue(color) {
  var r = color[0];
  var g = color[1];
  var b = color[2];
  var mx = Math.max(r, Math.max(g, b));
  var mn = Math.min(r, Math.min(g, b));
  var d = mx - mn;
  if (d < 0.0000001) return 0;
  var h;
  if (mx === r) {
    h = (g - b) / d;
    if (g < b) h += 6;
    h /= 6;
  } else if (mx === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return h;
}

ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Advanced Spill Suppressor",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_advspill.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    keyPrimary: { type: "f", value: 1 },
    keyOther1: { type: "f", value: 0 },
    keyOther2: { type: "f", value: 2 },
    suppression: { type: "f", value: 1 },
    spillRange: { type: "f", value: 0 },
    lumaCorrection: { type: "f", value: 0 },
    tolerance: { type: "f", value: 1 },
    desaturate: { type: "f", value: 0 },
    neutral: { type: "f", value: 0 },
    keyHue: { type: "f", value: 1 / 3 },
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    method: {
      dynamic: true,
      name: "Method",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Standard;Ultra",
    },
    keyColor: {
      dynamic: true,
      name: "Key Color",
      type: PZ.property.type.COLOR,
      value: [0, 1, 0],
    },
    suppression: {
      dynamic: true,
      name: "Suppression",
      type: PZ.property.type.NUMBER,
      value: 100,
      min: 0,
      max: 200,
      step: 1,
      decimals: 0,
    },
    tolerance: {
      dynamic: true,
      name: "Tolerance",
      type: PZ.property.type.NUMBER,
      value: 50,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
    desaturate: {
      dynamic: true,
      name: "Desaturate",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
    spillRange: {
      dynamic: true,
      name: "Spill Range",
      type: PZ.property.type.NUMBER,
      value: 50,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
    spillColorCorrection: {
      dynamic: true,
      name: "Spill Color Correction",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
    lumaCorrection: {
      dynamic: true,
      name: "Luma Correction",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
  },
  update(frame) {
    if (!this.pass) return;
    var uniforms = this.pass.uniforms;
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
    var ultra = this.properties.method.get(frame) === 1;
    var key = this.properties.keyColor.get(frame);
    var order = aspPrimary(key);
    uniforms.keyPrimary.value = order[0];
    uniforms.keyOther1.value = order[1];
    uniforms.keyOther2.value = order[2];
    uniforms.keyHue.value = aspHue(key);
    uniforms.suppression.value = this.properties.suppression.get(frame) / 100;
    if (ultra) {
      uniforms.tolerance.value = this.properties.tolerance.get(frame) / 100;
      uniforms.desaturate.value = this.properties.desaturate.get(frame) / 100;
      uniforms.spillRange.value = this.properties.spillRange.get(frame) / 100;
      uniforms.neutral.value = this.properties.spillColorCorrection.get(frame) / 100;
      uniforms.lumaCorrection.value = this.properties.lumaCorrection.get(frame) / 100;
    } else {
      uniforms.tolerance.value = 1;
      uniforms.desaturate.value = 0;
      uniforms.spillRange.value = 0;
      uniforms.neutral.value = 0;
      uniforms.lumaCorrection.value = 0;
    }
  },
});
