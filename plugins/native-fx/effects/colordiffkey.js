"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Color Difference Key: production green/blue-screen keyer. It splits the
// colour difference between the key colour's dominant channel and each of the
// two other channels into two partial mattes (A and B); their union is the
// matte. Each partial and the combined matte have their own levels controls,
// and the View property shows the final output or any intermediate matte.

function cdkPrimary(color) {
  var r = color[0];
  var g = color[1];
  var b = color[2];
  if (g >= r && g >= b) return [1, 0, 2];
  if (b >= r && b >= g) return [2, 0, 1];
  return [0, 1, 2];
}

function cdkLinearize(value) {
  var v = Math.min(1, Math.max(0, value));
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Color Difference Key",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_colordiffkey.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    keyColor: { type: "v3", value: new THREE.Vector3(0, 1, 0) },
    keyDiff1: { type: "f", value: 1 },
    keyDiff2: { type: "f", value: 1 },
    keyPrimary: { type: "f", value: 1 },
    keyOther1: { type: "f", value: 0 },
    keyOther2: { type: "f", value: 2 },
    accurate: { type: "f", value: 0 },
    view: { type: "f", value: 0 },
    partialA: { type: "v4", value: new THREE.Vector4(0, 255, 0, 255) },
    partialB: { type: "v4", value: new THREE.Vector4(0, 255, 0, 255) },
    partialAGamma: { type: "f", value: 1 },
    partialBGamma: { type: "f", value: 1 },
    matteLevels: { type: "v3", value: new THREE.Vector3(0, 255, 1) },
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    view: {
      dynamic: true,
      name: "View",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Final Output;Source Only;Corrected Matte;Uncorrected Matte;Corrected Partial A;Corrected Partial B",
    },
    keyColor: {
      dynamic: true,
      name: "Key Color",
      type: PZ.property.type.COLOR,
      value: [0, 1, 0],
    },
    colorMatchingAccuracy: {
      dynamic: true,
      name: "Color Matching Accuracy",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Faster;More Accurate",
    },
    partialAInBlack: {
      dynamic: true,
      name: "Partial A In Black",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialAInWhite: {
      dynamic: true,
      name: "Partial A In White",
      type: PZ.property.type.NUMBER,
      value: 255,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialAGamma: {
      dynamic: true,
      name: "Partial A Gamma",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0.01,
      max: 10,
      step: 0.05,
      decimals: 2,
    },
    partialAOutBlack: {
      dynamic: true,
      name: "Partial A Out Black",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialAOutWhite: {
      dynamic: true,
      name: "Partial A Out White",
      type: PZ.property.type.NUMBER,
      value: 255,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialBInBlack: {
      dynamic: true,
      name: "Partial B In Black",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialBInWhite: {
      dynamic: true,
      name: "Partial B In White",
      type: PZ.property.type.NUMBER,
      value: 255,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialBGamma: {
      dynamic: true,
      name: "Partial B Gamma",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0.01,
      max: 10,
      step: 0.05,
      decimals: 2,
    },
    partialBOutBlack: {
      dynamic: true,
      name: "Partial B Out Black",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    partialBOutWhite: {
      dynamic: true,
      name: "Partial B Out White",
      type: PZ.property.type.NUMBER,
      value: 255,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    blackLevel: {
      dynamic: true,
      name: "Matte In Black",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    whiteLevel: {
      dynamic: true,
      name: "Matte In White",
      type: PZ.property.type.NUMBER,
      value: 255,
      min: 0,
      max: 255,
      step: 1,
      decimals: 0,
    },
    gamma: {
      dynamic: true,
      name: "Matte Gamma",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0.01,
      max: 10,
      step: 0.05,
      decimals: 2,
    },
  },
  update(frame) {
    if (!this.pass) return;
    var uniforms = this.pass.uniforms;
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
    uniforms.view.value = this.properties.view.get(frame);
    var accurate = this.properties.colorMatchingAccuracy.get(frame) === 1;
    uniforms.accurate.value = accurate ? 1 : 0;
    var key = this.properties.keyColor.get(frame);
    var kr = key[0];
    var kg = key[1];
    var kb = key[2];
    if (accurate) {
      kr = cdkLinearize(kr);
      kg = cdkLinearize(kg);
      kb = cdkLinearize(kb);
    }
    var order = cdkPrimary([kr, kg, kb]);
    var pi = order[0];
    var o1 = order[1];
    var o2 = order[2];
    var comps = [kr, kg, kb];
    uniforms.keyPrimary.value = pi;
    uniforms.keyOther1.value = o1;
    uniforms.keyOther2.value = o2;
    uniforms.keyDiff1.value = Math.max(comps[pi] - comps[o1], 0.001);
    uniforms.keyDiff2.value = Math.max(comps[pi] - comps[o2], 0.001);
    uniforms.keyColor.value.set(key[0], key[1], key[2]);
    uniforms.partialA.value.set(
      this.properties.partialAInBlack.get(frame),
      this.properties.partialAInWhite.get(frame),
      this.properties.partialAOutBlack.get(frame),
      this.properties.partialAOutWhite.get(frame)
    );
    uniforms.partialAGamma.value = this.properties.partialAGamma.get(frame);
    uniforms.partialB.value.set(
      this.properties.partialBInBlack.get(frame),
      this.properties.partialBInWhite.get(frame),
      this.properties.partialBOutBlack.get(frame),
      this.properties.partialBOutWhite.get(frame)
    );
    uniforms.partialBGamma.value = this.properties.partialBGamma.get(frame);
    uniforms.matteLevels.value.set(
      this.properties.blackLevel.get(frame),
      this.properties.whiteLevel.get(frame),
      this.properties.gamma.get(frame)
    );
  },
});
