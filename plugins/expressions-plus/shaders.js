"use strict";
const library = require("./glsl-library.js");
const { ancestor, named } = require("./api.js");
function stripComments(source) { return source.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, ""); }
function expandIncludes(source) {
  if (!/\/\/\s*#include\s*<zoidium\//.test(source)) return source;
  const emitted = new Set();
  function expand(text, depth = 0) {
    if (depth > 8) throw new Error("Shader include nesting limit exceeded");
    let inComment = false;
    return text.split("\n").map(line => {
      const directive = !inComment && /^\s*\/\/\s*#include\s*<zoidium\/([a-z]+)>\s*\r?$/.exec(line);
      if (directive) {
        const name = directive[1];
        if (!Object.hasOwn(library, name)) throw new Error("Unknown Zoidium shader include: " + name);
        if (emitted.has(name)) return "";
        emitted.add(name);return expand(library[name], depth + 1);
      }
      // GLSL has no quoted strings, so this tracks comment delimiters without
      // treating a disabled directive inside a block comment as executable.
      for (let i = 0; i < line.length - 1; i++) {
        const pair = line.slice(i, i + 2);
        if (!inComment && pair === "//") break;
        if (!inComment && pair === "/*") { inComment = true; i++; }
        else if (inComment && pair === "*/") { inComment = false; i++; }
      }
      return line;
    }).join("\n");
  }
  return expand(source);
}
function analyze(source) {
  const expanded = expandIncludes(source), text = stripComments(expanded);
  const uniforms = [];
  const pattern = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|vec[234])\s+([A-Za-z_]\w*)\s*;/g;
  for (const match of text.matchAll(pattern)) {
    const [, type, name] = match;
    if (name === "zTime" || name === "zFrame" || name.startsWith("ctl_")) uniforms.push({ name, type, size: type.startsWith("vec") ? Number(type[3]) : 1 });
  }
  return { source: expanded, uniforms, used: expanded !== source || uniforms.length > 0 };
}
function installShaders({ PZ, THREE, store, engine, patch }) {
  const metadata = new WeakMap(), failed = new WeakMap(), reports = new Set();
  const prototype = PZ.effect.shader.prototype;
  patch(prototype, "updateFragmentShader", original => function compileWithExtensions() {
    const property = this.properties.fragShader, raw = property.get(), parsed = analyze(raw);
    if (!parsed.used) { metadata.delete(this); return original.apply(this, arguments); }
    const own = Object.getOwnPropertyDescriptor(property, "get");
    if (parsed.source !== raw) property.get = () => parsed.source;
    try { original.apply(this, arguments); }
    finally { if (own) Object.defineProperty(property, "get", own); else delete property.get; }
    metadata.set(this, parsed);
    for (const uniform of parsed.uniforms) {
      const value = uniform.size === 1 ? 0 : new THREE["Vector" + uniform.size]();
      this.pass.uniforms[uniform.name] = { type: uniform.size === 1 ? uniform.type === "int" ? "i" : "f" : "v" + uniform.size, value };
    }
  });
  patch(prototype, "update", original => function updateWithExtensions(frame) {
    const raw = this.properties.fragShader.get();
    if (failed.get(this) === raw) { this.pass.enabled = false; return; }
    try {
      const result = original.apply(this, arguments), parsed = metadata.get(this);
      if (!parsed) return result;
      const sequence = ancestor(this, n => n instanceof PZ.sequence), clip = ancestor(this, n => n instanceof PZ.clip);
      const absolute = frame + (clip?.start || 0), names = new Map();
      for (const p of sequence ? store.list(sequence) : []) {
        const name = named(p).replace(/[^A-Za-z0-9_]/g, "_");
        if (names.has(name)) throw new Error("Control names collide in shader uniform: ctl_" + name);
        names.set(name, p);
      }
      for (const uniform of parsed.uniforms) {
        let value;
        if (uniform.name === "zTime") {
          if (uniform.size !== 1) throw new Error("zTime must be a scalar shader uniform");
          value = clip ? engine.read(clip.properties.time, frame) : absolute / (sequence?.properties.rate.get() || 30);
        } else if (uniform.name === "zFrame") {
          if (uniform.size !== 1) throw new Error("zFrame must be a scalar shader uniform");value = frame;
        } else {
          const control = names.get(uniform.name.slice(4));
          if (!control) throw new Error("Shader control was not found: " + uniform.name);
          value = engine.read(control, absolute);
          if (uniform.size !== (Array.isArray(value) ? value.length : 1)) throw new Error("Shader control has the wrong dimension: " + uniform.name);
        }
        if (uniform.size === 1) this.pass.uniforms[uniform.name].value = uniform.type === "int" ? Math.trunc(Number(value)) : Number(value);
        else this.pass.uniforms[uniform.name].value.set(...value);
      }
      return result;
    } catch (error) {
      const message = "Expressions+ shader error: " + error.message;
      if (!reports.has(message)) { reports.add(message); if (reports.size > 128) reports.delete(reports.values().next().value); console.warn("[Zoidium] " + message); }
      this.onShaderError.update(message);this.pass.enabled = false;
      // Include parse errors cannot recover until source changes. Missing
      // controls can recover immediately after an ordinary control edit.
      if (/include/i.test(error.message)) failed.set(this, raw);
    }
  });
  return { analyze, expandIncludes };
}
module.exports = { analyze, expandIncludes, stripComments, installShaders };
