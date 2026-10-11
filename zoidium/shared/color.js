// Zoidium shared color math.
//
// Pure scalar/vector color helpers shared by setup windows, grade engines,
// and theme code. Every function is deterministic and side-effect free. Where
// existing implementations differ, each variant keeps its own name: hsv helpers
// take hue in degrees (Magic Looks), while the *01 helpers take hue in [0, 1]
// (Material+ graph runtime). Load order: before zoidium/plugin-apis.js (see
// postInitScripts in zoidium/runtime-config.js). plugin-apis.js exposes this
// table as ZoidiumPluginApis.color.
(function initializeColor(global) {
  "use strict";

  function clamp(value, minimum, maximum) {
    return value < minimum ? minimum : value > maximum ? maximum : value;
  }

  function lerp(start, end, amount) {
    return start + (end - start) * amount;
  }

  // Unit clamp with Effector semantics
  // (plugins/scene-plus/effector-core.js): non-positive and NaN collapse to 0.
  function clampUnit(value) {
    if (!(value > 0)) return 0;
    return value < 1 ? value : 1;
  }

  // Unit clamp with grade semantics: NaN passes through as NaN.
  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  // Hue in [0, 360), saturation/value in [0, 1] -> [r, g, b] in [0, 1].
  // Exact semantics of plugins/magic-looks/looks-color.js.
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0;
    var g = 0;
    var b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }

  // [r, g, b] in [0, 1] -> { h in [0, 360), s, v }.
  // Exact semantics of plugins/magic-looks/looks-color.js.
  function rgbToHsv(r, g, b) {
    var mx = Math.max(r, g, b);
    var mn = Math.min(r, g, b);
    var d = mx - mn;
    var h = 0;
    if (d > 1e-9) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: mx === 0 ? 0 : d / mx, v: mx };
  }

  // Hue/saturation/value in [0, 1] -> [r, g, b] in [0, 1].
  // Exact semantics of plugins/material-plus/graph-runtime.js.
  function hsvToRgb01(h, s, v) {
    var i = Math.floor(h * 6);
    var f = h * 6 - i;
    var p = v * (1 - s);
    var q = v * (1 - f * s);
    var t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: return [v, t, p];
      case 1: return [q, v, p];
      case 2: return [p, v, t];
      case 3: return [p, q, v];
      case 4: return [t, p, v];
      default: return [v, p, q];
    }
  }

  // [r, g, b] in [0, 1] -> [h, s, v] in [0, 1].
  // Exact semantics of plugins/material-plus/graph-runtime.js.
  function rgbToHsv01(r, g, b) {
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var delta = max - min;
    var h = 0;
    if (delta !== 0) {
      if (max === r) h = (g - b) / delta;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    var s = max === 0 ? 0 : delta / max;
    return [h, s, max];
  }

  function hueToRgb(p, q, value) {
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  }

  // Hue/saturation/lightness in [0, 1] -> [r, g, b] in [0, 1].
  // Exact semantics of plugins/scene-plus/effector-fracture.js.
  function hslToRgb(hue, saturation, lightness) {
    if (saturation === 0) return [lightness, lightness, lightness];
    var q = lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
    var p = 2 * lightness - q;
    return [
      hueToRgb(p, q, hue + 1 / 3),
      hueToRgb(p, q, hue),
      hueToRgb(p, q, hue - 1 / 3),
    ];
  }

  // "#rrggbb" (leading "#" optional) -> [r, g, b] in [0, 1], or null.
  // Exact semantics of plugins/openzoid-legacy/effect-windows.js.
  function hexToRgb(hex) {
    var match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!match) return null;
    var n = parseInt(match[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  // [r, g, b] in [0, 1] -> "#rrggbb".
  // Exact semantics of plugins/openzoid-legacy/effect-windows.js.
  function rgbToHex(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return "#ffffff";
    return "#" + rgb.slice(0, 3).map(function (channel) {
      var n = Math.max(0, Math.min(255, Math.round(Number(channel) * 255)));
      return (n < 16 ? "0" : "") + n.toString(16);
    }).join("");
  }

  global.ZoidiumSharedColor = {
    clamp: clamp,
    lerp: lerp,
    clampUnit: clampUnit,
    clamp01: clamp01,
    hsvToRgb: hsvToRgb,
    rgbToHsv: rgbToHsv,
    hsvToRgb01: hsvToRgb01,
    rgbToHsv01: rgbToHsv01,
    hslToRgb: hslToRgb,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
  };
  // Serialize this initializer, including its closure state and dependencies.
  // The worker receives the same implementation without fetching overlay files.
  Object.defineProperty(global.ZoidiumSharedColor, "workerSource", {
    value: function () {
      return "(" + Function.prototype.toString.call(initializeColor) + ")(globalThis);\n" +
        "globalThis.ZoidiumPluginApis = globalThis.ZoidiumPluginApis || {};\n" +
        "globalThis.ZoidiumPluginApis.color = globalThis.ZoidiumSharedColor;\n";
    },
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
