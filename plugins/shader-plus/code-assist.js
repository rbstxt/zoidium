"use strict";
const reference = require("./reference.js");
const { constants, items } = require("./kinds.js");
const nativeTypes = ["float", "vec2", "vec3", "vec4", "vec3"];
const keywords = "attribute const uniform varying break continue do for while if else in out inout float int void bool true false lowp mediump highp precision invariant discard return mat2 mat3 mat4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 sampler2D samplerCube struct".split(" ");
const functions = "radians degrees sin cos tan asin acos atan pow exp log exp2 log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp mix step smoothstep length distance dot cross normalize faceforward reflect refract matrixCompMult lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not texture2D texture2DProj texture2DLod texture2DProjLod textureCube textureCubeLod dFdx dFdy fwidth".split(" ");
function stripComments(source) { return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, m => m.replace(/[^\n]/g, " ")); }
function declarations(source) {
  const result = [];
  for (const m of stripComments(source).matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g)) for (const part of m[2].split(",")) {
    const match = /^\s*([A-Za-z_]\w*)\s*(\[\s*\d+\s*\])?/.exec(part);
    if (match) result.push({ name: match[1], type: m[1] + (match[2]?.replace(/\s/g, "") || ""), line: source.slice(0, m.index).split("\n").length });
  }
  return result;
}
function propertySymbols(effect) {
  return (effect?.customProperties || []).flatMap(p => {
    const name = String(p.properties.name.get()).replace(/\s/g, "_"), d = p.definition;
    const entry = reference.entries.find(e => e.category === "kind" && e.kind === d.zoidiumShader?.kind);
    const type = entry?.types[0] || (d.type === 8 ? "sampler2D" : nativeTypes[d.type] || "#define");
    const describe = (name, type, description, extra = {}) => ({ name, type, signature: type === "#define" ? "#define " + name + " value" : "uniform " + type.replace(/\[.*\]/, "") + " " + name + (type.match(/\[.*\]/)?.[0] || "") + ";", description, hint: description, example: name, id: entry?.id, ...extra });
    const result = [describe(name, type, entry?.description || (d.dynamic ? "Custom uniform" : "Custom property"), { types: entry?.types || [type], property: true, static: !d.dynamic && ![8].includes(d.type) && !entry?.types.includes("sampler2D") && entry?.kind !== "palette" })];
    for (const aux of entry?.auxiliary || []) {
      if (aux.type === "#define") for (const key of Object.keys(constants(name, items(d)))) result.push(describe(key, "#define", aux.description));
      else result.push(describe(name + aux.suffix, aux.type, aux.description));
    }
    return result;
  });
}
function symbols(effect, { expressions = false, controls = [], source = effect?.properties?.fragShader?.get?.() || "" } = {}) {
  const declared = new Map(declarations(source).map(e => [e.name, e.type]));
  const result = reference.entries.filter(e => ["builtin", "helper", "include"].includes(e.category) && e.name !== "ctl_*" && (expressions || e.provider !== "expressions-plus")).map(e => ({ ...e, type: e.category === "helper" ? e.type + "()" : e.type || "include", hint: e.include ? "// #include <" + e.include + ">" : e.description }));
  for (const entry of propertySymbols(effect)) result.push({ ...entry, type: entry.property ? declared.get(entry.name) || entry.type : entry.type });
  if (expressions) for (const p of controls) {
    const name = "ctl_" + String(p.properties.name.get()).replace(/[^A-Za-z0-9_]/g, "_"), type = nativeTypes[p.definition.type] || "float";
    result.push({ name, type, signature: "uniform " + type + " " + name + ";", description: "Expressions+ sequence control.", example: name, id: "builtin.ctl_any" });
  }
  const merged = new Map();
  for (const e of result) {
    const previous = merged.get(e.name);
    if (previous && e.category === "helper") previous.signature += "\n" + e.signature;
    else merged.set(e.name, { ...e });
  }
  return [...merged.values()];
}
function wordAt(source, at) {
  const start = at - (/[A-Za-z_0-9]*$/.exec(source.slice(0, at))?.[0].length || 0);
  const end = at + (/^[A-Za-z_0-9]*/.exec(source.slice(at))?.[0].length || 0);
  return { start, end, word: source.slice(start, end) };
}
function completions(source, at, entries) {
  const { start } = wordAt(source, at), prefix = source.slice(start, at);
  if (!/^[A-Za-z_]\w*$/.test(prefix) || !stripComments(source).slice(start, at).trim()) return [];
  const candidates = new Map();
  const add = (entry, rank) => { if (!candidates.has(entry.name)) candidates.set(entry.name, { ...entry, rank }); };
  for (const e of entries) if (e.category !== "include") add(e, e.property ? 0 : 1);
  for (const name of keywords) add({ name, description: "GLSL keyword" }, 3);
  for (const name of [...functions, "gl_FragColor", "gl_FragCoord", "gl_FrontFacing", "gl_PointCoord"]) add({ name, description: "GLSL built-in" }, 2);
  for (const name of stripComments(source).match(/[A-Za-z_]\w*/g) || []) add({ name, description: "Identifier in this source" }, 4);
  return [...candidates.values()].filter(e => e.name !== prefix && e.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => Number(!a.name.startsWith(prefix)) - Number(!b.name.startsWith(prefix)) || a.rank - b.rank || a.name.localeCompare(b.name)).slice(0, 40);
}
module.exports = { symbols, propertySymbols, completions, wordAt, declarations, stripComments };
