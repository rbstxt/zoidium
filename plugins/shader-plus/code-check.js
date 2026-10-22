"use strict";
const { declarations, propertySymbols, stripComments } = require("./code-assist.js");
const reference = require("./reference.js");
function lint(source, effect, entries) {
  const declared = declarations(source), byName = new Map(declared.map(d => [d.name, d]));
  const bindings = propertySymbols(effect), expected = new Map([...entries, ...bindings].filter(e => e.type !== "#define" && e.category !== "helper" && e.category !== "include").map(e => [e.name, e]));
  const result = [];
  for (const binding of bindings) {
    if (binding.static || binding.type === "#define") continue;
    const d = byName.get(binding.name), types = binding.types || [binding.type];
    if (!d && binding.property) result.push({ line: 1, message: binding.name + " has no uniform declaration.", declare: binding.signature });
    else if (d && !types.includes(d.type)) result.push({ line: d.line, message: binding.name + " expects " + types.join(" or ") + ", declared " + d.type + "." });
  }
  for (const d of declared) if (!expected.has(d.name) && !reference.entries.some(e => e.category === "builtin" && e.name === "ctl_*" && d.name.startsWith("ctl_") && entries.some(e => e.name === d.name))) result.push({ line: d.line, message: d.name + " has no matching property or built-in." });
  return result;
}
function declareUniform(source, declaration) {
  const clean = stripComments(source); let at = 0;
  for (const m of clean.matchAll(/\bprecision\s+\w+\s+\w+\s*;/g)) at = m.index + m[0].length;
  if (!at) for (const m of source.matchAll(/^\s*#(?:version|extension)[^\n]*(?:\n|$)/gm)) at = m.index + m[0].length;
  return source.slice(0, at) + (at && source[at - 1] !== "\n" ? "\n" : "") + declaration + "\n" + source.slice(at);
}
function transformedMap(expanded, locations, source) {
  const before = expanded.split("\n"), after = source.split("\n"); let at = 0;
  return after.map((line, i) => {
    if (line === before[at]) return locations[at++];
    const next = before.indexOf(line, at);
    if (next >= 0 && next - at < 12) { at = next + 1; return locations[next]; }
    // Injected auxiliary declarations have no source line of their own.
    if (/^\s*uniform\b/.test(line) && after.slice(i + 1, i + 5).includes(before[at])) return locations[Math.max(0, at - 1)] || 1;
    return locations[Math.min(at++, locations.length - 1)] || 1;
  });
}
function diagnostics(log, prefixLines, map) {
  const result = [];
  for (const line of String(log || "").split("\n")) {
    const match = /(?:ERROR|WARNING):\s*\d+:(\d+)(?::|\(\d+\))\s*(.*)/.exec(line) || /\d+\((\d+)\)\s*:\s*(.*)/.exec(line);
    if (match) result.push({ line: map[Math.max(0, Number(match[1]) - prefixLines - 1)] || 1, message: match[2], severity: /^WARNING/.test(line) ? "warning" : "error" });
  }
  if (!result.length && log?.trim()) result.push({ line: 1, message: log.trim(), severity: "error" });
  return result;
}
function checkShader(gl, prepared) {
  const vertex = gl.createShader(gl.VERTEX_SHADER), fragment = gl.createShader(gl.FRAGMENT_SHADER), program = gl.createProgram();
  if (!vertex || !fragment || !program) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); if (program) gl.deleteProgram(program); throw new Error("Shader checks are unavailable while the graphics context is lost."); }
  try {
    const defines = Object.entries(prepared.defines).filter(([, v]) => v !== false).map(([k, v]) => "#define " + k + " " + v).join("\n");
    // THREE.RawShaderMaterial r91 appends a newline only to a nonempty prefix.
    const prefix = defines ? defines + "\n" : "", map = transformedMap(prepared.expanded, prepared.locations, prepared.source);
    gl.shaderSource(vertex, prefix + prepared.vertexShader); gl.compileShader(vertex);
    gl.shaderSource(fragment, prefix + prepared.source); gl.compileShader(fragment);
    const fragmentErrors = diagnostics(gl.getShaderInfoLog(fragment), prefix.split("\n").length - 1, map);
    if (!gl.getShaderParameter(vertex, gl.COMPILE_STATUS)) return [{ line: 1, severity: "error", message: "Vertex shader: " + gl.getShaderInfoLog(vertex) }];
    if (!gl.getShaderParameter(fragment, gl.COMPILE_STATUS)) return fragmentErrors.length ? fragmentErrors : [{ line: 1, severity: "error", message: "Shader compilation failed." }];
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return [{ line: 1, severity: "error", message: gl.getProgramInfoLog(program) || "Shader link failed." }];
    return fragmentErrors;
  } finally { gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); }
}
module.exports = { lint, declareUniform, transformedMap, diagnostics, checkShader };
