"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Key Cleaner: cleans a keyed matte's edges. Reduce Chatter smooths the alpha
// with a small spatial blur (no temporal history: fully deterministic),
// Additional Edge Radius decontaminates edge colours against a local average,
// Alpha Contrast steepens the matte, and Strength scales the decontamination.
// Both blurs use a bounded 5x5 kernel, so very large radii are approximated.

ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Key Cleaner",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_keycleaner.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    chatter: { type: "f", value: 0 },
    contrast: { type: "f", value: 1 },
    strength: { type: "f", value: 1 },
    estSigma: { type: "f", value: 1.5 },
    estStep: { type: "f", value: 1 },
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    additionalEdgeRadius: {
      dynamic: true,
      name: "Additional Edge Radius",
      type: PZ.property.type.NUMBER,
      value: 3,
      min: 0,
      max: 100,
      step: 0.1,
      decimals: 1,
    },
    reduceChatter: {
      dynamic: true,
      name: "Reduce Chatter",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "off;on",
    },
    alphaContrast: {
      dynamic: true,
      name: "Alpha Contrast",
      type: PZ.property.type.NUMBER,
      value: 100,
      min: 100,
      max: 500,
      step: 1,
      decimals: 0,
    },
    strength: {
      dynamic: true,
      name: "Strength",
      type: PZ.property.type.NUMBER,
      value: 100,
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
    uniforms.chatter.value = this.properties.reduceChatter.get(frame) === 1 ? 1 : 0;
    uniforms.contrast.value = this.properties.alphaContrast.get(frame) / 100;
    uniforms.strength.value = this.properties.strength.get(frame) / 100;
    var radius = Math.max(0, this.properties.additionalEdgeRadius.get(frame));
    var sigma = radius * 0.5;
    uniforms.estSigma.value = sigma;
    uniforms.estStep.value = Math.min(4, Math.max(1, sigma * 0.75));
  },
});
