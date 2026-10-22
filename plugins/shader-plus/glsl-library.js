"use strict";
const helpers = {
  gradient: `vec4 zGradient(sampler2D s, float t) { return texture2D(s, vec2((clamp(t,0.0,1.0)*255.0+0.5)/256.0,0.5)); }
vec4 zGradientCycle(sampler2D s, float t) { return zGradient(s,fract(t)); }
vec4 zGradientCycle(sampler2D s, float t, float repetitions) { return zGradient(s,fract(t*repetitions)); }`,
  curve: `float zCurve(sampler2D s, float x, vec2 range) { return mix(range.x,range.y,texture2D(s,vec2((clamp(x,0.0,1.0)*1023.0+0.5)/1024.0,0.5)).r); }
float zCurve(sampler2D s, float x) { return zCurve(s,x,vec2(0.0,1.0)); }
vec4 zCurves(sampler2D s, vec4 x, vec2 range) {
  vec4 y=vec4(texture2D(s,vec2((clamp(x.r,0.0,1.0)*1023.0+0.5)/1024.0,0.5)).r,
    texture2D(s,vec2((clamp(x.g,0.0,1.0)*1023.0+0.5)/1024.0,0.5)).g,
    texture2D(s,vec2((clamp(x.b,0.0,1.0)*1023.0+0.5)/1024.0,0.5)).b,
    texture2D(s,vec2((clamp(x.a,0.0,1.0)*1023.0+0.5)/1024.0,0.5)).a);
  return mix(vec4(range.x),vec4(range.y),y);
}
vec4 zCurves(sampler2D s, vec4 x) { return zCurves(s,x,vec2(0.0,1.0)); }
vec3 zCurves(sampler2D s, vec3 x, vec2 range) { return zCurves(s,vec4(x,0.0),range).rgb; }
vec3 zCurves(sampler2D s, vec3 x) { return zCurves(s,x,vec2(0.0,1.0)); }`,
  text: `float zText(sampler2D s, vec2 uv) { return texture2D(s,uv).a; }
float zGlyph(sampler2D s, vec2 grid, float index, vec2 uv) { return texture2D(s,vec2((mod(index,grid.x)+uv.x)/grid.x,(grid.y-floor(index/grid.x)-1.0+uv.y)/grid.y)).a; }`,
};
// Add a range argument to two-argument calls for known Curve properties.
// The author keeps zCurve(Name,x); the sampler remains normalized on both
// half-float and RGBA8 hardware. Nested calls and comments retain their bytes.
function bindArguments(source, names, pattern, suffix, type) {
  const edits = [], declarations = new Set();
  for (const match of source.matchAll(pattern)) {
    const name = match[1]; if (!name || !names.has(name)) continue;
    let depth = 1, commas = 1, i = match.index + match[0].length;
    for (; i < source.length && depth; i++) {
      if (source.slice(i, i + 2) === "/*") { const end = source.indexOf("*/", i + 2); i = end < 0 ? source.length : end + 1; continue; }
      if (source.slice(i, i + 2) === "//") { const end = source.indexOf("\n", i + 2); i = end < 0 ? source.length : end; continue; }
      if (source[i] === "(") depth++;
      if (source[i] === ")") depth--;
      if (source[i] === "," && depth === 1) commas++;
    }
    if (!depth && commas === 1) { edits.push({ at: i - 1, text: ", " + name + suffix }); declarations.add(name); }
  }
  for (const edit of edits.sort((a, b) => b.at - a.at)) source = source.slice(0, edit.at) + edit.text + source.slice(edit.at);
  const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ");
  const missing = [...declarations].filter(name => !new RegExp("\\buniform\\s+" + type + "\\s+" + name + suffix + "\\s*;").test(clean));
  if (missing.length) {
    // Insert after precision declarations, before the first function.
    const precision = /\bprecision\s+\w+\s+\w+\s*;/g; let at = 0;
    for (const match of source.matchAll(precision)) at = match.index + match[0].length;
    source = source.slice(0, at) + "\n" + missing.map(name => "uniform " + type + " " + name + suffix + ";").join("\n") + "\n" + source.slice(at);
  }
  return source;
}
function bindCurveRanges(source, names) {
  return bindArguments(source, names, /\/\*[\s\S]*?\*\/|\/\/[^\n]*|\bzCurves?\s*\(\s*([A-Za-z_]\w*)\s*,/g, "_range", "vec2");
}
function bindGradientCycles(source, names) {
  return bindArguments(source, names, /\/\*[\s\S]*?\*\/|\/\/[^\n]*|\bzGradientCycle\s*\(\s*([A-Za-z_]\w*)\s*,/g, "_repetitions", "float");
}
module.exports = { helpers, bindCurveRanges, bindGradientCycles };
