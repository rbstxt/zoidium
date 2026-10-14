// Algorithm adapted from EffectCraft (MIT OR Apache-2.0).
//
// Pure deterministic math shared by the fx-trans Native FX effects
// (CC Page Turn, Card Wipe, CC Pixel Polly, Radial Shadow) and by their
// node:test suites. No PZ/THREE/DOM access; loads in Node via require and
// in effects via ZoidiumPluginApis.modules.createRequire.
(function defineFxTransMath(factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else if (typeof globalThis !== "undefined") globalThis.ZoidiumFxTransMath = api;
})(function factory() {
  "use strict";

  // Exact port of EffectCraft effectcraft_raster::hash_noise: deterministic
  // per (x, y, seed) value in [0, 1).
  function hashNoise(x, y, seed) {
    var h = (Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(seed | 0, 0xcb1ab31f)) | 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 16777216 / 256;
  }

  function h01(i, k, seed) {
    return hashNoise(i | 0, k | 0, seed | 0);
  }

  function hsigned(i, k, seed) {
    return hashNoise(i | 0, k | 0, seed | 0) * 2 - 1;
  }

  // Card Wipe seed folding: randomSeed ^ 0xca7d (as in card_wipe_plan).
  function foldSeed(randomSeed) {
    var s = Math.trunc(Number(randomSeed) || 0) >>> 0;
    return (s ^ 0xca7d) | 0;
  }

  // Flip-order offset o in [0, 1] for card (i, j); gradLum is the card
  // centre luminance used only by order 8 (Gradient, sampled from the layer
  // itself like the reference default).
  function cardOrderOffset(order, i, j, cols, rows, gradLum) {
    var nx = cols > 1 ? i / (cols - 1) : 0;
    var ny = rows > 1 ? j / (rows - 1) : 0;
    switch (order) {
      case 1: return 1 - nx;
      case 2: return ny;
      case 3: return 1 - ny;
      case 4: return (nx + ny) * 0.5;
      case 5: return (1 - nx + ny) * 0.5;
      case 6: return (nx + 1 - ny) * 0.5;
      case 7: return 1 - (nx + ny) * 0.5;
      case 8: {
        var l = Number(gradLum);
        if (!Number.isFinite(l)) l = 0;
        return Math.min(1, Math.max(0, l));
      }
      default: return nx;
    }
  }

  // Per-card progress p in [0, 1] from overall completion done in [0, 1].
  function cardProgress(done, o, transitionWidth) {
    var tw = Math.min(1, Math.max(0.01, Number(transitionWidth) || 0));
    var p = (done - o * (1 - tw)) / tw;
    return Math.min(1, Math.max(0, p));
  }

  // Per-card random draws in [0, 1): flip-axis coin, flip-direction coin,
  // timing jitter. cellIndex = j * cols + i (stable identity per card).
  function cardRandoms(cellIndex, j, seed) {
    return {
      axis: h01(cellIndex, j, seed ^ 0x55),
      dir: h01(cellIndex, j, seed ^ 0x99),
      jit: h01(cellIndex, j, seed ^ 0x7177),
    };
  }

  // Axis-angle rotation matrix (row-major 3x3), port of card3d::rot_axis.
  function rotAxis3(ax, ay, az, angle) {
    var len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!(len > 1e-12)) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    var x = ax / len;
    var y = ay / len;
    var z = az / len;
    var c = Math.cos(angle);
    var s = Math.sin(angle);
    var t = 1 - c;
    return [
      [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
      [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
      [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
    ];
  }

  // Facing of a rotated surface whose rest normal is +z.
  function facingOf(rot) {
    return rot[2][2];
  }

  // CC Pixel Polly piece plan: analytic (no simulation history) piece
  // positions for time t (seconds since start). Coordinates are layer
  // pixels with the origin at the layer top-left; z grows toward the
  // viewer. Mirrors pixel_polly_plan (force falloff, gravity term,
  // spin, depth order stable by cell index).
  function pollyPlan(options) {
    var lw = Math.max(1, Number(options.layerWidth) || 1);
    var lh = Math.max(1, Number(options.layerHeight) || 1);
    var force = Number(options.force) || 0;
    var gravity = Number(options.gravity) || 0;
    var spin = (Number(options.spinning) || 0) * Math.PI / 180;
    var fc = options.forceCenter || [lw / 2, lh / 2];
    var dirRand = (Number(options.directionRandomness) || 0) / 100;
    var spdRand = (Number(options.speedRandomness) || 0) / 100;
    var spacing = Math.max(1, Number(options.gridSpacing) || 1);
    var object = Math.max(0, Math.min(3, Math.round(Number(options.object) || 0)));
    var depthSort = !!options.enableDepthSort;
    var seed = Math.imul(Math.trunc(Number(options.randomSeed) || 0) | 0, 0x632be5ab);
    var t = Number(options.t) || 0;
    var maxPieces = Math.max(1, Math.round(Number(options.maxPieces) || 8192));
    var g = spacing;
    var nx = Math.max(1, Math.ceil(lw / g));
    var ny = Math.max(1, Math.ceil(lh / g));
    var tri = object <= 1;
    var per = tri ? 2 : 1;
    while (nx * ny * per > maxPieces) {
      g *= 1.25;
      nx = Math.max(1, Math.ceil(lw / g));
      ny = Math.max(1, Math.ceil(lh / g));
    }
    var textured = object === 1 || object === 3;
    var maxd = Math.max(lw, lh);
    var pieces = [];
    var total = nx * ny * per;
    for (var n = 0; n < total; n++) {
      var cell = Math.floor(n / per);
      var ci = cell % nx;
      var cj = Math.floor(cell / nx);
      var x0 = ci * g;
      var y0 = cj * g;
      var poly;
      if (!tri) {
        poly = [[x0, y0], [x0 + g, y0], [x0 + g, y0 + g], [x0, y0 + g]];
      } else if (n % 2 === 0) {
        poly = [[x0, y0], [x0 + g, y0], [x0, y0 + g]];
      } else {
        poly = [[x0 + g, y0], [x0 + g, y0 + g], [x0, y0 + g]];
      }
      var cx = 0;
      var cy = 0;
      for (var q = 0; q < poly.length; q++) {
        cx += poly[q][0];
        cy += poly[q][1];
      }
      cx /= poly.length;
      cy /= poly.length;
      var dx = cx - fc[0];
      var dy = cy - fc[1];
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (!(dist > 1e-6)) dist = 1e-6;
      var ang = Math.atan2(dy, dx) + dirRand * Math.PI * hsigned(n, 1, seed);
      var speed = (force / 100) * 0.6 * maxd / (1 + dist / (0.5 * maxd)) * (1 + spdRand * hsigned(n, 2, seed));
      var vz = -speed * 0.5 * h01(n, 3, seed);
      var pos = [
        cx + Math.cos(ang) * speed * t,
        cy + Math.sin(ang) * speed * t + 0.25 * gravity * lh * t * t,
        vz * t,
      ];
      var axis = [hsigned(n, 4, seed), hsigned(n, 5, seed), hsigned(n, 6, seed)];
      var rot = rotAxis3(axis[0], axis[1], axis[2], t * (Math.PI * h01(n, 7, seed) + spin));
      var shade = 0.35 + 0.65 * facingOf(rot);
      if (!(shade > 0)) shade = 0;
      pieces.push({ index: n, poly: poly, center: [cx, cy], pos: pos, rot: rot, shade: shade, textured: textured });
    }
    if (depthSort) {
      pieces.sort(function (a, b) {
        if (a.pos[2] !== b.pos[2]) return a.pos[2] - b.pos[2];
        return a.index - b.index;
      });
    }
    return { pieces: pieces, cols: nx, rows: ny, spacing: g, textured: textured };
  }

  // Project a piece corner offset (dx, dy layer px from the piece centre)
  // through the piece rotation/translation with a simple perspective camera
  // (distance camD layer px in front of the layer centre). Returns screen
  // layer px plus the perspective scale.
  function projectCorner(dx, dy, piece, layerWidth, layerHeight, camD) {
    var r = piece.rot;
    var px = r[0][0] * dx + r[0][1] * dy + piece.pos[0];
    var py = r[1][0] * dx + r[1][1] * dy + piece.pos[1];
    var pz = r[2][0] * dx + r[2][1] * dy + piece.pos[2];
    var d = Math.max(camD, 1);
    var s = d / Math.max(d * 0.05, d - pz);
    var ox = layerWidth / 2;
    var oy = layerHeight / 2;
    return { x: ox + (px - ox) * s, y: oy + (py - oy) * s, scale: s };
  }

  // --- Small premultiplied-float image helpers for the CPU references ---

  function makeImage(width, height, fill) {
    var data = new Float32Array(width * height * 4);
    if (fill) {
      for (var i = 0; i < width * height; i++) {
        data[i * 4] = fill[0];
        data[i * 4 + 1] = fill[1];
        data[i * 4 + 2] = fill[2];
        data[i * 4 + 3] = fill[3];
      }
    }
    return { width: width, height: height, data: data };
  }

  function getPx(img, x, y) {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [0, 0, 0, 0];
    var o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  }

  // Bilinear sample at continuous pixel coordinates (centres at +0.5);
  // transparent outside, matching effectcraft_raster::sample_bilinear.
  function sampleBilinear(img, x, y) {
    var fx = x - 0.5;
    var fy = y - 0.5;
    var x0 = Math.floor(fx);
    var y0 = Math.floor(fy);
    var tx = fx - x0;
    var ty = fy - y0;
    var a = getPx(img, x0, y0);
    var b = getPx(img, x0 + 1, y0);
    var c = getPx(img, x0, y0 + 1);
    var d = getPx(img, x0 + 1, y0 + 1);
    var o = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      var top = a[i] + (b[i] - a[i]) * tx;
      var bot = c[i] + (d[i] - c[i]) * tx;
      o[i] = top + (bot - top) * ty;
    }
    return o;
  }

  function unpremul(p) {
    var a = p[3];
    if (a > 1e-6) return { c: [p[0] / a, p[1] / a, p[2] / a], a: a };
    return { c: [0, 0, 0], a: Math.max(0, a) };
  }

  function premul(c, a) {
    return [c[0] * a, c[1] * a, c[2] * a, a];
  }

  function luminance(c) {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // CPU reference of CC Page Turn (page_turn): params use layer pixels for
  // foldPosition/foldRadius. Returns a new image.
  function pageTurnImage(params, src) {
    var w = src.width;
    var h = src.height;
    var out = makeImage(w, h, null);
    var phi = (Number(params.foldDirection) || 0) * Math.PI / 180;
    var nx = -Math.sin(phi);
    var ny = Math.cos(phi);
    var lam = (Number(params.lightDirection) || 0) * Math.PI / 180;
    var ldot = nx * Math.sin(lam) - ny * Math.cos(lam);
    var r = Math.max(0.5, Number(params.foldRadius) || 0);
    var render = Math.round(Number(params.render) || 0);
    var showFront = render !== 1;
    var showBack = render !== 2;
    var bo = (Number(params.backPageOpacity) || 0) / 100;
    var paper = params.paperColor || [1, 1, 1];
    var fx = params.foldPosition[0];
    var fy = params.foldPosition[1];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = x + 0.5;
        var py = y + 0.5;
        var d = (px - fx) * nx + (py - fy) * ny;
        var result = [0, 0, 0, 0];
        if (d <= r) {
          var cands = [];
          if (d <= 0) {
            cands.push({ u: Math.PI * r - d, back: true, shade: 0.9 });
            cands.push({ u: d, back: false, shade: 1 });
          } else {
            var av = Math.min(1, Math.max(-1, d / r));
            var a = Math.asin(av);
            cands.push({ u: Math.PI * r - r * a, back: true, shade: 0.6 + 0.4 * Math.cos(a) });
            var psi = a / (Math.PI / 2);
            cands.push({ u: r * a, back: false, shade: 1 - 0.4 * psi * (0.5 + 0.5 * ldot) });
          }
          for (var k = 0; k < cands.length; k++) {
            var cand = cands[k];
            if ((cand.back && !showBack) || (!cand.back && !showFront)) continue;
            var kk = cand.u - d;
            var v = sampleBilinear(src, px + kk * nx, py + kk * ny);
            if (v[3] <= 1e-4) continue;
            var up = unpremul(v);
            var cc = up.c;
            if (cand.back) {
              cc = [
                paper[0] * (1 - bo) + cc[0] * bo,
                paper[1] * (1 - bo) + cc[1] * bo,
                paper[2] * (1 - bo) + cc[2] * bo,
              ];
            }
            result = premul([cc[0] * cand.shade, cc[1] * cand.shade, cc[2] * cand.shade], up.a);
            break;
          }
        }
        var o = (y * w + x) * 4;
        out.data[o] = result[0];
        out.data[o + 1] = result[1];
        out.data[o + 2] = result[2];
        out.data[o + 3] = result[3];
      }
    }
    return out;
  }

  // CPU reference of Radial Shadow projection (softness 0): shadow shape
  // before blurring, plus the over-composite. Matches radial_shadow.
  function radialShadowImage(params, src) {
    var w = src.width;
    var h = src.height;
    var out = makeImage(w, h, null);
    var color = params.shadowColor || [0, 0, 0];
    var colorA = color.length > 3 ? color[3] : 1;
    var opacity = (Number(params.opacity) || 0) / 100;
    var dist = Math.max(0, Number(params.projectionDistance) || 0);
    var k = 1 + dist / 100;
    var glass = Math.round(Number(params.render) || 0) === 1;
    var influence = (Number(params.colorInfluence) || 0) / 100;
    var only = !!params.shadowOnly;
    var lx = params.lightSource[0];
    var ly = params.lightSource[1];
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var qx = x + 0.5;
        var qy = y + 0.5;
        var s = sampleBilinear(src, lx + (qx - lx) / k, ly + (qy - ly) / k);
        var up = unpremul(s);
        var a = glass ? Math.min(1, Math.max(0, up.a * (1 - up.a) * 4)) : up.a;
        a *= opacity * colorA;
        var c = [
          color[0] + (up.c[0] - color[0]) * influence,
          color[1] + (up.c[1] - color[1]) * influence,
          color[2] + (up.c[2] - color[2]) * influence,
        ];
        var sh = premul(c, a);
        var o = (y * w + x) * 4;
        if (!only) {
          var oo = (y * w + x) * 4;
          var orig = [src.data[oo], src.data[oo + 1], src.data[oo + 2], src.data[oo + 3]];
          var kk2 = 1 - orig[3];
          sh = [orig[0] + sh[0] * kk2, orig[1] + sh[1] * kk2, orig[2] + sh[2] * kk2, orig[3] + sh[3] * kk2];
        }
        out.data[o] = sh[0];
        out.data[o + 1] = sh[1];
        out.data[o + 2] = sh[2];
        out.data[o + 3] = sh[3];
      }
    }
    return out;
  }

  // CPU reference of one Card Wipe output pixel (premultiplied). params:
  // rows, columns, cardScale, flipAxis (0/1/2), flipDirection (0/1/2),
  // flipOrder (0..8), timingRandomness, completion (0..1),
  // transitionWidth (0.01..1), backMode (0 color, 1 transparent),
  // backColor [r,g,b], cameraDist, lightIntensity, ambient, aspect (w/h).
  // rndAt(i, j) returns {axis, dir, jit} in [0,1); sample(luv) returns a
  // premultiplied pixel with transparent outside. Mirrors fx_cardwipe.glsl.
  function cardWipePixel(params, luv, rndAt, sample) {
    var cols = Math.max(1, Math.round(params.columns));
    var rows = Math.max(1, Math.round(params.rows));
    var i = Math.min(cols - 1, Math.floor(luv[0] * cols));
    var j = Math.min(rows - 1, Math.floor(luv[1] * rows));
    var cc = [(i + 0.5) / cols, (j + 0.5) / rows];
    var o = cardOrderOffset(Math.round(params.flipOrder), i, j, cols, rows,
      params.flipOrder >= 7.5 ? luminance(unpremul(sample(cc)).c) : 0);
    var rnd = rndAt(i, j);
    var tr = Math.min(1, Math.max(0, params.timingRandomness));
    o += (rnd.jit - o) * tr;
    var p = cardProgress(params.completion, o, params.transitionWidth);
    if (p <= 0) return sample(luv);
    var aroundX = params.flipAxis < 0.5 ? true : params.flipAxis < 1.5 ? false : rnd.axis < 0.5;
    var sign = params.flipDirection < 0.5 ? 1 : params.flipDirection < 1.5 ? -1 : rnd.dir < 0.5 ? -1 : 1;
    var a = p * Math.PI * sign;
    var cosA = Math.cos(a);
    var sinA = Math.sin(a);
    if (Math.abs(cosA) < 0.004) return [0, 0, 0, 0];
    var front = cosA >= 0;
    var aspect = params.aspect;
    var relX = (luv[0] - cc[0]) * aspect;
    var relY = luv[1] - cc[1];
    var halfX = 0.5 * aspect / cols;
    var halfY = 0.5 / rows;
    var D = Math.max(1, params.cameraDist);
    var lx;
    var ly;
    if (aroundX) {
      ly = relY * D / (cosA * D - relY * sinA);
      lx = relX / (D / (D - ly * sinA));
    } else {
      lx = relX * D / (cosA * D - relX * sinA);
      ly = relY / (D / (D - lx * sinA));
    }
    var pic = Math.max(params.cardScale, 1);
    var ext = Math.min(params.cardScale, 1);
    // Half-texel tolerance: card edges shared with a neighbour must not
    // drop out from a ulp of inversion noise.
    if (Math.abs(lx) > halfX * ext + 1e-4 || Math.abs(ly) > halfY * ext + 1e-4) return [0, 0, 0, 0];
    var bright = params.lightIntensity * (params.ambient + (1 - params.ambient) * (0.3 + 0.7 * Math.abs(cosA)));
    if (!front) {
      if (params.backMode > 0.5) return [0, 0, 0, 0];
      return premul([params.backColor[0] * bright, params.backColor[1] * bright, params.backColor[2] * bright], 1);
    }
    var src = [cc[0] + lx / pic / aspect, cc[1] + ly / pic];
    if (src[0] < 0 || src[0] > 1 || src[1] < 0 || src[1] > 1) return [0, 0, 0, 0];
    var texel = sample(src);
    return [texel[0] * bright, texel[1] * bright, texel[2] * bright, texel[3]];
  }

  return {
    cardWipePixel: cardWipePixel,
    hashNoise: hashNoise,
    h01: h01,
    hsigned: hsigned,
    foldSeed: foldSeed,
    cardOrderOffset: cardOrderOffset,
    cardProgress: cardProgress,
    cardRandoms: cardRandoms,
    rotAxis3: rotAxis3,
    facingOf: facingOf,
    pollyPlan: pollyPlan,
    projectCorner: projectCorner,
    makeImage: makeImage,
    getPx: getPx,
    sampleBilinear: sampleBilinear,
    unpremul: unpremul,
    premul: premul,
    luminance: luminance,
    pageTurnImage: pageTurnImage,
    radialShadowImage: radialShadowImage,
  };
});
