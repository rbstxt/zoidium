// ASCII — character-cell video effect: the frame is resampled to a coarse
// grid and each cell is drawn as a glyph colored by the sampled color,
// with contrast/brightness shaping, band character mapping, random
// symbols, scale jitter, sine-wave motion, fractal noise displacement,
// and vertical scroll trails. Rendered as a canvas overlay composited
// over the layer image. Every frame is a pure function of the project
// properties, the frame index and the input pixels. See effect-windows.js
// for the setup window.

this.defaultName = "ASCII";

// Exposed for unit tests and debugging.
this.asciiMap = {
    hash: asciiHash,
    luminanceBand: asciiBand,
    valueNoise: asciiValueNoise,
    fbm: asciiFbm,
    pickGlyph: asciiPickGlyph,
    pickColor: asciiPickColor,
};

function asciiNum(name, value, min, max, step, decimals) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.NUMBER,
        value: value,
        min: min,
        max: max,
        step: step,
        decimals: decimals,
    };
}

function asciiOption(name, value, items) {
    return {
        dynamic: true,
        name: name,
        type: PZ.property.type.OPTION,
        value: value,
        items: items,
    };
}

function asciiColor(name, r, g, b) {
    return {
        dynamic: true,
        group: true,
        objects: [
            { dynamic: true, name: name + ".R", type: PZ.property.type.NUMBER, value: r, min: 0, max: 1 },
            { dynamic: true, name: name + ".G", type: PZ.property.type.NUMBER, value: g, min: 0, max: 1 },
            { dynamic: true, name: name + ".B", type: PZ.property.type.NUMBER, value: b, min: 0, max: 1 },
        ],
        name: name,
        type: PZ.property.type.COLOR,
    };
}

function asciiText(name, value) {
    return { name: name, type: PZ.property.type.TEXT, value: value };
}

function asciiBandDef(prefix, label, fill, stroke, r, g, b, opacity) {
    var defs = {};
    defs[prefix + "Fill"] = asciiText(label + " fill", fill);
    defs[prefix + "Stroke"] = asciiText(label + " stroke", stroke);
    defs[prefix + "Color"] = asciiColor(label + " color", r, g, b);
    defs[prefix + "Opacity"] = asciiNum(label + " opacity", opacity, 0, 100, 1, 0);
    return defs;
}

function asciiMerge(dst, src) {
    for (var k in src) dst[k] = src[k];
    return dst;
}

this.propertyDefinitions = asciiMerge(
    {
        enabled: {
            dynamic: true,
            name: "Enabled",
            type: PZ.property.type.OPTION,
            value: 1,
            items: "off;on",
            buttons: [{ name: "ASCII Setup", title: "Open the ASCII setup window", action: "asciiSetup" }],
        },
        backgroundColor: asciiColor("Background color", 0.03, 0.03, 0.04),
        blockSize: asciiNum("Block size", 23, 4, 64, 1, 0),
        contrast: asciiNum("Contrast", 1, 0, 4, 0.01, 2),
        brightness: asciiNum("Brightness", 0, -1, 1, 0.01, 2),
        fontFamily: asciiOption("Font", 0, "source code pro;monospace"),
        charSize: asciiNum("Character size", 18, 8, 64, 1, 0),
        charset: asciiOption("Character set", 0, "standard;blocks;detailed;minimal;custom"),
        customChars: asciiText("Custom characters", "@%#*+=-:. "),
        colorMode: asciiOption("Color mode", 0, "band colors;footage colors;duotone;mono;invert"),
        duotoneDark: asciiColor("Duotone dark", 0.05, 0.05, 0.08),
        duotoneLight: asciiColor("Duotone light", 1, 0.2, 0.3),
        monoColor: asciiColor("Mono color", 1, 1, 1),
        randomCharacters: asciiOption("Random characters", 0, "off;on"),
        randomScale: asciiNum("Random scale", 0, 0, 300, 1, 0),
        noiseIntensity: asciiNum("Noise intensity", 0, 0, 1, 0.01, 2),
        sineEnable: asciiOption("Enable sine waves", 0, "off;on"),
        sineRadial: asciiOption("Radial effects", 0, "off;on"),
        sineSpeed: asciiNum("Sine speed", 1, 0, 6, 0.1, 1),
        sineFrequency: asciiNum("Frequency", 1, 0.1, 8, 0.1, 1),
        sineSize: asciiNum("Size", 50, 0, 100, 1, 0),
        sineIntensity: asciiNum("Sine intensity", 50, 0, 100, 1, 0),
        noiseEnable: asciiOption("Enable advanced noise", 0, "off;on"),
        noiseType: asciiOption("Noise type", 0, "perlin;simplex;fractal;turbulence"),
        noiseScale: asciiNum("Noise scale", 1, 0.1, 8, 0.1, 1),
        noiseSpeed: asciiNum("Noise speed", 1, 0, 6, 0.1, 1),
        noiseOctaves: asciiNum("Octaves", 3, 1, 8, 1, 0),
        noisePersistence: asciiNum("Persistence", 0.9, 0, 1, 0.01, 2),
        scrollEnable: asciiOption("Enable scroll", 0, "off;on"),
        scrollWaves: asciiNum("Wave count", 1, 1, 6, 1, 0),
        scrollSpeed: asciiNum("Scroll speed", 3, 0, 6, 0.1, 1),
        glitchEnable: asciiOption("Glitch cuts", 0, "off;on"),
        glitchAmount: asciiNum("Glitch amount", 60, 0, 400, 1, 0),
        glitchSpeed: asciiNum("Glitch speed", 3, 0, 6, 0.1, 1),
    },
    asciiMerge(
        asciiMerge(asciiBandDef("black", "Black", "@", "", 1, 1, 1, 100),
            asciiBandDef("white", "White", "#", "", 1, 1, 1, 100)),
        asciiMerge(asciiBandDef("grey", "Grey", "+", "", 1, 1, 1, 100),
            asciiBandDef("alpha", "Alpha", " ", "", 1, 1, 1, 100))
    )
);

if (this.properties && typeof this.properties.addAll === "function") {
    this.properties.addAll(this.propertyDefinitions, this);
}

// Deterministic cell hash in [0,1): a pure function of (x, y, s), no random source.
function asciiHash(x, y, s) {
    var h = (x * 374761393 + y * 668265263 + (s || 0) * 974634211) | 0;
    h = (h ^ (h >> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >> 16)) >>> 0;
    return h / 4294967296;
}

// Luminance band index: 0 black, 1 grey, 2 white, 3 alpha (near-clear).
function asciiBand(lum) {
    if (lum < 0.03) return 3;
    if (lum < 0.33) return 0;
    if (lum < 0.66) return 1;
    return 2;
}

var ASCII_CHARSETS = {
    blocks: [" ", "\u2591", "\u2592", "\u2593", "\u2588"],
    detailed: " .:-=+*#%@".split(""),
    minimal: [" ", "@"],
};

// Glyph for a cell: standard mode uses the band fill (or animated random
// symbols); other modes index a shared ramp by luminance.
function asciiPickGlyph(lum, st, x, y, frameIdx, bandFill) {
    if (st.randomCharacters) {
        return ASCII_RANDOM_GLYPHS[
            Math.floor(asciiHash(x, y, frameIdx) * ASCII_RANDOM_GLYPHS.length) %
            ASCII_RANDOM_GLYPHS.length
        ];
    }
    if (st.charset === 1) {
        var ramps = ASCII_CHARSETS.blocks;
        return ramps[Math.min(ramps.length - 1, Math.floor(lum * ramps.length))];
    }
    if (st.charset === 2) {
        var det = ASCII_CHARSETS.detailed;
        return det[Math.min(det.length - 1, Math.floor(lum * det.length))];
    }
    if (st.charset === 3) {
        return lum < 0.5 ? " " : "@";
    }
    if (st.charset === 4) {
        var custom = String(st.customChars || "");
        if (!custom.length) return bandFill;
        return custom[Math.min(custom.length - 1, Math.floor(lum * custom.length))];
    }
    return bandFill;
}

// RGB for a cell: band colors, raw footage colors, duotone ramp,
// single mono color (invert folds into luminance before this runs).
function asciiPickColor(lum, sample, st, bandColor) {
    if (st.colorMode === 1) return [sample[0], sample[1], sample[2]];
    if (st.colorMode === 2) {
        var d = st.duotoneDark || [0, 0, 0];
        var l = st.duotoneLight || [1, 1, 1];
        return [
            d[0] + (l[0] - d[0]) * lum,
            d[1] + (l[1] - d[1]) * lum,
            d[2] + (l[2] - d[2]) * lum,
        ];
    }
    if (st.colorMode === 3) {
        var m = st.monoColor || [1, 1, 1];
        return [m[0], m[1], m[2]];
    }
    return bandColor;
}

function asciiFade(t) {
    return t * t * (3 - 2 * t);
}

function asciiValueNoise(x, y, seed) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var xf = x - xi;
    var yf = y - yi;
    var s = seed || 0;
    var a = asciiHash(xi, yi, s);
    var b = asciiHash(xi + 1, yi, s);
    var c = asciiHash(xi, yi + 1, s);
    var d = asciiHash(xi + 1, yi + 1, s);
    var u = asciiFade(xf);
    var v = asciiFade(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function asciiFbm(x, y, octaves, persistence, seed, turbulent) {
    var total = 0;
    var amp = 1;
    var norm = 0;
    var fx = x;
    var fy = y;
    for (var o = 0; o < octaves; o++) {
        var n = asciiValueNoise(fx, fy, seed + o * 101);
        if (turbulent) n = Math.abs(n * 2 - 1);
        total += n * amp;
        norm += amp;
        amp *= persistence;
        fx = fx * 2.03 + 11.3;
        fy = fy * 2.03 + 7.7;
    }
    return norm > 0 ? total / norm : 0;
}

function asciiClamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

// A layer's share of the shared render buffer; anything out of range means the
// whole buffer.
function asciiShare(v) {
    v = Number(v);
    return v > 0 && v <= 1 ? v : 1;
}

function asciiCss(rgb, a) {
    var r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)));
    var g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)));
    var b = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)));
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}

// Glyph fonts are limited to the page's bundled Source Code Pro and the
// generic monospace family. Any other saved index falls back to Source Code
// Pro, so older projects keep loading.
var ASCII_FONTS = ["'Source Code Pro', monospace", "monospace"];

var ASCII_RANDOM_GLYPHS = "@#%&?*+=:;. ".split("");

function asciiCollectState(props, e, frame) {
    var st = {};
    var num = function (key, fb) {
        try {
            var v = props[key].get(e);
            if (typeof v === "number" && isFinite(v)) return v;
        } catch (err) {}
        return fb;
    };
    var opt = function (key, fb) {
        return Math.round(num(key, fb));
    };
    var col = function (key, fb) {
        try {
            var v = props[key].get(e);
            if (Array.isArray(v) && v.length >= 3) return [v[0], v[1], v[2]];
        } catch (err) {}
        return fb;
    };
    var txt = function (key, fb) {
        try {
            var v = props[key].get(e);
            if (typeof v === "string") return v;
        } catch (err) {}
        return fb;
    };
    st.backgroundColor = col("backgroundColor", [0.03, 0.03, 0.04]);
    st.blockSize = Math.max(4, Math.round(num("blockSize", 23)));
    st.contrast = num("contrast", 1);
    st.brightness = num("brightness", 0);
    st.fontFamily = ASCII_FONTS[opt("fontFamily", 0)] || ASCII_FONTS[0];
    st.charSize = Math.max(8, Math.round(num("charSize", 18)));
    st.charset = opt("charset", 0);
    st.customChars = txt("customChars", "@%#*+=-:. ");
    st.colorMode = opt("colorMode", 0);
    st.duotoneDark = col("duotoneDark", [0.05, 0.05, 0.08]);
    st.duotoneLight = col("duotoneLight", [1, 0.2, 0.3]);
    st.monoColor = col("monoColor", [1, 1, 1]);
    st.randomCharacters = opt("randomCharacters", 0) === 1;
    st.randomScale = num("randomScale", 0) / 100;
    st.noiseIntensity = asciiClamp01(num("noiseIntensity", 0));
    st.sineEnable = opt("sineEnable", 0) === 1;
    st.sineRadial = opt("sineRadial", 0) === 1;
    st.sineSpeed = num("sineSpeed", 1);
    st.sineFrequency = Math.max(0.1, num("sineFrequency", 1));
    st.sineSize = num("sineSize", 50);
    st.sineIntensity = num("sineIntensity", 50) / 100;
    st.noiseEnable = opt("noiseEnable", 0) === 1;
    st.noiseType = opt("noiseType", 0);
    st.noiseScale = Math.max(0.1, num("noiseScale", 1));
    st.noiseSpeed = num("noiseSpeed", 1);
    st.noiseOctaves = Math.max(1, Math.min(8, Math.round(num("noiseOctaves", 3))));
    st.noisePersistence = asciiClamp01(num("noisePersistence", 0.9));
    st.scrollEnable = opt("scrollEnable", 0) === 1;
    st.scrollWaves = Math.max(1, Math.min(6, Math.round(num("scrollWaves", 1))));
    st.scrollSpeed = num("scrollSpeed", 3);
    st.glitchEnable = opt("glitchEnable", 0) === 1;
    st.glitchAmount = Math.max(0, num("glitchAmount", 60));
    st.glitchSpeed = num("glitchSpeed", 3);
    st.bands = [];
    var prefixes = ["black", "white", "grey", "alpha"];
    for (var b = 0; b < prefixes.length; b++) {
        (function (pre) {
            var fill = txt(pre + "Fill", pre === "alpha" ? " " : "@");
            var stroke = txt(pre + "Stroke", "");
            st.bands.push({
                fill: (fill || " ").slice(0, 2),
                stroke: (stroke || "").slice(0, 2),
                color: col(pre + "Color", [1, 1, 1]),
                opacity: asciiOpacity(props, pre, e),
            });
        })(prefixes[b]);
    }
    st.frame = typeof frame === "number" && isFinite(frame) ? frame : 0;
    return st;
}

function asciiOpacity(props, pre, e) {
    try {
        var v = props[pre + "Opacity"].get(e);
        if (typeof v === "number" && isFinite(v)) return Math.max(0, Math.min(100, v)) / 100;
    } catch (err) {}
    return 1;
}

// Cell grid for a layer region of cw x ch buffer pixels. Whole cells are
// centred in the region, so no glyph is cut off by the frame edge.
// ox/oy are the margins between the region edges and the grid.
function asciiGrid(cw, ch, block) {
    var b = Math.max(4, Math.round(block));
    var cols = Math.max(1, Math.floor(cw / b));
    var rows = Math.max(1, Math.floor(ch / b));
    return {
        cols: cols,
        rows: rows,
        block: b,
        width: cw,
        height: ch,
        ox: (cw - cols * b) / 2,
        oy: (ch - rows * b) / 2,
    };
}

// Draws the glyph grid for one layer region. The region is the bottom-left
// grid.width x grid.height part of the W x H canvas, which matches the layer's
// place in CM3's shared render buffer (canvas row 0 is the buffer's top).
function asciiDrawOverlay(ctx, W, H, st, sample, grid) {
    var block = grid.block;
    var cols = grid.cols;
    var rows = grid.rows;
    var ox = grid.ox;
    var oy = H - grid.height + grid.oy;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = asciiCss(st.backgroundColor, 1);
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var time = st.frame / 30;
    var t, x, y, lum, band, glyph, size, dx, dy, alpha;
    for (y = 0; y < rows; y++) {
        for (x = 0; x < cols; x++) {
            var readY = y;
            if (st.scrollEnable) {
                readY = (((y - Math.floor(time * st.scrollSpeed)) % rows) + rows) % rows;
            }
            var s = sample(x, readY, cols, rows);
            lum = (s[0] * 0.3 + s[1] * 0.59 + s[2] * 0.11);
            lum = (lum - 0.5) * st.contrast + 0.5 + st.brightness;
            if (lum < 0) lum = 0;
            if (lum > 1) lum = 1;
            if (st.colorMode === 4) lum = 1 - lum;
            // Noise moves luminance before band and glyph selection, so it
            // changes the characters in every color mode. The seed steps four
            // times a second and depends only on the frame time and the cell.
            if (st.noiseIntensity > 0) {
                lum += (asciiHash(x + 911, y + 733, 21 + ((time * 4) | 0) * 131) - 0.5) * 2 * st.noiseIntensity * 0.35;
                if (lum < 0) lum = 0;
                if (lum > 1) lum = 1;
            }
            band = asciiBand(lum);
            var spec = st.bands[band];
            if (!spec) continue;
            glyph = asciiPickGlyph(lum, st, x, y, (time * 4) | 0, spec.fill || " ");
            if (!glyph || glyph === " ") continue;
            var rgb = asciiPickColor(lum, s, st, spec.color);
            // Glitch cuts: whole rows slice sideways for one seed step.
            var gdx = 0;
            if (st.glitchEnable && st.glitchAmount > 0) {
                var gseed = Math.floor(time * Math.max(0.5, st.glitchSpeed * 2));
                var grow = asciiHash(y, gseed, 977);
                if (grow < 0.22) {
                    gdx = (asciiHash(y, gseed, 978) - 0.5) * 2 * st.glitchAmount;
                }
            }
            size = st.charSize;
            if (st.randomScale > 0) {
                size = size * (1 + (asciiHash(x + 57, y + 131, 7) - 0.5) * 2 * st.randomScale);
                if (size < 4) size = 4;
            }
            dx = 0;
            dy = 0;
            if (st.sineEnable) {
                var dist = st.sineRadial
                    ? Math.sqrt(Math.pow(x - cols / 2, 2) + Math.pow(y - rows / 2, 2))
                    : x;
                var wave = Math.sin(dist * st.sineFrequency * 0.35 - time * st.sineSpeed * 2);
                dy += wave * st.sineSize * 0.12 * st.sineIntensity;
            }
            if (st.noiseEnable) {
                var nse = asciiFbm(
                    (x / cols) * 4 * st.noiseScale + time * st.noiseSpeed,
                    (y / rows) * 4 * st.noiseScale,
                    st.noiseOctaves,
                    st.noisePersistence,
                    st.noiseType * 131,
                    st.noiseType === 3
                );
                var disp = (nse - 0.5) * block * 0.9;
                dx += disp;
                dy += (asciiFbm(
                    (x / cols) * 4 * st.noiseScale + 40.7,
                    (y / rows) * 4 * st.noiseScale + time * st.noiseSpeed,
                    st.noiseOctaves,
                    st.noisePersistence,
                    st.noiseType * 719,
                    st.noiseType === 3
                ) - 0.5) * block * 0.9;
                size = size * (1 + (nse - 0.5) * 0.6);
                if (size < 4) size = 4;
            }
            if (st.scrollEnable) {
                dy += Math.sin(((x / Math.max(cols, 1)) * st.scrollWaves * Math.PI * 2) + time * st.scrollSpeed) * 4;
            }
            alpha = spec.opacity;
            var cx = ox + (x + 0.5) * block + dx + gdx;
            var cy = oy + (y + 0.5) * block + dy;
            ctx.font = Math.round(size) + "px " + st.fontFamily;
            if (spec.stroke && st.charset === 0) {
                ctx.lineWidth = Math.max(1, size / 14);
                ctx.strokeStyle = asciiCss(rgb, alpha);
                ctx.strokeText(glyph, cx, cy);
            }
            ctx.fillStyle = asciiCss(rgb, alpha);
            ctx.fillText(glyph, cx, cy);
        }
    }
    return { cols: cols, rows: rows };
}

// Resolves once the glyph font is available. Canvas text drawn before the
// page font face loads would fall back to a different glyph shape, so the
// effect waits here (through prepare) before a frame is rendered.
function asciiFontReady() {
    var fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
    return Promise.resolve(fonts.load("20px 'Source Code Pro'")).then(
        function () {},
        function () {}
    );
}

this.load = async function (e) {
    this.pass = new THREE.AsciiPass();
    this.pass.setSize(2, 2);
    this.properties.load(e && e.properties);
    this._fontReady = asciiFontReady();
    await this._fontReady;
};

this.prepare = async function () {
    if (this._fontReady) await this._fontReady;
};

this.toJSON = function () {
    return { type: this.type, properties: this.properties };
};

this.unload = function (e) {
    if (this.pass && typeof this.pass.dispose === "function") {
        this.pass.dispose();
    }
    this.pass = null;
};

// The overlay is recomputed for every rendered frame from the collected
// state, so no output depends on earlier renders.
this.update = function (e) {
    if (!this.pass) {
        return;
    }
    var st = null;
    try {
        st = asciiCollectState(this.properties, e, e);
    } catch (err) {
        st = null;
    }
    var on = false;
    try {
        on = this.properties.enabled.get(e) === 1;
    } catch (err) {}
    this.pass.enabled = on;
    this.pass.asciiState = st;
};

if (!THREE.AsciiPass) {
    THREE.AsciiPass = function () {
        this.enabled = true;
        this.needsSwap = true;
        this.opacity = 1;
        this.asciiState = null;
        this.canvas = null;
        this.canvasTexture = null;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.sampleTarget = null;
        this.samplePixels = null;
        this.sampleWidth = 0;
        this.sampleHeight = 0;
        var material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { type: "t", value: null },
                tOverlay: { type: "t", value: null },
                uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
                opacity: { type: "f", value: 1 },
            },
            vertexShader: [
                "uniform vec2 uvScale;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "    vUv = uv;",
                "    vUvScaled = uv * uvScale;",
                "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "uniform sampler2D tOverlay;",
                "uniform float opacity;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "void main() {",
                "    vec4 bg = texture2D(tDiffuse, vUvScaled);",
                "    vec4 ov = texture2D(tOverlay, vUvScaled);",
                "    float a = clamp(ov.a * opacity, 0.0, 1.0);",
                "    vec3 rgb = mix(bg.rgb, ov.rgb, a);",
                "    float alpha = max(bg.a, a);",
                "    gl_FragColor = vec4(rgb, alpha);",
                "}",
            ].join("\n"),
        });
        material.transparent = true;
        this.material = material;
        this.uniforms = material.uniforms;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.scene.add(this.camera);
        this.quad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), material);
        this.quad.frustumCulled = false;
        this.scene.add(this.quad);
        // Samples the layer at the grid cell centres. The sample target has one
        // texel per cell; sampleOffset/sampleScale map its UVs onto the grid
        // rectangle inside the shared buffer.
        var copyMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { type: "t", value: null },
                sampleOffset: { type: "v2", value: new THREE.Vector2(0, 0) },
                sampleScale: { type: "v2", value: new THREE.Vector2(1, 1) },
            },
            vertexShader: [
                "varying vec2 vUv;",
                "void main() {",
                "    vUv = uv;",
                "    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
                "}",
            ].join("\n"),
            fragmentShader: [
                "uniform sampler2D tDiffuse;",
                "uniform vec2 sampleOffset;",
                "uniform vec2 sampleScale;",
                "varying vec2 vUv;",
                "void main() {",
                "    gl_FragColor = texture2D(tDiffuse, sampleOffset + vUv * sampleScale);",
                "}",
            ].join("\n"),
        });
        this.copyMaterial = copyMaterial;
        this.copyScene = new THREE.Scene();
        this.copyScene.add(this.camera);
        this.copyQuad = new THREE.Mesh(new THREE.PlaneBufferGeometry(2, 2), copyMaterial);
        this.copyQuad.frustumCulled = false;
        this.copyScene.add(this.copyQuad);
    };
    THREE.AsciiPass.prototype = Object.assign(Object.create(THREE.Pass.prototype), {
        constructor: THREE.AsciiPass,
        setSize: function (e, t) {},
        gridFor: function (w, h, block) {
            return asciiGrid(w, h, block);
        },
        // CM3 renders each layer into the shared, output-sized buffer and sets
        // this pass's uvScale to the layer's share of that buffer (see
        // renderEffects in the CM3 core). The layer occupies the bottom-left
        // part of the buffer, so the grid is laid out over that part only.
        layerRegion: function (w, h) {
            var scale = this.uniforms.uvScale && this.uniforms.uvScale.value;
            var sx = scale ? asciiShare(scale.x) : 1;
            var sy = scale ? asciiShare(scale.y) : 1;
            return {
                width: Math.max(1, Math.min(w, Math.round(w * sx))),
                height: Math.max(1, Math.min(h, Math.round(h * sy))),
            };
        },
        render: function (renderer, writeBuffer, readBuffer) {
            var w = readBuffer ? readBuffer.width : 0;
            var h = readBuffer ? readBuffer.height : 0;
            if (!w || !h) return;
            var st = this.asciiState;
            var block = st && st.blockSize ? st.blockSize : 23;
            var region = this.layerRegion(w, h);
            var grid = asciiGrid(region.width, region.height, block);
            var cols = grid.cols;
            var rows = grid.rows;
            if (!this.canvas || this.canvasWidth !== w || this.canvasHeight !== h) {
                this.canvas = document.createElement("canvas");
                this.canvas.width = w;
                this.canvas.height = h;
                this.canvasWidth = w;
                this.canvasHeight = h;
                if (this.canvasTexture) this.canvasTexture.dispose();
                this.canvasTexture = new THREE.CanvasTexture(this.canvas);
            }
            if (!this.sampleTarget || this.sampleWidth !== cols || this.sampleHeight !== rows) {
                if (this.sampleTarget) this.sampleTarget.dispose();
                this.sampleTarget = new THREE.WebGLRenderTarget(cols, rows, {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    depthBuffer: false,
                    stencilBuffer: false,
                });
                this.sampleWidth = cols;
                this.sampleHeight = rows;
                this.samplePixels = new Uint8Array(cols * rows * 4);
            }
            if (st) {
                try {
                    this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
                    // Map the sample texels onto the grid rectangle, measured
                    // from the buffer's bottom-left (texture) origin.
                    var sampleUniforms = this.copyMaterial.uniforms;
                    sampleUniforms.sampleOffset.value.x = grid.ox / w;
                    sampleUniforms.sampleOffset.value.y = grid.oy / h;
                    sampleUniforms.sampleScale.value.x = (cols * grid.block) / w;
                    sampleUniforms.sampleScale.value.y = (rows * grid.block) / h;
                    var oldAutoClear = renderer.autoClear;
                    renderer.autoClear = false;
                    renderer.render(this.copyScene, this.camera, this.sampleTarget, true);
                    renderer.autoClear = oldAutoClear;
                    renderer.readRenderTargetPixels(
                        this.sampleTarget, 0, 0, cols, rows, this.samplePixels
                    );
                    var ctx = this.canvas.getContext("2d");
                    var sw = cols;
                    var sh = rows;
                    var px = this.samplePixels;
                    asciiDrawOverlay(ctx, w, h, st, function (x, y) {
                        var sx = Math.max(0, Math.min(sw - 1, x));
                        var sy = Math.max(0, Math.min(sh - 1, sh - 1 - y));
                        var o = (sy * sw + sx) * 4;
                        return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
                    }, grid);
                    this.canvasTexture.needsUpdate = true;
                } catch (err) {
                    var message = String((err && err.stack) || err).slice(0, 300);
                    if (message !== this.lastError) {
                        this.lastError = message;
                        console.error("[Zoidium] ASCII overlay failed:", message);
                    }
                }
            }
            this.uniforms.tDiffuse.value = readBuffer.texture;
            this.uniforms.tOverlay.value = this.canvasTexture ? this.canvasTexture : null;
            this.uniforms.opacity.value = this.opacity;
            var oldClear = renderer.autoClear;
            renderer.autoClear = false;
            renderer.render(this.scene, this.camera, writeBuffer || readBuffer, true);
            renderer.autoClear = oldClear;
        },
        dispose: function () {
            if (this.canvasTexture) this.canvasTexture.dispose();
            this.canvasTexture = null;
            this.canvas = null;
            if (this.sampleTarget) this.sampleTarget.dispose();
            this.sampleTarget = null;
            this.samplePixels = null;
            if (this.material) this.material.dispose();
            if (this.copyMaterial) this.copyMaterial.dispose();
            if (this.quad) this.quad.geometry.dispose();
            if (this.copyQuad) this.copyQuad.geometry.dispose();
        },
    });
}
