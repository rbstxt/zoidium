"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Native FX (filter): Radio Waves. Concentric waves are emitted from a
// Producer Point at Frequency waves per second and expand at Expansion px/s
// for Lifespan seconds. Every live wave is a closed-form function of time
// since its birth (radius = expansion * age, drifting centre, spun polygon
// orientation, width/fade envelopes), evaluated on the CPU for the current
// frame and passed to the shader as bounded uniform tables (newest 24 waves).
// The pixel shader only measures the analytic distance to each wave, so
// output depends on the frame alone: no particle history, no randomness.
// Polygon waves use Sides/Star/Star Depth; 64 sides without Star is a circle
// (as in the reference). Image Contours / Mask wave types, Parameters Are Set
// At Birth and Curve Size/Curveiness are not implemented: every wave uses the
// current frame's values (the reference default, Each Frame) and the polygon
// distance is the exact Euclidean outline distance rather than the
// reference's ray-projected distance (identical except within a pixel of
// polygon vertices).
var fxgenEffect = this;
var FXGenMath = null;
try {
  var fxgenRequire = ZoidiumPluginApis && ZoidiumPluginApis.modules && ZoidiumPluginApis.modules.createRequire;
  var fxgenGetAsset = fxgenEffect && fxgenEffect._zoidiumGetAsset;
  if (typeof fxgenRequire === "function" && typeof fxgenGetAsset === "function") {
    FXGenMath = fxgenRequire(fxgenGetAsset, { root: "./plugins/native-fx/" })("./effects/fxgen-math.js");
  }
} catch (_fxgenError) {
  FXGenMath = null;
}

var FXGEN_MAX_WAVES = 24;

function radiowavesNumber(property, frame, fallback) {
  try {
    const value = Number(property && property.get && property.get(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function radiowavesVector(property, frame, fallback) {
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

function radiowavesColor(property, frame, fallback) {
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

function radiowavesFps(effect, frame) {
  try {
    const seq = effect.parentProject && effect.parentProject.sequence;
    const rate = seq && seq.properties && seq.properties.rate && seq.properties.rate.get(frame);
    const fps = Number(rate);
    if (Number.isFinite(fps) && fps > 0) return Math.min(120, fps);
  } catch (_error) {
    // Fall through to the default below.
  }
  return 30;
}

function radiowavesPoint(name, fallback) {
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

ZoidiumPluginApis.defineFilter.call(this, {
  displayName: "Radio Waves",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_radiowaves.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    uWavesA: { type: "v4v", value: Array.from({ length: FXGEN_MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0.25)) },
    uWavesB: { type: "v4v", value: Array.from({ length: FXGEN_MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uWavesC: { type: "v4v", value: Array.from({ length: FXGEN_MAX_WAVES }, () => new THREE.Vector4(1, 1, 1, 1)) },
    uWavesD: { type: "v4v", value: Array.from({ length: FXGEN_MAX_WAVES }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uWaveCount: { type: "f", value: 0 },
    uProfile: { type: "f", value: 0 },
    uComposite: { type: "f", value: 1 },
  },
  properties: {
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    producerPoint: radiowavesPoint("Producer Point", [0.5, 0.5]),
    frequency: { dynamic: true, name: "Frequency (waves/sec)", type: PZ.property.type.NUMBER, value: 1, min: 0.01, max: 100, step: 0.05, decimals: 2 },
    expansion: { dynamic: true, name: "Expansion (px/sec)", type: PZ.property.type.NUMBER, value: 100, min: 0, max: 10000, step: 1, decimals: 1 },
    orientation: { dynamic: true, name: "Orientation", type: PZ.property.type.NUMBER, value: 0, min: -3600, max: 3600, step: 1, decimals: 1 },
    direction: { dynamic: true, name: "Direction", type: PZ.property.type.NUMBER, value: 90, min: -3600, max: 3600, step: 1, decimals: 1 },
    velocity: { dynamic: true, name: "Velocity (px/sec)", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 10000, step: 1, decimals: 1 },
    spin: { dynamic: true, name: "Spin (deg/sec)", type: PZ.property.type.NUMBER, value: 0, min: -3600, max: 3600, step: 1, decimals: 1 },
    lifespan: { dynamic: true, name: "Lifespan (sec)", type: PZ.property.type.NUMBER, value: 2, min: 0.01, max: 100, step: 0.05, decimals: 2 },
    reflection: { dynamic: true, name: "Reflection", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
    waveType: { dynamic: true, name: "Wave Type", type: PZ.property.type.OPTION, value: 0, items: "Polygon;Circle" },
    sides: { dynamic: true, name: "Sides", type: PZ.property.type.NUMBER, value: 64, min: 3, max: 64, step: 1, decimals: 0 },
    star: { dynamic: true, name: "Star", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
    starDepth: { dynamic: true, name: "Star Depth (inner radius)", type: PZ.property.type.NUMBER, value: -0.3, min: -1, max: 1, step: 0.01, decimals: 2 },
    profile: { dynamic: true, name: "Stroke Profile", type: PZ.property.type.OPTION, value: 0, items: "Square;Taper Front;Taper Back;Taper Both;Sine;Sawtooth Out;Sawtooth In" },
    color: { dynamic: true, name: "Stroke Color", type: PZ.property.type.COLOR, value: [1, 1, 1] },
    opacity: { dynamic: true, name: "Opacity", type: PZ.property.type.NUMBER, value: 100, min: 0, max: 100, step: 1, decimals: 1 },
    fadeIn: { dynamic: true, name: "Fade-in Time (sec)", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 100, step: 0.05, decimals: 2 },
    fadeOut: { dynamic: true, name: "Fade-out Time (sec)", type: PZ.property.type.NUMBER, value: 0, min: 0, max: 100, step: 0.05, decimals: 2 },
    startWidth: { dynamic: true, name: "Start Width (px)", type: PZ.property.type.NUMBER, value: 5, min: 0, max: 1000, step: 0.5, decimals: 1 },
    endWidth: { dynamic: true, name: "End Width (px)", type: PZ.property.type.NUMBER, value: 5, min: 0, max: 1000, step: 0.5, decimals: 1 },
    composite: { dynamic: true, name: "Composite on Original", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = radiowavesNumber(this.properties.enabled, frame, 1) === 1;
    const uniforms = this.pass.uniforms;
    if (!FXGenMath) {
      uniforms.uWaveCount.value = 0;
      return;
    }
    let res = [0, 0];
    try {
      const r = this.parentLayer && this.parentLayer.properties && this.parentLayer.properties.resolution.get(frame);
      if (Array.isArray(r) && r[0] > 0 && r[1] > 0) res = [Number(r[0]), Number(r[1])];
    } catch (_error) {
      // Keep the zero resolution: no waves are emitted this frame.
    }
    if (uniforms.resolution) uniforms.resolution.value.set(res[0] || 1, res[1] || 1);
    const fps = radiowavesFps(this, frame);
    const producer = radiowavesVector(this.properties.producerPoint, frame, [0.5, 0.5]);
    const waveType = radiowavesNumber(this.properties.waveType, frame, 0);
    const waves = FXGenMath.radioWaves({
      time: Number(frame) / fps,
      freq: radiowavesNumber(this.properties.frequency, frame, 1),
      lifespan: radiowavesNumber(this.properties.lifespan, frame, 2),
      producerX: producer[0],
      producerY: producer[1],
      bufW: res[0] || 1,
      bufH: res[1] || 1,
      expansion: radiowavesNumber(this.properties.expansion, frame, 100),
      orientationDeg: radiowavesNumber(this.properties.orientation, frame, 0),
      directionDeg: radiowavesNumber(this.properties.direction, frame, 90),
      velocity: radiowavesNumber(this.properties.velocity, frame, 0),
      spinDeg: radiowavesNumber(this.properties.spin, frame, 0),
      reflection: radiowavesNumber(this.properties.reflection, frame, 0) === 1,
      startWidth: radiowavesNumber(this.properties.startWidth, frame, 5),
      endWidth: radiowavesNumber(this.properties.endWidth, frame, 5),
      fadeIn: radiowavesNumber(this.properties.fadeIn, frame, 0),
      fadeOut: radiowavesNumber(this.properties.fadeOut, frame, 0),
      color: [...radiowavesColor(this.properties.color, frame, [1, 1, 1]), 1],
      opacity: radiowavesNumber(this.properties.opacity, frame, 100) / 100,
      sides: waveType === 1 ? 64 : radiowavesNumber(this.properties.sides, frame, 64),
      star: waveType === 0 && radiowavesNumber(this.properties.star, frame, 0) === 1,
      starDepth: radiowavesNumber(this.properties.starDepth, frame, -0.3),
      maxWaves: FXGEN_MAX_WAVES,
    });
    const count = Math.min(waves.length, FXGEN_MAX_WAVES);
    for (let i = 0; i < FXGEN_MAX_WAVES; i += 1) {
      const A = uniforms.uWavesA.value[i];
      const B = uniforms.uWavesB.value[i];
      const C = uniforms.uWavesC.value[i];
      const D = uniforms.uWavesD.value[i];
      if (i < count) {
        const wv = waves[i];
        A.set(wv.cx, wv.cy, wv.radius, wv.halfWidth);
        B.set(wv.rotation, wv.fade, wv.opacity, wv.sides);
        C.set(wv.r, wv.g, wv.b, wv.a);
        D.set(wv.starK, 0, 0, 0);
      } else {
        A.set(0, 0, 0, 0.25);
        B.set(0, 0, 0, 0);
        C.set(1, 1, 1, 1);
        D.set(0, 0, 0, 0);
      }
    }
    uniforms.uWaveCount.value = count;
    uniforms.uProfile.value = radiowavesNumber(this.properties.profile, frame, 0);
    uniforms.uComposite.value = radiowavesNumber(this.properties.composite, frame, 1) === 1 ? 1 : 0;
  },
});
