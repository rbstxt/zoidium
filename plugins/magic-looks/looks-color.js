"use strict";

// Magic Looks — pure color math and the JS reference grade (no DOM). The
// setup window, the canvas widgets and the unit tests share this file. The
// reference mirrors looks-grade.glsl tool-for-tool; both read the same
// neutral defaults and run tools in the same chain order.

var Looks = Looks || {};

(function (Looks) {
  var color = {};

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  color.clamp = clamp;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  color.lerp = lerp;

  // h in [0,360), s/v in [0,1] -> [r,g,b] in [0,1].
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
  }
  color.hsvToRgb = hsvToRgb;

  // [r,g,b] in [0,1] -> { h in [0,360), s, v }.
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
  color.rgbToHsv = rgbToHsv;

  // Wheel dot (angle degrees, radius 0..1) -> tint color. Center is white.
  function wheelTint(angleDeg, radius) {
    radius = clamp(radius, 0, 1);
    if (radius < 1e-6) return [1, 1, 1];
    var pure = hsvToRgb(angleDeg, 1, 1);
    return [lerp(1, pure[0], radius), lerp(1, pure[1], radius), lerp(1, pure[2], radius)];
  }
  color.wheelTint = wheelTint;

  // Tint color -> wheel dot { angle, radius }. White maps to the center.
  function tintToDot(r, g, b) {
    var hsv = rgbToHsv(clamp(r, 0, 2), clamp(g, 0, 2), clamp(b, 0, 2));
    var sat = hsv.v === 0 ? 0 : 1 - Math.min(r, g, b) / hsv.v;
    return { angle: hsv.h, radius: clamp(sat, 0, 1) };
  }
  color.tintToDot = tintToDot;

  // Format a value like the Looks readouts: decimals, optional % scaling,
  // optional explicit + sign.
  function fmtNum(value, decimals, opts) {
    opts = opts || {};
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    if (opts.percent) v = v * 100;
    var s = v.toFixed(decimals === undefined ? 3 : decimals);
    if (opts.percent) s += "%";
    if (opts.signed && v >= 0) s = "+" + s;
    return s;
  }
  color.fmtNum = fmtNum;

  Looks.color = color;

  /* ================= grade engine (JS reference) =================
   * gradePixel(c, uv, T, en, sample, res, luts, order) grades one pixel:
   *   c       straight [r,g,b] of the source pixel (sampled again after the
   *           lens stage)
   *   uv      [0,1] pixel coordinate
   *   T       tool state map (defaultState().tools shape)
   *   en      enable map (missing entries read as on)
   *   sample  bilinear (u,v) -> [r,g,b] reader on the source
   *   res     [w,h] in pixels
   *   luts    buildFrameLuts(T) result (curves + S-curve tables)
   *   order   tool ids in chain order (defaults to the default chain)
   * gradeImage(data, w, h, T, en, order) runs a full RGBA frame. Both work on
   * straight color; alpha is passed through unchanged.
   */

  var grade = {};
  var CC_AMOUNT = 0.37;          // fixed Color Contrast character
  var POW_EPS = 1e-6;

  function gLuma(c) {
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  }
  grade.luma = gLuma;

  function gSat(c, s) {
    var l = gLuma(c);
    return [l + (c[0] - l) * s, l + (c[1] - l) * s, l + (c[2] - l) * s];
  }
  grade.saturate = gSat;

  function gContrast(c, k, p) {
    return [p + (c[0] - p) * (1 + k), p + (c[1] - p) * (1 + k), p + (c[2] - p) * (1 + k)];
  }
  grade.contrastPivot = gContrast;

  function gExposure(c, e) {
    if (!e) return c;
    var m = Math.pow(2, e);
    return [c[0] * m, c[1] * m, c[2] * m];
  }
  grade.exposure = gExposure;

  function gMix(a, b, t) {
    t = clamp(t, 0, 1);
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  grade.mix = gMix;

  // Guarded smoothstep: a degenerate edge pair acts as a step, never NaN.
  function gSmooth(a, b, x) {
    var d = b - a;
    if (Math.abs(d) < 1e-6) return x >= b ? 1 : 0;
    var t = clamp((x - a) / d, 0, 1);
    return t * t * (3 - 2 * t);
  }
  grade.smoothstep = gSmooth;

  // Power with a guarded base (pow(0, e) is undefined in GLSL).
  function gPow(x, e) {
    return Math.pow(Math.max(x, POW_EPS), Math.max(e, 1e-3));
  }
  grade.pow = gPow;

  function circDist(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  grade.circDist = circDist;

  function hueOf(c) {
    return rgbToHsv(clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)).h;
  }
  grade.hueOf = hueOf;

  // Zone weights [shadow, mid, highlight] from three positional thresholds.
  // Thresholds are sorted, so their order does not change the zones.
  function zoneWeights(l, t0, t1, t2) {
    var lo = Math.min(t0, t1, t2);
    var hi = Math.max(t0, t1, t2);
    var md = t0 + t1 + t2 - lo - hi;
    var sh = 1 - gSmooth(lo, md, l);
    var hh = gSmooth(md, hi, l);
    var mm = clamp(1 - sh - hh, 0, 1);
    return [sh, mm, hh];
  }
  grade.zoneWeights = zoneWeights;

  function evalPolyline(points, x) {
    var pts = points.slice().sort(function (a, b) { return a.x - b.x; });
    if (!pts.length) return x;
    if (x <= pts[0].x) return pts[0].y;
    for (var i = 1; i < pts.length; i++) {
      if (x <= pts[i].x) {
        var span = pts[i].x - pts[i - 1].x;
        var t = span < 1e-9 ? 0 : (x - pts[i - 1].x) / span;
        return lerp(pts[i - 1].y, pts[i].y, t);
      }
    }
    return pts[pts.length - 1].y;
  }
  grade.evalPolyline = evalPolyline;

  // Cubic bezier point (S-curve handles).
  function cubic(p0, c1, c2, p3, t) {
    var u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  }
  color.cubic = cubic;

  // Bezier S-curve sampled into a 256-entry table: entry k is the curve value
  // at input k/255 (x(t) is monotonic for the shapes the setup produces).
  function evalScurveLUT(shape) {
    var lut = new Array(256);
    var xs = [], ys = [];
    for (var i = 0; i <= 128; i++) {
      var p = cubic(shape.p0, shape.c1, shape.c2, shape.p3, i / 128);
      xs.push(p.x);
      ys.push(p.y);
    }
    for (var k = 0; k < 256; k++) {
      var x = k / 255;
      var v = x < xs[0] ? ys[0] : x > xs[xs.length - 1] ? ys[ys.length - 1] : x;
      if (x >= xs[0] && x <= xs[xs.length - 1]) {
        for (var j = 1; j < xs.length; j++) {
          if (x <= xs[j]) {
            var span = xs[j] - xs[j - 1];
            var t = span < 1e-9 ? 0 : (x - xs[j - 1]) / span;
            v = lerp(ys[j - 1], ys[j], t);
            break;
          }
        }
      }
      lut[k] = clamp(v, 0, 1);
    }
    return lut;
  }
  grade.evalScurveLUT = evalScurveLUT;

  // Per-channel 256 tables from the Curves state. Each channel curve is
  // followed by the RGB master curve. Identity points give identity tables.
  function buildCurveLUTs(curves) {
    var master = curves && curves.channels && curves.channels.RGB;
    var out = {};
    ["Red", "Green", "Blue"].forEach(function (ch) {
      var pts = (curves && curves.channels && curves.channels[ch]) || [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      var arr = new Array(256);
      for (var k = 0; k < 256; k++) {
        var x = k / 255;
        var y = clamp(evalPolyline(pts, x), 0, 1);
        if (master) y = clamp(evalPolyline(master, y), 0, 1);
        arr[k] = y;
      }
      out[ch] = arr;
    });
    return out;
  }
  grade.buildCurveLUTs = buildCurveLUTs;

  // S-curve table with the black/white input range (levels) and the bezier.
  function buildScurveLUT(scurve) {
    if (!scurve) return null;
    var table = evalScurveLUT(scurve);
    var arr = new Array(256);
    var span = Math.max(1e-6, scurve.white - scurve.black);
    for (var k = 0; k < 256; k++) {
      var xr = clamp(((k / 255) - scurve.black) / span, 0, 1);
      arr[k] = lutSample(table, xr);
    }
    return arr;
  }
  grade.buildScurveLUT = buildScurveLUT;

  // Linear interpolation over a 256-entry table, entry k at input k/255
  // (matches the shader's texel mapping u = (x*255 + 0.5) / 256).
  function lutSample(lut, x) {
    var f = clamp(x, 0, 1) * 255;
    var i = Math.floor(f);
    var t = f - i;
    var a = lut[Math.min(255, i)];
    var b = lut[Math.min(255, i + 1)];
    return lerp(a, b, t);
  }
  grade.lutSample = lutSample;

  function frameLutsFrom(T) {
    var curves = T["curves"] && T["curves"].x.curves;
    var scurve = T["s-curve"] && T["s-curve"].x.scurve;
    return {
      curves: curves ? buildCurveLUTs(curves) : null,
      scurve: scurve ? buildScurveLUT(scurve) : null,
    };
  }
  grade.buildFrameLuts = frameLutsFrom;

  // Average of N taps. offsets is a flat list of [du,dv] in pixels.
  function tapAvg(sample, uv, res, offsets) {
    var r = 0, g = 0, b = 0;
    for (var i = 0; i < offsets.length; i++) {
      var px = sample(uv[0] + offsets[i][0] / res[0], uv[1] + offsets[i][1] / res[1]);
      r += px[0]; g += px[1]; b += px[2];
    }
    var n = Math.max(1, offsets.length);
    return [r / n, g / n, b / n];
  }

  function boxOffsets(r, diag) {
    var o = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    if (diag) {
      o.push([r * 0.7071, r * 0.7071], [-r * 0.7071, r * 0.7071],
        [r * 0.7071, -r * 0.7071], [-r * 0.7071, -r * 0.7071]);
    }
    return o;
  }

  // count taps spanning [-r, r] along angleRad; half = count >> 1.
  function lineOffsets(r, angleRad, count) {
    var o = [];
    var half = count >> 1;
    var dx = Math.cos(angleRad), dy = Math.sin(angleRad);
    var div = half || 1;
    for (var i = -half; i <= half; i++) {
      o.push([dx * r * i / div, dy * r * i / div]);
    }
    return o;
  }

  function on(en, id) {
    return !en || en[id] !== 0;
  }

  function wheelOf(T, id, key) {
    var w = T[id] && T[id].w && T[id].w[key];
    return w ? w.rgb : [1, 1, 1];
  }

  function num(T, id, key, fallback) {
    var t = T[id] && T[id].p;
    var v = t && t[key];
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }

  // ---- per-tool stages: (c, cx) -> c. cx = { T, en, uv, sample, res, luts }.
  var FX = {};

  FX["lift-gamma-gain"] = function (c, cx) {
    var id = "lift-gamma-gain";
    if (!on(cx.en, id)) return c;
    var T = cx.T, p = T[id].p;
    var lift = wheelOf(T, id, "lift"), gam = wheelOf(T, id, "gamma"), gain = wheelOf(T, id, "gain");
    var gsp = Math.max(p.gammaSpace, 0.5);
    var gs = gsp / 2.2;
    var r = [gPow(c[0], gs), gPow(c[1], gs), gPow(c[2], gs)];
    r = [r[0] + (lift[0] - 1), r[1] + (lift[1] - 1), r[2] + (lift[2] - 1)];
    r = [r[0] * gain[0], r[1] * gain[1], r[2] * gain[2]];
    r = [gPow(r[0], 1 / Math.max(gam[0], 1e-3)), gPow(r[1], 1 / Math.max(gam[1], 1e-3)), gPow(r[2], 1 / Math.max(gam[2], 1e-3))];
    r = [gPow(r[0], 2.2 / gsp), gPow(r[1], 2.2 / gsp), gPow(r[2], 2.2 / gsp)];
    c = gMix(c, r, p.strength);
    return gExposure(c, p.exposure);
  };

  FX["contrast"] = function (c, cx) {
    if (!on(cx.en, "contrast")) return c;
    var p = cx.T.contrast.p;
    c = gContrast(c, p.contrast, p.pivot);
    return gExposure(c, p.exposure);
  };

  FX["color-contrast"] = function (c, cx) {
    if (!on(cx.en, "color-contrast")) return c;
    var T = cx.T, p = T["color-contrast"].p;
    var r = gContrast(c, CC_AMOUNT, p.pivot);
    var ct = wheelOf(T, "color-contrast", "contrast");
    r = [r[0] * ct[0], r[1] * ct[1], r[2] * ct[2]];
    return gExposure(r, p.exposure);
  };

  FX["crush"] = function (c, cx) {
    if (!on(cx.en, "crush")) return c;
    var T = cx.T, p = T.crush.p;
    var t = wheelOf(T, "crush", "color");
    var r = [gPow(c[0], p.gamma) * t[0], gPow(c[1], p.gamma) * t[1], gPow(c[2], p.gamma) * t[2]];
    return gExposure(r, p.exposure);
  };

  // Color Ranges: zone-weighted tints from its own positional thresholds.
  FX["color-ranges"] = function (c, cx) {
    if (!on(cx.en, "color-ranges")) return c;
    var T = cx.T, p = T["color-ranges"].p;
    var zw = zoneWeights(gLuma(c), p.shadow, p.midtone, p.highlight);
    if (p.showThreshold) return [zw[0], zw[1], zw[2]];
    var hT = wheelOf(T, "color-ranges", "highlight");
    var mT = wheelOf(T, "color-ranges", "midtone");
    var sT = wheelOf(T, "color-ranges", "shadow");
    var s = clamp(p.strength, 0, 2);
    var out = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var m = lerp(1, hT[i], zw[2]) * lerp(1, mT[i], zw[1]) * lerp(1, sT[i], zw[0]);
      out[i] = c[i] * (1 + (m - 1) * s);
    }
    return out;
  };

  FX["ranged-saturation"] = function (c, cx) {
    if (!on(cx.en, "ranged-saturation")) return c;
    var T = cx.T, p = T["ranged-saturation"].p;
    var zw = zoneWeights(gLuma(c), p.thresholdShadow, p.thresholdMidtone, p.thresholdHighlight);
    var ss = zw[0] * p.satShadow + zw[1] * p.satMidtone + zw[2] * p.satHighlight;
    var r = gSat(c, ss);
    var bt = wheelOf(T, "ranged-saturation", "balance");
    r = [r[0] * bt[0], r[1] * bt[1], r[2] * bt[2]];
    c = p.showThreshold ? [zw[0], zw[1], zw[2]] : r;
    return gExposure(c, p.exposure);
  };

  FX["mojo"] = function (c, cx) {
    if (!on(cx.en, "mojo")) return c;
    var mj = cx.T.mojo.p;
    var r = gSat(c, 1 + mj.punch * 1.5);
    var rl = gLuma(r);
    r = gMix(r, [rl + 0.08, rl + 0.08, rl + 0.08], clamp(mj.bleach * 0.6, 0, 1));
    r = [r[0] * (1 - mj.fade * 0.4) + mj.fade * 0.12,
      r[1] * (1 - mj.fade * 0.4) + mj.fade * 0.12,
      r[2] * (1 - mj.fade * 0.4) + mj.fade * 0.12];
    r = [r[0] + mj.coolWarm * 0.25, r[1] + mj.coolWarm * 0.08, r[2] - mj.coolWarm * 0.25];
    r = [r[0] - mj.greenMagenta * 0.2, r[1] + mj.greenMagenta * 0.25, r[2] - mj.greenMagenta * 0.2];
    var hue = hueOf(r);
    var wBlue = Math.exp(-Math.pow(circDist(hue, 240) / 25, 2));
    var wSkin = Math.exp(-Math.pow(circDist(hue, 25) / 20, 2));
    r = gSat(r, 1 - mj.blueSqueeze * 0.5 * wBlue);
    r = gSat(r, 1 - mj.skinSqueeze * 0.5 * wSkin);
    r = [r[0] + mj.skinYellowPink * 0.15 * wSkin,
      r[1] + mj.skinYellowPink * 0.02 * wSkin,
      r[2] - mj.skinYellowPink * 0.12 * wSkin];
    r = gExposure(r, mj.exposure);
    return gMix(c, r, clamp(mj.mojo, 0, 1) * clamp(mj.strength, 0, 1));
  };

  FX["three-strip"] = function (c, cx) {
    if (!on(cx.en, "three-strip")) return c;
    var p = cx.T["three-strip"].p;
    var r = [c[0] * 0.88 + c[1] * 0.08 + c[2] * 0.04,
      c[0] * 0.06 + c[1] * 0.82 + c[2] * 0.12,
      c[0] * 0.08 + c[1] * 0.10 + c[2] * 0.82];
    c = gMix(c, r, clamp(p.strength, 0, 1));
    return gExposure(c, p.exposure);
  };

  FX["color-reversal"] = function (c, cx) {
    if (!on(cx.en, "color-reversal")) return c;
    var p = cx.T["color-reversal"].p;
    c = gMix(c, [1 - c[0], 1 - c[1], 1 - c[2]], clamp(p.strength, 0, 1));
    return gExposure(c, p.exposure);
  };

  FX["auto-shoulder"] = function (c, cx) {
    if (!on(cx.en, "auto-shoulder")) return c;
    var s = clamp(cx.T["auto-shoulder"].p.strength, 0, 1);
    var r = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var v = Math.max(c[i], 0);
      r[i] = v / (v + 0.18) * 1.18;
    }
    return gMix(c, r, s);
  };

  var HSL_HUES = [0, 30, 60, 120, 180, 240, 270, 300];
  FX["hsl-colors"] = function (c, cx) {
    if (!on(cx.en, "hsl-colors")) return c;
    var hx = cx.T["hsl-colors"].x.hsl;
    var h = hueOf(c);
    var satS = 1, lite = 0;
    for (var i = 0; i < 8; i++) {
      var g8 = Math.exp(-Math.pow(circDist(h, HSL_HUES[i]) / 28, 2));
      satS += (hx[i] ? hx[i].sat : 0) * g8;
      lite += (hx[i] ? hx[i].light : 0) * g8 * 0.5;
    }
    var r = gSat(c, Math.max(0, satS));
    return [r[0] + lite, r[1] + lite, r[2] + lite];
  };

  FX["warm-cool"] = function (c, cx) {
    if (!on(cx.en, "warm-cool")) return c;
    var p = cx.T["warm-cool"].p;
    var r = [c[0] + p.warmCool * 0.28 + p.tint * 0.18,
      c[1] + p.warmCool * 0.12 - p.tint * 0.18,
      c[2] - p.warmCool * 0.28 + p.tint * 0.18];
    return gExposure(r, p.exposure);
  };

  FX["four-way"] = function (c, cx) {
    if (!on(cx.en, "four-way")) return c;
    var T = cx.T, p = T["four-way"].p;
    var lw = gLuma(c);
    var fsh = 1 - gSmooth(0.2, 0.5, lw);
    var fhi = gSmooth(0.5, 0.8, lw);
    var fmid = clamp(1 - fsh - fhi, 0, 1);
    var fwx = T["four-way"].x && T["four-way"].x.fourway;
    if (fwx && fwx.preview) return [fsh, fmid, fhi];
    var s4 = clamp(p.strength, 0, 1);
    var tS = wheelOf(T, "four-way", "shadows");
    var tM = wheelOf(T, "four-way", "midtones");
    var tH = wheelOf(T, "four-way", "highlights");
    var tG = wheelOf(T, "four-way", "global");
    var r = [0, 0, 0];
    for (var i = 0; i < 3; i++) {
      var m = (1 + (tS[i] - 1) * fsh * s4) * (1 + (tM[i] - 1) * fmid * s4) *
        (1 + (tH[i] - 1) * fhi * s4) * (1 + (tG[i] - 1) * s4);
      r[i] = c[i] * m;
    }
    r = gContrast(r, p.contrast, 0.18);
    return gExposure(r, p.exposure);
  };

  FX["curves"] = function (c, cx) {
    if (!on(cx.en, "curves") || !cx.luts || !cx.luts.curves) return c;
    var L = cx.luts.curves;
    return [lutSample(L.Red, c[0]), lutSample(L.Green, c[1]), lutSample(L.Blue, c[2])];
  };

  FX["s-curve"] = function (c, cx) {
    if (!on(cx.en, "s-curve") || !cx.luts || !cx.luts.scurve) return c;
    var L = cx.luts.scurve;
    return [lutSample(L, c[0]), lutSample(L, c[1]), lutSample(L, c[2])];
  };

  FX["lut"] = function (c, cx) {
    if (!on(cx.en, "lut")) return c;
    var lx = cx.T.lut.x.lut;
    if (!lx || lx.name === "None") return c;
    var r = c.slice();
    if (lx.gamma === "Input") {
      r = [gPow(r[0], 2.2), gPow(r[1], 2.2), gPow(r[2], 2.2)];
    }
    if (lx.name === "Hot") {
      r = [r[0] * 1.1 + 0.035, r[1] * 1.0 + 0.012, r[2] * 0.88 - 0.02];
    } else if (lx.name === "Cold") {
      r = [r[0] * 0.9 - 0.02, r[1] * 0.97, r[2] * 1.1 + 0.03];
    } else if (lx.name === "Noir") {
      r = gContrast(gSat(r, 0.2), 0.35, 0.18);
    }
    if (lx.gamma === "Output") {
      r = [gPow(r[0], 1 / 2.2), gPow(r[1], 1 / 2.2), gPow(r[2], 1 / 2.2)];
    }
    return gMix(c, r, clamp(lx.strength, 0, 1));
  };

  FX["lightflex"] = function (c, cx) {
    if (!on(cx.en, "lightflex")) return c;
    var T = cx.T, p = T.lightflex.p;
    var lfl = gLuma(c);
    var t = wheelOf(T, "lightflex", "color");
    var k = p.boost * 0.045 * (1 - lfl);
    var r = [c[0] + t[0] * k, c[1] + t[1] * k, c[2] + t[2] * k];
    return gExposure(r, p.exposure);
  };

  FX["deflare"] = function (c, cx) {
    if (!on(cx.en, "deflare")) return c;
    var p = cx.T.deflare.p;
    var lum = gLuma(c);
    var dff = gSmooth(0.55, 0.95, lum) * clamp(p.strength, 0, 1);
    var r = gMix(c, [lum, lum, lum], dff * 0.7);
    r = [r[0] + dff * 0.05, r[1] + dff * 0.05, r[2] + dff * 0.05];
    return gExposure(r, p.exposure);
  };

  FX["vignette"] = function (c, cx) {
    if (!on(cx.en, "vignette")) return c;
    var T = cx.T, vg = T.vignette.p;
    var vgt = wheelOf(T, "vignette", "color");
    var uv = cx.uv;
    var cenx = 0.5 + vg.centerX * 0.5, ceny = 0.5 + vg.centerY * 0.5;
    var dx = (uv[0] - cenx) * vg.aspect, dy = uv[1] - ceny;
    var dd = Math.sqrt(dx * dx + dy * dy);
    var inner = vg.radius * (1 - vg.spread * 0.85);
    var vm = gSmooth(inner, Math.max(vg.radius, inner + 1e-4), dd);
    var vf = Math.pow(vm, Math.max(vg.falloff * 2 + 0.3, 0.05)) * clamp(vg.strength, 0, 1);
    var fade = 1 - vf;
    var r = [c[0] * fade * lerp(1, vgt[0], vf), c[1] * fade * lerp(1, vgt[1], vf), c[2] * fade * lerp(1, vgt[2], vf)];
    return gExposure(r, vg.exposure);
  };

  FX["haze-flare"] = function (c, cx) {
    if (!on(cx.en, "haze-flare")) return c;
    var T = cx.T, hz = T["haze-flare"].p;
    var hzt = wheelOf(T, "haze-flare", "tint");
    var uv = cx.uv, res = cx.res;
    var hr = 1 + hz.softness * 14;
    var glow = tapAvg(cx.sample, uv, res, boxOffsets(hr, false));
    var hazed = [glow[0] * hzt[0] + 0.02, glow[1] * hzt[1] + 0.02, glow[2] * hzt[2] + 0.02];
    var r = gMix(c, hazed, clamp(hz.spillage, 0, 1));
    if (hz.reflection && hz.reflectionExposure) {
      var hs = tapAvg(cx.sample, uv, res, lineOffsets(hz.reach * res[0] * 0.04, 0, 7));
      var k = hz.reflectionExposure * 0.15;
      r = [r[0] + hs[0] * hzt[0] * k, r[1] + hs[1] * hzt[1] * k, r[2] + hs[2] * hzt[2] * k];
    }
    var hbox = Math.max(Math.abs(uv[0] - 0.5), Math.abs(uv[1] - 0.5)) * 2;
    var hout = gSmooth(hz.matteBoxSize, hz.matteBoxSize + 0.08, hbox);
    if (hz.spillage > 0) {
      var shade = 1 - hout * hz.matteBoxShade * 0.85;
      r = [r[0] * shade, r[1] * shade, r[2] * shade];
    }
    return gExposure(r, hz.exposure);
  };

  FX["pop"] = function (c, cx) {
    if (!on(cx.en, "pop")) return c;
    var pp = cx.T.pop.p;
    if (!pp.pop) return c;
    var pr = 1 + pp.size * 3;
    var pb = tapAvg(cx.sample, cx.uv, cx.res, boxOffsets(pr, false));
    var pd = [c[0] - pb[0], c[1] - pb[1], c[2] - pb[2]];
    var pdet = Math.sqrt(pd[0] * pd[0] + pd[1] * pd[1] + pd[2] * pd[2]);
    var pkeep = 1 - pp.preserveDetail * gSmooth(0, 0.25, pdet);
    return [c[0] + pd[0] * pp.pop * pkeep, c[1] + pd[1] * pp.pop * pkeep, c[2] + pd[2] * pp.pop * pkeep];
  };

  FX["diffusion"] = function (c, cx) {
    if (!on(cx.en, "diffusion")) return c;
    var T = cx.T, dc = T.diffusion.p;
    if (dc.glow) {
      var dr = (1 + dc.size * 10) * (0.5 + dc.grade * 0.15);
      var dg = tapAvg(cx.sample, cx.uv, cx.res, boxOffsets(dr, true));
      var dl = gLuma(c);
      var dmask = gSmooth(dc.highlightsOnly * 0.7, Math.min(1, dc.highlightsOnly * 0.7 + 0.25), dl + dc.highlightBias * 0.15);
      var dct = wheelOf(T, "diffusion", "color");
      var k = dc.glow * dmask * (0.35 + dc.grade * 0.08);
      c = [c[0] + dg[0] * dct[0] * k, c[1] + dg[1] * dct[1] * k, c[2] + dg[2] * dct[2] * k];
    }
    return gExposure(c, dc.exposure);
  };

  // Line taps along angle; count matches lineOffsets (half = count >> 1).
  FX["star-filter"] = function (c, cx) {
    if (!on(cx.en, "star-filter")) return c;
    var T = cx.T, sf = T["star-filter"].p;
    if (sf.boost) {
      var sar = sf.angle * Math.PI / 180;
      var sr = 2 + sf.size * 40;
      var s1 = tapAvg(cx.sample, cx.uv, cx.res, lineOffsets(sr, sar, 5));
      var s2 = tapAvg(cx.sample, cx.uv, cx.res, lineOffsets(sr, sar + Math.PI / 2, 5));
      var sl = Math.max(gLuma(s1), gLuma(s2));
      var sm = clamp((sl - sf.threshold) / Math.max(1 - sf.threshold, 1e-3), 0, 1);
      if (sf.showThreshold) return [sm, sm, sm];
      var sct = wheelOf(T, "star-filter", "color");
      var k = sm * sf.boost * 0.3;
      return [c[0] + sct[0] * k, c[1] + sct[1] * k, c[2] + sct[2] * k];
    }
    return sf.showThreshold ? [0, 0, 0] : c;
  };

  FX["anamorphic-flare"] = function (c, cx) {
    if (!on(cx.en, "anamorphic-flare")) return c;
    var T = cx.T, af = T["anamorphic-flare"].p;
    if (af.boost) {
      var ar = Math.max(1, af.size * 20);
      var ag = tapAvg(cx.sample, cx.uv, cx.res, lineOffsets(ar, 0, 9));
      var al = gLuma(ag);
      var am = clamp((al - af.threshold) / Math.max(1 - af.threshold, 1e-3), 0, 1);
      if (af.showThreshold) return [am, am, am];
      var act = wheelOf(T, "anamorphic-flare", "color");
      var k = am * af.boost * 0.35;
      var r = [c[0] + act[0] * k, c[1] + act[1] * k, c[2] + act[2] * k];
      if (af.reflection) {
        var flip = cx.sample(1 - cx.uv[0], cx.uv[1]);
        var rb = Math.max(0, af.reflectionBoost) * 0.15;
        r = [r[0] + flip[0] * act[0] * rb, r[1] + flip[1] * act[1] * rb, r[2] + flip[2] * act[2] * rb];
      }
      return r;
    }
    return af.showThreshold ? [0, 0, 0] : c;
  };

  FX["edge-softness"] = function (c, cx) {
    if (!on(cx.en, "edge-softness")) return c;
    var es = cx.T["edge-softness"].p;
    if (!es.blurSize) return c;
    var uv = cx.uv;
    var ecx = 0.5 + es.centerX * 0.5, ecy = 0.5 + es.centerY * 0.5;
    var edx = (uv[0] - ecx) * es.aspect, edy = uv[1] - ecy;
    var ed = Math.sqrt(edx * edx + edy * edy);
    var eout = gSmooth(es.radius, es.radius + es.spread + 1e-4, ed);
    var er = es.blurSize * 300 * (0.5 + es.quality / 8);
    var eb = tapAvg(cx.sample, uv, cx.res, boxOffsets(er, false));
    return gMix(c, eb, eout * clamp(es.blurSize * 40, 0, 1));
  };

  FX["chromatic-aberration"] = function (c, cx) {
    if (!on(cx.en, "chromatic-aberration")) return c;
    var ca = cx.T["chromatic-aberration"].p;
    if (!(ca.redCyan || ca.greenMagenta || ca.blueYellow)) return c;
    var uv = cx.uv, s = cx.sample;
    var cox = uv[0] - 0.5, coy = uv[1] - 0.5;
    return [
      s(uv[0] + cox * ca.redCyan * 0.02, uv[1] + coy * ca.redCyan * 0.02)[0],
      s(uv[0] + cox * ca.greenMagenta * 0.02, uv[1] + coy * ca.greenMagenta * 0.02)[1],
      s(uv[0] - cox * ca.blueYellow * 0.02, uv[1] - coy * ca.blueYellow * 0.02)[2],
    ];
  };

  FX["shutter-streak"] = function (c, cx) {
    if (!on(cx.en, "shutter-streak")) return c;
    var sh = cx.T["shutter-streak"].p;
    var smix = clamp(sh.boost * 0.5, 0, 1);
    if (smix <= 0) return c;
    var shr = Math.max(1, sh.size * cx.res[0] * 0.02);
    var f = clamp(sh.falloff, 0, 1);
    var acc = [0, 0, 0], wsum = 0;
    for (var si = -4; si <= 4; si++) {
      var w = 1 + (1 - Math.abs(si) / 4 - 1) * f;
      var px = cx.sample(cx.uv[0] + shr * si / 4 / cx.res[0], cx.uv[1]);
      acc = [acc[0] + px[0] * w, acc[1] + px[1] * w, acc[2] + px[2] * w];
      wsum += w;
    }
    var div = Math.max(wsum, 0.001);
    return gMix(c, [acc[0] / div, acc[1] / div, acc[2] / div], smix);
  };

  FX["telecine-net"] = function (c, cx) {
    if (!on(cx.en, "telecine-net")) return c;
    var tn = cx.T["telecine-net"].p;
    if (tn.strength) {
      var tf = Math.max(tn.size, 0.004);
      var tu = cx.uv[0] / tf, tv = cx.uv[1] / tf;
      var fu = tu - Math.floor(tu), fv = tv - Math.floor(tv);
      var tdu = Math.min(fu, 1 - fu);
      var tdv = Math.min(fv, 1 - fv);
      var tnet = Math.max(1 - gSmooth(0, 0.03, tdu), 1 - gSmooth(0, 0.03, tdv));
      var k = 1 - tnet * tn.strength * 0.6;
      c = [c[0] * k, c[1] * k, c[2] * k];
    }
    return gExposure(c, tn.exposure);
  };

  grade.FX = FX;

  var DEFAULT_ORDER = null;
  function defaultOrder() {
    if (!DEFAULT_ORDER) DEFAULT_ORDER = Looks.tools.defaultChain();
    return DEFAULT_ORDER;
  }
  grade.defaultOrder = defaultOrder;

  // Lens Distortion resamples the source before the chain; the rest of the
  // chain runs in the given order.
  function gradePixel(c, uv, T, en, sample, res, luts, order) {
    order = order || defaultOrder();
    var lens = T["lens-distortion"].p;
    var u = uv;
    if (order.indexOf("lens-distortion") >= 0 && on(en, "lens-distortion") &&
        (lens.distortion || lens.flatten)) {
      var ox = uv[0] - 0.5, oy = uv[1] - 0.5;
      var r2 = ox * ox + oy * oy;
      var f = 1 + lens.distortion * r2 * 4;
      u = [0.5 + ox * f, 0.5 + oy * (1 + lens.distortion * r2 * 4 * lens.flatten)];
    }
    var cur = u === uv ? c : sample(u[0], u[1]);
    var cx = { T: T, en: en, uv: u, sample: sample, res: res, luts: luts };
    for (var i = 0; i < order.length; i++) {
      var id = order[i];
      var fn = FX[id];
      if (fn) cur = fn(cur, cx);
    }
    return cur;
  }
  grade.gradePixel = gradePixel;

  // Full-frame grade over flat RGBA bytes (0..255). Returns a new array,
  // alpha preserved. Bilinear clamped sampler; texel centers at (i+0.5)/size.
  function gradeImage(data, w, h, T, en, order) {
    var src = new Array(w * h * 4);
    var i;
    for (i = 0; i < data.length; i++) src[i] = data[i];
    function at(px, py) {
      var x = clamp(Math.round(px), 0, w - 1);
      var y = clamp(Math.round(py), 0, h - 1);
      var k = (y * w + x) * 4;
      return [src[k] / 255, src[k + 1] / 255, src[k + 2] / 255];
    }
    function sample(u, v) {
      var x = clamp(u, 0, 1) * w - 0.5;
      var y = clamp(v, 0, 1) * h - 0.5;
      var x0 = Math.floor(x), y0 = Math.floor(y);
      var tx = x - x0, ty = y - y0;
      var a = at(x0, y0), b = at(x0 + 1, y0), cc = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return [
        lerp(lerp(a[0], b[0], tx), lerp(cc[0], d[0], tx), ty),
        lerp(lerp(a[1], b[1], tx), lerp(cc[1], d[1], tx), ty),
        lerp(lerp(a[2], b[2], tx), lerp(cc[2], d[2], tx), ty),
      ];
    }
    var luts = frameLutsFrom(T);
    var out = new Array(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var k = (y * w + x) * 4;
        var uv = [(x + 0.5) / w, (y + 0.5) / h];
        var g = gradePixel(sample(uv[0], uv[1]), uv, T, en, sample, [w, h], luts, order);
        out[k] = clamp(g[0], 0, 1) * 255;
        out[k + 1] = clamp(g[1], 0, 1) * 255;
        out[k + 2] = clamp(g[2], 0, 1) * 255;
        out[k + 3] = src[k + 3];
      }
    }
    return out;
  }
  grade.gradeImage = gradeImage;

  Looks.grade = grade;
})(Looks);
