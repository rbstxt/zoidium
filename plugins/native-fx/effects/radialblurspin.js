"use strict";

// Native FX (filter): a single-pass spin blur built on the shared
// ZoidiumPluginApis.defineFilter helper (see zoidium/plugin-apis.js).
// Only the shader URL, uniforms, properties, and per-frame uniform updates
// below are unique to this effect; loading, bundling, and disposal come
// from the helper.
ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Radial Blur (Spin)",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_radialblurspin.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    decay: { type: "f", value: 0.97 },
    density: { type: "f", value: 0.5 },
    dither: { type: "f", value: 1 },
    center: { type: "v2", value: new THREE.Vector2(0, 0) },
    weight: { type: "f", value: 1 },
  },
  defines: {
    DITHER: 1,
    CONSTANT_BRIGHTNESS: 1,
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    density: {
      dynamic: true,
      name: "Angle",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      max: 2,
      min: -2,
      step: 0.05,
      decimals: 3,
    },
    dither: {
      dynamic: true,
      name: "Dither",
      type: PZ.property.type.NUMBER,
      value: 0.5,
      max: 1,
      min: 0,
      step: 0.05,
      decimals: 3,
    },
    decay: {
      dynamic: true,
      name: "Decay",
      type: PZ.property.type.NUMBER,
      value: 0.9,
      max: 1,
      min: 0,
      step: 0.05,
      decimals: 3,
    },
    center: {
      dynamic: true,
      group: true,
      objects: [
        {
          dynamic: true,
          name: "Center.X",
          type: PZ.property.type.NUMBER,
          value: 0,
          step: 0.05,
          decimals: 3,
        },
        {
          dynamic: true,
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
        effect.pass.material.needsUpdate = true;
      },
      items: "off;on",
    },
    weight: {
      dynamic: true,
      name: "Weight",
      type: PZ.property.type.NUMBER,
      value: 0.2,
      max: 1,
      min: 0,
      step: 0.05,
      decimals: 3,
    },
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = this.properties.enabled.get(frame);
    this.pass.uniforms.decay.value = this.properties.decay.get(frame);
    this.pass.uniforms.density.value = this.properties.density.get(frame);
    this.pass.uniforms.dither.value = this.properties.dither.get(frame);
    this.pass.uniforms.weight.value = this.properties.weight.get(frame);
    const center = this.properties.center.get(frame);
    this.pass.uniforms.center.value.set(center[0], center[1]);
  },
});
