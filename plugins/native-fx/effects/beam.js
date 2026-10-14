"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Native FX (filter): Beam. A laser beam from Starting Point to Ending Point.
// Length (%) and Time (%) select the visible portion of the segment
// (t0 = time * (1 - length), t1 = t0 + length); thickness lerps from Starting
// to Ending Thickness; Softness blends Inside Color into Outside Color across
// the beam. With 3D Perspective on, thickness follows the beam's position
// between the two points; with it off, the visible head and tail take the
// starting and ending thickness. Deterministic closed form per pixel.
var fxgenBeamEffect = this;

function beamNumber(property, frame, fallback) {
  try {
    const value = Number(property && property.get && property.get(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function beamVector(property, frame, fallback) {
  try {
    const value = property && property.get && property.get(frame);
    if (Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      return [Number(value[0]), Number(value[1])];
    }
  } catch (_error) {
    // Fall through to the fallback below.
  }
  return fallback.slice();
}

function beamColor(property, frame, fallback) {
  try {
    const value = property && property.get && property.get(frame);
    if (Array.isArray(value) && value.length >= 3) {
      const r = Number(value[0]);
      const g = Number(value[1]);
      const b = Number(value[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
    }
  } catch (_error) {
    // Fall through to the fallback below.
  }
  return fallback.slice();
}

function beamPoint(name, fallback) {
  return {
    dynamic: true,
    group: true,
    name,
    type: PZ.property.type.VECTOR2,
    objects: [
      { dynamic: true, name: `${name}.X`, type: PZ.property.type.NUMBER, value: fallback[0], step: 0.01, decimals: 3 },
      { dynamic: true, name: `${name}.Y`, type: PZ.property.type.NUMBER, value: fallback[1], step: 0.01, decimals: 3 },
    ],
  };
}

ZoidiumPluginApis.defineFilter.call(fxgenBeamEffect, {
  displayName: "Beam",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_beam.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    uStart: { type: "v2", value: new THREE.Vector2(0.25, 0.5) },
    uEnd: { type: "v2", value: new THREE.Vector2(0.75, 0.5) },
    uWindow: { type: "v3", value: new THREE.Vector3(0, 0.25, 0.25) },
    uThick: { type: "v2", value: new THREE.Vector2(8, 8) },
    uSoft: { type: "f", value: 0.2 },
    uInside: { type: "v3", value: new THREE.Vector3(1, 1, 1) },
    uOutside: { type: "v3", value: new THREE.Vector3(0.4, 0.4, 1) },
    uPersp: { type: "f", value: 1 },
    uComposite: { type: "f", value: 1 },
  },
  properties: {
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    startPoint: beamPoint("Starting Point", [0.25, 0.5]),
    endPoint: beamPoint("Ending Point", [0.75, 0.5]),
    length: { dynamic: true, name: "Length (%)", type: PZ.property.type.NUMBER, value: 25, min: 0, max: 100, step: 1, decimals: 1 },
    time: { dynamic: true, name: "Time (%)", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 100, step: 1, decimals: 1 },
    startThickness: { dynamic: true, name: "Starting Thickness (px)", type: PZ.property.type.NUMBER, value: 8, min: 0, max: 1000, step: 0.5, decimals: 1 },
    endThickness: { dynamic: true, name: "Ending Thickness (px)", type: PZ.property.type.NUMBER, value: 8, min: 0, max: 1000, step: 0.5, decimals: 1 },
    softness: { dynamic: true, name: "Softness (%)", type: PZ.property.type.NUMBER, value: 20, min: 0, max: 100, step: 1, decimals: 1 },
    insideColor: { dynamic: true, name: "Inside Color", type: PZ.property.type.COLOR, value: [1, 1, 1] },
    outsideColor: { dynamic: true, name: "Outside Color", type: PZ.property.type.COLOR, value: [0.4, 0.4, 1] },
    perspective: { dynamic: true, name: "3D Perspective", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    composite: { dynamic: true, name: "Composite on Original", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = beamNumber(this.properties.enabled, frame, 1) === 1;
    const uniforms = this.pass.uniforms;
    const start = beamVector(this.properties.startPoint, frame, [0.25, 0.5]);
    const end = beamVector(this.properties.endPoint, frame, [0.75, 0.5]);
    const len = Math.min(1, Math.max(0, beamNumber(this.properties.length, frame, 25) / 100));
    const tm = Math.min(1, Math.max(0, beamNumber(this.properties.time, frame, 0) / 100));
    const t0 = tm * (1 - len);
    const inside = beamColor(this.properties.insideColor, frame, [1, 1, 1]);
    const outside = beamColor(this.properties.outsideColor, frame, [0.4, 0.4, 1]);
    uniforms.uStart.value.set(start[0], start[1]);
    uniforms.uEnd.value.set(end[0], end[1]);
    uniforms.uWindow.value.set(t0, t0 + len, len);
    uniforms.uThick.value.set(
      beamNumber(this.properties.startThickness, frame, 8),
      beamNumber(this.properties.endThickness, frame, 8),
    );
    uniforms.uSoft.value = Math.min(1, Math.max(0, beamNumber(this.properties.softness, frame, 20) / 100));
    uniforms.uInside.value.set(inside[0], inside[1], inside[2]);
    uniforms.uOutside.value.set(outside[0], outside[1], outside[2]);
    uniforms.uPersp.value = beamNumber(this.properties.perspective, frame, 1) === 1 ? 1 : 0;
    uniforms.uComposite.value = beamNumber(this.properties.composite, frame, 1) === 1 ? 1 : 0;
  },
});
