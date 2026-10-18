"use strict";

// Historical spectral evaluators, kept byte-compatible.
module.exports = function ({ newBuffer, clamp, luminanceAt, colorBuffer }) {
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

    return { wavelengthColor, uniformPixels, rgbSpectrumBuffer, gaussianSpectrumColor, gaussianSpectrumBuffer, blackbodyColor, blackbodyBuffer };
};
