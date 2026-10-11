// Node evaluation ported from DaviFX OpenZoid. Editor and asset ownership are Zoidium code.
return function createGraphRuntime(PZ, document) {
    const nodes = {};
    function clamp(value, min, max) {
        return value < min ? min : value > max ? max : value;
    }

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

    function blend(base, top, mode) {
        if (mode === 1) return base + top;
        if (mode === 2) return base - top;
        if (mode === 3) return base * top;
        if (mode === 4) return 1 - (1 - base) * (1 - top);
        if (mode === 5) return base < 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top);
        if (mode === 6) return Math.min(base, top);
        if (mode === 7) return Math.max(base, top);
        if (mode === 8) return Math.abs(base - top);
        return top;
    }

    var BLEND_MODES = ["normal", "add", "subtract", "multiply", "screen", "overlay", "darken", "lighten", "difference"];
    var MATH_MODES = ["Add", "Subtract", "Multiply", "Divide", "Minimum", "Maximum", "Power", "Modulo", "Absolute", "Invert", "Clamp", "Compare", "Sine", "Round"];

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

    function wavelengthColor(wavelength, result = [0, 0, 0]) {
        var r = 0;
        var g = 0;
        var b = 0;
        if (wavelength < 440) {
            r = -(wavelength - 440) / 60;
            b = 1;
        } else if (wavelength < 490) {
            g = (wavelength - 440) / 50;
            b = 1;
        } else if (wavelength < 510) {
            g = 1;
            b = -(wavelength - 510) / 20;
        } else if (wavelength < 580) {
            r = (wavelength - 510) / 70;
            g = 1;
        } else if (wavelength < 645) {
            r = 1;
            g = -(wavelength - 645) / 65;
        } else {
            r = 1;
        }
        var factor;
        if (wavelength < 420) factor = 0.3 + (0.7 * (wavelength - 380)) / 40;
        else if (wavelength <= 700) factor = 1;
        else factor = 0.3 + (0.7 * (780 - wavelength)) / 80;
        factor = clamp(factor, 0, 1);
        result[0] = clamp(r * factor, 0, 1); result[1] = clamp(g * factor, 0, 1); result[2] = clamp(b * factor, 0, 1);
        return result;
    }

    function uniformPixels(size, color) {
        const buffer = newBuffer(size);
        for (let i = 0; i < buffer.length; i += 4) {
            buffer[i] = color[0] * 255; buffer[i + 1] = color[1] * 255; buffer[i + 2] = color[2] * 255; buffer[i + 3] = 255;
        }
        buffer.uniform = true;
        return buffer;
    }

    function rgbSpectrumBuffer(size, input, params) {
        if (input?.uniform && !params._fields?.wavelength) return uniformPixels(size,
            wavelengthColor(clamp(380 + luminanceAt(input, 0) * 400 + params.wavelength - 550, 380, 780)));
        if (input || params._fields?.wavelength) {
            var buffer = newBuffer(size);
            const scratchColor = new Float64Array(3);
            for (var p = 0; p < size * size; p++) {
                var index = p * 4;
                params._pixel = index;

                var color = wavelengthColor(input ? clamp(380 + luminanceAt(input, index) * 400 + params.wavelength - 550, 380, 780) : params.wavelength, scratchColor);
                buffer[index] = color[0] * 255;
                buffer[index + 1] = color[1] * 255;
                buffer[index + 2] = color[2] * 255;
                buffer[index + 3] = 255;
            }
            return buffer;
        }
        return colorBuffer(size, wavelengthColor(params.wavelength));
    }

    function gaussianSpectrumColor(center, width) {
        var r = 0;
        var g = 0;
        var b = 0;
        var total = 0;
        const scratchColor = new Float64Array(3);
        for (var wavelength = 380; wavelength <= 780; wavelength += 5) {
            var weight = Math.exp(-0.5 * Math.pow((wavelength - center) / width, 2));
            var color = wavelengthColor(wavelength, scratchColor);
            r += color[0] * weight;
            g += color[1] * weight;
            b += color[2] * weight;
            total += weight;
        }
        if (total === 0) return [0, 0, 0];
        return [clamp(r / total, 0, 1), clamp(g / total, 0, 1), clamp(b / total, 0, 1)];
    }

    function gaussianSpectrumBuffer(size, input, params) {
        if (input?.uniform && !params._fields?.center && !params._fields?.width) return uniformPixels(size,
            gaussianSpectrumColor(clamp(380 + luminanceAt(input, 0) * 400 + params.center - 550, 380, 780), params.width));
        if (input || params._fields?.center || params._fields?.width) {
            var buffer = newBuffer(size);
            const colors = [];
            const fieldColors = new Map();
            let fieldColorCount = 0;
            for (var p = 0; p < size * size; p++) {
                var index = p * 4;
                params._pixel = index;

                // Byte inputs have only 25,501 luminance levels. Reuse spectral
                // integration across pixels rather than integrating every pixel.
                const center = input ? clamp(380 + luminanceAt(input, index) * 400 + params.center - 550, 380, 780) : params.center;
                const key = input ? input[index] * 30 + input[index + 1] * 59 + input[index + 2] * 11 : 0;
                const width = params.width;
                let color;
                if (params._fields?.center || params._fields?.width) {
                    // Cache exact numeric pairs, including linked fields. Bound
                    // memory for continuous fields with millions of unique pairs.
                    let widths = fieldColors.get(center);
                    color = widths?.get(width);
                    if (!color) {
                        color = gaussianSpectrumColor(center, width);
                        if (fieldColorCount < 4096) {
                            if (!widths) fieldColors.set(center, widths = new Map());
                            widths.set(width, color); fieldColorCount++;
                        }
                    }
                } else color = colors[key] || (colors[key] = gaussianSpectrumColor(center, width));
                buffer[index] = color[0] * 255;
                buffer[index + 1] = color[1] * 255;
                buffer[index + 2] = color[2] * 255;
                buffer[index + 3] = 255;
            }
            return buffer;
        }
        return colorBuffer(size, gaussianSpectrumColor(params.center, params.width));
    }

    function blackbodyColor(kelvin, result = [0, 0, 0]) {
        var temperature = clamp(kelvin, 1000, 40000) / 100;
        var red;
        var green;
        var blue;
        if (temperature <= 66) {
            red = 255;
        } else {
            red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
        }
        if (temperature <= 66) {
            green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
        } else {
            green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
        }
        if (temperature >= 66) {
            blue = 255;
        } else if (temperature <= 19) {
            blue = 0;
        } else {
            blue = 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
        }
        result[0] = clamp(red / 255, 0, 1); result[1] = clamp(green / 255, 0, 1); result[2] = clamp(blue / 255, 0, 1);
        return result;
    }

    function blackbodyBuffer(size, input, params) {
        var buffer = newBuffer(size);
        const scratchColor = new Float64Array(3);
        const uniformColor = (!input || input.uniform) && !params._fields?.temperature
            ? blackbodyColor(input ? 1000 + luminanceAt(input, 0) * 39000 + params.temperature - 4000 : params.temperature) : null;
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;

            var kelvin = input ? 1000 + luminanceAt(input, index) * 39000 + params.temperature - 4000 : params.temperature;
            var color = uniformColor || blackbodyColor(kelvin, scratchColor);
            buffer[index] = color[0] * 255;
            buffer[index + 1] = color[1] * 255;
            buffer[index + 2] = color[2] * 255;
            buffer[index + 3] = 255;
        }
        return buffer;
    }

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
                    buffer[index] = (br + (blend(br, cr, mode) - br) * opacity) * 255;
                    buffer[index + 1] = (bg + (blend(bg, cg, mode) - bg) * opacity) * 255;
                    buffer[index + 2] = (bb + (blend(bb, cb, mode) - bb) * opacity) * 255;
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
        for (var p = 0; p < size * size; p++) {
            var index = p * 4;
            params._pixel = index;
            var opacity = clamp(params.opacity, 0, 1);
            var mode = params.mode;

            for (var c = 0; c < 3; c++) {
                var base = a ? a[index + c] / 255 : 0;
                var top = b ? b[index + c] / 255 : base;
                buffer[index + c] = (base + (blend(base, top, mode) - base) * opacity) * 255;
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

    const imageCaches = new WeakMap();
    nodes.getImageCache = function (material) {
        if (!material) return Object.create(null);
        if (!imageCaches.has(material)) imageCaches.set(material, Object.create(null));
        return imageCaches.get(material);
    };
    nodes.releaseImages = function (material) {
        const cache = imageCaches.get(material);
        if (cache) for (const entry of Object.values(cache)) {
            entry.disposed = true;
            if (entry.asset) material.parentProject.assets.unload(entry.asset);
        }
        imageCaches.delete(material);
    };
    nodes.dependencySignature = function (graph, material) {
        const cache = nodes.getImageCache(material);
        return graph.nodes.filter(n => n.params.asset).map(n => [n.params.asset, cache[n.params.asset]?.revision || 0]);
    };
    nodes.prepareImages = async function (graph, material) {
        const cache = nodes.getImageCache(material);
        const keys = new Set(graph.nodes.map(n => n.params.asset).filter(Boolean));
        for (const key of Object.keys(cache)) if (!keys.has(key)) {
            cache[key].disposed = true;
            material.parentProject.assets.unload(cache[key].asset);
            delete cache[key];
        }
        await Promise.all(Array.from(keys, key => {
            if (cache[key]) return cache[key].loading;
            const asset = material.parentProject.assets.load(key);
            const loaded = new PZ.asset.image(asset);
            loaded.getImage();
            const entry = cache[key] = { asset, loaded, revision: 0, disposed: false };
            entry.loading = Promise.resolve(loaded.loading).then(() => {
                if (entry.disposed) return;
                entry.canvas = loaded.getImage();
                entry.revision++;
            });
            return entry.loading;
        }));
    };
    nodes.imageBuffers = function (graph, size, material, time = 0) {
        const result = Object.create(null);
        const cache = nodes.getImageCache(material);
        for (const node of graph.nodes) {
            const key = node.params.asset;
            if (!key || !cache[key]?.canvas || result[key]) continue;
            const entry = cache[key];
            const gif = entry.loaded?.data?.gif;
            let image = entry.canvas;
            if (gif?.frames?.length && gif.total > 0) {
                const target = ((time % gif.total) + gif.total) % gif.total;
                const index = gif.cumulative.findIndex(end => target < end);
                image = gif.frames[Math.max(0, index)].canvas;
            }
            if (entry.sample?.size === size && entry.sample.image === image) {
                result[key] = entry.sample.pixels;
                continue;
            }
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0, size, size);
            const pixels = ctx.getImageData(0, 0, size, size).data;
            entry.sample = { size, image, pixels };
            result[key] = pixels;
        }
        return result;
    };

    function imageBuffer(size, key, context, uv) {
        if (!key) return null;
        const source = context?.images?.[key];
        if (!source) return null;
        var buffer = newBuffer(size);
        if (!uv) {
            buffer.set(source);
            return buffer;
        }
        for (var y = 0; y < size; y++) {
            for (var x = 0; x < size; x++) {
                var index = (x + y * size) * 4;
                var sx = Math.min(size - 1, Math.max(0, Math.floor((uv[index] / 255) * size)));
                var sy = Math.min(size - 1, Math.max(0, Math.floor((uv[index + 1] / 255) * size)));
                var sourceIndex = (sx + sy * size) * 4;
                buffer[index] = source[sourceIndex];
                buffer[index + 1] = source[sourceIndex + 1];
                buffer[index + 2] = source[sourceIndex + 2];
                buffer[index + 3] = source[sourceIndex + 3];
            }
        }
        return buffer;
    }

    var TYPES = {
        output: {
            name: "Output",
            category: "Output",
            inputs: [
                { key: "color", name: "Color" },
                { key: "luminance", name: "Luminance" },
                { key: "roughness", name: "Roughness" },
                { key: "metalness", name: "Metalness" },
                { key: "bump", name: "Bump" },
                { key: "opacity", name: "Opacity" },
                { key: "fresnel", name: "Fresnel" },
            ],
            outputs: [],
            params: [],
        },
        noise: {
            name: "Noise",
            category: "Shader",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "scale", name: "Scale", type: "number", value: 4, min: 1, max: 64, step: 0.1 },
                { key: "ratio", name: "Ratio Y", type: "number", value: 1, min: 0.02, max: 64, step: 0.01 },
                { key: "octaves", name: "Octaves", type: "number", value: 4, min: 1, max: 8, step: 1 },
                { key: "seed", name: "Seed", type: "number", value: 1, min: 0, max: 9999, step: 1 },
                { key: "brightness", name: "Brightness", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
                { key: "contrast", name: "Contrast", type: "number", value: 1, min: 0, max: 4, step: 0.01 },
                { key: "speedX", name: "Speed X", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
                { key: "speedY", name: "Speed Y", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
            ],
            evaluate: function (size, inputs, params, time) {
                return noiseBuffer(size, params, time || 0, inputs.uv);
            },
        },
        gradient: {
            name: "Gradient",
            category: "Shader",
            inputs: [
                { key: "t", name: "Input" },
                { key: "a", name: "Base" },
            ],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "type", name: "Type", type: "option", items: ["linear", "circular", "angular", "diamond"], value: 0 },
                { key: "offsetX", name: "Offset X", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "offsetY", name: "Offset Y", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "scaleX", name: "Scale X", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "scaleY", name: "Scale Y", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "rotation", name: "Rotation", type: "number", value: 0, min: -180, max: 180, step: 1 },
                { key: "opacity", name: "Opacity", type: "number", value: 1, min: 0, max: 1, step: 0.01 },
                { key: "blendMode", name: "Blending mode", type: "option", items: BLEND_MODES, value: 0 },
                { key: "midpoint", name: "Midpoint", type: "number", value: 0.5, min: 0.01, max: 0.99, step: 0.01 },
                { key: "color1", name: "Color 1", type: "color", value: [0.1, 0.1, 0.12] },
                { key: "color2", name: "Color 2", type: "color", value: [1, 1, 1] },
            ],
            evaluate: function (size, inputs, params) {
                return gradientBuffer(size, inputs.t, inputs.a, params);
            },
        },
        color: {
            name: "Color",
            category: "Shader",
            inputs: [],
            outputs: [{ key: "out", name: "Color" }],
            params: [{ key: "color", name: "Color", type: "color", value: [0.8, 0.8, 0.8] }],
            evaluate: function (size, inputs, params) {
                return colorBuffer(size, params.color);
            },
        },
        checker: {
            name: "Checker",
            category: "Shader",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "scale", name: "Scale", type: "number", value: 8, min: 1, max: 64, step: 1 },
                { key: "color1", name: "Color 1", type: "color", value: [0, 0, 0] },
                { key: "color2", name: "Color 2", type: "color", value: [1, 1, 1] },
            ],
            evaluate: function (size, inputs, params) {
                return checkerBuffer(size, params, inputs.uv);
            },
        },
        image: {
            name: "Image",
            category: "Shader",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [{ key: "asset", name: "Image", type: "asset", value: "" }],
            evaluate: function (size, inputs, params, time, context) {
                return imageBuffer(size, params.asset, context, inputs.uv);
            },
        },
        texture: {
            name: "Texture",
            category: "Shader",
            inputs: [],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "asset", name: "Image", type: "asset", value: "" },
                { key: "projection", name: "Projection", type: "option", items: ["planar", "polar", "cylindrical", "spherical"], value: 0 },
                { key: "offsetX", name: "Offset X", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "offsetY", name: "Offset Y", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "scaleX", name: "Scale X", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "scaleY", name: "Scale Y", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "rotation", name: "Rotation", type: "number", value: 0, min: -180, max: 180, step: 1 },
            ],
            evaluate: function (size, inputs, params, time, context) {
                if (!params.asset) return null;
                var uv = projectionBuffer(size, {
                    mode: params.projection,
                    offsetX: 0,
                    offsetY: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                });
                uv = transformBuffer(size, uv, {
                    offsetX: params.offsetX,
                    offsetY: params.offsetY,
                    scaleX: params.scaleX,
                    scaleY: params.scaleY,
                    rotation: params.rotation,
                });
                return imageBuffer(size, params.asset, context, uv);
            },
        },
        fresnel: {
            name: "Fresnel",
            category: "Shader",
            inputs: [],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "color", name: "Color", type: "color", value: [1, 1, 1] },
                { key: "power", name: "Power", type: "number", value: 4, min: 0.1, max: 8, step: 0.05 },
                { key: "mix", name: "Mix", type: "number", value: 1, min: 0, max: 1, step: 0.01 },
            ],
            evaluate: function () {
                return null;
            },
        },
        mix: {
            name: "Mix",
            category: "Layer",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "mode", name: "Mode", type: "option", items: BLEND_MODES, value: 0 },
                { key: "opacity", name: "Opacity", type: "number", value: 1, min: 0, max: 1, step: 0.01 },
            ],
            evaluate: function (size, inputs, params) {
                return mixBuffer(size, inputs.a, inputs.b, params);
            },
        },
        math: {
            name: "Math",
            category: "Layer",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "op", name: "Operation", type: "option", items: MATH_MODES, value: 2 },
                { key: "value", name: "B Value", type: "number", value: 1, min: 0, max: 1, step: 0.01 },
            ],
            evaluate: function (size, inputs, params) {
                return mathBuffer(size, inputs.a, inputs.b, params);
            },
        },
        float: {
            name: "Float",
            category: "Shader",
            inputs: [],
            outputs: [{ key: "out", name: "Value" }],
            params: [{ key: "value", name: "Value", type: "number", value: 1, min: 0, max: 1, step: 0.01 }],
            evaluate: function (size, inputs, params) {
                return floatBuffer(size, params);
            },
        },
        sineWave: {
            name: "Sine Wave",
            category: "Patterns",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "scale", name: "Scale", type: "number", value: 6, min: 0.25, max: 64, step: 0.25 },
                { key: "phase", name: "Phase", type: "number", value: 0, min: 0, max: 1, step: 0.01 },
                { key: "axis", name: "Axis", type: "option", items: ["U", "V"], value: 0 },
            ],
            evaluate: function (size, inputs, params) {
                return sineBuffer(size, params, inputs.uv);
            },
        },
        marble: {
            name: "Marble",
            category: "Patterns",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "scale", name: "Bands", type: "number", value: 5, min: 0.25, max: 32, step: 0.25 },
                { key: "veins", name: "Veins", type: "number", value: 3, min: 0, max: 12, step: 0.1 },
                { key: "fractalScale", name: "Noise Scale", type: "number", value: 6, min: 1, max: 32, step: 0.1 },
                { key: "octaves", name: "Octaves", type: "number", value: 4, min: 1, max: 8, step: 1 },
                { key: "seed", name: "Seed", type: "number", value: 1, min: 0, max: 9999, step: 1 },
            ],
            evaluate: function (size, inputs, params, time) {
                return marbleBuffer(size, params, time, inputs.uv);
            },
        },
        ridgedFractal: {
            name: "Ridged Fractal",
            category: "Patterns",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "scale", name: "Scale", type: "number", value: 6, min: 1, max: 64, step: 0.1 },
                { key: "ratio", name: "Ratio Y", type: "number", value: 1, min: 0.02, max: 64, step: 0.01 },
                { key: "octaves", name: "Octaves", type: "number", value: 4, min: 1, max: 8, step: 1 },
                { key: "seed", name: "Seed", type: "number", value: 1, min: 0, max: 9999, step: 1 },
                { key: "brightness", name: "Brightness", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
                { key: "contrast", name: "Contrast", type: "number", value: 1, min: 0, max: 4, step: 0.01 },
                { key: "speedX", name: "Speed X", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
                { key: "speedY", name: "Speed Y", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
            ],
            evaluate: function (size, inputs, params, time) {
                return ridgedBuffer(size, params, time, inputs.uv);
            },
        },
        turbulence: {
            name: "Turbulence",
            category: "Patterns",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "scale", name: "Scale", type: "number", value: 6, min: 1, max: 64, step: 0.1 },
                { key: "ratio", name: "Ratio Y", type: "number", value: 1, min: 0.02, max: 64, step: 0.01 },
                { key: "octaves", name: "Octaves", type: "number", value: 4, min: 1, max: 8, step: 1 },
                { key: "seed", name: "Seed", type: "number", value: 1, min: 0, max: 9999, step: 1 },
                { key: "brightness", name: "Brightness", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
                { key: "contrast", name: "Contrast", type: "number", value: 1, min: 0, max: 4, step: 0.01 },
                { key: "speedX", name: "Speed X", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
                { key: "speedY", name: "Speed Y", type: "number", value: 0, min: -4, max: 4, step: 0.01 },
            ],
            evaluate: function (size, inputs, params, time) {
                return turbulenceBuffer(size, params, time, inputs.uv);
            },
        },
        dirt: {
            name: "Dirt (approx)",
            category: "Patterns",
            inputs: [{ key: "uv", name: "UV" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "scale", name: "Scale", type: "number", value: 4, min: 1, max: 64, step: 0.1 },
                { key: "ratio", name: "Ratio Y", type: "number", value: 1, min: 0.02, max: 64, step: 0.01 },
                { key: "octaves", name: "Octaves", type: "number", value: 4, min: 1, max: 8, step: 1 },
                { key: "seed", name: "Seed", type: "number", value: 1, min: 0, max: 9999, step: 1 },
                { key: "radius", name: "Radius", type: "number", value: 1.4, min: 0.1, max: 4, step: 0.05 },
            ],
            evaluate: function (size, inputs, params, time) {
                return dirtBuffer(size, params, time, inputs.uv);
            },
        },
        rgbSpectrum: {
            name: "RGB Spectrum",
            category: "Color",
            inputs: [{ key: "t", name: "Input" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [{ key: "wavelength", name: "Wavelength", type: "number", value: 550, min: 380, max: 780, step: 1 }],
            evaluate: function (size, inputs, params) {
                return rgbSpectrumBuffer(size, inputs.t, params);
            },
        },
        gaussianSpectrum: {
            name: "Gaussian Spectrum",
            category: "Color",
            inputs: [{ key: "t", name: "Input" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "center", name: "Center nm", type: "number", value: 550, min: 380, max: 780, step: 1 },
                { key: "width", name: "Width nm", type: "number", value: 60, min: 5, max: 200, step: 1 },
            ],
            evaluate: function (size, inputs, params) {
                return gaussianSpectrumBuffer(size, inputs.t, params);
            },
        },
        blackbody: {
            name: "Blackbody",
            category: "Color",
            inputs: [{ key: "t", name: "Input" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [{ key: "temperature", name: "Kelvin", type: "number", value: 4000, min: 1000, max: 40000, step: 100 }],
            evaluate: function (size, inputs, params) {
                return blackbodyBuffer(size, inputs.t, params);
            },
        },
        randomColor: {
            name: "Random Color",
            category: "Color",
            inputs: [],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "seed", name: "Seed", type: "number", value: 1, min: 0, max: 9999, step: 1 },
                { key: "brightness", name: "Brightness", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
            ],
            evaluate: function (size, inputs, params) {
                return randomColorBuffer(size, params);
            },
        },
        colorCorrection: {
            name: "Color Correction",
            category: "Color",
            inputs: [{ key: "a", name: "Input" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "brightness", name: "Brightness", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
                { key: "contrast", name: "Contrast", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
                { key: "gamma", name: "Gamma", type: "number", value: 1, min: 0.1, max: 4, step: 0.01 },
                { key: "hue", name: "Hue Shift", type: "number", value: 0, min: -180, max: 180, step: 1 },
                { key: "saturation", name: "Saturation", type: "number", value: 1, min: 0, max: 2, step: 0.01 },
            ],
            evaluate: function (size, inputs, params) {
                return colorCorrectionBuffer(size, inputs.a, params);
            },
        },
        colorizer: {
            name: "Colorizer",
            category: "Color",
            inputs: [{ key: "a", name: "Input" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "color1", name: "Color 1", type: "color", value: [0, 0, 0] },
                { key: "color2", name: "Color 2", type: "color", value: [0.25, 0.25, 0.3] },
                { key: "color3", name: "Color 3", type: "color", value: [0.7, 0.7, 0.75] },
                { key: "color4", name: "Color 4", type: "color", value: [1, 1, 1] },
                { key: "color5", name: "Color 5", type: "color", value: [1, 1, 1] },
            ],
            evaluate: function (size, inputs, params) {
                return colorizerBuffer(size, inputs.a, params);
            },
        },
        invert: {
            name: "Invert",
            category: "Math",
            inputs: [{ key: "a", name: "Input" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [{ key: "strength", name: "Strength", type: "number", value: 1, min: 0, max: 1, step: 0.01 }],
            evaluate: function (size, inputs, params) {
                return invertBuffer(size, inputs.a, params);
            },
        },
        clampTexture: {
            name: "Clamp Texture",
            category: "Math",
            inputs: [{ key: "a", name: "Input" }],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "min", name: "Min", type: "number", value: 0, min: 0, max: 1, step: 0.01 },
                { key: "max", name: "Max", type: "number", value: 1, min: 0, max: 1, step: 0.01 },
            ],
            evaluate: function (size, inputs, params) {
                return clampBuffer(size, inputs.a, params);
            },
        },
        multiply: {
            name: "Multiply",
            category: "Math",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Value" }],
            params: [{ key: "value", name: "B Value", type: "number", value: 1, min: 0, max: 1, step: 0.01 }],
            evaluate: function (size, inputs, params) {
                return multiplyBuffer(size, inputs.a, inputs.b, params);
            },
        },
        add: {
            name: "Add",
            category: "Math",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Value" }],
            params: [{ key: "value", name: "B Value", type: "number", value: 0, min: 0, max: 1, step: 0.01 }],
            evaluate: function (size, inputs, params) {
                return addBuffer(size, inputs.a, inputs.b, params);
            },
        },
        subtract: {
            name: "Subtract",
            category: "Math",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Value" }],
            params: [{ key: "value", name: "B Value", type: "number", value: 0, min: 0, max: 1, step: 0.01 }],
            evaluate: function (size, inputs, params) {
                return subtractBuffer(size, inputs.a, inputs.b, params);
            },
        },
        compare: {
            name: "Compare",
            category: "Math",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Value" }],
            params: [
                { key: "op", name: "Operation", type: "option", items: ["A > B", "A < B", "A = B"], value: 0 },
                { key: "value", name: "B Value", type: "number", value: 0.5, min: 0, max: 1, step: 0.01 },
                { key: "epsilon", name: "Epsilon", type: "number", value: 0.01, min: 0, max: 1, step: 0.005 },
            ],
            evaluate: function (size, inputs, params) {
                return compareBuffer(size, inputs.a, inputs.b, params);
            },
        },
        cosineMix: {
            name: "Cosine Mix",
            category: "Mix",
            inputs: [
                { key: "a", name: "A" },
                { key: "b", name: "B" },
            ],
            outputs: [{ key: "out", name: "Color" }],
            params: [{ key: "mix", name: "Mix", type: "number", value: 0.5, min: 0, max: 1, step: 0.01 }],
            evaluate: function (size, inputs, params) {
                return cosineMixBuffer(size, inputs.a, inputs.b, params);
            },
        },
        projection: {
            name: "Projection",
            category: "Mapping",
            inputs: [],
            outputs: [{ key: "out", name: "Projection" }],
            params: [
                { key: "mode", name: "Texture Projection", type: "option", items: ["planar", "polar", "cylindrical", "spherical"], value: 0 },
                { key: "offsetX", name: "Offset X", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "offsetY", name: "Offset Y", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "scaleX", name: "Scale X", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "scaleY", name: "Scale Y", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "rotation", name: "Rotation", type: "number", value: 0, min: -180, max: 180, step: 1 },
            ],
            evaluate: function (size, inputs, params) {
                return projectionBuffer(size, params);
            },
        },
        uvw: {
            name: "UvW Transform",
            category: "Mapping",
            inputs: [{ key: "a", name: "Input" }],
            outputs: [{ key: "out", name: "Color" }],
            params: [
                { key: "offsetX", name: "Offset X", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "offsetY", name: "Offset Y", type: "number", value: 0, min: -1, max: 1, step: 0.01 },
                { key: "scaleX", name: "Scale X", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "scaleY", name: "Scale Y", type: "number", value: 1, min: 0.05, max: 8, step: 0.01 },
                { key: "rotation", name: "Rotation", type: "number", value: 0, min: -180, max: 180, step: 1 },
            ],
            evaluate: function (size, inputs, params) {
                return transformBuffer(size, inputs.a, params);
            },
        },
    };

    TYPES.legacyMath = { ...TYPES.math, hidden: true, params: TYPES.math.params.map(p => p.key === "op" ? { ...p, items: MATH_MODES.slice(0, 6) } : p) };
    TYPES.math = { ...TYPES.math, inputs: [{ key: "a", name: "A" }, { key: "b", name: "B" }], evaluate: (size, inputs, params) => asTexture(numericMath(size, inputs, params), size), category: "Shader", params: [
        { key: "op", name: "Operation", type: "option", items: MATH_MODES, value: 0 },
        { key: "a", name: "A", type: "number", value: 0, step: 0.01 },
        { key: "b", name: "B", type: "number", value: 1, step: 0.01 },
    ] };
    for (const id of ["invert", "clampTexture", "multiply", "add", "subtract", "compare"]) TYPES[id].hidden = true;
    delete TYPES.float.params[0].min;
    delete TYPES.float.params[0].max;
    TYPES.rgbSpectrum.hint = "Wavelength sets the color without Input; with Input it shifts the spectrum relative to 550 nm.";
    TYPES.gaussianSpectrum.hint = "Center sets the color without Input; with Input it shifts the spectrum relative to 550 nm. Width controls spectral spread.";
    TYPES.blackbody.hint = "Kelvin sets the color without Input; with Input it shifts temperature relative to 4000 K.";
    for (const def of Object.values(TYPES)) for (const p of def.params) {
        if (["number", "color"].includes(p.type) && !def.inputs.some(input => input.key === p.key))
            def.inputs.push({ key: p.key, name: p.name, parameter: true, type: p.type });
    }

    const pixelTypes = new Set(["add", "blackbody", "checker", "clampTexture", "colorCorrection", "colorizer", "compare", "cosineMix", "dirt", "gaussianSpectrum", "gradient", "invert", "marble", "mix", "multiply", "noise", "rgbSpectrum", "ridgedFractal", "sineWave", "subtract", "turbulence"]);
    const latticeParams = new Set(["scale", "ratio", "octaves", "seed", "speedX", "speedY", "fractalScale"]);
    function pixelParameter(type, key) {
        if (!pixelTypes.has(type)) return false;
        if (["noise", "ridgedFractal", "turbulence", "marble", "dirt"].includes(type) && latticeParams.has(key)) return false;
        return true;
    }

    // Constant numeric links retain their full value. Whole-operation settings
    // use a spatial mean independent of traversal and playback order.
    function reduceValue(value, color = false) {
        if (value.scalar !== undefined) return color ? [value.scalar, value.scalar, value.scalar] : value.scalar;
        const rgb = [0, 0, 0];
        for (let i = 0; i < value.length; i += 4) for (let c = 0; c < 3; c++) rgb[c] += value[i + c] / 255;
        for (let c = 0; c < 3; c++) rgb[c] /= value.length / 4;
        return color ? rgb : rgb[0] === rgb[1] && rgb[1] === rgb[2] ? rgb[0] : rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
    }
    function asTexture(value, size) {
        if (!value) return null;
        if (value.scalar !== undefined) return colorBuffer(size, [value.scalar, value.scalar, value.scalar]);
        return value instanceof Uint8ClampedArray ? value : new Uint8ClampedArray(value);
    }
    function numericMath(size, inputs, params) {
        const a = inputs.a || { scalar: params.a }, b = inputs.b || { scalar: params.b };
        function operation(x, y) {
            let v;
            switch (params.op) {
                case 0: v = x + y; break;
                case 1: v = x - y; break;
                case 2: v = x * y; break;
                case 3: v = Math.abs(y) < 1e-12 ? 0 : x / y; break;
                case 4: v = Math.min(x, y); break;
                case 5: v = Math.max(x, y); break;
                case 6: v = Math.pow(x, y); break;
                case 7: v = Math.abs(y) < 1e-12 ? 0 : x % y; break;
                case 8: v = Math.abs(x); break;
                case 9: v = 1 - x; break;
                case 10: v = clamp(x, 0, 1); break;
                case 11: v = Math.abs(x - y) <= 0.01 ? 1 : 0; break;
                case 12: v = Math.sin(x); break;
                case 13: v = Math.round(x); break;
            }
            return Number.isFinite(v) ? clamp(v, -1e30, 1e30) : 0;
        }
        if (a.scalar !== undefined && b.scalar !== undefined) return { scalar: operation(a.scalar, b.scalar) };
        const buffer = new Float32Array(size * size * 4);
        for (let i = 0; i < buffer.length; i += 4) {
            const v = operation(a.scalar ?? luminanceAt(a, i), b.scalar ?? luminanceAt(b, i)) * 255;
            buffer[i] = buffer[i + 1] = buffer[i + 2] = v;
            buffer[i + 3] = 255;
        }
        return buffer;
    }

    nodes.types = TYPES;

    nodes.defaultGraph = function () {
        return {
            nodes: [
                {
                    id: "noise",
                    type: "noise",
                    x: 40,
                    y: 120,
                    params: { scale: 3, ratio: 14, octaves: 4, seed: 7, brightness: 1, contrast: 1.4, speedX: 0, speedY: 0 },
                },
                {
                    id: "gradient",
                    type: "gradient",
                    x: 330,
                    y: 90,
                    params: { value: 0.5, midpoint: 0.45, color1: [0.08, 0.08, 0.09], color2: [0.85, 0.87, 0.9] },
                },
                { id: "output", type: "output", x: 640, y: 80, params: {} },
            ],
            links: [
                { from: "noise", fromPort: "out", to: "gradient", toPort: "t" },
                { from: "gradient", fromPort: "out", to: "output", toPort: "color" },
                { from: "noise", fromPort: "out", to: "output", toPort: "bump" },
            ],
        };
    };

    nodes.createNode = function (type, id) {
        var definition = TYPES[type];
        var params = {};
        for (var i = 0; i < definition.params.length; i++) {
            var param = definition.params[i];
            params[param.key] = Array.isArray(param.value) ? param.value.slice() : param.value;
        }
        return { id: id, type: type, x: 40, y: 40, params: params };
    };

    nodes.parse = function (json) {
        let graph;
        try { graph = typeof json === "string" ? JSON.parse(json.slice(0, 1000000)) : json; } catch (_) {}
        if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) graph = nodes.defaultGraph();
        const result = { schemaVersion: 1, nodes: [], links: [] };
        const ids = new Set();
        for (const raw of graph.nodes.slice(0, 200)) {
            if (!raw || typeof raw.id !== "string" || raw.id.length > 128 || ids.has(raw.id) || !Object.hasOwn(TYPES, raw.type)) continue;
            ids.add(raw.id);
            const type = raw.type === "math" && raw.params?.a === undefined && raw.params?.b === undefined ? "legacyMath" : raw.type;
            const node = nodes.createNode(type, raw.id);
            node.x = Number.isFinite(raw.x) ? raw.x : 40;
            node.y = Number.isFinite(raw.y) ? raw.y : 40;
            for (const p of TYPES[type].params) {
                let v = raw.params?.[p.key];
                if (p.type === "number" && Number.isFinite(Number(v))) v = clamp(Number(v), p.min ?? -Number.MAX_VALUE, p.max ?? Number.MAX_VALUE);
                else if (p.type === "option" && Number.isFinite(Number(v))) v = clamp(Math.round(Number(v)), 0, p.items.length - 1);
                else if (p.type === "color" && Array.isArray(v) && v.length >= 3) v = v.slice(0, 3).map(c => clamp(Number(c) || 0, 0, 1));
                else if (p.type === "asset" && typeof v === "string" && !/^(?:https?:|data:|blob:)/i.test(v)) v = v.slice(0, 1024);
                else continue;
                node.params[p.key] = v;
            }
            result.nodes.push(node);
        }
        const map = new Map(result.nodes.map(n => [n.id, n]));
        const occupied = new Set();
        for (const raw of graph.links.slice(0, 400)) {
            if (!raw) continue;
            const link = typeof raw.from === "object" ? { from: raw.from?.node, fromPort: raw.from?.port, to: raw.to?.node, toPort: raw.to?.port } : raw;
            const from = map.get(link.from), to = map.get(link.to);
            const key = link.to + ":" + link.toPort;
            if (!from || !to || occupied.has(key) || !TYPES[from.type].outputs.some(p => p.key === link.fromPort) || !TYPES[to.type].inputs.some(p => p.key === link.toPort)) continue;
            const reaches = (id, seen = new Set()) => {
                if (id === link.from) return true;
                if (seen.has(id)) return false;
                seen.add(id);
                return result.links.some(l => l.from === id && reaches(l.to, seen));
            };
            if (reaches(link.to)) continue;
            occupied.add(key);
            result.links.push({ from: link.from, fromPort: link.fromPort, to: link.to, toPort: link.toPort });
        }
        return result;
    };

    nodes.findLink = function (graph, nodeId, port) {
        for (var i = 0; i < graph.links.length; i++) {
            var link = graph.links[i];
            if (link.to === nodeId && link.toPort === port) {
                return link;
            }
        }
        return null;
    };

    nodes.fresnelSettings = function (graph, time = 0, context = {}) {
        for (var i = 0; i < graph.nodes.length; i++) {
            if (graph.nodes[i].type !== "output") continue;
            var link = nodes.findLink(graph, graph.nodes[i].id, "fresnel");
            if (!link) return null;
            for (var n = 0; n < graph.nodes.length; n++) {
                var node = graph.nodes[n];
                if (node.id === link.from && node.type === "fresnel") {
                    const setting = key => {
                        const source = nodes.findLink(graph, node.id, key);
                        if (!source) return node.params[key];
                        const value = nodes.evaluate(graph, context.size || 32, time, context, source.from);
                        return value ? reduceValue(value, key === "color") : node.params[key];
                    };
                    return {
                        color: setting("color"),
                        power: setting("power"),
                        mix: setting("mix"),
                    };
                }
            }
        }
        return null;
    };

    nodes.isAnimated = function (graph, material) {
        const cache = nodes.getImageCache(material);
        return graph.nodes.some(n => (["noise", "ridgedFractal", "turbulence", "marble", "dirt"].includes(n.type) && (n.params.speedX || n.params.speedY || graph.links.some(l => l.to === n.id && ["speedX", "speedY"].includes(l.toPort)))) || cache[n.params.asset]?.loaded?.data?.gif?.frames?.length > 1);
    };
    nodes.cacheKey = function (graph, resolution, frame, assets) {
        return JSON.stringify([nodes.parse(graph), resolution, frame, assets]);
    };
    nodes.evaluate = function (graph, size, time, context, target) {
        size = Math.max(1, Math.min(2048, Math.round(size) || 128));
        graph = nodes.parse(graph);
        var outputs = {};
        var cache = Object.create(null);
        var nodeMap = Object.create(null);
        for (var i = 0; i < graph.nodes.length; i++) {
            nodeMap[graph.nodes[i].id] = graph.nodes[i];
        }

        function inputBuffer(nodeId, port, stack) {
            var link = nodes.findLink(graph, nodeId, port);
            if (link) {
                return evaluateNode(link.from, stack);
            }
            return null;
        }

        function evaluateNode(id, stack) {
            if (cache[id] !== undefined) return cache[id];
            if (stack.indexOf(id) >= 0) return null;
            var node = nodeMap[id];
            if (!node) return null;
            var definition = TYPES[node.type];
            if (!definition) return null;
            stack.push(id);
            var inputs = {};
            for (var i = 0; i < definition.inputs.length; i++) {
                var input = definition.inputs[i];
                inputs[input.key] = inputBuffer(id, input.key, stack);
            }
            const params = { ...node.params, _pixel: 0, _fields: {} };
            for (const p of definition.params) if (inputs[p.key]) {
                const value = inputs[p.key];
                if (value.scalar === undefined && pixelParameter(node.type, p.key)) {
                    params._fields[p.key] = true;
                    const rgb = [0, 0, 0];
                    Object.defineProperty(params, p.key, { get() {
                        if (p.type !== "color") return value[params._pixel] === value[params._pixel + 1] && value[params._pixel + 1] === value[params._pixel + 2] ? value[params._pixel] / 255 : luminanceAt(value, params._pixel);
                        for (let c = 0; c < 3; c++) rgb[c] = value[params._pixel + c] / 255;
                        return rgb;
                    } });
                } else params[p.key] = reduceValue(value, p.type === "color");
            }
            let result;
            if (node.type === "float") result = inputs.value || { scalar: params.value };
            else if (node.type === "color" && inputs.color) result = asTexture(inputs.color, size);
            else if (node.type === "math") result = numericMath(size, inputs, params);
            else {
                for (const key of Object.keys(inputs)) if (!definition.params.some(p => p.key === key)) inputs[key] = asTexture(inputs[key], size);
                result = definition.evaluate ? definition.evaluate(size, inputs, params, time, context) : null;
            }
            stack.pop();
            cache[id] = result;
            return result;
        }

        if (target !== undefined) return evaluateNode(target, []);
        for (var n = 0; n < graph.nodes.length; n++) {
            var node = graph.nodes[n];
            if (node.type !== "output") continue;
            var definition = TYPES.output;
            for (var j = 0; j < definition.inputs.length; j++) {
                var key = definition.inputs[j].key;
                var buffer = inputBuffer(node.id, key, []);
                if (buffer) {
                    outputs[key] = bufferToCanvas(size, asTexture(buffer, size));
                }
            }
        }
        const fresnel = nodes.fresnelSettings(graph, time, { ...context, size });
        if (fresnel) outputs.__fresnel = fresnel;
        return outputs;
    };


return nodes;
};
