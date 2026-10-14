"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Radial Shadow: a shadow of the layer cast away from a point light source
// (radial scale k = 1 + distance/100 about the light point), tinted with
// the shadow color, blurred with a small fixed kernel, and composited
// behind the original. A single fragment shader pass (no scratch targets;
// output depends only on the input, properties and layer size). Only the
// uniforms, properties and per-frame updates below are unique to this
// effect; loading, bundling and disposal come from
// ZoidiumPluginApis.defineFilter.
ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Radial Shadow",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_radialshadow.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    shadowColor: { type: "v3", value: new THREE.Vector3(0, 0, 0) },
    shadowAlpha: { type: "f", value: 0.5 },
    lightSource: { type: "v2", value: new THREE.Vector2(0.3, 0.2) },
    projectionDistance: { type: "f", value: 10 },
    colorInfluence: { type: "f", value: 0 },
    renderMode: { type: "f", value: 0 },
    softPx: { type: "f", value: 0 },
    shadowOnly: { type: "f", value: 0 },
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    color: {
      dynamic: true,
      name: "Shadow Color",
      type: PZ.property.type.COLOR,
      value: [0, 0, 0],
    },
    opacity: {
      dynamic: true,
      name: "Opacity",
      type: PZ.property.type.NUMBER,
      value: 50,
      max: 100,
      min: 0,
      step: 1,
      decimals: 0,
    },
    lightSource: {
      dynamic: true,
      group: true,
      objects: [
        {
          dynamic: true,
          name: "Light Source.X",
          type: PZ.property.type.NUMBER,
          value: 0.3,
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 3,
        },
        {
          dynamic: true,
          name: "Light Source.Y",
          type: PZ.property.type.NUMBER,
          value: 0.2,
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 3,
        },
      ],
      name: "Light Source",
      type: PZ.property.type.VECTOR2,
    },
    projectionDistance: {
      dynamic: true,
      name: "Projection Distance",
      type: PZ.property.type.NUMBER,
      value: 10,
      max: 1000,
      min: 0,
      step: 0.5,
      decimals: 1,
    },
    softness: {
      dynamic: true,
      name: "Softness",
      type: PZ.property.type.NUMBER,
      value: 0,
      max: 1000,
      min: 0,
      step: 0.5,
      decimals: 1,
    },
    render: {
      dynamic: true,
      name: "Render",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Regular;Glass Edge",
    },
    colorInfluence: {
      dynamic: true,
      name: "Color Influence",
      type: PZ.property.type.NUMBER,
      value: 0,
      max: 100,
      min: 0,
      step: 1,
      decimals: 0,
    },
    shadowOnly: {
      dynamic: true,
      name: "Shadow Only",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "off;on",
    },
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
    var uniforms = this.pass.uniforms;
    function num(value, fallback) {
      var n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    var color = this.properties.color.get(frame);
    uniforms.shadowColor.value.set(num(color[0], 0), num(color[1], 0), num(color[2], 0));
    var colorAlpha = color.length > 3 ? num(color[3], 1) : 1;
    var opacity = num(this.properties.opacity.get(frame), 50);
    uniforms.shadowAlpha.value = Math.min(1, Math.max(0, opacity / 100)) * colorAlpha;
    var light = this.properties.lightSource.get(frame);
    uniforms.lightSource.value.set(num(light[0], 0.3), num(light[1], 0.2));
    uniforms.projectionDistance.value = Math.max(0, num(this.properties.projectionDistance.get(frame), 10));
    var influence = num(this.properties.colorInfluence.get(frame), 0);
    uniforms.colorInfluence.value = Math.min(1, Math.max(0, influence / 100));
    uniforms.renderMode.value = num(this.properties.render.get(frame), 0);
    uniforms.softPx.value = Math.max(0, num(this.properties.softness.get(frame), 0));
    uniforms.shadowOnly.value = num(this.properties.shadowOnly.get(frame), 0);
  },
});
