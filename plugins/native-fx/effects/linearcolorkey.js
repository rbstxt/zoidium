"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Linear Color Key: keys pixels by their distance to the Key Color, measured
// in RGB, by hue, or by chroma (normalized RG). Tolerance sets the distance
// below which pixels are fully keyed out; Softness widens the falloff above
// it. Key Colors removes matching pixels; Keep Colors keeps only them.

ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Linear Color Key",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_linearcolorkey.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    keyColor: { type: "v3", value: new THREE.Vector3(0, 0, 1) },
    matchMode: { type: "f", value: 0 },
    tolerance: { type: "f", value: 0.1 },
    softness: { type: "f", value: 0.1 },
    keep: { type: "f", value: 0 },
    view: { type: "f", value: 0 },
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
      items: "Final Output;Source Only;Matte Only",
    },
    keyColor: {
      dynamic: true,
      name: "Key Color",
      type: PZ.property.type.COLOR,
      value: [0, 0, 1],
    },
    matchColors: {
      dynamic: true,
      name: "Match Colors",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Using RGB;Using Hue;Using Chroma",
    },
    tolerance: {
      dynamic: true,
      name: "Matching Tolerance",
      type: PZ.property.type.NUMBER,
      value: 10,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
    softness: {
      dynamic: true,
      name: "Matching Softness",
      type: PZ.property.type.NUMBER,
      value: 10,
      min: 0,
      max: 100,
      step: 1,
      decimals: 0,
    },
    keyOperation: {
      dynamic: true,
      name: "Key Operation",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Key Colors;Keep Colors",
    },
  },
  update(frame) {
    if (!this.pass) return;
    var uniforms = this.pass.uniforms;
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
    uniforms.view.value = this.properties.view.get(frame);
    uniforms.matchMode.value = this.properties.matchColors.get(frame);
    uniforms.tolerance.value = this.properties.tolerance.get(frame) / 100;
    uniforms.softness.value = this.properties.softness.get(frame) / 100;
    uniforms.keep.value = this.properties.keyOperation.get(frame) === 1 ? 1 : 0;
    var key = this.properties.keyColor.get(frame);
    uniforms.keyColor.value.set(key[0], key[1], key[2]);
  },
});
