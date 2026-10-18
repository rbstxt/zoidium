"use strict";

// Node graph type registry: the 32 node definitions with their parameter
// metadata and evaluate functions, plus the scalar/texture reduction
// helpers the evaluator shares with the Math node.

module.exports = function defineGraphTypes(buffers) {
    const {
  BLEND_MODES, MATH_MODES, addBuffer, blackbodyBuffer, checkerBuffer, clamp,
    clampBuffer, colorBuffer, colorCorrectionBuffer, colorizerBuffer,
    compareBuffer, cosineMixBuffer, dirtBuffer, floatBuffer,
    gaussianSpectrumBuffer, gradientBuffer, imageBuffer, invertBuffer,
    luminanceAt, marbleBuffer, mathBuffer, mixBuffer, multiplyBuffer, noiseBuffer,
    projectionBuffer, randomColorBuffer, rgbSpectrumBuffer, ridgedBuffer,
    sineBuffer, subtractBuffer, transformBuffer, turbulenceBuffer
 } = buffers;
    var TYPES = {
        output: {
            name: "Output",
            category: "Output",
            inputs: [
                { key: "color", name: "Color" },
                { key: "luminance", name: "Luminance" },
                { key: "emission", name: "Emission" },
                { key: "normal", name: "Normal" },
                { key: "roughness", name: "Roughness" },
                { key: "metalness", name: "Metalness" },
                { key: "bump", name: "Bump" },
                { key: "opacity", name: "Opacity" },
                { key: "fresnel", name: "Fresnel" },
            ],
            outputs: [],
            params: [
                { key: "normalMode", name: "Normal input", type: "option", value: 0, items: ["Tangent-space color", "Height"] },
                { key: "normalStrength", name: "Normal strength", type: "number", value: 1, min: 0, max: 8, step: 0.01 },
            ],
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

    return { TYPES, pixelParameter, reduceValue, asTexture, numericMath };
};
