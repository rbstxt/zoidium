"use strict";
// Plain authoring data. Tests compare every helper overload, kind and binding
// against the implementations. IDs are stable documentation anchors.
module.exports = {
  "schemaVersion": 1,
  "docsUrl": "",
  "entries": [
    {
      "id": "builtin.tDiffuse",
      "category": "builtin",
      "name": "tDiffuse",
      "signature": "uniform sampler2D tDiffuse;",
      "description": "Input image of this effect.",
      "example": "texture2D(tDiffuse, vUvScaled)",
      "type": "sampler2D",
      "provider": "cm3"
    },
    {
      "id": "builtin.uvScale",
      "category": "builtin",
      "name": "uvScale",
      "signature": "uniform vec2 uvScale;",
      "description": "Scale from output UVs into the input texture.",
      "example": "vec2 inputUV = vUv * uvScale;",
      "type": "vec2",
      "provider": "cm3"
    },
    {
      "id": "builtin.resolution",
      "category": "builtin",
      "name": "resolution",
      "signature": "uniform vec2 resolution;",
      "description": "Layer output width and height in pixels.",
      "example": "vec2 pixel = 1.0 / resolution;",
      "type": "vec2",
      "provider": "cm3"
    },
    {
      "id": "builtin.vUv",
      "category": "builtin",
      "name": "vUv",
      "signature": "varying vec2 vUv;",
      "description": "Unscaled fullscreen UV coordinates.",
      "example": "vec2 uv = vUv;",
      "type": "vec2",
      "provider": "cm3"
    },
    {
      "id": "builtin.vUvScaled",
      "category": "builtin",
      "name": "vUvScaled",
      "signature": "varying vec2 vUvScaled;",
      "description": "Input UV coordinates multiplied by uvScale.",
      "example": "texture2D(tDiffuse, vUvScaled)",
      "type": "vec2",
      "provider": "cm3"
    },
    {
      "id": "builtin.bgCoord",
      "category": "builtin",
      "name": "bgCoord",
      "signature": "varying vec2 bgCoord;",
      "description": "Fullscreen clip position mapped to 0 to 1.",
      "example": "vec2 backgroundUV = bgCoord;",
      "type": "vec2",
      "provider": "cm3"
    },
    {
      "id": "builtin.zTime",
      "category": "builtin",
      "name": "zTime",
      "signature": "uniform float zTime;",
      "description": "Expressions+ clip time in seconds.",
      "example": "uniform float zTime;",
      "type": "float",
      "provider": "expressions-plus"
    },
    {
      "id": "builtin.zFrame",
      "category": "builtin",
      "name": "zFrame",
      "signature": "uniform float zFrame;",
      "description": "Expressions+ local frame number.",
      "example": "uniform float zFrame;",
      "type": "float",
      "provider": "expressions-plus"
    },
    {
      "id": "builtin.ctl_any",
      "category": "builtin",
      "name": "ctl_*",
      "signature": "uniform float / int / vec2 / vec3 / vec4 ctl_*;",
      "description": "Expressions+ sequence control, with punctuation replaced by underscores.",
      "example": "uniform float ctl_Amount;",
      "type": "float / int / vec2 / vec3 / vec4",
      "provider": "expressions-plus"
    },
    {
      "id": "include.gradient",
      "category": "include",
      "name": "zoidium/gradient",
      "signature": "// #include <zoidium/gradient>",
      "description": "Load the gradient helpers once per shader.",
      "example": "// #include <zoidium/gradient>",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zGradient.1",
      "category": "helper",
      "name": "zGradient",
      "signature": "vec4 zGradient(sampler2D s, float t);",
      "description": "Sample a clamped gradient.",
      "example": "zGradient(Input, 0.5)",
      "type": "vec4",
      "include": "zoidium/gradient",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zGradientCycle.1",
      "category": "helper",
      "name": "zGradientCycle",
      "signature": "vec4 zGradientCycle(sampler2D s, float t);",
      "description": "Sample a repeating gradient, optionally using repetitions.",
      "example": "zGradientCycle(Input, 0.5)",
      "type": "vec4",
      "include": "zoidium/gradient",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zGradientCycle.2",
      "category": "helper",
      "name": "zGradientCycle",
      "signature": "vec4 zGradientCycle(sampler2D s, float t, float repetitions);",
      "description": "Sample a repeating gradient, optionally using repetitions.",
      "example": "zGradientCycle(Input, 0.5, 0.5)",
      "type": "vec4",
      "include": "zoidium/gradient",
      "provider": "shader-plus"
    },
    {
      "id": "include.curve",
      "category": "include",
      "name": "zoidium/curve",
      "signature": "// #include <zoidium/curve>",
      "description": "Load the curve helpers once per shader.",
      "example": "// #include <zoidium/curve>",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zCurve.1",
      "category": "helper",
      "name": "zCurve",
      "signature": "float zCurve(sampler2D s, float x, vec2 range);",
      "description": "Sample one curve, optionally mapping to an output range.",
      "example": "zCurve(Input, 0.5, vec2(0.5))",
      "type": "float",
      "include": "zoidium/curve",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zCurve.2",
      "category": "helper",
      "name": "zCurve",
      "signature": "float zCurve(sampler2D s, float x);",
      "description": "Sample one curve, optionally mapping to an output range.",
      "example": "zCurve(Input, 0.5)",
      "type": "float",
      "include": "zoidium/curve",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zCurves.1",
      "category": "helper",
      "name": "zCurves",
      "signature": "vec4 zCurves(sampler2D s, vec4 x, vec2 range);",
      "description": "Remap RGB or RGBA through curve channels.",
      "example": "zCurves(Input, vec4(0.5), vec2(0.5))",
      "type": "vec4",
      "include": "zoidium/curve",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zCurves.2",
      "category": "helper",
      "name": "zCurves",
      "signature": "vec4 zCurves(sampler2D s, vec4 x);",
      "description": "Remap RGB or RGBA through curve channels.",
      "example": "zCurves(Input, vec4(0.5))",
      "type": "vec4",
      "include": "zoidium/curve",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zCurves.3",
      "category": "helper",
      "name": "zCurves",
      "signature": "vec3 zCurves(sampler2D s, vec3 x, vec2 range);",
      "description": "Remap RGB or RGBA through curve channels.",
      "example": "zCurves(Input, vec3(0.5), vec2(0.5))",
      "type": "vec3",
      "include": "zoidium/curve",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zCurves.4",
      "category": "helper",
      "name": "zCurves",
      "signature": "vec3 zCurves(sampler2D s, vec3 x);",
      "description": "Remap RGB or RGBA through curve channels.",
      "example": "zCurves(Input, vec3(0.5))",
      "type": "vec3",
      "include": "zoidium/curve",
      "provider": "shader-plus"
    },
    {
      "id": "include.text",
      "category": "include",
      "name": "zoidium/text",
      "signature": "// #include <zoidium/text>",
      "description": "Load the text helpers once per shader.",
      "example": "// #include <zoidium/text>",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zText.1",
      "category": "helper",
      "name": "zText",
      "signature": "float zText(sampler2D s, vec2 uv);",
      "description": "Sample text coverage from alpha.",
      "example": "zText(Input, vec2(0.5))",
      "type": "float",
      "include": "zoidium/text",
      "provider": "shader-plus"
    },
    {
      "id": "helper.zGlyph.1",
      "category": "helper",
      "name": "zGlyph",
      "signature": "float zGlyph(sampler2D s, vec2 grid, float index, vec2 uv);",
      "description": "Sample one atlas glyph using its grid and index.",
      "example": "zGlyph(Input, vec2(0.5), 0.5, vec2(0.5))",
      "type": "float",
      "include": "zoidium/text",
      "provider": "shader-plus"
    },
    {
      "id": "include.hash",
      "category": "include",
      "name": "zoidium/hash",
      "signature": "// #include <zoidium/hash>",
      "description": "Load the hash helpers once per shader.",
      "example": "// #include <zoidium/hash>",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zHash.1",
      "category": "helper",
      "name": "zHash",
      "signature": "float zHash(float p);",
      "description": "Deterministic scalar hash of a scalar or vector.",
      "example": "zHash(0.5)",
      "type": "float",
      "include": "zoidium/hash",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zHash.2",
      "category": "helper",
      "name": "zHash",
      "signature": "float zHash(vec2 p);",
      "description": "Deterministic scalar hash of a scalar or vector.",
      "example": "zHash(vec2(0.5))",
      "type": "float",
      "include": "zoidium/hash",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zHash.3",
      "category": "helper",
      "name": "zHash",
      "signature": "float zHash(vec3 p);",
      "description": "Deterministic scalar hash of a scalar or vector.",
      "example": "zHash(vec3(0.5))",
      "type": "float",
      "include": "zoidium/hash",
      "provider": "expressions-plus"
    },
    {
      "id": "include.noise",
      "category": "include",
      "name": "zoidium/noise",
      "signature": "// #include <zoidium/noise>",
      "description": "Load the noise helpers once per shader.",
      "example": "// #include <zoidium/noise>",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zNoise.1",
      "category": "helper",
      "name": "zNoise",
      "signature": "float zNoise(vec2 p);",
      "description": "Smooth deterministic lattice noise.",
      "example": "zNoise(vec2(0.5))",
      "type": "float",
      "include": "zoidium/noise",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zNoise.2",
      "category": "helper",
      "name": "zNoise",
      "signature": "float zNoise(vec3 p);",
      "description": "Smooth deterministic lattice noise.",
      "example": "zNoise(vec3(0.5))",
      "type": "float",
      "include": "zoidium/noise",
      "provider": "expressions-plus"
    },
    {
      "id": "include.color",
      "category": "include",
      "name": "zoidium/color",
      "signature": "// #include <zoidium/color>",
      "description": "Load the color helpers once per shader.",
      "example": "// #include <zoidium/color>",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zSrgbToLinear.1",
      "category": "helper",
      "name": "zSrgbToLinear",
      "signature": "vec3 zSrgbToLinear(vec3 c);",
      "description": "Convert sRGB color to linear RGB.",
      "example": "zSrgbToLinear(vec3(0.5))",
      "type": "vec3",
      "include": "zoidium/color",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zLinearToSrgb.1",
      "category": "helper",
      "name": "zLinearToSrgb",
      "signature": "vec3 zLinearToSrgb(vec3 c);",
      "description": "Convert linear RGB color to sRGB.",
      "example": "zLinearToSrgb(vec3(0.5))",
      "type": "vec3",
      "include": "zoidium/color",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zHsvToRgb.1",
      "category": "helper",
      "name": "zHsvToRgb",
      "signature": "vec3 zHsvToRgb(vec3 c);",
      "description": "Convert HSV in 0 to 1 units to RGB.",
      "example": "zHsvToRgb(vec3(0.5))",
      "type": "vec3",
      "include": "zoidium/color",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zRgbToHsv.1",
      "category": "helper",
      "name": "zRgbToHsv",
      "signature": "vec3 zRgbToHsv(vec3 c);",
      "description": "Convert RGB to HSV in 0 to 1 units.",
      "example": "zRgbToHsv(vec3(0.5))",
      "type": "vec3",
      "include": "zoidium/color",
      "provider": "expressions-plus"
    },
    {
      "id": "include.sdf",
      "category": "include",
      "name": "zoidium/sdf",
      "signature": "// #include <zoidium/sdf>",
      "description": "Load the sdf helpers once per shader.",
      "example": "// #include <zoidium/sdf>",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zSdCircle.1",
      "category": "helper",
      "name": "zSdCircle",
      "signature": "float zSdCircle(vec2 p, float radius);",
      "description": "Signed distance to a circle.",
      "example": "zSdCircle(vec2(0.5), 0.5)",
      "type": "float",
      "include": "zoidium/sdf",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zSdBox.1",
      "category": "helper",
      "name": "zSdBox",
      "signature": "float zSdBox(vec2 p, vec2 halfSize);",
      "description": "Signed distance to a 2D or 3D box.",
      "example": "zSdBox(vec2(0.5), vec2(0.5))",
      "type": "float",
      "include": "zoidium/sdf",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zSdSphere.1",
      "category": "helper",
      "name": "zSdSphere",
      "signature": "float zSdSphere(vec3 p, float radius);",
      "description": "Signed distance to a sphere.",
      "example": "zSdSphere(vec3(0.5), 0.5)",
      "type": "float",
      "include": "zoidium/sdf",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zSdBox.2",
      "category": "helper",
      "name": "zSdBox",
      "signature": "float zSdBox(vec3 p, vec3 halfSize);",
      "description": "Signed distance to a 2D or 3D box.",
      "example": "zSdBox(vec3(0.5), vec3(0.5))",
      "type": "float",
      "include": "zoidium/sdf",
      "provider": "expressions-plus"
    },
    {
      "id": "helper.zSmoothUnion.1",
      "category": "helper",
      "name": "zSmoothUnion",
      "signature": "float zSmoothUnion(float a, float b, float k);",
      "description": "Smoothly combine signed distances.",
      "example": "zSmoothUnion(0.5, 0.5, 0.5)",
      "type": "float",
      "include": "zoidium/sdf",
      "provider": "expressions-plus"
    },
    {
      "id": "kind.point",
      "category": "kind",
      "name": "Point",
      "signature": "uniform vec2 Name;",
      "description": "Two coordinates as vec2, in UV or pixel units.",
      "example": "Name",
      "kind": "point",
      "types": [
        "vec2"
      ],
      "storageType": 1,
      "dynamic": true,
      "auxiliary": []
    },
    {
      "id": "kind.checkbox",
      "category": "kind",
      "name": "Toggle",
      "signature": "uniform bool Name;",
      "description": "Off/on menu. Declare as bool, int or float.",
      "example": "Name",
      "kind": "checkbox",
      "types": [
        "bool",
        "int",
        "float"
      ],
      "storageType": 0,
      "dynamic": true,
      "auxiliary": []
    },
    {
      "id": "kind.dropdown",
      "category": "kind",
      "name": "Dropdown",
      "signature": "uniform int Name;",
      "description": "Animatable choice. Declare as int or float; Name_Item constants are defined.",
      "example": "Name",
      "kind": "dropdown",
      "types": [
        "int",
        "float"
      ],
      "storageType": 0,
      "dynamic": true,
      "auxiliary": [
        {
          "suffix": "_<Item>",
          "type": "#define",
          "description": "Option index, emitted only when referenced.",
          "signature": "#define Name_<Item> index",
          "example": "Name_Option_1"
        }
      ]
    },
    {
      "id": "kind.staticDropdown",
      "category": "kind",
      "name": "Static dropdown",
      "signature": "#define Name index",
      "description": "Compile-time choice, available as #define Name index.",
      "example": "Name",
      "kind": "staticDropdown",
      "types": [
        "#define"
      ],
      "storageType": 6,
      "dynamic": false,
      "auxiliary": [
        {
          "suffix": "_<Item>",
          "type": "#define",
          "description": "Option index, emitted only when referenced.",
          "signature": "#define Name_<Item> index",
          "example": "Name_Option_1"
        }
      ]
    },
    {
      "id": "kind.slider",
      "category": "kind",
      "name": "Slider",
      "signature": "uniform float Name;",
      "description": "Number with a range and a slider.",
      "example": "Name",
      "kind": "slider",
      "types": [
        "float",
        "int",
        "bool"
      ],
      "storageType": 0,
      "dynamic": true,
      "auxiliary": []
    },
    {
      "id": "kind.angle",
      "category": "kind",
      "name": "Angle",
      "signature": "uniform float Name;",
      "description": "Edited in degrees, passed to the shader in radians.",
      "example": "Name",
      "kind": "angle",
      "types": [
        "float",
        "int",
        "bool"
      ],
      "storageType": 0,
      "dynamic": true,
      "auxiliary": []
    },
    {
      "id": "kind.seed",
      "category": "kind",
      "name": "Seed",
      "signature": "uniform float Name;",
      "description": "Whole number with a randomize button.",
      "example": "Name",
      "kind": "seed",
      "types": [
        "float",
        "int",
        "bool"
      ],
      "storageType": 0,
      "dynamic": true,
      "auxiliary": []
    },
    {
      "id": "kind.color4",
      "category": "kind",
      "name": "Color + alpha",
      "signature": "uniform vec4 Name;",
      "description": "RGBA color, passed as vec4.",
      "example": "Name",
      "kind": "color4",
      "types": [
        "vec4"
      ],
      "storageType": 3,
      "dynamic": true,
      "auxiliary": []
    },
    {
      "id": "kind.gradient",
      "category": "kind",
      "name": "Gradient",
      "signature": "uniform sampler2D Name;",
      "description": "Color stops, sampled with zGradient(Name, t).",
      "example": "zGradient(Name, vUv.x)",
      "kind": "gradient",
      "types": [
        "sampler2D"
      ],
      "storageType": 7,
      "dynamic": false,
      "auxiliary": [
        {
          "suffix": "_repetitions",
          "type": "float",
          "description": "Gradient repetition count.",
          "signature": "uniform float Name_repetitions;",
          "example": "Name_repetitions"
        }
      ]
    },
    {
      "id": "kind.curve",
      "category": "kind",
      "name": "Curve",
      "signature": "uniform sampler2D Name;",
      "description": "Curve editor, sampled with zCurve(Name, x) or zCurves(Name, rgb).",
      "example": "zCurve(Name, vUv.x)",
      "kind": "curve",
      "types": [
        "sampler2D"
      ],
      "storageType": 7,
      "dynamic": false,
      "auxiliary": [
        {
          "suffix": "_range",
          "type": "vec2",
          "description": "Curve output range.",
          "signature": "uniform vec2 Name_range;",
          "example": "Name_range"
        }
      ]
    },
    {
      "id": "kind.palette",
      "category": "kind",
      "name": "Palette",
      "signature": "uniform vec4 Name[16];",
      "description": "Up to 16 colors as vec4 Name[16] and int Name_count.",
      "example": "Name[0]",
      "kind": "palette",
      "types": [
        "vec4[16]"
      ],
      "storageType": 7,
      "dynamic": false,
      "auxiliary": [
        {
          "suffix": "_count",
          "type": "int",
          "description": "Number of palette colors.",
          "signature": "uniform int Name_count;",
          "example": "Name_count"
        }
      ]
    },
    {
      "id": "kind.text",
      "category": "kind",
      "name": "Text",
      "signature": "uniform sampler2D Name;",
      "description": "Text in a project font, sampled with zText(Name, uv).",
      "example": "zText(Name, vUv)",
      "kind": "text",
      "types": [
        "sampler2D"
      ],
      "storageType": 7,
      "dynamic": false,
      "auxiliary": [
        {
          "suffix": "_aspect",
          "type": "float",
          "description": "Text texture aspect ratio.",
          "signature": "uniform float Name_aspect;",
          "example": "Name_aspect"
        },
        {
          "suffix": "_size",
          "type": "vec2",
          "description": "Text texture dimensions in pixels.",
          "signature": "uniform vec2 Name_size;",
          "example": "Name_size"
        },
        {
          "suffix": "_count",
          "type": "float",
          "description": "Number of glyphs.",
          "signature": "uniform float Name_count;",
          "example": "Name_count"
        },
        {
          "suffix": "_grid",
          "type": "vec2",
          "description": "Atlas columns and rows.",
          "signature": "uniform vec2 Name_grid;",
          "example": "Name_grid"
        }
      ]
    }
  ]
};
