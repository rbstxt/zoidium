// OpenZoid Trapcode Suite — Trapcode color, gradient, curve, and palette helpers.
/*
 * trapcode-color.js
 *
 * Color parsing, gradient/curve sampling, the shared designer
 * palettes, and the palette apply/CSS helpers. Loaded after
 * trapcode-common.js.
 */

var PZ = PZ || {};

(function () {
    PZ.trapcode = PZ.trapcode || {};
    var T = PZ.trapcode;

    T.parseColor = function (color) {
        if (typeof color !== "string") return [1, 1, 1, 1];
        if (color.indexOf("rgb") === 0) {
            var parts = color
                .slice(color.indexOf("(") + 1, -1)
                .split(",")
                .map(function (e) {
                    return parseFloat(e);
                });
            return [
                (parts[0] || 0) / 255,
                (parts[1] || 0) / 255,
                (parts[2] || 0) / 255,
                parts.length > 3 ? parts[3] : 1,
            ];
        }
        return [1, 1, 1, 1];
    };

    T.colorBrightness = function (color) {
        var c = T.parseColor(color);
        return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    };

    T.gradientColor = function (value, position) {
        if (!value || !value.length) return [1, 1, 1, 1];
        if (value.length === 1) return T.parseColor(value[0].color);
        if (position <= value[0].position) return T.parseColor(value[0].color);
        var last = value[value.length - 1];
        if (position >= last.position) return T.parseColor(last.color);
        var a = value[0];
        var b = last;
        for (var i = 0; i < value.length - 1; i++) {
            if (position >= value[i].position && position <= value[i + 1].position) {
                a = value[i];
                b = value[i + 1];
                break;
            }
        }
        var span = b.position - a.position;
        var ratio = span > 0 ? (position - a.position) / span : 0;
        var ca = T.parseColor(a.color);
        var cb = T.parseColor(b.color);
        return [
            ca[0] + (cb[0] - ca[0]) * ratio,
            ca[1] + (cb[1] - ca[1]) * ratio,
            ca[2] + (cb[2] - ca[2]) * ratio,
            ca[3] + (cb[3] - ca[3]) * ratio,
        ];
    };

    T.curveValue = function (keys, position) {
        if (!keys || !keys.length) return 1;
        var alphaOf = function (color) {
            var c = T.parseColor(color);
            return typeof c[3] === "number" && c[3] >= 0 ? c[3] : T.colorBrightness(color);
        };
        if (keys.length === 1) return alphaOf(keys[0].color);
        if (position <= keys[0].position) return alphaOf(keys[0].color);
        var last = keys[keys.length - 1];
        if (position >= last.position) return alphaOf(last.color);
        var a = keys[0];
        var b = last;
        for (var i = 0; i < keys.length - 1; i++) {
            if (position >= keys[i].position && position <= keys[i + 1].position) {
                a = keys[i];
                b = keys[i + 1];
                break;
            }
        }
        var span = b.position - a.position;
        var ratio = span > 0 ? (position - a.position) / span : 0;
        var va = alphaOf(a.color);
        var vb = alphaOf(b.color);
        return va + (vb - va) * ratio;
    };

    T.fillGradient = function (texture, value) {
        var data = texture.image.data;
        for (var i = 0; i < 256; i++) {
            var c = T.gradientColor(value, i / 255);
            data[i * 4 + 0] = Math.round(T.clamp(c[0], 0, 1) * 255);
            data[i * 4 + 1] = Math.round(T.clamp(c[1], 0, 1) * 255);
            data[i * 4 + 2] = Math.round(T.clamp(c[2], 0, 1) * 255);
            data[i * 4 + 3] = Math.round(T.clamp(c[3], 0, 1) * 255);
        }
        texture.needsUpdate = true;
    };

    T.fillCurve = function (texture, keys, enabled) {
        var data = texture.image.data;
        for (var i = 0; i < 256; i++) {
            var v = enabled ? T.curveValue(keys, i / 255) : 1;
            var b = Math.round(T.clamp(v, 0, 1) * 255);
            data[i * 4 + 0] = b;
            data[i * 4 + 1] = b;
            data[i * 4 + 2] = b;
            data[i * 4 + 3] = 255;
        }
        texture.needsUpdate = true;
    };
    // Shared color palettes for the Rowbyte & Red Giant Suite designer.
    // Each scheme carries gradient stops (Particular colorGradient, Form
    // colorOver) plus two flat colors in 0..1 (Particular/Form base color,
    // Plexus effector color/color2 and renderer color).
    T.palettes = [
        {
            name: "Fire",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.45, color: "rgba(255,190,90,1)" },
                { position: 0.8, color: "rgba(255,90,10,0.85)" },
                { position: 1, color: "rgba(180,20,0,0)" },
            ],
            colors: [[1, 0.72, 0.35], [1, 0.25, 0.05]],
        },
        {
            name: "Sunset",
            stops: [
                { position: 0, color: "rgba(255,240,200,1)" },
                { position: 0.5, color: "rgba(255,120,90,1)" },
                { position: 1, color: "rgba(120,40,140,0)" },
            ],
            colors: [[1, 0.62, 0.4], [0.55, 0.2, 0.6]],
        },
        {
            name: "Ocean",
            stops: [
                { position: 0, color: "rgba(220,255,255,1)" },
                { position: 0.5, color: "rgba(60,180,255,1)" },
                { position: 1, color: "rgba(10,60,180,0)" },
            ],
            colors: [[0.4, 0.8, 1], [0.05, 0.3, 0.8]],
        },
        {
            name: "Ice",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.55, color: "rgba(170,230,255,1)" },
                { position: 1, color: "rgba(80,150,255,0)" },
            ],
            colors: [[0.75, 0.92, 1], [0.35, 0.6, 1]],
        },
        {
            name: "Forest",
            stops: [
                { position: 0, color: "rgba(240,255,210,1)" },
                { position: 0.5, color: "rgba(120,220,90,1)" },
                { position: 1, color: "rgba(20,90,40,0)" },
            ],
            colors: [[0.6, 0.9, 0.4], [0.1, 0.4, 0.2]],
        },
        {
            name: "Neon",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.45, color: "rgba(255,0,220,1)" },
                { position: 1, color: "rgba(0,240,255,0)" },
            ],
            colors: [[1, 0.2, 0.9], [0, 0.9, 1]],
        },
        {
            name: "Candy",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.5, color: "rgba(255,130,200,1)" },
                { position: 1, color: "rgba(200,40,140,0)" },
            ],
            colors: [[1, 0.6, 0.8], [0.8, 0.15, 0.55]],
        },
        {
            name: "Royal",
            stops: [
                { position: 0, color: "rgba(255,250,230,1)" },
                { position: 0.5, color: "rgba(255,200,60,1)" },
                { position: 1, color: "rgba(120,40,160,0)" },
            ],
            colors: [[1, 0.82, 0.35], [0.5, 0.18, 0.65]],
        },
        {
            name: "Toxic",
            stops: [
                { position: 0, color: "rgba(240,255,200,1)" },
                { position: 0.5, color: "rgba(170,255,40,1)" },
                { position: 1, color: "rgba(30,140,40,0)" },
            ],
            colors: [[0.75, 1, 0.25], [0.12, 0.55, 0.15]],
        },
        {
            name: "Smoke",
            stops: [
                { position: 0, color: "rgba(255,255,255,1)" },
                { position: 0.6, color: "rgba(200,200,200,0.7)" },
                { position: 1, color: "rgba(120,120,120,0)" },
            ],
            colors: [[0.9, 0.9, 0.9], [0.5, 0.5, 0.5]],
        },
    ];

    T.supportsPalette = function (target) {
        if (!target || !target.properties) return false;
        var p = target.properties;
        if (p.particle && (p.particle.colorGradient || p.particle.colorOver)) return true;
        if (p.effector && (p.effector.color || p.effector.color2)) return true;
        if (p.renderer && p.renderer.color) return true;
        return false;
    };

    // Applies a shared palette scheme to a Particular system, Form
    // instance, or Plexus object. Returns true when anything was set.
    // Direct property writes, like the built-in behavior presets.
    T.applyPalette = function (target, palette) {
        if (!target || !palette) return false;
        var done = false;
        try {
            var p = target.properties;
            if (!p) return false;
            var stops = palette.stops || [];
            var colors = palette.colors || [];
            var base = colors[0] || [1, 1, 1];
            var second = colors[1] || base;
            if (p.particle && p.particle.colorGradient && stops.length) {
                p.particle.colorGradient.set(stops);
                done = true;
            }
            if (p.particle && p.particle.colorOver && stops.length) {
                p.particle.colorOver.set(stops);
                done = true;
            }
            if (p.particle && p.particle.color) {
                p.particle.color.set([base[0], base[1], base[2]]);
                done = true;
            }
            if (p.effector) {
                if (p.effector.color) {
                    p.effector.color.set([base[0], base[1], base[2]]);
                    done = true;
                }
                if (p.effector.color2) {
                    p.effector.color2.set([second[0], second[1], second[2]]);
                    done = true;
                }
            }
            if (p.renderer && p.renderer.color) {
                p.renderer.color.set([base[0], base[1], base[2]]);
                done = true;
            }
            if (done && typeof target.updatePalettes === "function") {
                target.updatePalettes();
            }
        } catch (err) {
            return done;
        }
        return done;
    };

    // CSS gradient bar preview for a palette scheme.
    T.paletteCSS = function (palette) {
        var stops = (palette && palette.stops) || [];
        if (!stops.length) return "linear-gradient(90deg,#fff,#fff)";
        var parts = [];
        for (var i = 0; i < stops.length; i++) {
            var pos = Math.round((stops[i].position || 0) * 100);
            parts.push(stops[i].color + " " + pos + "%");
        }
        return "linear-gradient(90deg," + parts.join(",") + ")";
    };
})();
