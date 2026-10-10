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
// corrected so each type draws its own shape. A small "flares" skin holds the
// row and tile layout; every color comes from the theme tokens.

(function () {
    var SOURCE_FIELDS = [
        { path: "positioning.sourceType", label: "Source", kind: "select" },
        { path: "positioning.lightIndex", label: "Light index", kind: "number" },
        { path: "positioning.foreground.occlude", label: "Occlude", kind: "check" },
        {
            path: "positioning.foreground.fade",
            label: "Fade amount",
            kind: "number",
            hint: "Stored with the project. Occlusion is per pixel, so Fade does not change the render.",
        },
        { path: "positioning.margin", label: "Edge margin", kind: "number" },
        { path: "positioning.distanceFalloff", label: "Distance falloff", kind: "number" },
        { path: "positioning.referenceDistance", label: "Reference distance", kind: "number" },
    ];

    var GLOBAL_FIELDS = [
        { path: "flareSetup.centerPosition", label: "Center", kind: "xy" },
        { path: "flareSetup.brightness", label: "Brightness", kind: "number" },
        { path: "flareSetup.scale", label: "Scale", kind: "number" },
        { path: "flareSetup.scaleOffset", label: "Scale offset", kind: "check" },
        { path: "flareSetup.color", label: "Color", kind: "color" },
        { path: "flareSetup.colorMode", label: "Color mode", kind: "select" },
        { path: "flareSetup.rotationOffset", label: "Rotation offset", kind: "number" },
        { path: "flareSetup.animationEvolution", label: "Evolution", kind: "number" },
        { path: "positioning.flicker.amount", label: "Flicker", kind: "number" },
        { path: "positioning.flicker.speed", label: "Flicker speed", kind: "number" },
        { path: "flareSetup.gpu", label: "High quality", kind: "check" },
    ];

    var ADVANCED_FIELDS = [
        { path: "global.scale", label: "Element scale", kind: "number" },
        { path: "global.aspectRatio", label: "Aspect ratio", kind: "number" },
        { path: "global.blendMode", label: "Blend mode", kind: "select" },
        { path: "global.color", label: "Color", kind: "color" },
        { path: "global.globalSeed", label: "Seed", kind: "number" },
        { path: "global.scaleOffset", label: "Scale with distance", kind: "check" },
        { path: "motionBlur.renderMode", label: "Render mode", kind: "select" },
    ];

    var ELEMENT_FIELDS = [
        { path: "element.enabled", label: "Enabled", kind: "check" },
        { path: "element.solo", label: "Solo", kind: "check" },
        { path: "globalParams.color", label: "Color", kind: "color" },
        { path: "globalParams.scale", label: "Size", kind: "number" },
        { path: "element.opacity", label: "Brightness", kind: "number" },
        { path: "element.distance", label: "Position", kind: "number" },
        { path: "element.rotation", label: "Rotation", kind: "number" },
        { path: "globalParams.aspectRatio", label: "Aspect ratio", kind: "number" },
        { path: "globalParams.blendMode", label: "Blend mode", kind: "select" },
        { path: "globalParams.scaleOffset", label: "Scale with distance", kind: "check" },
        { path: "element.animate", label: "Animate", kind: "check" },
        { path: "globalParams.globalSeed", label: "Seed", kind: "number" },
    ];

    var SHAPE_FIELDS = [
        { path: "lensTexture.textureImage", label: "Texture", kind: "select" },
        { path: "lensTexture.illuminationRadius", label: "Illumination", kind: "number" },
        { path: "lensTexture.falloff", label: "Falloff", kind: "number" },
        { path: "matteBox.shape", label: "Matte shape", kind: "select" },
        { path: "matteBox.startRange", label: "Matte start", kind: "number" },
        { path: "matteBox.fadeAmount", label: "Matte fade", kind: "number" },
    ];

    // Layout for the stack rows and browser tiles. Everything visual comes
    // from the theme tokens; the canvases keep a black base so additive
    // glow drawings read the same under any theme.
    var SKIN_CSS = [
        ".of-stack{display:flex;flex-direction:column;gap:4px;}",
        ".of-row{display:flex;gap:6px;align-items:center;padding:4px;border:1px solid var(--zui-border-soft);border-radius:4px;cursor:pointer;}",
        ".of-row:hover{background:var(--zui-hover);}",
        ".of-row.active{border-color:var(--zui-accent);}",
        ".of-row.disabled .of-row-name,.of-row.disabled .of-thumb{opacity:.45;}",
        ".of-row.dragover{border-top-color:var(--zui-accent);}",
        ".of-thumb{width:72px;height:44px;background:#000;border:1px solid var(--zui-border);border-radius:3px;flex:0 0 auto;}",
        ".of-row-body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px;}",
        ".of-row-top{display:flex;align-items:center;gap:4px;}",
        ".of-row-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zui-text-strong);}",
        ".of-row-actions{display:flex;gap:3px;flex:0 0 auto;}",
        ".of-mini{background:transparent;border:1px solid var(--zui-border-soft);color:var(--zui-text-muted);border-radius:3px;padding:1px 6px;cursor:pointer;}",
        ".of-mini:hover{color:var(--zui-text-bright);border-color:var(--zui-accent);}",
        ".of-mini.on{background:var(--zui-accent);color:var(--zui-text-bright);border-color:var(--zui-accent);}",
        ".of-mini.x{color:var(--zui-danger);}",
        ".of-row-fields{display:flex;gap:4px;}",
        ".of-row-fields .zoidium-field{flex:1 1 0;min-width:0;grid-template-columns:minmax(0,auto) minmax(0,1fr);padding:2px 2px 2px 4px;min-height:26px;column-gap:4px;border-bottom:0;}",
        ".of-row-fields .zoidium-number{width:100%;}",
        ".of-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}",
        ".of-tile{background:var(--zui-bg-sunken);border:1px solid var(--zui-border-soft);border-radius:4px;cursor:pointer;padding:0 0 4px;text-align:left;color:var(--zui-text);}",
        ".of-tile:hover{border-color:var(--zui-accent);}",
        ".of-tile canvas{width:100%;height:56px;display:block;background:#000;border-radius:3px 3px 0 0;}",
        ".of-tile-row{display:flex;align-items:center;gap:4px;padding:3px 6px 0;}",
        ".of-tile-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".of-sub{display:flex;gap:6px;align-items:center;margin-bottom:6px;}",
        ".of-hint{color:var(--zui-text-muted);padding:6px 2px;}",
        ".of-section-label{text-align:center;color:var(--zui-text-muted);padding:8px 0 2px;grid-column:1/-1;}",
        ".of-thumb.of-checker,.of-tile canvas.of-checker{background-image:linear-gradient(45deg,var(--zui-border) 25%,transparent 25%,transparent 75%,var(--zui-border) 75%),linear-gradient(45deg,var(--zui-border) 25%,var(--zui-bg-sunken) 25%,var(--zui-bg-sunken) 75%,var(--zui-border) 75%);background-size:12px 12px;background-position:0 0,6px 6px;}",
    ].join("\n");

    var TITLE = "Optical Flares";
    var windowSerial = 0;
    var windowIds = new WeakMap();
    var FAV_KEY = "zoidium.optical-flares.presetFavs.v1";
    var BG_KEY = "zoidium.optical-flares.previewBg.v1";
    var favMemory = {};
    var bgMemory = "black";

    function loadFavs() {
        try {
            if (typeof localStorage !== "undefined") {
                var raw = localStorage.getItem(FAV_KEY);
                if (raw) return JSON.parse(raw) || {};
            }
        } catch (error) { /* UI state only; fall back to memory */ }
        return favMemory;
    }

    function saveFavs(favs) {
        favMemory = favs || {};
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(FAV_KEY, JSON.stringify(favMemory));
        } catch (error) { /* UI state only */ }
    }

    function loadPreviewBg() {
        try {
            if (typeof localStorage !== "undefined") {
                var raw = localStorage.getItem(BG_KEY);
                if (raw === "checker" || raw === "black") return raw;
            }
        } catch (error) { /* UI state only */ }
        return bgMemory;
    }

    function savePreviewBg(value) {
        bgMemory = value;
        try {
            if (typeof localStorage !== "undefined") localStorage.setItem(BG_KEY, value);
        } catch (error) { /* UI state only */ }
    }

    /* ---------------- deterministic thumbnails ---------------- */

    // Seeded hash in [0, 1): the same type always draws the same thumbnail.
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

    function resolve(base, path) {
        var node = base;
        var parts = path.split(".");
        for (var i = 0; i < parts.length && node; i++) node = node[parts[i]];
        return node || null;
    }

    function copy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function toHex(rgb) {
        return "#" + [0, 1, 2].map(function (i) {
            var v = Math.round(Math.max(0, Math.min(1, Number(rgb && rgb[i]) || 0)) * 255);
            return (v < 16 ? "0" : "") + v.toString(16);
        }).join("");
    }

    function fromHex(hex) {
        var n = parseInt(String(hex).slice(1), 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }

    function optionItems(definition) {
        return String(definition && definition.items || "").split(";").map(function (label, index) {
            return { value: String(index), label: label };
        });
    }

    function stop(event) {
        if (event && typeof event.stopPropagation === "function") event.stopPropagation();
    }

    // Group of observer subscriptions that can be dropped together. Callbacks
    // never re-subscribe from inside the observable they are attached to.
    function Scope() {
        this.disposers = [];
    }
    Scope.prototype.watch = function (observable, fn) {
        if (!observable || typeof observable.watch !== "function") return;
        observable.watch(fn);
        this.disposers.push(function () { observable.unwatch(fn); });
    };
    Scope.prototype.dispose = function () {
        var list = this.disposers.splice(0, this.disposers.length);
        for (var i = 0; i < list.length; i++) list[i]();
    };

    PZ.opticalflares.openWindow = function (ui, editor, root) {
        var ctl = ui.controls;
        var types = PZ.opticalflares.ELEMENT_TYPES;
        var Element = PZ.object3d.optflares.element;
        var history = editor.history;
        var ops = new PZ.ui.properties(editor);
        var edit = PZ.ui.edit.prototype;
        var editContext = { editor: editor };
        if (ui && typeof ui.registerSkin === "function") {
            try {
                ui.registerSkin("flares", SKIN_CSS);
            } catch (error) { /* the rows still work without the skin */ }
        }

        var pending = new Map();
        var selected = 0;
        var addType = 0;
        var suspended = 0;
        var checker = loadPreviewBg() === "checker";
        var favs = loadFavs();
        var browserTab = "flare";
        var lensMode = "basic";
        var presetCategory = "Cinematic";
        var presetFavOnly = false;

        var stackScope = new Scope();
        var elementScope = new Scope();
        var selectedScope = new Scope();
        var staticScope = new Scope();
        var view = {};
        var customView = null;

        function frameOf(prop) {
            var frame = editor.playback ? Math.round(editor.playback.currentFrame) : 0;
            return Math.max(0, frame - (prop.frameOffset || 0));
        }

        function read(prop) {
            return prop.get(frameOf(prop));
        }

        // Live preview while dragging: no undo record yet.
        function live(prop, value) {
            if (!pending.has(prop)) pending.set(prop, copy(read(prop)));
            prop.set(value, frameOf(prop));
        }

        var refreshQueued = false;
        function queueRefresh() {
            if (refreshQueued || !view.stackList) return;
            refreshQueued = true;
            if (typeof setTimeout !== "function") {
                refreshQueued = false;
                renderStack();
                return;
            }
            setTimeout(function () {
                refreshQueued = false;
                renderStack();
            }, 0);
        }

        function defaultOf(prop) {
            try {
                var value = prop.getDefaultValue();
                return value === undefined ? 0 : copy(value);
            } catch (ignored) {
                return 0;
            }
        }

        // Reads a property without throwing on the transient empty-keyframes
        // state CM3 passes through while loading an element: reset() empties
        // the keyframes before list.load() refills them, and name.set()
        // notifies in between. Throwing here would break out into the
        // operation in flight (notably undo) and leave it half applied, so
        // fall back to the definition default and queue one settled refresh.
        function safeRead(prop) {
            try {
                if (prop && prop.keyframes && prop.keyframes.length === 0) {
                    queueRefresh();
                    return defaultOf(prop);
                }
                return read(prop);
            } catch (error) {
                queueRefresh();
                return defaultOf(prop);
            }
        }

        function safeType(element) {
            try {
                return element.type;
            } catch (error) {
                queueRefresh();
                return 0;
            }
        }

        function group(fn) {
            history.startOperation();
            try {
                fn();
            } finally {
                history.finishOperation();
            }
        }

        function record(prop, value, oldValue) {
            ops.setValue({ property: prop.getAddress(), frame: frameOf(prop), value: value, oldValue: oldValue });
        }

        // One undo record per user edit.
        function commit(prop, value) {
            var old = pending.has(prop) ? pending.get(prop) : copy(read(prop));
            pending.delete(prop);
            if (JSON.stringify(old) === JSON.stringify(value)) return;
            group(function () { record(prop, value, old); });
        }

        function toggleProp(prop) {
            var next = read(prop) === 1 ? 0 : 1;
            commit(prop, next);
        }

        // CM3 notifies value edits on different observables per property
        // kind: static props (text, asset) use onChanged, dynamic keyframes
        // use onKeyframeChanged. Watch every notifier a property offers so
        // the window follows commits, undo and redo instead of going stale.
        function watchValue(scope, prop, fn) {
            if (!prop) return;
            scope.watch(prop.onChanged, fn);
            scope.watch(prop.onKeyframeChanged, fn);
            scope.watch(prop.onAnimatedChanged, fn);
        }

        function watchProp(scope, prop, fn) {
            watchValue(scope, prop, fn);
            if (prop.objects) {
                for (var i = 0; i < prop.objects.length; i++) watchProp(scope, prop.objects[i], fn);
            }
        }

        function makeElement(tag, cls, text) {
            var node = document.createElement(tag);
            if (cls) node.className = cls;
            if (text !== undefined) node.textContent = text;
            return node;
        }

        function makeButton(text, cls, title, onClick) {
            var node = makeElement("button", cls || "of-mini", text);
            node.type = "button";
            if (title) node.title = title;
            node.onclick = function (event) {
                stop(event);
                onClick();
            };
            return node;
        }

        // Builds the DOM for one field and keeps it in step with its property.
        function field(scope, base, spec) {
            var prop = resolve(base, spec.path);
            if (!prop) return [];
            var definition = prop.definition || {};
            var sync;
            var element;
            if (spec.kind === "xy") {
                return [0, 1].map(function (axis) {
                    var withAxis = function (v) {
                        var next = copy(read(prop));
                        next[axis] = v;
                        return next;
                    };
                    var num = ctl.number({
                        label: spec.label + (axis ? " Y" : " X"),
                        hint: spec.hint,
                        value: read(prop)[axis],
                        step: 1,
                        onInput: function (v) { live(prop, withAxis(v)); },
                        onChange: function (v) { commit(prop, withAxis(v)); },
                    });
                    watchValue(scope, prop, function () { num.set(read(prop)[axis]); });
                    return num.element;
                });
            }
            if (spec.kind === "check") {
                var check = ctl.checkbox({
                    label: spec.label,
                    hint: spec.hint,
                    value: read(prop) === 1,
                    onChange: function (v) { commit(prop, v ? 1 : 0); },
                });
                sync = function () { check.set(read(prop) === 1); };
                element = check.element;
            } else if (spec.kind === "select") {
                var select = ctl.select({
                    label: spec.label,
                    hint: spec.hint,
                    value: String(read(prop)),
                    options: optionItems(definition),
                    onChange: function (v) { commit(prop, Number(v)); },
                });
                sync = function () { select.set(String(read(prop))); };
                element = select.element;
            } else if (spec.kind === "color") {
                var swatch = ctl.color({
                    label: spec.label,
                    hint: spec.hint,
                    value: toHex(read(prop)),
                    onInput: function (hex) { live(prop, fromHex(hex)); },
                    onChange: function (hex) { commit(prop, fromHex(hex)); },
                });
                sync = function () { swatch.set(toHex(read(prop))); };
                element = swatch.element;
            } else {
                var input = ctl.number({
                    label: spec.label,
                    hint: spec.hint,
                    value: read(prop),
                    min: definition.min,
                    max: definition.max,
                    step: definition.step || 0.01,
                    onInput: function (v) { live(prop, v); },
                    onChange: function (v) { commit(prop, v); },
                });
                sync = function () { input.set(read(prop)); };
                element = input.element;
            }
            watchProp(scope, prop, sync);
            return [element];
        }

        function appendFields(scope, target, base, specs) {
            specs.forEach(function (spec) {
                field(scope, base, spec).forEach(function (node) {
                    target.appendChild(node);
                });
            });
        }

        /* ---------------- stack operations ---------------- */

        function insertAt(index, data) {
            edit.createObject.call(editContext, {
                newParentAddress: root.stack.getAddress(),
                newIdx: index,
                baseType: root.stack.type,
                subType: data.type,
                data: data,
            });
        }

        function removeAt(index) {
            edit.deleteObject.call(editContext, {
                oldParentAddress: root.stack.getAddress(),
                oldIdx: index,
            });
        }

        function moveTo(from, to) {
            var address = root.stack.getAddress();
            edit.moveObject.call(editContext, {
                oldParentAddress: address,
                oldIdx: from,
                newParentAddress: address,
                newIdx: to,
            });
        }

        // Runs one or more stack edits as a single undo step, then refreshes
        // the window once.
        function mutate(fn) {
            suspended += 1;
            try {
                group(fn);
            } finally {
                suspended -= 1;
            }
            renderStack();
        }

        function selectedElement() {
            return selected >= 0 && selected < root.stack.length ? root.stack[selected] : null;
        }

        function addElement() {
            addElementOfType(addType);
        }

        function addElementOfType(type) {
            mutate(function () {
                insertAt(root.stack.length, copy(Element.create(type)));
                selected = root.stack.length - 1;
            });
        }

        function addCustomElement(slot) {
            mutate(function () {
                var data = copy(Element.create(0));
                if (data.properties && data.properties.lensTexture) {
                    data.properties.lensTexture.textureImage = slot + 7;
                }
                insertAt(root.stack.length, data);
                selected = root.stack.length - 1;
            });
        }

        function duplicateElement() {
            var element = selectedElement();
            if (!element) return;
            mutate(function () {
                insertAt(selected + 1, copy(element));
                selected += 1;
            });
        }

        function removeElement() {
            if (!selectedElement()) return;
            mutate(function () {
                removeAt(selected);
                selected = Math.max(0, Math.min(selected, root.stack.length - 1));
            });
        }

        function moveElement(delta) {
            var target = selected + delta;
            if (!selectedElement() || target < 0 || target >= root.stack.length) return;
            mutate(function () {
                moveTo(selected, target);
                selected = target;
            });
        }

        function applyRecords(records) {
            mutate(function () {
                for (var i = root.stack.length - 1; i >= 0; i--) removeAt(i);
                records.forEach(function (data, index) {
                    insertAt(index, data);
                });
                selected = 0;
            });
        }

        function applyPreset(key) {
            applyRecords(PZ.opticalflares.presetData(key));
        }

        // Restores the default stack and every root property group in one
        // undo step.
        function resetAll() {
            mutate(function () {
                ops.resetAll(root.properties.flareSetup);
                ops.resetAll(root.properties.positioning);
                ops.resetAll(root.properties.motionBlur);
                ops.resetAll(root.properties.global);
                for (var i = root.stack.length - 1; i >= 0; i--) removeAt(i);
                PZ.opticalflares.presetData("default").forEach(function (data, index) {
                    insertAt(index, data);
                });
                selected = 0;
            });
        }

        function resetGroup(list) {
            if (!list) return;
            group(function () { ops.resetAll(list); });
            renderStack();
        }

        function resetSelectedElement() {
            var element = selectedElement();
            if (!element) return;
            group(function () {
                ops.resetAll(element.properties.element);
                ops.resetAll(element.properties.globalParams);
                ops.resetAll(element.properties.matteBox);
                ops.resetAll(element.properties.lensTexture);
            });
            renderStack();
        }

        function changeType(element, index) {
            var old = element.type;
            if (old === index) return;
            var nameProp = element.properties.name;
            var oldName = nameProp.get();
            var typeProp = element.properties.element.elementType;
            group(function () {
                record(typeProp, index, old);
                if (oldName === types[old].name) record(nameProp, types[index].name, oldName);
            });
        }

        /* ---------------- rendering ---------------- */

        function typeOptions() {
            return types.map(function (type, index) {
                return { value: String(index), label: type.name };
            });
        }

        // The window title is the product name; the flare's own name is the
        // subtitle. The default name equals the title, so it is left blank.
        function subtitleFor(name) {
            var text = String(name || "");
            return text === TITLE ? "" : text;
        }

        function checkerClass(canvas) {
            if (!canvas || !canvas.classList) return;
            if (typeof canvas.classList.toggle !== "function") return;
            canvas.classList.toggle("of-checker", checker);
        }

        function paintThumb(canvas, element) {
            checkerClass(canvas);
            var color = safeRead(element.properties.globalParams.color);
            drawThumb(canvas, safeType(element), color);
        }

        function selectElement(index) {
            selected = Number(index);
            renderItems();
            renderSelected();
            refreshElementsTab();
        }

        function buildRow(element, index) {
            var props = element.properties;
            var row = makeElement("div", "of-row");
            row.draggable = true;

            var thumb = makeElement("canvas", "of-thumb");
            thumb.width = 72;
            thumb.height = 44;
            thumb.title = "Toggle visibility";
            thumb.onclick = function (event) {
                stop(event);
                toggleProp(props.element.enabled);
            };
            row.appendChild(thumb);

            var body = makeElement("div", "of-row-body");
            var top = makeElement("div", "of-row-top");
            var name = makeElement("span", "of-row-name");
            top.appendChild(name);
            var actions = makeElement("span", "of-row-actions");
            var hideButton = makeButton("Hide", "of-mini", "Toggle visibility", function () {
                toggleProp(props.element.enabled);
            });
            var soloButton = makeButton("Solo", "of-mini", "Preview this element alone", function () {
                toggleProp(props.element.solo);
            });
            var deleteButton = makeButton("X", "of-mini x", "Remove this element", function () {
                selected = index;
                removeElement();
            });
            actions.appendChild(hideButton);
            actions.appendChild(soloButton);
            actions.appendChild(deleteButton);
            top.appendChild(actions);
            body.appendChild(top);

            var fields = makeElement("div", "of-row-fields");
            var scaleProp = props.globalParams.scale;
            var scaleNum = ctl.number({
                label: "Scale",
                value: safeRead(scaleProp),
                min: scaleProp.definition && scaleProp.definition.min,
                max: scaleProp.definition && scaleProp.definition.max,
                step: 0.1,
                dragSpeed: 1,
                onInput: function (v) { live(scaleProp, v); },
                onChange: function (v) { commit(scaleProp, v); },
            });
            var distanceProp = props.element.distance;
            var distanceNum = ctl.number({
                label: "Distance",
                value: safeRead(distanceProp),
                min: distanceProp.definition && distanceProp.definition.min,
                max: distanceProp.definition && distanceProp.definition.max,
                step: 0.1,
                dragSpeed: 1,
                onInput: function (v) { live(distanceProp, v); },
                onChange: function (v) { commit(distanceProp, v); },
            });
            fields.appendChild(scaleNum.element);
            fields.appendChild(distanceNum.element);
            body.appendChild(fields);
            row.appendChild(body);

            row.onclick = function () {
                if (selected !== index) selectElement(index);
            };
            row.ondragstart = function (event) {
                if (event && event.dataTransfer) {
                    event.dataTransfer.setData("text/plain", String(index));
                    event.dataTransfer.effectAllowed = "move";
                }
            };
            row.ondragover = function (event) {
                if (event && typeof event.preventDefault === "function") event.preventDefault();
                if (row.classList) row.classList.add("dragover");
            };
            row.ondragleave = function () {
                if (row.classList) row.classList.remove("dragover");
            };
            row.ondrop = function (event) {
                if (event && typeof event.preventDefault === "function") event.preventDefault();
                if (row.classList) row.classList.remove("dragover");
                var from = event && event.dataTransfer
                    ? parseInt(event.dataTransfer.getData("text/plain"), 10)
                    : NaN;
                if (isNaN(from) || from === index) return;
                mutate(function () {
                    moveTo(from, index);
                    selected = index;
                });
            };

            watchValue(elementScope, props.name, renderItems);
            watchValue(elementScope, props.element.elementType, renderItems);
            watchValue(elementScope, props.element.enabled, renderItems);
            watchValue(elementScope, props.element.solo, renderItems);
            watchValue(elementScope, props.globalParams.color, renderItems);
            watchProp(elementScope, scaleProp, function () { scaleNum.set(safeRead(scaleProp)); });
            watchProp(elementScope, distanceProp, function () { distanceNum.set(safeRead(distanceProp)); });

            return {
                element: element,
                row: row,
                thumb: thumb,
                name: name,
                scaleNum: scaleNum,
                scaleProp: scaleProp,
                distanceNum: distanceNum,
                distanceProp: distanceProp,
                hideButton: hideButton,
                soloButton: soloButton,
            };
        }

        // Refreshes row text, states and thumbnails only. Safe to call from
        // property observers because it changes no subscriptions.
        function renderItems() {
            if (!view.stackList) return;
            if (selected >= root.stack.length) selected = root.stack.length - 1;
            if (!view.rows) return;
            view.rows.forEach(function (entry, index) {
                var element = entry.element;
                var enabled = safeRead(element.properties.element.enabled) === 1;
                var solo = safeRead(element.properties.element.solo) === 1;
                var typeName = types[safeType(element)].name;
                var label = (index + 1) + ". " + typeName + (enabled ? "" : " (off)");
                entry.name.textContent = label;
                var custom = element.properties.name.get();
                entry.name.title = custom && custom !== typeName ? custom : label;
                if (entry.row.classList) {
                    entry.row.classList.toggle("active", index === selected);
                    entry.row.classList.toggle("disabled", !enabled);
                }
                if (entry.hideButton.classList) entry.hideButton.classList.toggle("on", !enabled);
                if (entry.soloButton.classList) entry.soloButton.classList.toggle("on", solo);
                paintThumb(entry.thumb, element);
            });
            if (!root.stack.length && view.emptyNote) view.emptyNote.hidden = false;
            else if (view.emptyNote) view.emptyNote.hidden = true;
        }

        function renderSelected() {
            if (!view.selectedBody) return;
            selectedScope.dispose();
            view.selectedBody.textContent = "";
            var element = selectedElement();
            if (!element) {
                view.selectedBody.appendChild(ctl.note("Select an element to edit it.").element);
                return;
            }
            var typeSelect = ctl.select({
                label: "Type",
                value: String(safeType(element)),
                options: typeOptions(),
                onChange: function (v) { changeType(element, Number(v)); },
            });
            watchValue(selectedScope, element.properties.element.elementType, function () {
                typeSelect.set(String(safeType(element)));
            });
            view.selectedBody.appendChild(typeSelect.element);
            appendFields(selectedScope, view.selectedBody, element.properties, ELEMENT_FIELDS);
            var shape = ctl.section({ title: "Shape", collapsed: true });
            appendFields(selectedScope, shape.body, element.properties, SHAPE_FIELDS);
            view.selectedBody.appendChild(shape.element);
        }

        // Full refresh after the element stack itself changed.
        function renderStack() {
            if (suspended > 0 || !view.stackList) return;
            elementScope.dispose();
            view.stackList.textContent = "";
            view.rows = [];
            Array.from(root.stack).forEach(function (element, index) {
                var entry = buildRow(element, index);
                view.rows.push(entry);
                view.stackList.appendChild(entry.row);
            });
            renderItems();
            renderSelected();
            refreshElementsTab();
        }

        /* ---------------- browser ---------------- */

        function makeTile(name, type, tint, onClick) {
            var tile = makeElement("div", "of-tile");
            tile.title = name;
            var canvas = makeElement("canvas");
            canvas.width = 160;
            canvas.height = 56;
            checkerClass(canvas);
            drawThumb(canvas, type, tint);
            tile.appendChild(canvas);
            var row = makeElement("div", "of-tile-row");
            row.appendChild(makeElement("span", "of-tile-name", name));
            tile.appendChild(row);
            tile.onclick = function () { onClick(); };
            return tile;
        }

        function browserGrid() {
            var grid = makeElement("div", "of-grid");
            return grid;
        }

        function renderFlareTab(panel) {
            if (!panel) return;
            panel.textContent = "";
            var grid = browserGrid();
            PZ.opticalflares.PRESETS.forEach(function (preset) {
                var thumbType = preset.key === "sparkle" ? 7 : preset.key === "scifi" ? 9
                    : preset.key === "anamorphic" ? 3 : 0;
                grid.appendChild(makeTile(preset.name, thumbType, [1, 1, 1], function () {
                    applyPreset(preset.key);
                }));
            });
            panel.appendChild(grid);
            panel.appendChild(ctl.buttonRow([{
                title: "Reset All",
                hint: "Restores the default stack and every flare setting. Undo restores the previous state.",
                onClick: resetAll,
            }]).element);
            view.panels.flare = panel;
        }

        function selectedElementType() {
            var element = selectedElement();
            return element ? safeType(element) : -1;
        }

        function renderElementsTab() {
            var panel = view.panels.elements;
            if (!panel) return;
            panel.textContent = "";
            var sub = makeElement("div", "of-sub");
            var basicButton = makeButton("Basic", "of-mini" + (lensMode === "basic" ? " on" : ""), "Show the element types", function () {
                lensMode = "basic";
                renderElementsTab();
            });
            var customButton = makeButton("Custom", "of-mini" + (lensMode === "custom" ? " on" : ""), "Show the custom layers", function () {
                lensMode = "custom";
                renderElementsTab();
            });
            sub.appendChild(basicButton);
            sub.appendChild(customButton);
            panel.appendChild(sub);
            var grid = browserGrid();
            if (lensMode === "basic") {
                var activeType = selectedElementType();
                types.forEach(function (type, index) {
                    var tile = makeTile(type.name, index, type.color, function () {
                        addElementOfType(index);
                    });
                    if (index === activeType && tile.classList) tile.classList.add("active");
                    grid.appendChild(tile);
                });
            } else {
                var layers = root.properties.positioning.customLayers;
                ["layer1", "layer2", "layer3"].forEach(function (key, slot) {
                    var layer = layers && layers[key];
                    var asset = layer ? read(layer) : null;
                    var tile = makeTile(
                        asset ? "Custom Layer " + (slot + 1) : "Custom " + (slot + 1) + " (empty)",
                        0,
                        [1, 1, 1],
                        function () {
                            if (!asset) return;
                            addCustomElement(slot);
                        }
                    );
                    grid.appendChild(tile);
                });
                var hint = makeElement("div", "of-hint",
                    "Assign Custom Layers in the Custom Layers section, then use them as a Lens Texture.");
                panel.appendChild(grid);
                panel.appendChild(hint);
                return;
            }
            panel.appendChild(grid);
        }

        function refreshElementsTab() {
            if (view.panels && view.panels.elements) renderElementsTab();
        }

        function renderPresetsTab(panel) {
            if (!panel) return;
            panel.textContent = "";
            var category = ctl.select({
                label: "Presets",
                value: presetCategory,
                options: ["Cinematic", "Rainbow (8)", "Gold (8)"].map(function (name) {
                    return { value: name.replace(/ \(8\)$/, ""), label: name };
                }),
                onChange: function (v) {
                    presetCategory = v;
                    renderPresetsTab(view.panels.presets);
                },
            });
            panel.appendChild(category.element);
            var favOnly = ctl.checkbox({
                label: "Favorites only",
                value: presetFavOnly,
                onChange: function (v) {
                    presetFavOnly = Boolean(v);
                    renderPresetsTab(view.panels.presets);
                },
            });
            panel.appendChild(favOnly.element);
            var grid = browserGrid();
            var names = variantNames(presetCategory);
            var shown = 0;
            names.forEach(function (name, idx) {
                var favKey = presetCategory + ":" + name;
                if (presetFavOnly && !favs[favKey]) return;
                shown += 1;
                var tile = makeTile((favs[favKey] ? "* " : "") + name,
                    variantThumbType(presetCategory, idx), variantTint(presetCategory, idx), function () {
                        applyRecords(variantRecords(presetCategory, idx));
                    });
                var row = tile.children && tile.children[tile.children.length - 1];
                var favButton = makeButton(favs[favKey] ? "Unfav" : "Fav",
                    "of-mini" + (favs[favKey] ? " on" : ""), "Toggle favorite", function () {
                        if (favs[favKey]) delete favs[favKey];
                        else favs[favKey] = true;
                        saveFavs(favs);
                        renderPresetsTab(view.panels.presets);
                    });
                if (row) row.appendChild(favButton);
                else tile.appendChild(favButton);
                grid.appendChild(tile);
            });
            panel.appendChild(grid);
            var count = presetCategory === "Cinematic" ? "8 cinematic presets - Afterglow to Flash In The Darkness"
                : presetCategory === "Rainbow" ? "8 rainbow flares presets"
                : "8 gold flares presets";
            panel.appendChild(makeElement("div", "of-section-label",
                shown === names.length ? count : shown + " of " + names.length + " favorites"));
            view.panels.presets = panel;
        }

        function browserSection(section) {
            var bgRow = makeElement("div", "of-sub");
            var bgSelect = ctl.select({
                label: "Preview bg",
                value: checker ? "checker" : "black",
                options: [
                    { value: "black", label: "Black" },
                    { value: "checker", label: "Checker" },
                ],
                onChange: function (v) {
                    checker = v === "checker";
                    savePreviewBg(checker ? "checker" : "black");
                    renderStack();
                    if (view.panels.flare) renderFlareTab(view.panels.flare);
                    refreshElementsTab();
                    if (view.panels.presets) renderPresetsTab(view.panels.presets);
                },
            });
            bgRow.appendChild(bgSelect.element);
            section.body.appendChild(bgRow);
            view.panels = {};
            section.body.appendChild(ctl.tabs({
                value: browserTab,
                tabs: [
                    {
                        id: "flare",
                        title: "Flare",
                        render: function (panel) { renderFlareTab(panel); },
                    },
                    {
                        id: "elements",
                        title: "Elements",
                        render: function (panel) {
                            view.panels.elements = panel;
                            renderElementsTab();
                        },
                    },
                    {
                        id: "presets",
                        title: "Presets",
                        render: function (panel) { renderPresetsTab(panel); },
                    },
                ],
                onChange: function (id) { browserTab = id; },
            }).element);
        }

        function elementsSection(section) {
            var addSelect = ctl.select({
                label: "Add type",
                value: String(addType),
                options: typeOptions(),
                onChange: function (v) { addType = Number(v); },
            });
            view.stackList = makeElement("div", "of-stack");
            view.emptyNote = makeElement("div", "of-hint", "No elements. Add one or apply a preset.");
            section.body.appendChild(addSelect.element);
            section.body.appendChild(view.stackList);
            section.body.appendChild(view.emptyNote);
            section.body.appendChild(ctl.buttonRow([
                { title: "Add", variant: "primary", onClick: addElement },
                { title: "Duplicate", onClick: duplicateElement },
                { title: "Remove", variant: "danger", onClick: removeElement },
            ]).element);
            section.body.appendChild(ctl.buttonRow([
                { title: "Move Up", onClick: function () { moveElement(-1); } },
                { title: "Move Down", onClick: function () { moveElement(1); } },
            ]).element);
        }

        function resetRow(section, title, hint, onReset) {
            section.body.appendChild(ctl.buttonRow([{
                title: title,
                hint: hint,
                onClick: onReset,
            }]).element);
        }

        if (!windowIds.has(root)) windowIds.set(root, ++windowSerial);
        var win = ui.openWindow({
            id: "flares:" + windowIds.get(root),
            title: TITLE,
            subtitle: subtitleFor(root.properties.name.get()),
            persistKey: "options",
            skin: "flares",
            width: 360,
            height: 620,
            isValid: function () { return root.isLive(); },
            mount: function (body, handle) {
                var browser = ctl.section({ title: "Browser", collapsed: true });
                browserSection(browser);
                var elements = ctl.section({ title: "Elements" });
                elementsSection(elements);
                view.selectedBody = document.createElement("div");
                var selectedSection = ctl.section({ title: "Selected element" });
                selectedSection.body.appendChild(view.selectedBody);
                resetRow(selectedSection, "Reset Element", "Resets the selected element to its defaults. Undo restores it.", resetSelectedElement);
                var source = ctl.section({ title: "Source" });
                appendFields(staticScope, source.body, root.properties, SOURCE_FIELDS);
                resetRow(source, "Reset Source", "Resets the source settings. Undo restores them.", function () {
                    resetGroup(root.properties.positioning);
                });
                var global = ctl.section({ title: "Global" });
                appendFields(staticScope, global.body, root.properties, GLOBAL_FIELDS);
                resetRow(global, "Reset Global", "Resets the flare settings. Undo restores them.", function () {
                    resetGroup(root.properties.flareSetup);
                });
                var advanced = ctl.section({ title: "Advanced", collapsed: true });
                appendFields(staticScope, advanced.body, root.properties, ADVANCED_FIELDS);
                resetRow(advanced, "Reset Advanced", "Resets the shared element settings. Undo restores them.", function () {
                    resetGroup(root.properties.global);
                    resetGroup(root.properties.motionBlur);
                });
                var custom = ctl.section({ title: "Custom Layers", collapsed: true });
                if (ui && typeof ui.properties === "function") {
                    customView = ui.properties({
                        editor: editor,
                        target: function () { return root.properties.positioning.customLayers; },
                    });
                    custom.body.appendChild(customView.element);
                } else {
                    custom.body.appendChild(ctl.note("Custom layers are edited in the Objects panel.").element);
                }
                [browser, elements, selectedSection, source, global, advanced, custom].forEach(function (section) {
                    body.appendChild(section.element);
                });

                watchValue(staticScope, root.properties.name, function () {
                    handle.setSubtitle(subtitleFor(root.properties.name.get()));
                });
                var customLayers = root.properties.positioning.customLayers;
                if (customLayers) {
                    ["layer1", "layer2", "layer3"].forEach(function (key) {
                        if (customLayers[key]) watchValue(staticScope, customLayers[key], refreshElementsTab);
                    });
                }
                stackScope.watch(root.stack.onListChanged, renderStack);
                renderStack();
                return function () {
                    stackScope.dispose();
                    elementScope.dispose();
                    selectedScope.dispose();
                    staticScope.dispose();
                    if (customView && typeof customView.dispose === "function") customView.dispose();
                    customView = null;
                    pending.clear();
                    view = {};
                };
            },
            footer: [{ title: "Done", variant: "primary", onClick: function () { win.close(); } }],
        });
        return win;
    };

    PZ.opticalflares.drawThumb = drawThumb;
})();
