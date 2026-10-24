"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Native FX (filter): Timecode. Displays the layer/project time as timecode:
// SMPTE HH:MM:SS:FF at the project fps (with Drop Frame for nominal 30/60),
// raw Frames, Feet + Frames (35mm/16mm), or Seconds. Time Source selects which
// clock feeds the display; Layer Source and Composition both read the
// deterministic project clock available to effects (frame / project fps),
// Custom adds Starting Frame at Time Units per second. Glyphs, raster policy
// and determinism notes are shared with Numbers (see numbers.js): a tiny
// built-in single-stroke atlas rasterised analytically on the CPU, uploaded
// only when the string or layout changes.
var fxgenTimecodeEffect = this;
var FXGenTimecodeMath = null;
try {
  var fxgenTimecodeRequire = ZoidiumPluginApis && ZoidiumPluginApis.modules && ZoidiumPluginApis.modules.createRequire;
  var fxgenTimecodeGetAsset = fxgenTimecodeEffect && fxgenTimecodeEffect._zoidiumGetAsset;
  if (typeof fxgenTimecodeRequire === "function" && typeof fxgenTimecodeGetAsset === "function") {
    FXGenTimecodeMath = fxgenTimecodeRequire(fxgenTimecodeGetAsset, { root: "./plugins/native-fx/" })("./effects/fxgen-math.js");
  }
} catch (_fxgenError) {
  FXGenTimecodeMath = null;
}

function timecodeNumber(property, frame, fallback) {
  try {
    const value = Number(property && property.get && property.get(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function timecodeVector(property, frame, fallback) {
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

function timecodeColor(property, frame, fallback) {
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

function timecodeFps(effect, frame) {
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

function timecodeResolution(effect, frame) {
  try {
    const r = effect.parentLayer && effect.parentLayer.properties && effect.parentLayer.properties.resolution.get(frame);
    if (Array.isArray(r) && r[0] > 0 && r[1] > 0 && Number.isFinite(Number(r[0])) && Number.isFinite(Number(r[1]))) {
      return [Math.round(Number(r[0])), Math.round(Number(r[1]))];
    }
  } catch (_error) {
    // Fall through to the fallback below.
  }
  return [0, 0];
}

ZoidiumPluginApis.defineFilter.call(fxgenTimecodeEffect, {
  displayName: "Timecode",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_textfield.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    uText: { type: "t", value: null },
    uFill: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
    uStroke: { type: "v4", value: new THREE.Vector4(0, 0, 0, 0) },
    uDisplay: { type: "f", value: 0 },
    uComposite: { type: "f", value: 1 },
    uBoxRect: { type: "v4", value: new THREE.Vector4(0, 0, 0, 0) },
    uBoxColor: { type: "v4", value: new THREE.Vector4(0, 0, 0, 0) },
    uBoxOn: { type: "f", value: 0 },
  },
  properties: {
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    displayFormat: { dynamic: true, name: "Display Format", type: PZ.property.type.OPTION, value: 0, items: "SMPTE HH:MM:SS:FF;Frames;Feet + Frames (35mm);Feet + Frames (16mm)" },
    timeSource: { dynamic: true, name: "Time Source", type: PZ.property.type.OPTION, value: 0, items: "Layer Source;Composition;Custom" },
    timeUnits: { dynamic: true, name: "Time Units (fps)", type: PZ.property.type.NUMBER, value: 30, min: 1, max: 120, step: 1, decimals: 2 },
    dropFrame: { dynamic: true, name: "Drop Frame", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
    startingFrame: { dynamic: true, name: "Starting Frame", type: PZ.property.type.NUMBER, value: 0, min: -1000000, max: 1000000, step: 1, decimals: 0 },
    textPosition: {
      dynamic: true,
      group: true,
      name: "Text Position",
      type: PZ.property.type.VECTOR2,
      objects: [
        { dynamic: true, name: "Text Position.X", type: PZ.property.type.NUMBER, value: 0.5, step: 0.01, decimals: 3 },
        { dynamic: true, name: "Text Position.Y", type: PZ.property.type.NUMBER, value: 0.9, step: 0.01, decimals: 3 },
      ],
    },
    textSize: { dynamic: true, name: "Text Size (px)", type: PZ.property.type.NUMBER, value: 36, min: 0, max: 512, step: 1, decimals: 1 },
    textColor: { dynamic: true, name: "Text Color", type: PZ.property.type.COLOR, value: [1, 1, 1] },
    showBox: { dynamic: true, name: "Show Box", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    boxColor: { dynamic: true, name: "Box Color", type: PZ.property.type.COLOR, value: [0, 0, 0] },
    opacity: { dynamic: true, name: "Opacity", type: PZ.property.type.NUMBER, value: 100, min: 0, max: 100, step: 1, decimals: 1 },
    renderOnOriginal: { dynamic: true, name: "Composite on Original", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
  },
  onLoad(effect) {
    if (!FXGenTimecodeMath && typeof ZoidiumPluginApis !== "undefined" && ZoidiumPluginApis.modules &&
        typeof ZoidiumPluginApis.modules.createRequire === "function" && typeof effect._zoidiumGetAsset === "function") {
      try {
        FXGenTimecodeMath = ZoidiumPluginApis.modules.createRequire(effect._zoidiumGetAsset, { root: "./plugins/native-fx/" })("./effects/fxgen-math.js");
      } catch (_error) {
        FXGenTimecodeMath = null;
      }
    }
    try {
      effect._fxgenLayer = FXGenTimecodeMath ? FXGenTimecodeMath.createTextLayer(THREE) : null;
    } catch (_error) {
      effect._fxgenLayer = null;
    }
  },
  onUnload(effect) {
    try {
      if (effect._fxgenLayer) effect._fxgenLayer.dispose();
    } catch (_error) {
      // Disposal is best effort.
    }
    effect._fxgenLayer = null;
  },
  update(frame) {
    if (!this.pass) return;
    this.pass.enabled = timecodeNumber(this.properties.enabled, frame, 1) === 1;
    if (!this.pass.enabled) return;
    const uniforms = this.pass.uniforms;
    uniforms.uBoxOn.value = 0;
    if (!FXGenTimecodeMath || !this._fxgenLayer) return;
    const M = FXGenTimecodeMath;
    const res = timecodeResolution(this, frame);
    if (res[0] <= 0 || res[1] <= 0) return;
    if (uniforms.resolution) uniforms.resolution.value.set(res[0], res[1]);
    const fps = timecodeFps(this, frame);
    const timeSec = Number(frame) / fps;
    const text = M.timecodeText({
      displayFormat: Math.round(timecodeNumber(this.properties.displayFormat, frame, 0)),
      timeSource: Math.round(timecodeNumber(this.properties.timeSource, frame, 0)),
      timeUnits: timecodeNumber(this.properties.timeUnits, frame, 30),
      dropFrame: timecodeNumber(this.properties.dropFrame, frame, 0) === 1,
      startingFrame: timecodeNumber(this.properties.startingFrame, frame, 0),
      timeSec,
      fps,
    });
    const sizePx = Math.max(0.5, timecodeNumber(this.properties.textSize, frame, 36));
    const pos = timecodeVector(this.properties.textPosition, frame, [0.5, 0.9]);
    const opacity = timecodeNumber(this.properties.opacity, frame, 100) / 100;
    const showBox = timecodeNumber(this.properties.showBox, frame, 1) === 1;
    const key = [text, sizePx, pos[0], pos[1], res[0], res[1]].join("|");
    const wdt = M.lineWidth(text, sizePx, 0, false);
    if (this._fxgenLayer.key !== key) {
      const polys = M.layoutLine(text, pos[0] * res[0] - wdt * 0.5, pos[1] * res[1] + M.textUnit(sizePx) * 3, sizePx, 0, false);
      const cov = M.textCoverage(res[0], res[1], polys, M.textWeight(sizePx), 0);
      this._fxgenLayer.ensure(res[0], res[1], cov.fill, null, opacity);
      this._fxgenLayer.key = key;
    }
    const fill = timecodeColor(this.properties.textColor, frame, [1, 1, 1]);
    uniforms.uText.value = this._fxgenLayer.texture;
    uniforms.uFill.value.set(fill[0], fill[1], fill[2], 1);
    uniforms.uDisplay.value = 0;
    uniforms.uComposite.value = timecodeNumber(this.properties.renderOnOriginal, frame, 1) === 1 ? 1 : 0;
    if (showBox) {
      const box = timecodeColor(this.properties.boxColor, frame, [0, 0, 0]);
      const pad = sizePx * 0.25;
      uniforms.uBoxRect.value.set(pos[0] * res[0] - wdt * 0.5 - pad, pos[0] * res[0] + wdt * 0.5 + pad, pos[1] * res[1] - sizePx * 0.5, pos[1] * res[1] + sizePx * 0.5);
      uniforms.uBoxColor.value.set(box[0], box[1], box[2], opacity);
      uniforms.uBoxOn.value = 1;
    }
  },
});
