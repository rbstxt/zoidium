"use strict";

// Magic Looks — pure color math (no DOM). Shared by the canvas widgets and
// the setup shell; unit-tested in looks-catalog.test.js.

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

  // Wheel dot (angle degrees, radius 0..1) -> tint color. Center is white,
  // matching the Looks readouts (centered dot reads 1.000/1.000/1.000).
  function wheelTint(angleDeg, radius) {
    radius = clamp(radius, 0, 1);
    if (radius < 1e-6) return [1, 1, 1];
    var pure = hsvToRgb(angleDeg, 1, 1);
    return [
      lerp(1, pure[0], radius),
      lerp(1, pure[1], radius),
      lerp(1, pure[2], radius),
    ];
  }
  color.wheelTint = wheelTint;

  // Tint color -> wheel dot { angle, radius }. White maps to the center.
  function tintToDot(r, g, b) {
    var hsv = rgbToHsv(clamp(r, 0, 2), clamp(g, 0, 2), clamp(b, 0, 2));
    var sat = hsv.v === 0 ? 0 : 1 - Math.min(r, g, b) / hsv.v;
    return { angle: hsv.h, radius: clamp(sat, 0, 1) };
  }
  color.tintToDot = tintToDot;

  // Gaussian hump for the 4-way ranges graph.
  function gauss(x, mu, sig) {
    var d = (x - mu) / sig;
    return Math.exp(-0.5 * d * d);
  }
  color.gauss = gauss;

  // Cubic bezier point (S-curve handles).
  function cubic(p0, c1, c2, p3, t) {
    var u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    };
  }
  color.cubic = cubic;

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

  // Parse an edited readout back to a number. Accepts %, +/- and plain.
  function parseNum(text, schema) {
    if (typeof text !== "string") return null;
    var t = text.trim().replace("%", "");
    if (!/^[-+0-9][0-9.,eE+-]*$/.test(t)) return null;
    var v = parseFloat(t.replace(",", "."));
    if (!isFinite(v)) return null;
    if (schema && schema.percent && text.indexOf("%") === -1) {
      // Bare numbers for percent fields stay raw (50 -> 0.5 only if the
      // schema stores fractions and the user typed a fraction).
      if (Math.abs(v) > 1 && schema.fraction) v = v / 100;
    } else if (schema && schema.percent && text.indexOf("%") !== -1 && schema.fraction) {
      v = v / 100;
    }
    if (schema) {
      if (schema.min !== undefined) v = Math.max(schema.min, v);
      if (schema.max !== undefined) v = Math.min(schema.max, v);
    }
    return v;
  }
  color.parseNum = parseNum;

  Looks.color = color;

  /* ================= grade engine (JS reference pipeline) =================
   * Pure per-pixel color pipeline mirroring the looks-grade.glsl shader
   * op-for-op. gradePixel(c, uv, T, en, sample, res) grades one pixel:
   * c is [r,g,b], uv is [0,1], T is the tools map (defaultState().tools
   * shape), en is the enable map (missing entries read as on), sample is
   * a bilinear (u,v)->[r,g,b] source reader, res is [w,h] px.
   * gradeImage(data, w, h, T, en) runs the full frame (data = flat RGBA
   * array, alpha preserved) for tests and probes.
   */

  var grade = {};

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

  function gSmooth(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  grade.smoothstep = gSmooth;

  function circDist(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  grade.circDist = circDist;

  function hueOf(c) {
    return rgbToHsv(clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)).h;
  }
  grade.hueOf = hueOf;

  // Sorted zone weights from three threshold params (robust to any order).
  function zoneWeights(l, t0, t1, t2, edge) {
    var ts = [t0, t1, t2].sort(function (a, b) { return a - b; });
    var lo = ts[0], mid = ts[1], hi = ts[2];
    var e = edge === undefined ? 0.2 : edge;
    var sh = 1 - gSmooth(lo, mid, l);
    var hh = gSmooth(mid, hi, l);
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

  // Bezier S-curve sampled into a 256-entry LUT (parametric x(t),y(t)).
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
      if (v === x) {
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

  // Per-channel 256 LUTs from the Curves state, composed with the S-curve
  // over the black/white input range.
  function buildChannelLUTs(curves, scurve) {
    var sc = scurve ? evalScurveLUT(scurve) : null;
    var out = {};
    ["Red", "Green", "Blue"].forEach(function (ch) {
      var pts = (curves.channels && curves.channels[ch]) || [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      var arr = new Array(256);
      for (var k = 0; k < 256; k++) {
        var x = k / 255;
        var xr = scurve ? clamp((x - scurve.black) / Math.max(1e-6, scurve.white - scurve.black), 0, 1) : x;
        var y = clamp(evalPolyline(pts, xr), 0, 1);
        if (sc) y = sc[clamp(Math.round(y * 255), 0, 255)];
        arr[k] = y;
      }
      out[ch] = arr;
    });
    return out;
  }
  grade.buildChannelLUTs = buildChannelLUTs;

  function lutSample(lut, x) {
    var f = clamp(x, 0, 1) * 255;
    var i = Math.floor(f);
    var t = f - i;
    var a = lut[Math.min(255, i)];
    var b = lut[Math.min(255, i + 1)];
    return lerp(a, b, t);
  }

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

  function lineOffsets(r, angleRad, count) {
    var o = [];
    var dx = Math.cos(angleRad), dy = Math.sin(angleRad);
    for (var i = -(count >> 1); i <= (count >> 1); i++) {
      o.push([dx * r * i / ((count >> 1) || 1), dy * r * i / ((count >> 1) || 1)]);
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

  function gradePixel(c, uv, T, en, sample, res, luts) {
    var i, r, m;
    // 1. Lens distortion first (geometric): resample the source. All later
    // taps share the distorted coordinates, like the shader.
    var lens = T["lens-distortion"].p;
    if (on(en, "lens-distortion") && (lens.distortion || lens.flatten)) {
      var ox = uv[0] - 0.5, oy = uv[1] - 0.5;
      var r2 = ox * ox + oy * oy;
      var f = 1 + lens.distortion * r2 * 4;
      uv = [0.5 + ox * f, 0.5 + oy * (1 + lens.distortion * r2 * 4 * lens.flatten)];
    }
    c = sample(uv[0], uv[1]);

    // 2. Lift-Gamma-Gain.
    if (on(en, "lift-gamma-gain")) {
      var lg = T["lift-gamma-gain"];
      var lift = wheelOf(T, "lift-gamma-gain", "lift");
      var gam = wheelOf(T, "lift-gamma-gain", "gamma");
      var gain = wheelOf(T, "lift-gamma-gain", "gain");
      var gs = lg.p.gammaSpace / 2.2;
      r = [Math.pow(Math.max(c[0], 0), gs), Math.pow(Math.max(c[1], 0), gs), Math.pow(Math.max(c[2], 0), gs)];
      r = [r[0] + (lift[0] - 1), r[1] + (lift[1] - 1), r[2] + (lift[2] - 1)];
      r = [r[0] * gain[0], r[1] * gain[1], r[2] * gain[2]];
      r = [Math.pow(Math.max(r[0], 0), 1 / Math.max(gam[0], 1e-3)),
        Math.pow(Math.max(r[1], 0), 1 / Math.max(gam[1], 1e-3)),
        Math.pow(Math.max(r[2], 0), 1 / Math.max(gam[2], 1e-3))];
      r = [Math.pow(Math.max(r[0], 0), 2.2 / lg.p.gammaSpace),
        Math.pow(Math.max(r[1], 0), 2.2 / lg.p.gammaSpace),
        Math.pow(Math.max(r[2], 0), 2.2 / lg.p.gammaSpace)];
      c = gMix(c, r, lg.p.strength);
      c = gExposure(c, lg.p.exposure);
    }

    // 3. Contrast + Color Contrast + Crush.
    if (on(en, "contrast")) {
      var cn = T.contrast.p;
      c = gContrast(c, cn.contrast, cn.pivot);
      c = gExposure(c, cn.exposure);
    }
    if (on(en, "color-contrast")) {
      var cc = T["color-contrast"];
      // Fixed contrast amount (no knob in the reference panel).
      r = gContrast(c, 0.37, cc.p.pivot);
      var ct = wheelOf(T, "color-contrast", "contrast");
      r = [r[0] * ct[0], r[1] * ct[1], r[2] * ct[2]];
      c = r;
      c = gExposure(c, cc.p.exposure);
    }
    if (on(en, "crush")) {
      var cr = T.crush;
      var crt = wheelOf(T, "crush", "color");
      r = [Math.pow(Math.max(c[0], 0), cr.p.gamma),
        Math.pow(Math.max(c[1], 0), cr.p.gamma),
        Math.pow(Math.max(c[2], 0), cr.p.gamma)];
      r = [r[0] * crt[0], r[1] * crt[1], r[2] * crt[2]];
      c = r;
      c = gExposure(c, cr.p.exposure);
    }

    // 4. Ranged Saturation.
    if (on(en, "ranged-saturation")) {
      var rs = T["ranged-saturation"].p;
      var l0 = gLuma(c);
      var zw = zoneWeights(l0, rs.thresholdShadow, rs.thresholdMidtone, rs.thresholdHighlight, 0.2);
      var ss = zw[0] * rs.satShadow + zw[1] * rs.satMidtone + zw[2] * rs.satHighlight;
      r = gSat(c, ss);
      var rhT = wheelOf(T, "color-ranges", "highlight");
      var rmT = wheelOf(T, "color-ranges", "midtone");
      var rsT = wheelOf(T, "color-ranges", "shadow");
      r = [r[0] * lerp(1, rhT[0], zw[2]) * lerp(1, rmT[0], zw[1]) * lerp(1, rsT[0], zw[0]),
        r[1] * lerp(1, rhT[1], zw[2]) * lerp(1, rmT[1], zw[1]) * lerp(1, rsT[1], zw[0]),
        r[2] * lerp(1, rhT[2], zw[2]) * lerp(1, rmT[2], zw[1]) * lerp(1, rsT[2], zw[0])];
      var bt = wheelOf(T, "ranged-saturation", "balance");
      r = [r[0] * bt[0], r[1] * bt[1], r[2] * bt[2]];
      c = rs.showThreshold ? [zw[0], zw[1], zw[2]] : r;
      c = gExposure(c, rs.exposure);
    }

    // 5. Mojo II (documented approximation).
    if (on(en, "mojo")) {
      var mj = T.mojo.p;
      var ml = gLuma(c);
      r = gSat(c, 1 + mj.punch * 1.5);
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
      c = gMix(c, r, clamp(mj.mojo, 0, 1) * clamp(mj.strength, 0, 1));
    }

    // 6. 3-Strip dye matrix.
    if (on(en, "three-strip")) {
      var ts = T["three-strip"].p;
      r = [c[0] * 0.88 + c[1] * 0.08 + c[2] * 0.04,
        c[0] * 0.06 + c[1] * 0.82 + c[2] * 0.12,
        c[0] * 0.08 + c[1] * 0.10 + c[2] * 0.82];
      c = gMix(c, r, clamp(ts.strength, 0, 1));
      c = gExposure(c, ts.exposure);
    }

    // 7. Color Reversal + Auto Shoulder.
    if (on(en, "color-reversal")) {
      var crv = T["color-reversal"].p;
      c = gMix(c, [1 - c[0], 1 - c[1], 1 - c[2]], clamp(crv.strength, 0, 1));
      c = gExposure(c, crv.exposure);
    }
    if (on(en, "auto-shoulder")) {
      var ash = T["auto-shoulder"].p;
      r = [c[0] / (c[0] + 0.18) * 1.18, c[1] / (c[1] + 0.18) * 1.18, c[2] / (c[2] + 0.18) * 1.18];
      c = gMix(c, r, clamp(ash.strength, 0, 1));
    }

    // 8. HSL selective.
    if (on(en, "hsl-colors")) {
      var hx = T["hsl-colors"].x.hsl;
      var hues = [0, 30, 60, 120, 180, 240, 270, 300];
      var h = hueOf(c);
      var satS = 1, lite = 0;
      for (i = 0; i < 8; i++) {
        var g8 = Math.exp(-Math.pow(circDist(h, hues[i]) / 28, 2));
        satS += (hx[i] ? hx[i].sat : 0) * g8;
        lite += (hx[i] ? hx[i].light : 0) * g8 * 0.5;
      }
      r = gSat(c, Math.max(0, satS));
      r = [r[0] + lite, r[1] + lite, r[2] + lite];
      c = r;
    }

    // 9. Warm/Cool + 4-Way.
    if (on(en, "warm-cool")) {
      var wc = T["warm-cool"].p;
      r = [c[0] + wc.warmCool * 0.28 + wc.tint * 0.18,
        c[1] + wc.warmCool * 0.12 - wc.tint * 0.18,
        c[2] - wc.warmCool * 0.28 + wc.tint * 0.18];
      c = r;
      c = gExposure(c, wc.exposure);
    }
    if (on(en, "four-way")) {
      var fw = T["four-way"];
      var g4 = fw.x.fourway;
      var lw = gLuma(c);
      var fsh = 1 - gSmooth(0.2, 0.5, lw);
      var fhi = gSmooth(0.5, 0.8, lw);
      var fmid = clamp(1 - fsh - fhi, 0, 1);
      var s4 = clamp(fw.p.strength, 0, 1);
      function fwTint(slot) {
        var s = g4 ? g4[slot] : null;
        if (!s) return [1, 1, 1];
        return s.rgb || s;
      }
      function zoneMult(tint, w) {
        return [1 + (tint[0] - 1) * w * s4, 1 + (tint[1] - 1) * w * s4, 1 + (tint[2] - 1) * w * s4];
      }
      var mS = zoneMult(fwTint("shadows"), fsh);
      var mM = zoneMult(fwTint("midtones"), fmid);
      var mH = zoneMult(fwTint("highlights"), fhi);
      var mG = fwTint("global");
      r = [c[0] * mS[0] * mM[0] * mH[0] * (1 + (mG[0] - 1) * s4),
        c[1] * mS[1] * mM[1] * mH[1] * (1 + (mG[1] - 1) * s4),
        c[2] * mS[2] * mM[2] * mH[2] * (1 + (mG[2] - 1) * s4)];
      r = gContrast(r, fw.p.contrast, 0.18);
      c = gExposure(r, fw.p.exposure);
    }

    // 10. Curves + S-curve channel LUTs (prebuilt per frame).
    if (on(en, "curves") && luts) {
      c = [lutSample(luts.r, c[0]), lutSample(luts.g, c[1]), lutSample(luts.b, c[2])];
    }

    // 11. LUT tool (built-in analytic looks + gamma wrap).
    if (on(en, "lut")) {
      var lx = T.lut.x.lut;
      if (lx.name !== "None") {
        r = c.slice();
        if (lx.gamma === "Input") {
          r = [Math.pow(Math.max(r[0], 0), 2.2), Math.pow(Math.max(r[1], 0), 2.2), Math.pow(Math.max(r[2], 0), 2.2)];
        }
        if (lx.name === "Hot") {
          r = [r[0] * 1.1 + 0.035, r[1] * 1.0 + 0.012, r[2] * 0.88 - 0.02];
        } else if (lx.name === "Cold") {
          r = [r[0] * 0.9 - 0.02, r[1] * 0.97, r[2] * 1.1 + 0.03];
        } else if (lx.name === "Noir") {
          r = gSat(r, 0.2);
          r = gContrast(r, 0.35, 0.18);
        }
        if (lx.gamma === "Output") {
          r = [Math.pow(Math.max(r[0], 0), 1 / 2.2), Math.pow(Math.max(r[1], 0), 1 / 2.2), Math.pow(Math.max(r[2], 0), 1 / 2.2)];
        }
        c = gMix(c, r, clamp(lx.strength, 0, 1));
      }
    }

    // 12. Lightflex.
    if (on(en, "lightflex")) {
      var lf = T.lightflex;
      var lfl = gLuma(c);
      var lft = wheelOf(T, "lightflex", "color");
      r = [c[0] + lft[0] * (lf.p.boost * 0.045) * (1 - lfl),
        c[1] + lft[1] * (lf.p.boost * 0.045) * (1 - lfl),
        c[2] + lft[2] * (lf.p.boost * 0.045) * (1 - lfl)];
      c = r;
      c = gExposure(c, lf.p.exposure);
    }

    // 13. Deflare.
    if (on(en, "deflare")) {
      var df = T.deflare.p;
      var dfl = gLuma(c);
      var dff = gSmooth(0.55, 0.95, dfl) * clamp(df.strength, 0, 1);
      r = gMix(c, [dfl, dfl, dfl], dff * 0.7);
      r = [r[0] + dff * 0.05, r[1] + dff * 0.05, r[2] + dff * 0.05];
      c = r;
      c = gExposure(c, df.exposure);
    }

    // 14. Vignette.
    if (on(en, "vignette")) {
      var vg = T.vignette.p;
      var vgt = wheelOf(T, "vignette", "color");
      var cenx = 0.5 + vg.centerX * 0.5, ceny = 0.5 + vg.centerY * 0.5;
      var dx = (uv[0] - cenx) * vg.aspect, dy = uv[1] - ceny;
      var dd = Math.sqrt(dx * dx + dy * dy);
      var inner = vg.radius * (1 - vg.spread * 0.85);
      var vm = gSmooth(inner, Math.max(vg.radius, inner + 1e-4), dd);
      var vf = Math.pow(vm, vg.falloff * 2 + 0.3) * clamp(vg.strength, 0, 1);
      r = [c[0] * lerp(1, vgt[0], vf), c[1] * lerp(1, vgt[1], vf), c[2] * lerp(1, vgt[2], vf)];
      c = r;
      c = gExposure(c, vg.exposure);
    }

    // 15. Haze/Flare.
    if (on(en, "haze-flare")) {
      var hz = T["haze-flare"].p;
      var hzt = wheelOf(T, "haze-flare", "tint");
      var hr = 1 + hz.softness * 14;
      var glow = tapAvg(sample, uv, res, boxOffsets(hr, false));
      var hazed = [glow[0] * hzt[0] + 0.02, glow[1] * hzt[1] + 0.02, glow[2] * hzt[2] + 0.02];
      r = gMix(c, hazed, clamp(hz.spillage, 0, 1));
      if (hz.reflection && hz.reflectionExposure) {
        var hs = tapAvg(sample, uv, res, lineOffsets(hz.reach * res[0] * 0.04, 0, 7));
        r = [r[0] + hs[0] * hzt[0] * hz.reflectionExposure * 0.15,
          r[1] + hs[1] * hzt[1] * hz.reflectionExposure * 0.15,
          r[2] + hs[2] * hzt[2] * hz.reflectionExposure * 0.15];
      }
      var hbox = Math.max(Math.abs(uv[0] - 0.5), Math.abs(uv[1] - 0.5)) * 2;
      var hout = gSmooth(hz.matteBoxSize, hz.matteBoxSize + 0.08, hbox);
      if (hz.spillage > 0) {
        r = [r[0] * (1 - hout * hz.matteBoxShade * 0.85),
          r[1] * (1 - hout * hz.matteBoxShade * 0.85),
          r[2] * (1 - hout * hz.matteBoxShade * 0.85)];
      }
      c = r;
      c = gExposure(c, hz.exposure);
    }

    // 16. Pop (unsharp).
    if (on(en, "pop")) {
      var pp = T.pop.p;
      if (pp.pop) {
        var pr = 1 + pp.size * 3;
        var pb = tapAvg(sample, uv, res, boxOffsets(pr, false));
        var pdet = Math.sqrt((c[0] - pb[0]) * (c[0] - pb[0]) + (c[1] - pb[1]) * (c[1] - pb[1]) + (c[2] - pb[2]) * (c[2] - pb[2]));
        var pkeep = 1 - pp.preserveDetail * gSmooth(0, 0.25, pdet);
        r = [c[0] + (c[0] - pb[0]) * pp.pop * pkeep,
          c[1] + (c[1] - pb[1]) * pp.pop * pkeep,
          c[2] + (c[2] - pb[2]) * pp.pop * pkeep];
        c = r;
      }
    }

    // 17. Diffusion glow.
    if (on(en, "diffusion")) {
      var dc = T.diffusion.p;
      if (dc.glow) {
        var dr = (1 + dc.size * 10) * (0.5 + dc.grade * 0.15);
        var dg = tapAvg(sample, uv, res, boxOffsets(dr, true));
        var dl = gLuma(c);
        var dmask = gSmooth(dc.highlightsOnly * 0.7, Math.min(1, dc.highlightsOnly * 0.7 + 0.25), dl + dc.highlightBias * 0.15);
        var dct = wheelOf(T, "diffusion", "color");
        var dResp = 0.35 + dc.grade * 0.08;
        r = [c[0] + dg[0] * dct[0] * dc.glow * dmask * dResp,
          c[1] + dg[1] * dct[1] * dc.glow * dmask * dResp,
          c[2] + dg[2] * dct[2] * dc.glow * dmask * dResp];
        c = r;
      }
      c = gExposure(c, dc.exposure);
    }

    // 18. Star Filter streaks.
    if (on(en, "star-filter")) {
      var sf = T["star-filter"].p;
      if (sf.boost) {
        var sa = T["star-filter"].x.angle || 0;
        var sar = sa * Math.PI / 180;
        var sr = 2 + sf.size * 40;
        var s1 = tapAvg(sample, uv, res, lineOffsets(sr, sar, 5));
        var s2 = tapAvg(sample, uv, res, lineOffsets(sr, sar + Math.PI / 2, 5));
        var sl = Math.max(gLuma(s1), gLuma(s2));
        var sm = clamp((sl - sf.threshold) / Math.max(1 - sf.threshold, 1e-3), 0, 1);
        var sct = wheelOf(T, "star-filter", "color");
        r = [c[0] + sct[0] * sm * sf.boost * 0.3,
          c[1] + sct[1] * sf.boost * 0.3 * sm,
          c[2] + sct[2] * sm * sf.boost * 0.3];
        c = sf.showThreshold ? [sm, sm, sm] : r;
      } else if (sf.showThreshold) {
        c = [0, 0, 0];
      }
    }

    // 19. Anamorphic Flare.
    if (on(en, "anamorphic-flare")) {
      var af = T["anamorphic-flare"].p;
      if (af.boost) {
        var ar = Math.max(1, af.size * 20);
        var ag = tapAvg(sample, uv, res, lineOffsets(ar, 0, 9));
        var al = gLuma(ag);
        var am = clamp((al - af.threshold) / Math.max(1 - af.threshold, 1e-3), 0, 1);
        var act = wheelOf(T, "anamorphic-flare", "color");
        r = [c[0] + act[0] * am * af.boost * 0.35,
          c[1] + act[1] * am * af.boost * 0.35,
          c[2] + act[2] * am * af.boost * 0.35];
        if (af.reflection) {
          var flip = sample(1 - uv[0], uv[1]);
          var rb = Math.max(0, af.reflectionBoost);
          r = [r[0] + flip[0] * act[0] * rb * 0.15,
            r[1] + flip[1] * act[1] * rb * 0.15,
            r[2] + flip[2] * act[2] * rb * 0.15];
        }
        c = af.showThreshold ? [am, am, am] : r;
      } else if (af.showThreshold) {
        c = [0, 0, 0];
      }
    }

    // 20. Edge Softness.
    if (on(en, "edge-softness")) {
      var es = T["edge-softness"].p;
      if (es.blurSize) {
        var ecx = 0.5 + es.centerX * 0.5, ecy = 0.5 + es.centerY * 0.5;
        var edx = (uv[0] - ecx) * es.aspect, edy = uv[1] - ecy;
        var ed = Math.sqrt(edx * edx + edy * edy);
        var eout = gSmooth(es.radius, es.radius + es.spread + 1e-4, ed);
        var er = es.blurSize * 300 * (0.5 + es.quality / 8);
        var eb = tapAvg(sample, uv, res, boxOffsets(er, false));
        c = gMix(c, eb, eout * clamp(es.blurSize * 40, 0, 1));
      }
    }

    // 21. Chromatic Aberration.
    if (on(en, "chromatic-aberration")) {
      var ca = T["chromatic-aberration"].p;
      if (ca.redCyan || ca.greenMagenta || ca.blueYellow) {
        var cox = uv[0] - 0.5, coy = uv[1] - 0.5;
        c = [sample(uv[0] + cox * ca.redCyan * 0.02, uv[1] + coy * ca.redCyan * 0.02)[0],
          sample(uv[0] + cox * ca.greenMagenta * 0.02, uv[1] + coy * ca.greenMagenta * 0.02)[1],
          sample(uv[0] - cox * ca.blueYellow * 0.02, uv[1] - coy * ca.blueYellow * 0.02)[2]];
      }
    }

    // 22. Shutter Streak.
    if (on(en, "shutter-streak")) {
      var sh = T["shutter-streak"].p;
      var smix = clamp(sh.boost * 0.5, 0, 1);
      if (smix > 0) {
        var shr = Math.max(1, sh.size * res[0] * 0.02);
        var offs = [];
        for (var si = -4; si <= 4; si++) {
          offs.push([shr * si / 4, 0]);
        }
        var smear = tapAvg(sample, uv, res, offs);
        c = gMix(c, smear, smix);
      }
    }

    // 23. Telecine Net.
    if (on(en, "telecine-net")) {
      var tn = T["telecine-net"].p;
      if (tn.strength) {
        var tf = Math.max(tn.size, 0.004);
        var tu = uv[0] / tf, tv = uv[1] / tf;
        var tdu = Math.min(tu - Math.floor(tu), 1 - (tu - Math.floor(tu)));
        var tdv = Math.min(tv - Math.floor(tv), 1 - (tv - Math.floor(tv)));
        var tnet = Math.max(1 - gSmooth(0, 0.03, tdu), 1 - gSmooth(0, 0.03, tdv));
        r = [c[0] * (1 - tnet * tn.strength * 0.6),
          c[1] * (1 - tnet * tn.strength * 0.6),
          c[2] * (1 - tnet * tn.strength * 0.6)];
        c = r;
      }
      c = gExposure(c, tn.exposure);
    }

    return c;
  }
  grade.gradePixel = gradePixel;

  // Per-frame channel LUTs from the Curves + S-curve state (built once per
  // frame by gradeImage and by the effect update path).
  function buildFrameLuts(T) {
    var curves = T.curves && T.curves.x.curves;
    var scurve = T["s-curve"] && T["s-curve"].x.scurve;
    if (!curves) return null;
    var per = buildChannelLUTs(curves, scurve);
    return { r: per.Red, g: per.Green, b: per.Blue };
  }
  grade.buildFrameLuts = buildFrameLuts;

  // Full-frame grade over flat RGBA bytes (0..255). Returns a new array,
  // alpha preserved. Bilinear clamped sampler.
  function gradeImage(data, w, h, T, en) {
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
      // Texel centers sit at (i+0.5)/size, matching GPU sampling, so grid
      // pixels land on texels exactly and fractional taps blend correctly.
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
    var luts = buildFrameLuts(T);
    var out = new Array(w * h * 4);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var k = (y * w + x) * 4;
        var uv = [(x + 0.5) / w, (y + 0.5) / h];
        var c = [src[k] / 255, src[k + 1] / 255, src[k + 2] / 255];
        var g = gradePixel(c, uv, T, en, sample, [w, h], luts);
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
