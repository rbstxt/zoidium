"use strict";
// Verbatim pre-migration helper bodies from dev 869a251.
const TINY = 1e-9;
function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampUnit(value) {
  if (!(value > 0)) return 0;
  return value < 1 ? value : 1;
}

function hash01(seed, index, channel) {
  let value = (Math.trunc(finiteOr(seed, 0)) | 0) ^ Math.imul((index | 0) + 1, 0x45d9f3b);
  value ^= Math.imul((channel | 0) + 1, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function hashUnitVector(seed, index, channel) {
  const x = 2 * hash01(seed, index, channel) - 1;
  const y = 2 * hash01(seed, index, channel + 1) - 1;
  const z = 2 * hash01(seed, index, channel + 2) - 1;
  const length = Math.sqrt(x * x + y * y + z * z);
  if (!(length > TINY)) return [0, 0, 1];
  return [x / length, y / length, z / length];
}

function hueToRgb(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToRgb(hue, saturation, lightness) {
  if (saturation === 0) return [lightness, lightness, lightness];
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    hueToRgb(p, q, hue + 1 / 3),
    hueToRgb(p, q, hue),
    hueToRgb(p, q, hue - 1 / 3),
  ];
}

function rgbToHsv(r, g, b) {
        var max = Math.max(r, g, b);
        var min = Math.min(r, g, b);
        var delta = max - min;
        var h = 0;
        if (delta !== 0) {
            if (max === r) h = ((g - b) / delta) % 6;
            else if (max === g) h = (b - r) / delta + 2;
            else h = (r - g) / delta + 4;
            h /= 6;
            if (h < 0) h += 1;
        }
        var s = max === 0 ? 0 : delta / max;
        return [h, s, max];
    }

function hsvToRgb(h, s, v) {
        var i = Math.floor(h * 6);
        var f = h * 6 - i;
        var p = v * (1 - s);
        var q = v * (1 - f * s);
        var t = v * (1 - (1 - f) * s);
        switch (i % 6) {
            case 0:
                return [v, t, p];
            case 1:
                return [q, v, p];
            case 2:
                return [p, v, t];
            case 3:
                return [p, q, v];
            case 4:
                return [t, p, v];
            default:
                return [v, p, q];
        }
    }

function readNumber(property, frame, fallback) {
    try {
      const value = property?.get?.(frame);
      return Number.isFinite(Number(value)) ? Number(value) : fallback;
    } catch (_error) {
      return fallback;
    }
  }

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
module.exports = {finiteOr, clampUnit, hash01, hashUnitVector, hslToRgb, rgbToHsv, hsvToRgb, readNumber, numberValue};
