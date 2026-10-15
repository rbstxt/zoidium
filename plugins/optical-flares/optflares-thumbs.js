"use strict";

// OpenZoid Optical Flares - options window.
//
// One floating window (context.ui.openWindow, see docs/plugin-ui.md) with a
// Browser (Flare, Elements and Presets tabs), the element stack, the selected
// element, Source, Global, Advanced and Custom Layers sections. The editor
// viewport behind it is the live preview.
//
// Every edit is written through the flare's own properties with CM3's property
// operations, and element add/remove/move uses CM3's object list commands, so
// undo and redo come from the host history. Dragging previews through
// property.set() only; the undo record is written once, on commit.
//
// The stack rows and browser tiles draw per-type thumbnails with the same
// seeded 2D routines the donor editor used (no wall clock, no Math.random),
// corrected so each type draws its own shape. Scoped widget CSS holds the
// row and tile layout; the host supplies standard window chrome.

// Optical Flares per-type thumbnails and preset-variant records. Pure 2D
// canvas routines with seeded variation (no wall clock, no Math.random).

module.exports = function createThumbs(PZ) {
    if (!PZ) throw new Error("Optical Flares thumbnails need the CM3 runtime.");
    function thumbRandom(n) {
        var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        return x - Math.floor(x);
    }

    function thumbRgba(rgb, alpha) {
        return "rgba(" +
            Math.round(Math.max(0, Math.min(1, rgb[0])) * 255) + "," +
            Math.round(Math.max(0, Math.min(1, rgb[1])) * 255) + "," +
            Math.round(Math.max(0, Math.min(1, rgb[2])) * 255) + "," + alpha + ")";
    }

    function thumbDot(ctx, color, x, y, radius, alpha, core) {
        var rad = Math.max(radius, 0.01);
        var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, "rgba(255,255,255," + (core === undefined ? Math.min(1, alpha * 1.4) : core) + ")");
        g.addColorStop(0.22, thumbRgba(color, alpha));
        g.addColorStop(0.6, thumbRgba(color, alpha * 0.35));
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
    }

    function thumbRay(ctx, color, x, y, ang, len, width, alpha, inner) {
        var x0 = x + Math.cos(ang) * inner;
        var y0 = y + Math.sin(ang) * inner;
        var x1 = x + Math.cos(ang) * len;
        var y1 = y + Math.sin(ang) * len;
        var g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, thumbRgba(color, alpha));
        g.addColorStop(0.35, thumbRgba(color, alpha * 0.45));
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
    }

    function thumbPoly(ctx, cx, cy, radius, sides, rot) {
        ctx.beginPath();
        for (var i = 0; i <= sides; i++) {
            var a = (i / sides) * Math.PI * 2 + (rot || 0);
            var px = cx + Math.cos(a) * radius;
            var py = cy + Math.sin(a) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    var THUMB_DRAW = {
        glow: function (ctx, w, h, color) {
            var gx = w * 0.4;
            var gy = h * 0.32;
            thumbDot(ctx, color, gx, gy, w * 0.3, 0.22, 0.75);
            thumbDot(ctx, color, gx, gy, w * 0.09, 0.42, 0.95);
            thumbDot(ctx, color, gx, gy, w * 0.022, 0.9, 1);
        },
        streak: function (ctx, w, h, color) {
            var sy = h * 0.5;
            var line1 = ctx.createLinearGradient(0, 0, w, 0);
            line1.addColorStop(0, "rgba(0,0,0,0)");
            line1.addColorStop(0.5, thumbRgba(color, 0.9));
            line1.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = line1;
            ctx.fillRect(0, sy - 1.5, w, 3);
            var line2 = ctx.createLinearGradient(0, 0, w, 0);
            line2.addColorStop(0, "rgba(0,0,0,0)");
            line2.addColorStop(0.5, "rgba(255,255,255,1)");
            line2.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = line2;
            ctx.fillRect(w * 0.18, sy - 0.75, w * 0.64, 1.5);
            thumbDot(ctx, color, w * 0.5, sy, w * 0.035, 0.55, 1);
        },
        iris: function (ctx, w, h, color) {
            var ix = w * 0.63;
            var iy = h * 0.58;
            var ir = w * 0.115;
            ctx.save();
            ctx.translate(ix, iy);
            thumbPoly(ctx, 0, 0, ir, 6, 0.35);
            var g = ctx.createRadialGradient(0, 0, ir * 0.1, 0, 0, ir);
            g.addColorStop(0, thumbRgba(color, 0.3));
            g.addColorStop(0.75, thumbRgba(color, 0.22));
            g.addColorStop(1, thumbRgba(color, 0.05));
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = thumbRgba(color, 0.28);
            ctx.lineWidth = 1.2;
            ctx.stroke();
            ctx.restore();
        },
        multiiris: function (ctx, w, h, color) {
            var startX = w * 0.26;
            var startY = h * 0.36;
            var endX = w * 0.78;
            var endY = h * 0.62;
            for (var m = 0; m < 9; m++) {
                var t = m / 8;
                var mx = startX + (endX - startX) * t;
                var my = startY + (endY - startY) * t + (thumbRandom(m * 7.3) - 0.5) * h * 0.06;
                var mr = w * (0.03 - 0.022 * t);
                var tint = (m % 3 === 1) ? [1, 1, 1] : color;
                thumbDot(ctx, tint, mx, my, mr * 3.2, 0.28, 0.7);
                thumbDot(ctx, tint, mx, my, mr, 0.8, 1);
            }
        },
        shimmer: function (ctx, w, h, color) {
            var shx = w * 0.36;
            var shy = h * 0.52;
            for (var s = 0; s < 64; s++) {
                var a = (s / 64) * Math.PI * 2 + (thumbRandom(s * 1.13) - 0.5) * 0.12;
                thumbRay(ctx, color, shx, shy, a, w * (0.1 + 0.34 * thumbRandom(s * 1.71)),
                    0.8 + thumbRandom(s * 2.31) * 1.6, 0.05 + thumbRandom(s * 3.17) * 0.16, w * 0.005);
            }
            thumbDot(ctx, color, shx, shy, w * 0.075, 0.45, 1);
            thumbDot(ctx, color, shx, shy, w * 0.02, 0.9, 1);
        },
        glint: function (ctx, w, h, color) {
            var glx = w * 0.44;
            var gly = h * 0.46;
            for (var k = 0; k < 4; k++) {
                var a = (k / 4) * Math.PI * 2 + 0.2;
                thumbRay(ctx, color, glx, gly, a, w * 0.44, 2, 0.5, w * 0.01);
                thumbRay(ctx, color, glx, gly, a + Math.PI / 4, w * 0.2, 1.4, 0.35, w * 0.01);
            }
            thumbDot(ctx, color, glx, gly, w * 0.16, 0.3, 0.85);
            thumbDot(ctx, color, glx, gly, w * 0.045, 0.85, 1);
        },
        spikeball: function (ctx, w, h, color) {
            var spx = w * 0.46;
            var spy = h * 0.46;
            for (var s = 0; s < 40; s++) {
                var a = (s / 40) * Math.PI * 2 + (thumbRandom(s * 5.7) - 0.5) * 0.18;
                thumbRay(ctx, color, spx, spy, a, w * (0.1 + 0.26 * thumbRandom(s * 1.37)),
                    0.9, 0.16 + 0.16 * thumbRandom(s * 2.9), w * 0.005);
            }
            thumbDot(ctx, color, spx, spy, w * 0.15, 0.32, 0.9);
            thumbDot(ctx, color, spx, spy, w * 0.035, 0.9, 1);
        },
        sparkle: function (ctx, w, h, color) {
            var cx = w * 0.55;
            var cy = h * 0.48;
            for (var s = 0; s < 46; s++) {
                var rr = Math.sqrt(thumbRandom(s * 1.91)) * w * 0.34;
                var aa = thumbRandom(s * 2.77) * Math.PI * 2;
                var px = cx + Math.cos(aa) * rr;
                var py = cy + Math.sin(aa) * rr;
                var sz = 0.5 + thumbRandom(s * 3.61) * 1.5;
                var al = 0.25 + thumbRandom(s * 4.43) * 0.6;
                thumbDot(ctx, color, px, py, sz * 2.4, al * 0.5, al);
                if (s % 2 === 0) {
                    thumbRay(ctx, color, px, py, aa, sz * 5, 0.7, al * 0.4, 0);
                    thumbRay(ctx, color, px, py, aa + Math.PI / 2, sz * 5, 0.7, al * 0.4, 0);
                }
            }
        },
        ring: function (ctx, w, h) {
            var rx = w * 0.32;
            var ry = h * 0.34;
            var rad = w * 0.135;
            ctx.strokeStyle = "rgba(220,255,225,0.9)";
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(rx, ry, rad, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = "rgba(255,110,110,0.55)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(rx, ry, rad - 2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = "rgba(140,255,170,0.4)";
            ctx.beginPath();
            ctx.arc(rx, ry, rad + 2, 0, Math.PI * 2);
            ctx.stroke();
        },
        hoop: function (ctx, w, h) {
            var hx = w * 0.47;
            var hy = h * 0.55;
            var hrx = w * 0.4;
            var hry = h * 0.3;
            ctx.save();
            ctx.translate(hx, hy);
            ctx.rotate(-0.2);
            for (var seg = 0; seg < 72; seg++) {
                var a0 = (seg / 72) * Math.PI * 2;
                var a1 = ((seg + 1.35) / 72) * Math.PI * 2;
                var hue = (seg / 72) * 360;
                ctx.strokeStyle = "hsla(" + hue + ",92%,58%,0.85)";
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.ellipse(0, 0, hrx, hry, 0, a0, a1);
                ctx.stroke();
            }
            ctx.restore();
        },
        caustic: function (ctx, w, h, color) {
            var cx = w * 0.68;
            var cy = h * 0.6;
            var r = w * 0.055;
            var g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
            g.addColorStop(0, "rgba(120,126,138,0.6)");
            g.addColorStop(0.55, "rgba(160,165,178,0.5)");
            g.addColorStop(1, "rgba(200,205,215,0.35)");
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            for (var b = 0; b < 6; b++) {
                var ab = (b / 6) * Math.PI * 2 + 0.3;
                thumbRay(ctx, color, cx, cy, ab, r * 0.95, 1, 0.35, 0);
                thumbRay(ctx, color, cx, cy, ab + Math.PI / 6, r * 0.6, 0.8, 0.2, 0);
            }
            ctx.strokeStyle = "rgba(225,230,240,0.7)";
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            thumbDot(ctx, color, cx, cy, r * 0.35, 0.5, 0.9);
        },
        lensorbs: function (ctx, w, h) {
            var ox = w * 0.55;
            var oy = h * 0.5;
            for (var o = 0; o < 12; o++) {
                var orr = w * (0.035 + 0.075 * thumbRandom(o * 1.53));
                var oa = thumbRandom(o * 3.11) * Math.PI * 2;
                var ord = 0.05 + 0.24 * Math.sqrt(thumbRandom(o * 2.27));
                var px = ox + Math.cos(oa) * w * ord;
                var py = oy + Math.sin(oa) * h * ord * 1.4;
                var g = ctx.createRadialGradient(px, py, orr * 0.05, px, py, orr);
                g.addColorStop(0, "rgba(200,205,215,0.2)");
                g.addColorStop(0.7, "rgba(205,210,220,0.24)");
                g.addColorStop(0.86, "rgba(225,230,240,0.3)");
                g.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(px, py, orr, 0, Math.PI * 2);
                ctx.fill();
            }
        },
    };

    // Draws the thumbnail for an element type on a canvas. Dispatches by type
    // key so every type draws its own shape. A canvas without a 2D context
    // (or a missing type) is left blank instead of throwing.
    // Thumbnail failures are reported once per type so a broken canvas does
    // not flood the console while the window stays usable.
    var warnedThumbTypes = {};
    function drawThumb(canvas, type, tint) {
        if (!canvas || typeof canvas.getContext !== "function") return;
        var ctx = null;
        try {
            ctx = canvas.getContext("2d");
        } catch (error) {
            return;
        }
        if (!ctx) return;
        var types = PZ.opticalflares.ELEMENT_TYPES;
        var entry = types ? types[type] : null;
        var color = tint || (entry && entry.color) || [1, 1, 1];
        var w = canvas.width || 72;
        var h = canvas.height || 44;
        try {
            ctx.clearRect(0, 0, w, h);
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            var draw = entry && THUMB_DRAW[entry.key];
            if (draw) draw(ctx, w, h, color);
            ctx.restore();
        } catch (error) {
            var thumbKey = "type:" + type;
            if (!warnedThumbTypes[thumbKey]) {
                warnedThumbTypes[thumbKey] = true;
                console.warn("[Zoidium] optical-flares: thumbnail draw failed", error);
            }
            try { ctx.restore(); } catch (ignored) { /* keep the window usable */ }
        }
    }

    /* ---------------- preset variants ---------------- */

    var CINEMATIC_NAMES = ["Afterglow", "Aircraft Light", "Alien Spotlight", "Comet",
        "Discreet Illumination", "Distant Flicker", "Flash In Rain", "Flash In The Darkness"];
    var RAINBOW_NAMES = ["Rainbow 01", "Rainbow 02", "Rainbow 03", "Rainbow 04",
        "Rainbow 05", "Rainbow 06", "Rainbow 07", "Rainbow 08"];
    var GOLD_NAMES = ["Gold 01", "Gold 02", "Gold 03", "Gold 04",
        "Gold 05", "Gold 06", "Gold 07", "Gold 08"];
    var CINEMATIC_KEYS = ["default", "anamorphic", "cinematic", "scifi",
        "sparkle", "default", "anamorphic", "cinematic"];
    var RAINBOW_HUES = [[1, 0.35, 0.5], [0.4, 0.7, 1], [0.5, 1, 0.6], [1, 0.85, 0.3],
        [0.8, 0.4, 1], [0.35, 1, 0.9], [1, 0.5, 0.25], [0.6, 0.6, 1]];

    function variantNames(category) {
        if (category === "Rainbow") return RAINBOW_NAMES;
        if (category === "Gold") return GOLD_NAMES;
        return CINEMATIC_NAMES;
    }

    function variantBaseKey(category, idx) {
        if (category === "Rainbow") return (idx % 2 === 0) ? "scifi" : "anamorphic";
        if (category === "Gold") return (idx % 2 === 0) ? "cinematic" : "sparkle";
        return CINEMATIC_KEYS[idx % CINEMATIC_KEYS.length];
    }

    // Serialized element records for one tint variant: a canonical stack with
    // the Rainbow/Gold color overlays applied.
    function variantRecords(category, idx) {
        var records = PZ.opticalflares.presetData(variantBaseKey(category, idx));
        if (category === "Rainbow") {
            var tint = RAINBOW_HUES[idx % RAINBOW_HUES.length];
            records.forEach(function (record, i) {
                if (i % 3 === 0 && record.properties && record.properties.globalParams) {
                    record.properties.globalParams.color = tint.slice();
                }
            });
        } else if (category === "Gold") {
            var gold = [1, 0.82 - (idx % 4) * 0.05, 0.45];
            records.forEach(function (record) {
                if (record.properties && record.properties.globalParams) {
                    record.properties.globalParams.color = gold.slice();
                }
            });
        }
        return records;
    }

    function variantThumbType(category, idx) {
        if (category === "Rainbow") return [9, 8, 1, 5, 9, 4, 8, 1][idx % 8];
        if (category === "Gold") return [5, 0, 4, 3][idx % 4];
        return [1, 1, 1, 0, 1, 1, 0, 0][idx % 8];
    }

    function variantTint(category, idx) {
        if (category === "Rainbow") return RAINBOW_HUES[idx % RAINBOW_HUES.length];
        if (category === "Gold") return [1, 0.8, 0.5];
        return [1, 1, 1];
    }


    return {
        drawThumb: drawThumb,
        variantNames: variantNames,
        variantBaseKey: variantBaseKey,
        variantRecords: variantRecords,
        variantThumbType: variantThumbType,
        variantTint: variantTint,
    };
};
