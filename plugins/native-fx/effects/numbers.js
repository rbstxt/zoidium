"use strict";

// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Native FX (filter): Numbers. Draws a number from Value/Offset/Random Max:
// plain Number, Number with leading zeros, Timecode at 30/25/24 fps, Time
// (HH:MM:SS), Numerical/Short/Long Date, or Hexadecimal. Random Values hashes
// the frame index with Seed (deterministic per frame); Current Time/Date adds
// the deterministic layer/project time (frame / project fps), never the wall
// clock, so renders are identical on every machine and in any frame order.
// Glyphs come from a tiny built-in single-stroke atlas (original design)
// rasterised analytically on the CPU with the reference coverage formula and
// uploaded as a texture only when the string or layout changes; the shader
// only composites fill/stroke. Same bytes on every machine by construction.
var fxgenNumbersEffect = this;
var FXGenNumbersMath = null;
try {
  var fxgenNumbersRequire = ZoidiumPluginApis && ZoidiumPluginApis.modules && ZoidiumPluginApis.modules.createRequire;
  var fxgenNumbersGetAsset = fxgenNumbersEffect && fxgenNumbersEffect._zoidiumGetAsset;
  if (typeof fxgenNumbersRequire === "function" && typeof fxgenNumbersGetAsset === "function") {
    FXGenNumbersMath = fxgenNumbersRequire(fxgenNumbersGetAsset, { root: "./plugins/native-fx/" })("./effects/fxgen-math.js");
  }
} catch (_fxgenError) {
  FXGenNumbersMath = null;
}

function numbersNumber(property, frame, fallback) {
  try {
    const value = Number(property && property.get && property.get(frame));
    return Number.isFinite(value) ? value : fallback;
  } catch (_error) {
    return fallback;
  }
}

function numbersVector(property, frame, fallback) {
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

function numbersColor(property, frame, fallback) {
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

function numbersFps(effect, frame) {
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

function numbersResolution(effect, frame) {
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

ZoidiumPluginApis.defineFilter.call(fxgenNumbersEffect, {
  displayName: "Numbers",
  fragShaderUrl: "/plugins/native-fx/shaders/fx_textfield.glsl",
  uniforms: {
    uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
    resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
    uText: { type: "t", value: null },
    uFill: { type: "v4", value: new THREE.Vector4(1, 0, 0, 1) },
    uStroke: { type: "v4", value: new THREE.Vector4(1, 1, 1, 1) },
    uDisplay: { type: "f", value: 0 },
    uComposite: { type: "f", value: 1 },
    uBoxRect: { type: "v4", value: new THREE.Vector4(0, 0, 0, 0) },
    uBoxColor: { type: "v4", value: new THREE.Vector4(0, 0, 0, 0) },
    uBoxOn: { type: "f", value: 0 },
  },
  properties: {
    enabled: { dynamic: true, name: "Enabled", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    format: {
      dynamic: true,
      name: "Type",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "Number;Number (Leading Zeros);Timecode (30);Timecode (25);Timecode (24);Time;Numerical Date;Short Date;Long Date;Hexadecimal",
    },
    randomValues: { dynamic: true, name: "Random Values", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
    seed: { dynamic: true, name: "Seed", type: PZ.property.type.NUMBER, value: 1, min: 0, max: 100000, step: 1, decimals: 0 },
    value: { dynamic: true, name: "Value/Offset/Random Max", type: PZ.property.type.NUMBER, value: 0, min: -30000, max: 30000, step: 0.001, decimals: 3 },
    decimalPlaces: { dynamic: true, name: "Decimal Places", type: PZ.property.type.NUMBER, value: 2, min: 0, max: 10, step: 1, decimals: 0 },
    currentTime: { dynamic: true, name: "Current Time/Date", type: PZ.property.type.OPTION, value: 0, items: "off;on" },
    position: {
      dynamic: true,
      group: true,
      name: "Position",
      type: PZ.property.type.VECTOR2,
      objects: [
        { dynamic: true, name: "Position.X", type: PZ.property.type.NUMBER, value: 0.5, step: 0.01, decimals: 3 },
        { dynamic: true, name: "Position.Y", type: PZ.property.type.NUMBER, value: 0.5, step: 0.01, decimals: 3 },
      ],
    },
    displayOptions: { dynamic: true, name: "Display Options", type: PZ.property.type.OPTION, value: 0, items: "Fill Only;Stroke Only;Fill Over Stroke;Stroke Over Fill" },
    fillColor: { dynamic: true, name: "Fill Color", type: PZ.property.type.COLOR, value: [1, 0, 0] },
    strokeColor: { dynamic: true, name: "Stroke Color", type: PZ.property.type.COLOR, value: [1, 1, 1] },
    strokeWidth: { dynamic: true, name: "Stroke Width (px)", type: PZ.property.type.NUMBER, value: 2, min: 0, max: 50, step: 0.5, decimals: 1 },
    size: { dynamic: true, name: "Size (px)", type: PZ.property.type.NUMBER, value: 36, min: 0, max: 512, step: 1, decimals: 1 },
    tracking: { dynamic: true, name: "Tracking (px)", type: PZ.property.type.NUMBER, value: 0, min: -100, max: 100, step: 0.5, decimals: 1 },
    proportionalSpacing: { dynamic: true, name: "Proportional Spacing", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
    compositeOnOriginal: { dynamic: true, name: "Composite on Original", type: PZ.property.type.OPTION, value: 1, items: "off;on" },
  },
  onLoad(effect) {
    if (!FXGenNumbersMath && typeof ZoidiumPluginApis !== "undefined" && ZoidiumPluginApis.modules &&
        typeof ZoidiumPluginApis.modules.createRequire === "function" && typeof effect._zoidiumGetAsset === "function") {
      try {
        FXGenNumbersMath = ZoidiumPluginApis.modules.createRequire(effect._zoidiumGetAsset, { root: "./plugins/native-fx/" })("./effects/fxgen-math.js");
      } catch (_error) {
        FXGenNumbersMath = null;
      }
    }
    try {
      effect._fxgenLayer = FXGenNumbersMath ? FXGenNumbersMath.createTextLayer(THREE) : null;
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
    this.pass.enabled = numbersNumber(this.properties.enabled, frame, 1) === 1;
    const uniforms = this.pass.uniforms;
    uniforms.uBoxOn.value = 0;
    if (!FXGenNumbersMath || !this._fxgenLayer) return;
    const M = FXGenNumbersMath;
    const res = numbersResolution(this, frame);
    if (res[0] <= 0 || res[1] <= 0) return;
    if (uniforms.resolution) uniforms.resolution.value.set(res[0], res[1]);
    const fps = numbersFps(this, frame);
    const timeSec = Number(frame) / fps;
    const text = M.numbersText({
      type: Math.round(numbersNumber(this.properties.format, frame, 0)),
      value: numbersNumber(this.properties.value, frame, 0),
      decimalPlaces: numbersNumber(this.properties.decimalPlaces, frame, 2),
      randomValues: numbersNumber(this.properties.randomValues, frame, 0) === 1,
      currentTime: numbersNumber(this.properties.currentTime, frame, 0) === 1,
      seed: Math.round(numbersNumber(this.properties.seed, frame, 1)),
      timeSec,
      fps,
    });
    const sizePx = Math.max(0.5, numbersNumber(this.properties.size, frame, 36));
    const trackingPx = numbersNumber(this.properties.tracking, frame, 0);
    const proportional = numbersNumber(this.properties.proportionalSpacing, frame, 1) === 1;
    const pos = numbersVector(this.properties.position, frame, [0.5, 0.5]);
    const strokeWPx = Math.max(0, numbersNumber(this.properties.strokeWidth, frame, 2));
    const display = Math.min(3, Math.max(0, Math.round(numbersNumber(this.properties.displayOptions, frame, 0))));
    const key = [text, sizePx, trackingPx, proportional, pos[0], pos[1], strokeWPx, res[0], res[1]].join("|");
    if (this._fxgenLayer.key !== key) {
      const wdt = M.lineWidth(text, sizePx, trackingPx, proportional);
      const polys = M.layoutLine(text, pos[0] * res[0] - wdt * 0.5, pos[1] * res[1] + M.textUnit(sizePx) * 3, sizePx, trackingPx, proportional);
      const cov = M.textCoverage(res[0], res[1], polys, M.textWeight(sizePx), strokeWPx);
      this._fxgenLayer.ensure(res[0], res[1], cov.fill, cov.ring, 1);
      this._fxgenLayer.key = key;
    }
    const fill = numbersColor(this.properties.fillColor, frame, [1, 0, 0]);
    const stroke = numbersColor(this.properties.strokeColor, frame, [1, 1, 1]);
    uniforms.uText.value = this._fxgenLayer.texture;
    uniforms.uFill.value.set(fill[0], fill[1], fill[2], 1);
    uniforms.uStroke.value.set(stroke[0], stroke[1], stroke[2], 1);
    uniforms.uDisplay.value = display;
    uniforms.uComposite.value = numbersNumber(this.properties.compositeOnOriginal, frame, 1) === 1 ? 1 : 0;
  },
});
