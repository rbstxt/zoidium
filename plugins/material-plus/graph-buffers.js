"use strict";

// Node graph pixel buffers: typed-array image math for every procedural
// node (noise, marble, spectra, gradients, color ops). Stateless apart
// from the per-runtime fractal scratch space and lattice cache, which
// this factory creates fresh for each graph runtime.

module.exports = function createPixelBuffers(document) {
    const { clamp } = ZoidiumPluginApis.color;

    function random(seed) {
        var value = seed | 0;
        return function () {
            value = (value + 0x6d2b79f5) | 0;
            var t = Math.imul(value ^ (value >>> 15), 1 | value);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function newBuffer(size) {
        return new Uint8ClampedArray(size * size * 4);
    }

    function bufferToCanvas(size, buffer) {
        if (!document) return buffer;
        var canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        var context = canvas.getContext("2d");
        var image = context.createImageData(size, size);
        image.data.set(buffer);
        context.putImageData(image, 0, 0);
        return canvas;
    }

    function luminanceAt(buffer, index) {
        return (buffer[index] * 0.3 + buffer[index + 1] * 0.59 + buffer[index + 2] * 0.11) / 255;
    }

    const extraBlend = require("./graph-blend.js");
    function blend(base, top, mode) {
        if (mode === 1) return base + top;
        if (mode === 2) return base - top;
        if (mode === 3) return base * top;
        if (mode === 4) return 1 - (1 - base) * (1 - top);
        if (mode === 5) return base < 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top);
        if (mode === 6) return Math.min(base, top);
        if (mode === 7) return Math.max(base, top);
        if (mode === 8) return Math.abs(base - top);
        return mode >= 9 ? extraBlend.blend(base, top, mode) : top;
    }

    var BLEND_MODES = ["normal", "add", "subtract", "multiply", "screen", "overlay", "darken", "lighten", "difference", ...extraBlend.names];
    var MATH_MODES = ["Add", "Subtract", "Multiply", "Divide", "Minimum", "Maximum", "Power", "Modulo", "Absolute", "Invert", "Clamp", "Compare", "Sine", "Round", "Square Root", "Logarithm", "Exponent", "Floor", "Ceiling", "Fraction", "Sign", "Smooth Minimum", "Smooth Maximum", "Snap", "Wrap", "Ping-Pong", "Cosine", "Tangent", "Arctan2", "Greater Than", "Less Than"];

    function coordsAt(uv, index, size, x, y, coords) {
        coords[0] = uv ? uv[index] / 255 : x / size;
        coords[1] = uv ? uv[index + 1] / 255 : y / size;
        return coords;
    }

    let fractalScratch = null;
    let latticeCache = null;
    function fractalBuffer(size, params, time, transform, uv) {
        var octaves = clamp(Math.round(params.octaves || 4), 1, 8);
        var frequencyX = Math.max(1, Math.round(params.scale || 4));
        var frequencyY = Math.max(1, Math.round((params.scale || 4) * (params.ratio || 1)));
        var rand = random(params.seed || 1);
        if (!fractalScratch || fractalScratch.size !== size) fractalScratch = {
            size, values: new Float32Array(size * size), layer: new Float32Array(size * size),
            x0: new Int32Array(size), x1: new Int32Array(size), sx: new Float64Array(size),
        };
        var { values, layer, x0: xs0, x1: xs1, sx: xSmooth } = fractalScratch;
        values.fill(0);
        const latticeKey = JSON.stringify([octaves, frequencyX, frequencyY, params.seed || 1]);
        const cachedLattices = latticeCache?.key === latticeKey ? latticeCache.layers : null;
        const lattices = cachedLattices || [];
        var amplitude = 1;
        var total = 0;
        var offsetX = (params.speedX || 0) * (time || 0);
        var offsetY = (params.speedY || 0) * (time || 0);
        for (var o = 0; o < octaves; o++) {
            var cellsX = Math.min(1024, Math.max(1, frequencyX));
            var cellsY = Math.min(1024, Math.max(1, frequencyY));
            var lattice = cachedLattices ? cachedLattices[o] : new Float32Array(cellsX * cellsY);
            if (!cachedLattices) {
                for (var i = 0; i < lattice.length; i++) lattice[i] = rand();
                lattices.push(lattice);
            }
            // Unmapped UVs are separable. Compute horizontal coordinates once
            // per octave and vertical coordinates once per row.
            if (!uv) for (var x = 0; x < size; x++) {
                var gx = x / size * cellsX + offsetX;
                var floorX = Math.floor(gx), fx = gx - floorX;
                xs0[x] = ((floorX % cellsX) + cellsX) % cellsX;
                xs1[x] = (xs0[x] + 1) % cellsX;
                xSmooth[x] = fx * fx * (3 - 2 * fx);
            }
            for (var y = 0; y < size; y++) {
                var gyRow = y / size * cellsY + offsetY;
                var floorY = Math.floor(gyRow), fyRow = gyRow - floorY;
                var rowSmooth = fyRow * fyRow * (3 - 2 * fyRow);
                var row0 = ((floorY % cellsY) + cellsY) % cellsY;
                var row1 = (row0 + 1) % cellsY;
                for (var x = 0; x < size; x++) {
                    var index = (x + y * size) * 4;
                    var ix0, ix1, iy0, iy1, sx, sy;
                    if (uv) {
                        var gx = uv[index] / 255 * cellsX + offsetX;
                        var gy = uv[index + 1] / 255 * cellsY + offsetY;
                        var x0 = Math.floor(gx), y0 = Math.floor(gy);
                        var fx = gx - x0, fy = gy - y0;
                        sx = fx * fx * (3 - 2 * fx);
                        sy = fy * fy * (3 - 2 * fy);
                        ix0 = ((x0 % cellsX) + cellsX) % cellsX;
                        ix1 = (ix0 + 1) % cellsX;
                        iy0 = ((y0 % cellsY) + cellsY) % cellsY;
                        iy1 = (iy0 + 1) % cellsY;
                    } else {
                        ix0 = xs0[x]; ix1 = xs1[x]; sx = xSmooth[x];
                        iy0 = row0; iy1 = row1; sy = rowSmooth;
                    }
                    var v00 = lattice[ix0 + iy0 * cellsX];
                    var v10 = lattice[ix1 + iy0 * cellsX];
                    var v01 = lattice[ix0 + iy1 * cellsX];
                    var v11 = lattice[ix1 + iy1 * cellsX];
                    var top = v00 + (v10 - v00) * sx;
                    var bottom = v01 + (v11 - v01) * sx;
                    var value = top + (bottom - top) * sy;
                    if (transform === 1) value = 1 - Math.abs(2 * value - 1);
                    else if (transform === 2) value = Math.abs(2 * value - 1);
                    layer[x + y * size] = value;
                }
            }
            for (var l = 0; l < size * size; l++) {
                values[l] += layer[l] * amplitude;
            }
            total += amplitude;
            amplitude *= 0.5;
            frequencyX *= 2;
            frequencyY *= 2;
        }
        latticeCache = { key: latticeKey, layers: lattices };
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            params._pixel = p * 4;
            var contrast = params.contrast === undefined ? 1 : params.contrast;
            var brightness = params.brightness === undefined ? 1 : params.brightness;
            var normalized = values[p] / total;
            normalized = (normalized - 0.5) * contrast + 0.5;
            normalized = clamp(normalized * brightness, 0, 1);
            var gray = Math.round(normalized * 255);
            var index = p * 4;
            buffer[index] = gray;
            buffer[index + 1] = gray;
            buffer[index + 2] = gray;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function noiseBuffer(size, params, time, uv) {
        return fractalBuffer(size, params, time, 0, uv);
    }

    function ridgedBuffer(size, params, time, uv) {
        return fractalBuffer(size, params, time, 1, uv);
    }

    function turbulenceBuffer(size, params, time, uv) {
        return fractalBuffer(size, params, time, 2, uv);
    }

    function sineBuffer(size, params, uv) {
        var buffer = newBuffer(size);
        var coordinates = new Float64Array(2);
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                params._pixel = index;

                var coords = coordsAt(uv, index, size, x, y, coordinates);
                var coord = params.axis === 1 ? coords[1] : coords[0];
                var value = 0.5 + 0.5 * Math.sin((coord * params.scale + params.phase) * Math.PI * 2);
                var gray = Math.round(clamp(value, 0, 1) * 255);
                buffer[index] = gray;
                buffer[index + 1] = gray;
                buffer[index + 2] = gray;
                buffer[index + 3] = 255;
            }
        }
        return buffer;
    }

    function marbleBuffer(size, params, time, uv) {
        var fractal = fractalBuffer(size, {
            scale: params.fractalScale,
            ratio: 1,
            octaves: params.octaves,
            seed: params.seed,
            brightness: 1,
            contrast: 1,
        }, time, 0, uv);
        var buffer = newBuffer(size);
        var coordinates = new Float64Array(2);
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                params._pixel = index;

                var coords = coordsAt(uv, index, size, x, y, coordinates);
                var coord = coords[1] * params.scale + (fractal[index] / 255) * params.veins;
                var gray = Math.round(clamp(0.5 + 0.5 * Math.sin(coord * Math.PI * 2), 0, 1) * 255);
                buffer[index] = gray;
                buffer[index + 1] = gray;
                buffer[index + 2] = gray;
                buffer[index + 3] = 255;
            }
        }
        return buffer;
    }

    function dirtBuffer(size, params, time, uv) {
        var fractal = fractalBuffer(size, {
            scale: params.scale,
            ratio: params.ratio,
            octaves: params.octaves,
            seed: params.seed,
            brightness: 1,
            contrast: 2,
        }, time, 2, uv);
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;

            var value = 1 - fractal[index] / 255;
            value = clamp((value - 0.5) * (params.radius || 1) + 0.5, 0, 1);
            var gray = Math.round(value * 255);
            buffer[index] = gray;
            buffer[index + 1] = gray;
            buffer[index + 2] = gray;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function invertBuffer(size, input, params) {
        var source = input || colorBuffer(size, [0.5, 0.5, 0.5]);
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;
            var strength = params.strength === undefined ? 1 : params.strength;

            for (var c = 0; c < 3; c++) {
                var value = source[index + c] / 255;
                buffer[index + c] = (value + (1 - 2 * value) * strength) * 255;
            }
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function clampBuffer(size, input, params) {
        var source = input || colorBuffer(size, [0.5, 0.5, 0.5]);
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;
            var min = params.min === undefined ? 0 : params.min;
            var max = params.max === undefined ? 1 : params.max;

            for (var c = 0; c < 3; c++) {
                buffer[index + c] = clamp(source[index + c] / 255, min, max) * 255;
            }
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function floatBuffer(size, params) {
        var value = clamp(params.value === undefined ? 1 : params.value, 0, 1);
        return colorBuffer(size, [value, value, value]);
    }

    function binaryBuffer(size, a, b, params, op) {
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;

            var base = a ? a[index] / 255 : 0;
            var top = b ? b[index] / 255 : clamp(params.value === undefined ? 1 : params.value, 0, 1);
            var result;
            if (op === 1) result = base + top;
            else if (op === 2) result = base - top;
            else result = base * top;
            var gray = clamp(result, 0, 1) * 255;
            buffer[index] = gray;
            buffer[index + 1] = gray;
            buffer[index + 2] = gray;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function multiplyBuffer(size, a, b, params) {
        return binaryBuffer(size, a, b, params, 0);
    }

    function addBuffer(size, a, b, params) {
        return binaryBuffer(size, a, b, params, 1);
    }

    function subtractBuffer(size, a, b, params) {
        return binaryBuffer(size, a, b, params, 2);
    }

    function compareBuffer(size, a, b, params) {
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;

            var base = a ? a[index] / 255 : 0;
            var top = b ? b[index] / 255 : clamp(params.value === undefined ? 0.5 : params.value, 0, 1);
            var result;
            if (params.op === 1) result = base < top ? 1 : 0;
            else if (params.op === 2) result = Math.abs(base - top) <= (params.epsilon || 0.01) ? 1 : 0;
            else result = base > top ? 1 : 0;
            var gray = result * 255;
            buffer[index] = gray;
            buffer[index + 1] = gray;
            buffer[index + 2] = gray;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function cosineMixBuffer(size, a, b, params) {
        var source = a || colorBuffer(size, [0, 0, 0]);
        var target = b || source;
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;
            var mix = clamp(params.mix === undefined ? 0.5 : params.mix, 0, 1);
            var t = 0.5 - 0.5 * Math.cos(Math.PI * mix);

            for (var c = 0; c < 3; c++) {
                var base = source[index + c] / 255;
                var top = target[index + c] / 255;
                buffer[index + c] = (base + (top - base) * t) * 255;
            }
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    // The graph worker embeds these shared tables before loading this factory.
    const { rgbToHsv01: rgbToHsv, hsvToRgb01: hsvToRgb } = ZoidiumPluginApis.color;

    function colorCorrectionBuffer(size, input, params) {
        var source = input || colorBuffer(size, [1, 1, 1]);
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;
            var brightness = params.brightness === undefined ? 1 : params.brightness;
            var contrast = params.contrast === undefined ? 1 : params.contrast;
            var gamma = params.gamma === undefined ? 1 : params.gamma;
            var hue = (params.hue || 0) / 360;
            var saturation = params.saturation === undefined ? 1 : params.saturation;

            for (var c = 0; c < 3; c++) {
                var value = source[index + c] / 255;
                value = (value - 0.5) * contrast + 0.5;
                value = clamp(value, 0, 1);
                if (gamma !== 1) value = Math.pow(value, 1 / gamma);
                buffer[index + c] = clamp(value * brightness, 0, 1) * 255;
            }
            if (hue !== 0 || saturation !== 1) {
                var hsv = rgbToHsv(buffer[index] / 255, buffer[index + 1] / 255, buffer[index + 2] / 255);
                var shifted = (hsv[0] + hue) % 1;
                if (shifted < 0) shifted += 1;
                var rgb = hsvToRgb(shifted, clamp(hsv[1] * saturation, 0, 1), hsv[2]);
                buffer[index] = rgb[0] * 255;
                buffer[index + 1] = rgb[1] * 255;
                buffer[index + 2] = rgb[2] * 255;
            }
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function colorizerBuffer(size, input, params) {
        var source = input || colorBuffer(size, [0.5, 0.5, 0.5]);
        var buffer = newBuffer(size);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;

            var t = luminanceAt(source, index);
            var scaled = t * 4;
            var segment = Math.min(3, Math.floor(scaled));
            var local = scaled - segment;
            var first = params["color" + (segment + 1)];
            var second = params["color" + (segment + 2)];
            buffer[index] = (first[0] + (second[0] - first[0]) * local) * 255;
            buffer[index + 1] = (first[1] + (second[1] - first[1]) * local) * 255;
            buffer[index + 2] = (first[2] + (second[2] - first[2]) * local) * 255;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function randomColorBuffer(size, params) {
        var rand = random(params.seed || 1);
        var color = [rand(), rand(), rand()];
        var boost = params.brightness === undefined ? 1 : params.brightness;
        return colorBuffer(size, [clamp(color[0] * boost, 0, 1), clamp(color[1] * boost, 0, 1), clamp(color[2] * boost, 0, 1)]);
    }

    const { wavelengthColor, uniformPixels, rgbSpectrumBuffer, gaussianSpectrumColor, gaussianSpectrumBuffer, blackbodyColor, blackbodyBuffer } = require("./graph-spectra.js")({ newBuffer, clamp, luminanceAt, colorBuffer });

    function transformBuffer(size, input, params) {
        if (!input) return null;
        var angle = ((params.rotation || 0) * Math.PI) / 180;
        var cos = Math.cos(-angle);
        var sin = Math.sin(-angle);
        var offsetX = params.offsetX || 0;
        var offsetY = params.offsetY || 0;
        var scaleX = params.scaleX || 1;
        var scaleY = params.scaleY || 1;
        var buffer = newBuffer(size);
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var u = (x / size - 0.5 - offsetX) / scaleX;
                var v = (y / size - 0.5 - offsetY) / scaleY;
                var ru = u * cos - v * sin + 0.5;
                var rv = u * sin + v * cos + 0.5;
                ru = ru - Math.floor(ru);
                rv = rv - Math.floor(rv);
                var sx = Math.min(size - 1, Math.floor(ru * size));
                var sy = Math.min(size - 1, Math.floor(rv * size));
                var source = (sx + sy * size) * 4;
                var target = (x + y * size) * 4;
                buffer[target] = input[source];
                buffer[target + 1] = input[source + 1];
                buffer[target + 2] = input[source + 2];
                buffer[target + 3] = 255;
            }
        }
        return buffer;
    }

    function colorBuffer(size, color) {
        var buffer = newBuffer(size);
        var r = Math.round(clamp(color[0], 0, 1) * 255);
        var g = Math.round(clamp(color[1], 0, 1) * 255);
        var b = Math.round(clamp(color[2], 0, 1) * 255);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            buffer[index] = r;
            buffer[index + 1] = g;
            buffer[index + 2] = b;
            buffer[index + 3] = 255;
        }
        buffer.uniform = true;
        return buffer;
    }

    function gradientTypeT(params, u, v) {
        var angle = ((params.rotation || 0) * Math.PI) / 180;
        var cos = Math.cos(-angle);
        var sin = Math.sin(-angle);
        var cu = (u - 0.5 - (params.offsetX || 0)) / (params.scaleX || 1);
        var cv = (v - 0.5 - (params.offsetY || 0)) / (params.scaleY || 1);
        var ru = cu * cos - cv * sin;
        var rv = cu * sin + cv * cos;
        var t;
        if (params.type === 1) {
            t = Math.min(1, Math.sqrt(ru * ru + rv * rv) * 2);
        } else if (params.type === 2) {
            t = Math.atan2(rv, ru) / (Math.PI * 2) + 0.5;
        } else if (params.type === 3) {
            t = Math.min(1, (Math.abs(ru) + Math.abs(rv)) * 2);
        } else {
            t = ru + 0.5;
        }
        return clamp(t, 0, 1);
    }

    function gradientBuffer(size, position, base, params) {
        var buffer = newBuffer(size);
        const hsvA = new Float64Array(3), hsvB = new Float64Array(3), rgb = new Float64Array(3);
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                params._pixel = index;
                var c1 = params.color1;
                var c2 = params.color2;
                var midpoint = clamp(params.midpoint, 0.001, 0.999);
                var opacity = clamp(params.opacity === undefined ? 1 : params.opacity, 0, 1);
                var mode = params.blendMode || 0;

                var t = position ? luminanceAt(position, index) : gradientTypeT(params, x / size, y / size);
                var ramp = t < midpoint ? 0.5 * (t / midpoint) : 0.5 + 0.5 * ((t - midpoint) / (1 - midpoint));
                var cr = c1[0] + (c2[0] - c1[0]) * ramp;
                var cg = c1[1] + (c2[1] - c1[1]) * ramp;
                var cb = c1[2] + (c2[2] - c1[2]) * ramp;
                if (base) {
                    var br = base[index] / 255;
                    var bg = base[index + 1] / 255;
                    var bb = base[index + 2] / 255;
                    if (mode >= 15) extraBlend.blendColor(br, bg, bb, cr, cg, cb, mode, hsvA, hsvB, rgb);
                    buffer[index] = (br + ((mode >= 15 ? rgb[0] : blend(br, cr, mode)) - br) * opacity) * 255;
                    buffer[index + 1] = (bg + ((mode >= 15 ? rgb[1] : blend(bg, cg, mode)) - bg) * opacity) * 255;
                    buffer[index + 2] = (bb + ((mode >= 15 ? rgb[2] : blend(bb, cb, mode)) - bb) * opacity) * 255;
                } else {
                    buffer[index] = cr * 255;
                    buffer[index + 1] = cg * 255;
                    buffer[index + 2] = cb * 255;
                }
                buffer[index + 3] = 255;
            }
        }
        return buffer;
    }

    function checkerBuffer(size, params, uv) {
        var buffer = newBuffer(size);
        var coordinates = new Float64Array(2);
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                params._pixel = index;
                var scale = Math.max(1, Math.round(params.scale));

                var coords = coordsAt(uv, index, size, x, y, coordinates);
                var checker = (Math.floor(coords[0] * scale) + Math.floor(coords[1] * scale)) % 2;
                var color = checker === 0 ? params.color1 : params.color2;
                buffer[index] = clamp(color[0], 0, 1) * 255;
                buffer[index + 1] = clamp(color[1], 0, 1) * 255;
                buffer[index + 2] = clamp(color[2], 0, 1) * 255;
                buffer[index + 3] = 255;
            }
        }
        return buffer;
    }

    function projectionBuffer(size, params) {
        var buffer = newBuffer(size);
        var angle = ((params.rotation || 0) * Math.PI) / 180;
        var cos = Math.cos(-angle);
        var sin = Math.sin(-angle);
        var scaleX = params.scaleX || 1;
        var scaleY = params.scaleY || 1;
        var offsetX = params.offsetX || 0;
        var offsetY = params.offsetY || 0;
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                var u = (x / size - 0.5 - offsetX) / scaleX;
                var v = (y / size - 0.5 - offsetY) / scaleY;
                var ru = u * cos - v * sin;
                var rv = u * sin + v * cos;
                var ou;
                var ov;
                if (params.mode === 1 || params.mode === 2 || params.mode === 3) {
                    ou = Math.atan2(rv, ru) / (Math.PI * 2) + 0.5;
                } else {
                    ou = ru + 0.5;
                }
                if (params.mode === 1) {
                    ov = Math.min(1, Math.sqrt(ru * ru + rv * rv) * 2);
                } else if (params.mode === 2) {
                    ov = rv + 0.5;
                } else if (params.mode === 3) {
                    ov = Math.asin(clamp(Math.sqrt(ru * ru + rv * rv) * 2, 0, 1)) / (Math.PI / 2);
                } else {
                    ov = rv + 0.5;
                }
                ou = ou - Math.floor(ou);
                ov = ov - Math.floor(ov);
                buffer[index] = ou * 255;
                buffer[index + 1] = ov * 255;
                buffer[index + 2] = 0;
                buffer[index + 3] = 255;
            }
        }
        return buffer;
    }

    function mixBuffer(size, a, b, params) {
        var buffer = newBuffer(size);
        const hsvA = new Float64Array(3), hsvB = new Float64Array(3), rgb = new Float64Array(3);
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;
            var opacity = clamp(params.opacity, 0, 1);
            var mode = params.mode;
            if (mode >= 15) extraBlend.blendColor(a ? a[index] / 255 : 0, a ? a[index + 1] / 255 : 0, a ? a[index + 2] / 255 : 0, b ? b[index] / 255 : a ? a[index] / 255 : 0, b ? b[index + 1] / 255 : a ? a[index + 1] / 255 : 0, b ? b[index + 2] / 255 : a ? a[index + 2] / 255 : 0, mode, hsvA, hsvB, rgb);

            for (var c = 0; c < 3; c++) {
                var base = a ? a[index + c] / 255 : 0;
                var top = b ? b[index + c] / 255 : base;
                buffer[index + c] = (base + ((mode >= 15 ? rgb[c] : blend(base, top, mode)) - base) * opacity) * 255;
            }
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    function mathBuffer(size, a, b, params) {
        var buffer = newBuffer(size);
        var op = params.op;
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            var base = a ? a[index] / 255 : 0;
            var top = b ? b[index] / 255 : clamp(params.value, 0, 1);
            var result;
            if (op === 0) result = base + top;
            else if (op === 1) result = base - top;
            else if (op === 2) result = base * top;
            else if (op === 3) result = top === 0 ? 0 : base / top;
            else if (op === 4) result = Math.min(base, top);
            else result = Math.max(base, top);
            var gray = clamp(result, 0, 1) * 255;
            buffer[index] = gray;
            buffer[index + 1] = gray;
            buffer[index + 2] = gray;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

    return {
  clamp, random, newBuffer, bufferToCanvas, luminanceAt, blend,
  BLEND_MODES, MATH_MODES, coordsAt, fractalBuffer, noiseBuffer, ridgedBuffer,
  turbulenceBuffer, sineBuffer, marbleBuffer, dirtBuffer, invertBuffer,
  clampBuffer, floatBuffer, binaryBuffer, multiplyBuffer, addBuffer,
  subtractBuffer, compareBuffer, cosineMixBuffer, rgbToHsv, hsvToRgb,
  colorCorrectionBuffer, colorizerBuffer, randomColorBuffer, wavelengthColor,
  uniformPixels, rgbSpectrumBuffer, gaussianSpectrumColor,
  gaussianSpectrumBuffer, blackbodyColor, blackbodyBuffer, transformBuffer,
  colorBuffer, gradientTypeT, gradientBuffer, checkerBuffer, projectionBuffer,
  mixBuffer, mathBuffer
 };
};
