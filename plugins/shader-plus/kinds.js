"use strict";
// Shader+ property kinds. Every kind is stored as a native custom property
// type; `zoidiumShader` in the saved definition carries the Zoidium meaning
// and `zoidiumControl` selects the row editor. CM3 saves custom definitions
// verbatim, so vanilla CM3 and older Zoidium keep (and resave) both fields.
const T = { NUMBER: 0, VECTOR2: 1, VECTOR4: 3, GRADIENT: 5, OPTION: 6, TEXT: 7 };
const MAX_ITEMS = 32, MAX_PALETTE = 16;

const DEFAULT_CURVE = JSON.stringify({ points: [[0, 0], [1, 1]], range: [0, 1], channels: "single", composite: [[0, 0], [1, 1]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]], alpha: [[0, 0], [1, 1]] });
const DEFAULT_GRADIENT = JSON.stringify({ stops: [{ position: 0, color: [0, 0, 0, 1] }, { position: 1, color: [1, 1, 1, 1] }], interpolation: "linear", space: "srgb", cyclic: false });
const DEFAULT_PALETTE = JSON.stringify({ colors: [[0.07, 0.07, 0.1, 1], [0.32, 0.18, 0.5, 1], [0.86, 0.26, 0.36, 1], [1, 0.62, 0.25, 1], [1, 0.94, 0.75, 1]] });

function channel(name, value) {
  return { dynamic: true, name, type: T.NUMBER, value, min: 0, max: 1, step: 0.01, decimals: 2 };
}

// Factories return a fresh object on every call: CM3 hands the picker's
// `type` object straight to PZ.property.create(), so a shared object would
// be shared by every property created from it.
const KINDS = {
  point: {
    label: "Point", desc: "Two coordinates as vec2, in UV or pixel units.", texture: false, hidden: true,
    create: () => ({ custom: true, dynamic: true, group: true, type: T.VECTOR2, objects: ["X", "Y"].map(name => ({ dynamic: true, name, type: T.NUMBER, value: 0.5, step: 0.01, decimals: 2 })), zoidiumShader: { kind: "point", space: "uv" } }),
  },
  checkbox: {
    label: "Toggle", desc: "Off/on menu. Declare as bool, int or float.", texture: false, discrete: true,
    create: () => ({ custom: true, dynamic: true, type: T.NUMBER, value: 0, min: 0, max: 1, step: 1, decimals: 0, zoidiumControl: "shader-plus/checkbox", zoidiumShader: { kind: "checkbox" } }),
  },
  dropdown: {
    label: "Dropdown", desc: "Animatable choice. Declare as int or float; Name_Item constants are defined.", texture: false, discrete: true,
    create: () => ({ custom: true, dynamic: true, type: T.NUMBER, value: 0, min: 0, step: 1, decimals: 0, zoidiumControl: "shader-plus/dropdown", zoidiumShader: { kind: "dropdown", items: ["Option 1", "Option 2", "Option 3"] } }),
  },
  staticDropdown: {
    label: "Static dropdown", desc: "Compile-time choice, available as #define Name index.", texture: false,
    create: () => ({ custom: true, type: T.OPTION, value: 0, items: "Option 1;Option 2;Option 3", zoidiumShader: { kind: "staticDropdown" } }),
  },
  slider: {
    label: "Slider", desc: "Number with a range and a slider.", texture: false,
    create: () => ({ custom: true, dynamic: true, type: T.NUMBER, value: 0.5, min: 0, max: 1, step: 0.01, decimals: 2, zoidiumControl: "shader-plus/slider", zoidiumShader: { kind: "slider" } }),
  },
  angle: {
    label: "Angle", desc: "Edited in degrees, passed to the shader in radians.", texture: false,
    create: () => ({ custom: true, dynamic: true, type: T.NUMBER, value: 0, step: 1, decimals: 1, scaleFactor: Math.PI / 180, zoidiumControl: "shader-plus/angle", zoidiumShader: { kind: "angle" } }),
  },
  seed: {
    label: "Seed", desc: "Whole number with a randomize button.", texture: false, discrete: true,
    create: () => ({ custom: true, dynamic: true, type: T.NUMBER, value: 1, min: 0, step: 1, decimals: 0, zoidiumControl: "shader-plus/seed", zoidiumShader: { kind: "seed" } }),
  },
  color4: {
    label: "Color + alpha", desc: "RGBA color, passed as vec4.", texture: false,
    create: () => ({ custom: true, dynamic: true, group: true, type: T.VECTOR4, objects: [channel("R", 1), channel("G", 1), channel("B", 1), channel("A", 1)], zoidiumControl: "shader-plus/color4", zoidiumShader: { kind: "color4" } }),
  },
  gradient: {
    label: "Gradient", desc: "Color stops, sampled with zGradient(Name, t).", texture: true,
    create: () => ({ custom: true, type: T.TEXT, value: DEFAULT_GRADIENT, zoidiumControl: "shader-plus/gradient", zoidiumShader: { kind: "gradient" } }),
  },
  curve: {
    label: "Curve", desc: "Curve editor, sampled with zCurve(Name, x) or zCurves(Name, rgb).", texture: true,
    create: () => ({ custom: true, type: T.TEXT, value: DEFAULT_CURVE, zoidiumControl: "shader-plus/curve", zoidiumShader: { kind: "curve", range: [0, 1], channels: "single" } }),
  },
  palette: {
    label: "Palette", desc: "Up to 16 colors as vec4 Name[16] and int Name_count.", texture: true,
    create: () => ({ custom: true, type: T.TEXT, value: DEFAULT_PALETTE, zoidiumControl: "shader-plus/palette", zoidiumShader: { kind: "palette" } }),
  },
  text: {
    label: "Text", desc: "Text in a project font, sampled with zText(Name, uv).", texture: true,
    create: font => ({ custom: true, type: T.TEXT, value: JSON.stringify({ text: "Text", font: font || null, size: 128, align: "center", lineHeight: 1.2, letterSpacing: 0, mode: "layout", sdf: false }), zoidiumControl: "shader-plus/text", zoidiumShader: { kind: "text" } }),
  },
};
// Hidden kinds stay loadable for saved projects but are not offered in menus.
const ORDER = ["point", "checkbox", "dropdown", "staticDropdown", "slider", "angle", "seed", "color4", "gradient", "curve", "palette", "text"];

function kindOf(property) {
  const kind = property?.definition?.zoidiumShader?.kind;
  return Object.hasOwn(KINDS, kind) ? kind : null;
}

// Same rule as CM3's fixPropertyName for the property itself; constants
// additionally need a valid GLSL identifier suffix.
function identifier(label) {
  const text = String(label).trim().replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
  return /^[0-9]/.test(text) ? "_" + text : text || "_";
}

function items(definition) {
  const raw = definition?.zoidiumShader?.items ?? definition?.items;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(";") : [];
  return list.map(String).slice(0, MAX_ITEMS);
}

// `#define <Name>_<Item> <index>`; colliding labels keep the first index.
function constants(name, list) {
  const defines = {};
  list.forEach((label, index) => {
    const key = name + "_" + identifier(label);
    if (!Object.hasOwn(defines, key)) defines[key] = index;
  });
  return defines;
}

// Display-only conversion. The renderer always retains native get(frame).
function discreteValue(kind, raw, definition) {
  if (kind === "checkbox") return raw >= 0.5 ? 1 : 0;
  if (kind === "dropdown") return Math.min(Math.max(items(definition).length - 1, 0), Math.max(0, Math.round(raw)));
  return Math.round(raw);
}

module.exports = { T, KINDS, ORDER, MAX_ITEMS, MAX_PALETTE, DEFAULT_CURVE, DEFAULT_GRADIENT, DEFAULT_PALETTE, kindOf, identifier, items, constants, discreteValue };
