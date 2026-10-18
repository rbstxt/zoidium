(function (global, factory) {
  "use strict";
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (global.ZoidiumUIBuilder = global.ZoidiumUIBuilder || {}).themeModel = factory();
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";

  var PALETTE = { focus: 0x384668, link: 0x7e8fb9, clip: 0x526183, clipSelected: 0x7f94c7, clipSelection: 0x273465 };
  var PRESETS = [
    { value: "panzoid", label: "Panzoid Classic", hue: 0 },
    { value: "signal", label: "Signal Blue", hue: -18 },
    { value: "ember", label: "Ember Console", hue: 154 },
    { value: "moss", label: "Moss Terminal", hue: 78 },
    { value: "rose", label: "Rose Signal", hue: -72 },
    { value: "gray", label: "Gray", hue: 0 },
    { value: "custom", label: "Custom", hue: 0 },
  ];
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function hex(value) { return "#" + value.toString(16).padStart(6, "0"); }
  function color(value) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null; }
  function hsl(value) {
    var n = typeof value === "number" ? value : parseInt(value.slice(1), 16);
    var r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    var h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function fromHsl(h, s, l) {
    h = (h % 1 + 1) % 1; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    function channel(n) {
      var k = (n + h * 12) % 12;
      return Math.round(255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    }
    return hex(channel(0) << 16 | channel(8) << 8 | channel(4));
  }
  function shiftThemeColor(color, degrees, saturationScale) {
    var red = (color >> 16 & 255) / 255;
    var green = (color >> 8 & 255) / 255;
    var blue = (color & 255) / 255;
    var max = Math.max(red, green, blue);
    var min = Math.min(red, green, blue);
    var lightness = (max + min) / 2;
    var saturation = 0;
    var hue = 0;

    if (max !== min) {
      var delta = max - min;
      saturation = lightness > 0.5
        ? delta / (2 - max - min)
        : delta / (max + min);
      if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
      else if (max === green) hue = (blue - red) / delta + 2;
      else hue = (red - green) / delta + 4;
      hue /= 6;
    }

    hue = (hue + degrees / 360) % 1;
    if (hue < 0) hue += 1;

    var scale = Number(saturationScale);
    saturation = clamp(saturation * (Number.isFinite(scale) ? scale : 1), 0, 1);

    function hueToRgb(first, second, value) {
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      if (value < 1 / 6) return first + (second - first) * 6 * value;
      if (value < 1 / 2) return second;
      if (value < 2 / 3) return first + (second - first) * (2 / 3 - value) * 6;
      return first;
    }

    if (saturation === 0) {
      red = green = blue = lightness;
    } else {
      var second = lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
      var first = 2 * lightness - second;
      red = hueToRgb(first, second, hue + 1 / 3);
      green = hueToRgb(first, second, hue);
      blue = hueToRgb(first, second, hue - 1 / 3);
    }

    return (Math.round(red * 255) << 16)
      | (Math.round(green * 255) << 8)
      | Math.round(blue * 255);
  }

  function derive(main, overrides) {
    var base = hsl(PALETTE.focus), input = hsl(color(main) || hex(PALETTE.focus)), result = {};
    Object.keys(PALETTE).forEach(function (key) {
      var reference = hsl(PALETTE[key]);
      result[key] = color(overrides && overrides[key]) || (key === "focus" ? color(main) || hex(PALETTE.focus)
        : fromHsl(input[0] + reference[0] - base[0], input[1] * reference[1] / base[1], input[2] + reference[2] - base[2]));
    });
    return result;
  }
  function presetPalette(id, hue, saturation) {
    var preset = PRESETS.find(function (entry) { return entry.value === id; }) || PRESETS[0];
    var degrees = id === "custom" ? Number(hue) || 0 : preset.hue;
    var scale = id === "gray" ? 0 : id === "custom" ? clamp(Number(saturation) / 100, 0, 2) : 1;
    if (!Number.isFinite(scale)) scale = 1;
    var result = {};
    Object.keys(PALETTE).forEach(function (key) { result[key] = hex(shiftThemeColor(PALETTE[key], degrees, scale)); });
    return result;
  }
  // Neutral Zoidium chrome stays dark for every palette because CM3's own
  // panels never change their surfaces; only accent-derived tokens follow
  // the theme, so extension windows always match the surrounding editor.
  function uiTokens(palette) {
    var colors = {
      bg: "#2a2a2a", "bg-title": "#222222", "bg-input": "#202020", "bg-sunken": "#1d1d1d",
      border: "#1b1b1b", "border-soft": "#242424", hover: "#333333",
      text: "#cccccc", "text-strong": "#dadada", "text-bright": "#e4e4e4", "text-muted": "#9a9a9a", "text-faint": "#6d6d6d",
      danger: "#df9b9b",
    };
    colors.value = palette.link;
    colors["accent-strong"] = "color-mix(in srgb, var(--zui-accent) 70%, var(--zui-text-bright))";
    colors["value-strong"] = "color-mix(in srgb, var(--zui-value) 60%, var(--zui-text-bright))";
    colors["bg-title-focused"] = "color-mix(in srgb, var(--zui-accent) 22%, var(--zui-bg-title))";
    colors.shadow = "#000000";
    return colors;
  }
  function validTypeKey(key) {
    return typeof key === "string" && (/^cm3:\d+$/.test(key) || key === "audio" || /^zoidium:[a-z0-9-]+\/[a-z0-9-]+$/.test(key));
  }
  function typeKey(type, audio, aliases) {
    if (audio) return "audio";
    if (aliases && Object.hasOwn(aliases, type)) return typeKey(aliases[type]);
    if (Number.isInteger(type) && type >= 0) return "cm3:" + type;
    return validTypeKey(type) ? type : null;
  }
  function record(value) { return value && typeof value === "object" && !Array.isArray(value); }
  function validateTheme(value) {
    if (!record(value) || typeof value.id !== "string" || !/^user:[a-z0-9-]{1,100}$/.test(value.id)
        || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 || !color(value.main)
        || !record(value.overrides) || !record(value.clips)) return null;
    var overrides = {}, clips = {};
    for (var key of Object.keys(value.overrides)) {
      if (!Object.hasOwn(PALETTE, key) || !color(value.overrides[key])) return null;
      overrides[key] = color(value.overrides[key]);
    }
    if (Object.keys(value.clips).length > 512) return null;
    for (var type of Object.keys(value.clips)) {
      if (!validTypeKey(type) || !color(value.clips[type])) return null;
      clips[type] = color(value.clips[type]);
    }
    return { id: value.id, name: value.name.trim(), main: color(value.main), overrides: overrides, clips: clips };
  }
  function parseStorage(text) {
    try {
      var value = JSON.parse(text);
      if (!record(value) || value.version !== 1 || !Array.isArray(value.themes)) return [];
      var ids = new Set(), themes = [];
      for (var item of value.themes) {
        var theme = validateTheme(item);
        if (!theme || ids.has(theme.id)) return [];
        ids.add(theme.id); themes.push(theme);
      }
      return themes;
    } catch (_error) { return []; }
  }
  function parseImport(text) {
    if (typeof text !== "string" || text.length > 262144) throw new Error("Choose a theme JSON file smaller than 256 KB.");
    var value;
    try { value = JSON.parse(text); } catch (_error) { throw new Error("This file is not valid JSON."); }
    var theme = record(value) && value.version === 1 && validateTheme(value.theme);
    if (!theme) throw new Error("This file is not a valid Zoidium theme version 1.");
    return theme;
  }
  function uniqueName(name, themes) {
    var base = name.trim().slice(0, 94), result = base, count = 2;
    while (themes.some(function (theme) { return theme.name === result; })) result = base + " (" + count++ + ")";
    return result;
  }
  function copyPalette(palette) {
    var automatic = derive(palette.focus), overrides = {};
    Object.keys(PALETTE).forEach(function (key) { if (automatic[key] !== palette[key]) overrides[key] = palette[key]; });
    return { main: palette.focus, overrides: overrides, clips: {} };
  }
  function selectedClip(value) {
    var c = hsl(value);
    return fromHsl(c[0], c[1], c[2] + (1 - c[2]) * 0.35);
  }
  function labelColor(value) {
    function luminance(hexColor) {
      var n = parseInt(hexColor.slice(1), 16);
      var c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) {
        v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    }
    var l = luminance(value), dark = luminance("#2c323f"), light = luminance("#f4f4f4");
    return (l + 0.05) / (dark + 0.05) >= (light + 0.05) / (l + 0.05) ? "#2c323f" : "#f4f4f4";
  }
  return { PALETTE: PALETTE, PRESETS: PRESETS, color: color, hsl: hsl, derive: derive, presetPalette: presetPalette,
    shiftThemeColor: shiftThemeColor, uiTokens: uiTokens, typeKey: typeKey, validateTheme: validateTheme, parseStorage: parseStorage,
    parseImport: parseImport, uniqueName: uniqueName, copyPalette: copyPalette, selectedClip: selectedClip, labelColor: labelColor };
});
