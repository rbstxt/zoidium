#!/usr/bin/env node

/*
 * Build the optional AfterClip shader/group pack.
 *
 * The source files in AfterClip are JSON-wrapped Panzoid shader objects.  This
 * builder deliberately keeps the original mathematical bodies wherever
 * possible, then applies the small compatibility layer required by Zoidium:
 * canonical uniform names, common object controls, premultiplied source-over,
 * and WebGL 1 validation-friendly headers.
 */

const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.resolve(
  process.argv[2] || path.join(projectRoot, "..", "AfterClip", "src")
);
const outputRoot = path.join(projectRoot, "plugins", "afterclip");

if (!fs.existsSync(sourceRoot)) {
  console.error(`AfterClip source directory not found: ${sourceRoot}`);
  process.exit(1);
}

const shaderRoot = path.join(sourceRoot, "Shaders");
const presetRoot = path.join(sourceRoot, "Presets");

const CATEGORY = Object.freeze({
  "Shaders/Warp": "AFTERCLIP · SHADERS · WARP",
  "Shaders/Shape": "AFTERCLIP · SHADERS · SHAPE",
  "Shaders/Repeat": "AFTERCLIP · SHADERS · REPEAT",
  "Presets/Effects": "AFTERCLIP · PRESETS · EFFECTS",
  "Presets/Dot Waves": "AFTERCLIP · PRESETS · DOT WAVES",
  "Presets/SyncTools": "AFTERCLIP · PRESETS · SYNCTOOLS",
});

const DISPLAY_NAMES = Object.freeze({
  "Shaders/Shape/Arrow": "Arrow Shape",
  "Shaders/Shape/Gradient Overlay (Easeable)": "Gradient (Easeable)",
  "Shaders/Warp/Mirror (Fixed Bugs)": "Mirror (Fixed)",
  "Presets/Effects/Arrow": "Arrow Effect",
  "Presets/Effects/fw": "Fireworks",
});

const DESCRIPTIONS = Object.freeze({
  "Fractal Noise": "Generates fractal noise patterns.",
  "Fractal Warp": "Warps the source using fractal noise.",
  "Mirror (Fixed)": "Reflects the source with the corrected mirror behavior.",
  "Polar Coordinates": "Converts the source to polar coordinates.",
  Stretch: "Stretches the source along a controlled angle.",
  "Wavy (Extended)": "Applies the extended animated wave distortion.",
  "Arrow Shape": "Draws a controllable arrow-shaped overlay.",
  CLE: "Draws repeated circular line segments.",
  Chevron: "Draws a controllable chevron pattern.",
  "Gradient (Easeable)": "Fills the source with an easeable color gradient.",
  "Hex Net": "Draws a hexagonal net overlay.",
  "Line Wave Mask": "Reveals the source with an animated line wave.",
  "Line Wave": "Draws animated line-wave colors over the source.",
  Lines: "Draws a repeated diagonal line pattern.",
  Net: "Draws a repeated two-direction line net.",
  PinWheel: "Draws repeated pinwheel sectors.",
  "Plain Wave Mask": "Reveals the source with a plain wave.",
  "Plain Wave": "Draws a plain animated wave over the source.",
  "Polygon Echo": "Draws repeated polygon rings with stripes.",
  Polygon: "Draws a polygon ring overlay.",
  "Repeating Dots": "Draws a row of repeating dots.",
  "Rounded Star": "Draws a repeated rounded-star overlay.",
  Shockwave: "Draws a polygonal shockwave ring.",
  Triangle: "Draws a triangle overlay.",
  "Circle Dot Wave": "Draws a circular dot-wave pattern.",
  "Dot Wave": "Draws an animated dot-wave pattern.",
  "Duplicate (Extended)": "Duplicates the source with extended repeat modes.",
  "Gradient Linear Repeat": "Repeats the source through a color gradient.",
  "Hex Dot Wave": "Draws a hexagonal dot-wave pattern.",
  "Linear Repeat": "Repeats the source along a linear path.",
  "Radial Repeat": "Repeats the source around a radial path.",
  "Stroke (Extended)": "Draws an extended alpha stroke around the source.",
  "Arrow Effect": "Animated arrow group preset.",
  Burst: "Animated burst group preset.",
  "Fractal Burst": "Animated fractal burst group preset.",
  "Line Waves": "Animated line-wave group preset.",
  Spiral: "Animated spiral group preset.",
  Fireworks: "Animated fireworks group preset.",
  "Circular DotWave": "Circular dot-wave group preset.",
  "Hex DotWave": "Hexagonal dot-wave group preset.",
  "Square DotWave": "Square dot-wave group preset.",
  ChevSync: "Chevron synchronization group preset.",
  "SyncTools v2": "Synchronization controls group preset.",
});

const OBJECT_SHADER_NAMES = new Set([
  "Arrow",
  "CLE",
  "Chevron",
  "Hex Net",
  "Lines",
  "Net",
  "PinWheel",
  "Polygon Echo",
  "Polygon",
  "Repeating Dots",
  "RoundedStar",
  "Shockwave",
  "Triangle",
  "Circle Dot Wave",
  "Dot Wave",
  "Hex Dot Wave",
  "Line",
  "DotWave Warp",
  "HexWave Warp",
]);

const POSITION_REWRITE_NAMES = new Set([
  "Arrow",
  "Chevron",
  "PinWheel",
  "Polygon Echo",
  "Polygon",
  "Repeating Dots",
  "RoundedStar",
  "Shockwave",
]);

const GROUP_ONLY_NAME_ALIASES = Object.freeze({
  Wave: "Line Wave",
  "Wave Cut": "Line Wave Mask",
  WaveCut: "Plain Wave Mask",
  "Triangle Mask": "Triangle Mask",
  "Grayscale Gradient": "Grayscale Gradient",
  "DotWave Warp": "Dot Wave",
  "HexWave Warp": "Hex Dot Wave",
  Mirror: "Mirror (Fixed)",
});

const STANDARD_DEFAULTS = Object.freeze({
  Color: [1, 1, 1],
  StartColor: [1, 1, 1],
  EndColor: [1, 1, 1],
  Opacity: 1,
  Position: [0, 0],
  Rotation: 0,
  Scale: [1, 1],
});

function walk(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "effect";
}

function unwrap(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return value?.[0]?.data?.[0] || null;
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseUniforms(source) {
  return [...source.matchAll(/uniform\s+(\w+)\s+(\w+)\s*;/g)].map((match) => ({
    type: match[1],
    name: match[2],
  }));
}

function replaceWords(source, mapping) {
  const entries = Object.entries(mapping)
    .filter(([from, to]) => from !== to)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of entries) {
    source = source.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  // A lowercase AfterClip uniform named `step` must not rename GLSL's
  // built-in step() function.
  if (mapping.step === "Step") source = source.replace(/\bStep\s*\(/g, "step(");
  return source;
}

function normalizedShaderName(name) {
  return GROUP_ONLY_NAME_ALIASES[name] || name;
}

function canonicalUniformName(name, shaderName) {
  const normalizedName = normalizedShaderName(shaderName);
  if (name === "Center" && normalizedName === "PinWheel") return "Position";
  if (name === "offset" && normalizedName === "Arrow") return "Position";
  if (name === "Rotation" && OBJECT_SHADER_NAMES.has(normalizedName)) return "PatternRotation";
  if (name === "Scale" && (normalizedName === "Fractal Noise" || normalizedName === "Fractal Warp")) {
    return "NoiseScale";
  }
  if (name === "Position" && (normalizedName === "Fractal Noise" || normalizedName === "Fractal Warp")) {
    return "NoisePosition";
  }
  if (name === "Scale" && normalizedName === "Chevron") return "PatternScale";
  if (name === "Scale" && (normalizedName === "Triangle" || normalizedName === "Triangle Mask")) {
    return "GeometryScale";
  }
  if (
    name === "Scale" &&
    (normalizedName === "Linear Repeat" || normalizedName === "Gradient Linear Repeat")
  ) {
    return "RepeatScale";
  }

  const aliases = {
    radius: "Radius",
    radius2: "Radius2",
    angle: "Angle",
    offset: "Offset",
    color: "Color",
    paintedWidth: "PaintedWidth",
    unpaintedWidth: "UnpaintedWidth",
    time: "Time",
    delay: "Delay",
    power: "Power",
    step: "Step",
    start: "StartColor",
    end: "EndColor",
    startColor: "StartColor",
    endColor: "EndColor",
    colorstep: "ColorStep",
    width: "Width",
    hue: "Hue",
    rgb: "Color",
    iterations: "Iterations",
    segments: "Segments",
    amount: "Amount",
    size: "Size",
    warpAngle: "WarpAngle",
  };
  return aliases[name] || name;
}

function firstValue(property) {
  if (!property || typeof property !== "object") return undefined;
  if (Array.isArray(property.keyframes) && property.keyframes.length > 0) {
    return property.keyframes[0].value;
  }
  if (Array.isArray(property.objects)) return property.objects.map(firstValue);
  return property.value;
}

function setDynamic(type) {
  if (!type || typeof type !== "object") return;
  type.dynamic = true;
  if (Array.isArray(type.objects)) {
    for (const child of type.objects) setDynamic(child);
  }
}

function staticProperty(name, value, template) {
  const result = template ? clone(template) : {
    type: { custom: true, dynamic: true, type: 0 },
    properties: { name },
  };
  result.properties = { ...(result.properties || {}), name };
  setDynamic(result.type);
  result.animated = false;
  result.keyframes = [{ value, frame: 0, tween: 1 }];
  delete result.expression;
  delete result.objects;
  if (template?.objects) {
    result.objects = template.objects.map((child, index) => {
      const childValue = Array.isArray(value) ? value[index] : undefined;
      return staticProperty(child.properties?.name || ["X", "Y", "Z"][index], childValue, child);
    });
  }
  return result;
}

function makeVectorProperty(name, type, value) {
  const dimensions = type === "vec3" ? ["R", "G", "B"] : ["X", "Y"];
  const values = Array.isArray(value) ? value : dimensions.map(() => 0);
  return {
    type: {
      custom: true,
      group: true,
      dynamic: true,
      objects: dimensions.map((component, index) => ({
        dynamic: true,
        name: component,
        type: 0,
        value: values[index] ?? 0,
      })),
      type: type === "vec3" ? 4 : 1,
    },
    properties: { name },
    objects: dimensions.map((component, index) => ({
      animated: false,
      keyframes: [{ value: values[index] ?? 0, frame: 0, tween: 1 }],
    })),
  };
}

function defaultForUniform(uniform) {
  if (Object.prototype.hasOwnProperty.call(STANDARD_DEFAULTS, uniform.name)) {
    return clone(STANDARD_DEFAULTS[uniform.name]);
  }
  if (uniform.type === "vec2") return [0, 0];
  if (uniform.type === "vec3") return [1, 1, 1];
  if (uniform.type === "int") return 0;
  return 0;
}

function normalizeProperties(customProperties, uniforms, mapping, staticDefaults) {
  const original = new Map(
    (customProperties || [])
      .map((property) => [property?.properties?.name, property])
      .filter(([name]) => name)
  );
  const inverse = new Map(Object.entries(mapping).map(([from, to]) => [to, from]));
  return uniforms
    .filter((uniform) => uniform.name !== "tDiffuse")
    .map((uniform) => {
      const mappedOriginalName = inverse.get(uniform.name);
      const originalName = mappedOriginalName || uniform.name;
      // A source uniform may have been renamed to make room for a standard
      // control (for example Scale -> PatternScale).  Do not reuse that
      // source property's value for the newly added identity Scale control.
      const sourceNameWasRenamed =
        Object.prototype.hasOwnProperty.call(mapping, uniform.name) &&
        mapping[uniform.name] !== uniform.name;
      const template = mappedOriginalName
        ? original.get(originalName)
        : sourceNameWasRenamed
          ? undefined
          : original.get(uniform.name);
      let value = template ? firstValue(template) : defaultForUniform(uniform);
      if (value === undefined) value = defaultForUniform(uniform);
      if (staticDefaults) {
        if (uniform.type === "vec2" || uniform.type === "vec3") {
          return makeVectorProperty(uniform.name, uniform.type, value);
        }
        return staticProperty(uniform.name, value, template);
      }
      if (template) {
        const result = clone(template);
        result.properties = { ...(result.properties || {}), name: uniform.name };
        setDynamic(result.type);
        return result;
      }
      if (uniform.type === "vec2" || uniform.type === "vec3") {
        return makeVectorProperty(uniform.name, uniform.type, value);
      }
      return staticProperty(uniform.name, value);
    });
}

function standardTransform(applyPosition, applyRotation, applyScale) {
  return `
vec2 standardObjectUv(vec2 uv) {
    vec2 p = uv * 2.0 - 1.0;
    ${applyPosition ? "p -= Position;" : ""}
    p.x *= 16.0 / 9.0;
    ${applyRotation ? `
    float standardRotation = Rotation * 3.14159265359 / 180.0;
    p = vec2(
        cos(standardRotation) * p.x + sin(standardRotation) * p.y,
        -sin(standardRotation) * p.x + cos(standardRotation) * p.y
    );` : ""}
    ${applyScale ? "p /= max(abs(Scale), vec2(0.0001));" : ""}
    p.x /= 16.0 / 9.0;
    return p * 0.5 + 0.5;
}
`;
}

const PREMULTIPLY_HELPERS = `
vec4 premultiplyColor(vec4 colorValue) {
    float alpha = clamp(colorValue.a, 0.0, 1.0);
    return vec4(colorValue.rgb * alpha, alpha);
}

vec4 sourceOverColor(vec4 backgroundColor, vec3 effectColor, float effectAlpha) {
    float sourceAlpha = clamp(effectAlpha, 0.0, 1.0);
    float backgroundAlpha = clamp(backgroundColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = effectColor * sourceAlpha + backgroundColor.rgb * remainingBackground;
    return vec4(outputColor, outputAlpha);
}
`;

const PREMULTIPLIED_BLEND = `
vec4 blendColors(vec4 baseColor, vec4 overlayColor) {
    float sourceAlpha = clamp(overlayColor.a, 0.0, 1.0);
    float backgroundAlpha = clamp(baseColor.a, 0.0, 1.0);
    float remainingBackground = backgroundAlpha * (1.0 - sourceAlpha);
    float outputAlpha = sourceAlpha + remainingBackground;
    vec3 outputColor = overlayColor.rgb * sourceAlpha + baseColor.rgb * (1.0 - sourceAlpha);
    return vec4(outputColor, outputAlpha);
}
`;

function objectOptions(name, uniforms) {
  const declared = new Set(uniforms.map((uniform) => uniform.name));
  const normalizedName = normalizedShaderName(name);
  const positionRewrite = POSITION_REWRITE_NAMES.has(normalizedName);
  return {
    object: OBJECT_SHADER_NAMES.has(normalizedName),
    applyPosition: OBJECT_SHADER_NAMES.has(normalizedName) &&
      (!declared.has("Position") || positionRewrite),
    applyRotation: OBJECT_SHADER_NAMES.has(normalizedName) && !declared.has("Rotation"),
    applyScale: OBJECT_SHADER_NAMES.has(normalizedName) && !declared.has("Scale"),
  };
}

function removeHeaderParts(source) {
  return source
    .replace(/precision\s+highp\s+(?:float|int)\s*;\s*/g, "")
    .replace(/uniform\s+\w+\s+\w+\s*;\s*/g, "")
    .replace(/varying\s+vec2\s+(?:vUv|vUvScaled|objectUv)\s*;\s*/g, "")
    .trim();
}

function injectMain(source, statement) {
  return source.replace(/void\s+main\s*\(\s*\)\s*\{/, (match) => `${match}\n${statement}`);
}

function rewritePositionUses(source, shaderName) {
  if (shaderName === "Arrow") {
    source = source.replace(
      /vec2 offsetPixels\s*=\s*Position\s*\*\s*100\.0;\s*vec2 normalizedOffset\s*=\s*vec2\([^;]+;\s*vec2 P1\s*=\s*vec2\(0\.5,\s*0\.5\)\s*\+\s*normalizedOffset\s*;/,
      "vec2 P1 = vec2(0.5, 0.5);"
    );
  }
  if (shaderName === "Chevron") {
    source = source.replace(/vec2 uv\s*=\s*objectUv\s*\+\s*Position\s*\/\s*20\.0;/, "vec2 uv = objectUv;");
    source = source.replace(/rotate\(centeredUv,\s*PatternRotation\)/g, "rotate(centeredUv, PatternRotation * 3.14159265359 / 180.0)");
    source = source.replace(/rotate\(centeredUv,\s*StripeRotation\)/g, "rotate(centeredUv, StripeRotation * 3.14159265359 / 180.0)");
  }
  if (shaderName === "PinWheel") {
    source = source.replace(/vec2 center\s*=\s*vec2\([^;]+;/, "vec2 center = vec2(0.0);");
  }
  if (shaderName === "Polygon Echo") {
    source = source.replace(/vec2 position\s*=\s*Position\s*\*\s*vec2\([^;]+;/, "vec2 position = vec2(0.0);");
  }
  if (["Polygon", "Shockwave"].includes(shaderName)) {
    source = source.replace(/adjustedUV\s*-\s*Position/g, "adjustedUV");
  }
  if (shaderName === "RoundedStar") {
    source = source.replace(/vec2 centerOffset\s*=\s*Position\s*\*\s*vec2\([^;]+;/, "vec2 centerOffset = vec2(0.0);");
  }
  if (shaderName === "Repeating Dots") {
    source = source.replace(/vec2 circleCenter\s*=\s*Position\s*;/, "vec2 circleCenter = vec2(0.0);");
  }
  return source;
}

function rewriteTriangleLocals(source) {
  source = source.replace(/vec2 P1\s*=/g, "vec2 p1Uv =");
  source = source.replace(/vec2 P2\s*=/g, "vec2 p2Uv =");
  source = source.replace(/vec2 P3\s*=/g, "vec2 p3Uv =");
  source = source.replace(
    /isInTriangle\(scaledUV,\s*P1,\s*P2,\s*P3\)/g,
    "isInTriangle(scaledUV, p1Uv, p2Uv, p3Uv)"
  );
  return source;
}

function rewriteRepeatLocals(source, shaderName) {
  if (["Linear Repeat", "Gradient Linear Repeat"].includes(shaderName)) {
    source = source.replace(/vec2 Offset\s*=\s*Offset\s*\/\s*vec2\([^;]+;/, "vec2 offsetPixels = Offset / vec2(-1920.0, -1080.0);");
    source = source.replace(/offsetIncrement\s*=\s*Offset\s*\/\s*float\(Repeat\)/g, "offsetIncrement = offsetPixels / float(Repeat)");
    source = source.replace(/\(Scale\s*-\s*1\.0\)/g, "(RepeatScale - 1.0)");
  }
  return source;
}

function rewriteBlendFunctions(source, shaderName) {
  if (["Linear Repeat", "Radial Repeat", "Gradient Linear Repeat"].includes(shaderName)) {
    if (/vec4\s+blendColors\s*\(/.test(source)) {
      source = source.replace(/vec4\s+blendColors\s*\([^{}]+\{[\s\S]*?\n\}/, PREMULTIPLIED_BLEND.trim());
    } else {
      source = `${PREMULTIPLIED_BLEND.trim()}\n${source}`;
    }
    source = source.replace(/color\s*=\s*mix\(color,\s*texel,\s*alpha\);/g, "color = blendColors(color, texel);");
  }
  if (["Polygon Echo", "RoundedStar"].includes(shaderName)) {
    source = source.replace(/vec4\s+blendColors\s*\([^{}]+\{[\s\S]*?\n\}/, PREMULTIPLIED_BLEND.trim());
    source = source.replace(
      /vec4\s+texel\s*=\s*texture2D\(([^;]+)\);/g,
      "vec4 texel = premultiplyColor(texture2D($1));"
    );
  }
  return source;
}

function rewriteOutputs(source, shaderName, object) {
  const isMask = ["Line Wave Mask", "Plain Wave Mask", "Triangle Mask", "Wave Cut", "WaveCut"].includes(shaderName);
  const opacityExpression = object ? "Opacity" : "1.0";

  source = source.replace(
    /gl_FragColor\s*=\s*draw\s*\?\s*vec4\(Color,\s*1\.0\)\s*:\s*texel\s*;/g,
    `gl_FragColor = draw ? sourceOverColor(sourceTexel, Color, ${opacityExpression}) : premultiplyColor(texel);`
  );
  source = source.replace(
    /gl_FragColor\s*=\s*vec4\(Color,\s*1\.0\)\s*;/g,
    `gl_FragColor = sourceOverColor(sourceTexel, Color, ${opacityExpression});`
  );
  source = source.replace(
    /gl_FragColor\s*=\s*vec4\(color,\s*1\.0\)\s*;/g,
    "gl_FragColor = sourceOverColor(sourceTexel, color, 1.0);"
  );
  source = source.replace(
    /gl_FragColor\s*=\s*vec4\(newColor,\s*1\.0\)\s*;/g,
    `gl_FragColor = sourceOverColor(sourceTexel, newColor, ${opacityExpression});`
  );
  source = source.replace(
    /gl_FragColor\s*=\s*vec4\(eased,\s*eased,\s*eased,\s*1\.0\)\s*;/g,
    "gl_FragColor = sourceOverColor(sourceTexel, vec3(eased), 1.0);"
  );
  source = source.replace(
    /gl_FragColor\s*=\s*mix\(texel,\s*blindsColor,\s*alpha\)\s*;/g,
    `gl_FragColor = sourceOverColor(sourceTexel, Color, alpha * ${opacityExpression});`
  );
  if (shaderName === "Chevron") {
    source = source.replace(/vec4\s+texel\s*=\s*texture2D\(([^;]+)\);/, "vec4 texel = premultiplyColor(texture2D($1));");
    source = source.replace(/texel\s*=\s*vec4\(Color,\s*1\.0\);/g, "texel = sourceOverColor(sourceTexel, Color, Opacity);");
    source = source.replace(/gl_FragColor\s*=\s*premultiplyColor\(texel\)\s*;/g, "gl_FragColor = texel;");
  }
  if (["Polygon Echo", "RoundedStar"].includes(shaderName)) {
    // blendColors() now accepts premultiplied base colors.
    source = source.replace(
      /vec4\s+texel\s*=\s*premultiplyColor\(texture2D\(tDiffuse,\s*uv\)\)\s*;/g,
      "vec4 texel = premultiplyColor(sourceTexel);"
    );
    source = source.replace(/gl_FragColor\s*=\s*finalColor\s*;/g, "gl_FragColor = finalColor;");
  }
  if (object && !isMask) {
    source = source.replace(/gl_FragColor\s*=\s*vec4\(0\.0\)\s*;/g, "gl_FragColor = premultiplyColor(sourceTexel);");
  }
  if (!["Linear Repeat", "Radial Repeat", "Gradient Linear Repeat", "Polygon Echo", "RoundedStar", "Chevron"].includes(shaderName)) {
    source = source.replace(/gl_FragColor\s*=\s*texel\s*;/g, "gl_FragColor = premultiplyColor(texel);");
  }
  source = source.replace(
    /gl_FragColor\s*=\s*texture2D\(tDiffuse,\s*vUvScaled\)\s*;/g,
    "gl_FragColor = premultiplyColor(texture2D(tDiffuse, vUvScaled));"
  );
  source = source.replace(/gl_FragColor\s*=\s*originalTexel\s*;/g, "gl_FragColor = premultiplyColor(originalTexel);");
  source = source.replace(/gl_FragColor\s*=\s*texColor\s*;/g, "gl_FragColor = premultiplyColor(texColor);");
  return source;
}

function normalizeShader(shaderName, rawShader, customProperties, staticDefaults) {
  const normalizedName = normalizedShaderName(shaderName);
  let source = stripComments(rawShader).replace(/\bvUv\b/g, "vUvScaled");
  const originalUniforms = parseUniforms(source);
  const mapping = {};
  for (const uniform of originalUniforms) {
    if (uniform.name !== "tDiffuse") {
      mapping[uniform.name] = canonicalUniformName(uniform.name, normalizedName);
    }
  }
  source = replaceWords(source, mapping);
  if (["Triangle", "Triangle Mask"].includes(normalizedName)) {
    source = rewriteTriangleLocals(source);
  }
  source = rewriteRepeatLocals(source, normalizedName);
  source = rewritePositionUses(source, normalizedName);
  const uniformsBeforeControls = parseUniforms(source);
  const options = objectOptions(normalizedName, uniformsBeforeControls);
  const existingNames = new Set(uniformsBeforeControls.map((uniform) => uniform.name));

  if (options.object) {
    if (!existingNames.has("Position")) source = `uniform vec2 Position;\n${source}`;
    if (!existingNames.has("Rotation")) source = `uniform float Rotation;\n${source}`;
    if (!existingNames.has("Scale")) source = `uniform vec2 Scale;\n${source}`;
    if (!existingNames.has("Opacity")) source = `uniform float Opacity;\n${source}`;
  }

  // Keep direct source reads on the screen UV, while shape mathematics gets a
  // transformed object UV.  The defaults are identity, so opaque defaults
  // retain the AfterClip result.
  source = source.replace(
    /texture2D\(tDiffuse,\s*vUvScaled\)/g,
    "texture2D(tDiffuse, SOURCE_UV)"
  );
  if (options.object) source = source.replace(/\bvUvScaled\b/g, "objectUv");
  source = source.replace(/\bSOURCE_UV\b/g, "vUvScaled");
  const normalizedUniforms = parseUniforms(source);
  source = removeHeaderParts(source);
  source = rewriteBlendFunctions(source, normalizedName);
  source = rewriteOutputs(source, normalizedName, options.object);

  const controls = options.object ? standardTransform(
    options.applyPosition,
    options.applyRotation,
    options.applyScale
  ) : "";
  source = injectMain(
    source,
    `${options.object ? "objectUv = standardObjectUv(vUvScaled);\n" : ""}vec4 sourceTexel = texture2D(tDiffuse, vUvScaled);${options.object ? "\nif (Opacity <= 0.0) { gl_FragColor = premultiplyColor(sourceTexel); return; }" : ""}`
  );

  // Fix a few source-specific cases after the common output pass.
  if (normalizedName === "Gradient Linear Repeat") {
    source = source.replace(/float\s+t\s*=\s*float\(i\)\s*\/\s*\(Repeat\s*-\s*1\.0\);/g, "float t = float(i) / max(Repeat - 1.0, 1.0);");
  }
  if (normalizedName === "Duplicate (Extended)") {
    source = source.replace(/gl_FragColor\s*=\s*texel\s*;/g, "gl_FragColor = premultiplyColor(texel);");
  }
  if (normalizedName === "Wavy (Extended)") {
    source = source.replace(/gl_FragColor\s*=\s*texColor\s*;/g, "gl_FragColor = premultiplyColor(texColor);");
  }

  source = removeHeaderParts(source);
  const uniformDeclarations = normalizedUniforms
    .filter((uniform) => uniform.name !== "tDiffuse")
    .map((uniform) => `uniform ${uniform.type} ${uniform.name};`)
    .join("\n");
  return {
    source: `${[
      "precision highp float;",
      "precision highp int;",
      "uniform sampler2D tDiffuse;",
      uniformDeclarations,
      PREMULTIPLY_HELPERS,
      options.object ? "varying vec2 vUvScaled;" : "varying vec2 vUvScaled;",
      options.object ? "vec2 objectUv;" : "",
      options.object ? controls : "",
      source,
    ].join("\n")}\n`,
    uniforms: normalizedUniforms,
    properties: normalizeProperties(customProperties, normalizedUniforms, mapping, staticDefaults),
    mapping,
    object: options.object,
  };
}

function renameExpressions(value, names) {
  if (typeof value === "string") {
    for (const [from, to] of Object.entries(names)) {
      value = value.replaceAll(`properties["${from}"]`, `properties["${to}"]`);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => renameExpressions(item, names));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, renameExpressions(child, names)]));
}

function normalizeGroupPropertyName(name) {
  const cleaned = String(name).replace(/^[├└]\s*/, "");
  const aliases = {
    time: "Time",
    delay: "Delay",
    power: "Power",
    step: "Step",
  };
  return aliases[cleaned] || cleaned;
}

function collectGroupNames(value, names = {}) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectGroupNames(item, names));
    return names;
  }
  if (!value || typeof value !== "object") return names;
  if (Array.isArray(value.customProperties)) {
    value.customProperties.forEach((property) => {
      const oldName = property?.properties?.name;
      if (!oldName) return;
      const newName = normalizeGroupPropertyName(oldName);
      if (newName !== oldName) names[oldName] = newName;
    });
  }
  Object.values(value).forEach((child) => collectGroupNames(child, names));
  return names;
}

function renameGroupProperties(value, names) {
  if (Array.isArray(value)) {
    value.forEach((item) => renameGroupProperties(item, names));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value.customProperties)) {
    value.customProperties.forEach((property) => {
      const oldName = property?.properties?.name;
      if (oldName && names[oldName]) property.properties.name = names[oldName];
    });
  }
  Object.values(value).forEach((child) => renameGroupProperties(child, names));
  return value;
}

function normalizeGroup(group, sourcePath, groupId, shaderWriter, groupShaders) {
  const result = clone(group);
  const names = collectGroupNames(result);

  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.properties?.fragShader && node.type === 1) {
      const shaderName = node.properties.name || "AfterClip Shader";
      const normalized = normalizeShader(shaderName, node.properties.fragShader, node.customProperties, false);
      const shaderPath = shaderWriter(`${groupId}-${slugify(shaderName)}`, normalized.source);
      groupShaders.add(shaderPath);
      delete node.properties.fragShader;
      node._zoidiumShader = shaderPath;
      node.customProperties = normalized.properties;
    }
    if (Array.isArray(node.objects)) node.objects.forEach(visit);
  }
  visit(result);
  renameGroupProperties(result, names);
  return renameExpressions(result, names);
}

function relativeCategory(filePath) {
  const relative = path.relative(sourceRoot, filePath).replace(/\\/g, "/");
  const directory = path.dirname(relative);
  return CATEGORY[directory] || "AFTERCLIP";
}

function displayNameFor(filePath, rootData) {
  const relative = path.relative(sourceRoot, filePath).replace(/\\/g, "/").replace(/\.txt$/, "");
  return DISPLAY_NAMES[relative] || rootData?.properties?.name || path.basename(filePath, ".txt");
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outputRoot, "effects"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "groups"), { recursive: true });
fs.mkdirSync(path.join(outputRoot, "shaders", "groups"), { recursive: true });

const usedShaderFiles = new Map();
function writeShader(hint, source) {
  const existing = [...usedShaderFiles.entries()].find(([, value]) => value.source === source);
  if (existing) return existing[0];
  const base = slugify(hint);
  let fileName = `${base}.glsl`;
  let suffix = 2;
  while (usedShaderFiles.has(fileName)) fileName = `${base}-${suffix++}.glsl`;
  const relative = `./plugins/afterclip/shaders/${fileName}`;
  fs.writeFileSync(path.join(outputRoot, "shaders", fileName), source);
  usedShaderFiles.set(relative, { source });
  return relative;
}

function writeGroupShader(hint, source) {
  const existing = [...usedShaderFiles.entries()].find(([, value]) => value.source === source);
  if (existing) return existing[0];
  const base = `groups/${slugify(hint)}`;
  let fileName = `${base}.glsl`;
  let suffix = 2;
  while (usedShaderFiles.has(`./plugins/afterclip/shaders/${fileName}`)) fileName = `${base}-${suffix++}.glsl`;
  const relative = `./plugins/afterclip/shaders/${fileName}`;
  fs.writeFileSync(path.join(outputRoot, "shaders", fileName), source);
  usedShaderFiles.set(relative, { source });
  return relative;
}

const effects = [];
for (const filePath of walk(shaderRoot).filter((file) => file.endsWith(".txt")).sort()) {
  const data = unwrap(filePath);
  if (!data || data.type !== 1 || typeof data.properties?.fragShader !== "string") continue;
  const sourceName = data.properties.name || path.basename(filePath, ".txt");
  const displayName = displayNameFor(filePath, data);
  const id = `afterclip-${slugify(path.relative(shaderRoot, filePath).replace(/\.txt$/, ""))}`;
  const normalized = normalizeShader(sourceName, data.properties.fragShader, data.customProperties, true);
  const shaderPath = writeShader(id, normalized.source);
  const preset = clone(data);
  preset.properties.name = displayName;
  delete preset.properties.fragShader;
  preset.customProperties = normalized.properties;
  const presetPath = `effects/${id}.json`;
  writeJson(path.join(outputRoot, presetPath), preset);
  effects.push({
    id,
    name: displayName,
    description: DESCRIPTIONS[displayName] || DESCRIPTIONS[sourceName] || `${displayName} from AfterClip.`,
    category: relativeCategory(filePath),
    source: path.relative(sourceRoot, filePath).replace(/\\/g, "/"),
    shader: shaderPath,
    preset: `./plugins/afterclip/${presetPath}`,
  });
}

const groups = [];
for (const filePath of walk(presetRoot).filter((file) => file.endsWith(".txt")).sort()) {
  const data = unwrap(filePath);
  if (!data || data.type !== 0 || !Array.isArray(data.objects)) continue;
  const displayName = displayNameFor(filePath, data);
  const relativeBase = path.relative(presetRoot, filePath).replace(/\.txt$/, "").replace(/\\/g, "/");
  const id = `afterclip-group-${slugify(relativeBase)}`;
  const groupShaders = new Set();
  const normalizedGroup = normalizeGroup(
    data,
    filePath,
    id,
    writeGroupShader,
    groupShaders
  );
  normalizedGroup.properties.name = displayName;
  normalizedGroup.name = displayName;
  normalizedGroup.desc = DESCRIPTIONS[displayName] || `${displayName} from AfterClip.`;
  normalizedGroup.category = relativeCategory(filePath);
  const presetPath = `groups/${id}.json`;
  writeJson(path.join(outputRoot, presetPath), normalizedGroup);
  groups.push({
    id,
    name: displayName,
    description: DESCRIPTIONS[displayName] || `${displayName} from AfterClip.`,
    category: relativeCategory(filePath),
    source: path.relative(sourceRoot, filePath).replace(/\\/g, "/"),
    preset: `./plugins/afterclip/${presetPath}`,
    shaders: [...groupShaders].sort(),
  });
}

effects.sort((a, b) => a.source.localeCompare(b.source, "en"));
groups.sort((a, b) => a.source.localeCompare(b.source, "en"));

const manifest = {
  schemaVersion: 1,
  id: "afterclip",
  name: "AfterClip",
  author: "AfterClip",
  version: "1",
  category: "AFTERCLIP",
  description: "AfterClip-compatible shader effects and group presets, normalized for Zoidium.",
  effectCount: effects.length,
  groupCount: groups.length,
  effects,
  groups,
};
writeJson(path.join(outputRoot, "manifest.json"), manifest);

const readme = `# AfterClip\n\nOptional AfterClip shader and group pack for Zoidium.\n\n- Standalone shaders: ${effects.length}\n- Group presets: ${groups.length}\n- Excluded by design: Twitch and VHS\n- Object overlays use premultiplied-alpha source-over compositing.\n- Position, Rotation, Scale, and Opacity follow the Zoidium/panzoid-shader conventions.\n\nThe files are generated by \`tools/build-afterclip-plugin.js\` from the AfterClip \`src/Shaders\` and \`src/Presets\` trees.\n`;
fs.writeFileSync(path.join(outputRoot, "README.md"), readme);

console.log(`Built AfterClip plugin: ${effects.length} shaders + ${groups.length} groups`);
