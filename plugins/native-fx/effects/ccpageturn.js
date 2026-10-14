"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// CC Page Turn: analytic cylinder page curl of the layer in a single
// fragment shader (no simulation history; output depends only on the
// input, properties and layer size). Only the uniforms, properties and
// per-frame updates below are unique to this effect; loading, bundling
// and disposal come from ZoidiumPluginApis.defineFilter.
ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "CC Page Turn",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_ccpageturn.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    foldPos: { type: "v2", value: new THREE.Vector2(0.7, 0.7) },
    foldDir: { type: "f", value: 315 },
    foldRadius: { type: "f", value: 20 },
    lightDir: { type: "f", value: -45 },
    renderMode: { type: "f", value: 0 },
    backOpacity: { type: "f", value: 0.75 },
    paperColor: { type: "v3", value: new THREE.Vector3(1, 1, 1) },
    backSource: { type: "f", value: 0 },
  },
  properties: {
    enabled: {
      dynamic: true,
      name: "Enabled",
      type: PZ.property.type.OPTION,
      value: 1,
      items: "off;on",
    },
    foldPosition: {
      dynamic: true,
      group: true,
      objects: [
        {
          dynamic: true,
          name: "Fold Position.X",
          type: PZ.property.type.NUMBER,
          value: 0.7,
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 3,
        },
        {
          dynamic: true,
          name: "Fold Position.Y",
          type: PZ.property.type.NUMBER,
          value: 0.7,
          min: 0,
          max: 1,
          step: 0.01,
          decimals: 3,
        },
      ],
      name: "Fold Position",
      type: PZ.property.type.VECTOR2,
    },
    foldDirection: {
      dynamic: true,
      name: "Fold Direction",
      type: PZ.property.type.NUMBER,
      value: 315,
      max: 360,
      min: -360,
      step: 1,
      decimals: 1,
    },
    foldRadius: {
      dynamic: true,
      name: "Fold Radius",
      type: PZ.property.type.NUMBER,
      value: 20,
      max: 1000,
      min: 0,
      step: 1,
      decimals: 1,
    },
    lightDirection: {
      dynamic: true,
      name: "Light Direction",
      type: PZ.property.type.NUMBER,
      value: -45,
      max: 360,
      min: -360,
      step: 1,
      decimals: 1,
    },
    render: {
      dynamic: true,
      name: "Render",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Front & Back Page;Back Page;Front Page",
    },
    backSource: {
      dynamic: true,
      name: "Back Page",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Mirrored Layer;Paper Color",
    },
    backPageOpacity: {
      dynamic: true,
      name: "Back Opacity",
      type: PZ.property.type.NUMBER,
      value: 75,
      max: 100,
      min: 0,
      step: 1,
      decimals: 0,
    },
    paperColor: {
      dynamic: true,
      name: "Paper Color",
      type: PZ.property.type.COLOR,
      value: [1, 1, 1],
    },
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = this.properties.enabled.get(frame) === 1;
    var uniforms = this.pass.uniforms;
    var fold = this.properties.foldPosition.get(frame);
    uniforms.foldPos.value.set(Number(fold[0]) || 0, Number(fold[1]) || 0);
    uniforms.foldDir.value = Number(this.properties.foldDirection.get(frame)) || 0;
    uniforms.foldRadius.value = Math.max(0, Number(this.properties.foldRadius.get(frame)) || 0);
    uniforms.lightDir.value = Number(this.properties.lightDirection.get(frame)) || 0;
    uniforms.renderMode.value = Number(this.properties.render.get(frame)) || 0;
    uniforms.backSource.value = Number(this.properties.backSource.get(frame)) || 0;
    var opacity = Number(this.properties.backPageOpacity.get(frame));
    if (!Number.isFinite(opacity)) opacity = 75;
    uniforms.backOpacity.value = Math.min(1, Math.max(0, opacity / 100));
    var paper = this.properties.paperColor.get(frame);
    uniforms.paperColor.value.set(Number(paper[0]) || 0, Number(paper[1]) || 0, Number(paper[2]) || 0);
  },
});
