"use strict";

// Return a text edit rather than touching the DOM, so selection and indentation
// rules are the same for Shader and Expression editors.
function indentCode(text, start, end, unindent = false) {
  if (start === end && !unindent) return { text: text.slice(0, start) + "  " + text.slice(end), start: start + 2, end: start + 2 };
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const to = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const lines = text.slice(from, to).split("\n");
  let delta = 0, first = 0;
  const replacement = lines.map((line, i) => {
    const removed = unindent ? (/^(?:  |\t| )/.exec(line)?.[0].length || 0) : 0;
    const change = unindent ? -removed : 2;
    if (!i) first = change;
    delta += change;
    return unindent ? line.slice(removed) : "  " + line;
  }).join("\n");
  return { text: text.slice(0, from) + replacement + text.slice(to), start: Math.max(from, start + first), end: Math.max(from, end + delta) };
}

const nativeTypes = ["float", "vec2", "vec3", "vec4", "vec3"];
function shaderSymbols(effect, { expressions = false, controls = [] } = {}) {
  const source = (effect?.properties?.fragShader?.get?.() || "").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
  const declared = new Map();
  for (const match of source.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|bool|vec[234]|sampler2D)\s+([^;]+);/g)) {
    for (const entry of match[2].split(",")) {
      const name = /^\s*([A-Za-z_]\w*)/.exec(entry)?.[1];
      if (name) declared.set(name, match[1]);
    }
  }
  const result = [
    { name: "tDiffuse", type: "sampler2D", hint: "Input image" },
    { name: "uvScale", type: "vec2", hint: "Input UV scale" },
    { name: "resolution", type: "vec2", hint: "Output resolution" },
  ];
  for (const p of effect?.customProperties || []) {
    const name = String(p.properties.name.get()).replace(/\s/g, "_");
    const kind = p.definition.zoidiumShader?.kind;
    let type = declared.get(name) || nativeTypes[p.definition.type] || "#define";
    if (["gradient", "curve", "text"].includes(kind) || p.definition.type === 8) type = "sampler2D";
    if (kind === "palette") type = "vec4[16]";
    result.push({ name, type, hint: p.definition.dynamic ? "Custom uniform" : type === "#define" ? "Static define" : "Custom property" });
    const extras = kind === "curve" ? [["range", "vec2"]] : kind === "gradient" ? [["repetitions", "float"]] : kind === "palette" ? [["count", "int"]] : kind === "text" ? [["aspect", "float"], ["size", "vec2"], ["count", "float"], ["grid", "vec2"]] : [];
    for (const [suffix, type] of extras) result.push({ name: name + "_" + suffix, type, hint: "Shader+ binding" });
  }
  if (expressions) {
    result.push({ name: "zTime", type: "float", hint: "Expressions+ clip time, seconds" }, { name: "zFrame", type: "float", hint: "Expressions+ local frame" });
    for (const p of controls) result.push({ name: "ctl_" + String(p.properties.name.get()).replace(/[^A-Za-z0-9_]/g, "_"), type: nativeTypes[p.definition.type] || "float", hint: "Expressions+ sequence control" });
  }
  for (const [name, type, library] of [["zGradient", "vec4", "gradient"], ["zGradientCycle", "vec4", "gradient"], ["zCurve", "float", "curve"], ["zCurves", "vec4", "curve"], ["zText", "float", "text"], ["zGlyph", "float", "text"]]) result.push({ name, type: type + "()", hint: "// #include <zoidium/" + library + ">" });
  return result;
}
module.exports = { indentCode, shaderSymbols };
