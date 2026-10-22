"use strict";
const library = require("./glsl-library.js");
const { ancestor, named } = require("./api.js");
const pipelineCore = typeof window !== "undefined" ? window.ZoidiumShaderPipeline : require("../core/shader-pipeline.js");
const { stripComments } = pipelineCore;
function expandIncludes(source) { return pipelineCore.expandIncludes(source, library); }
function analyze(source) {
  const expanded = expandIncludes(source), text = stripComments(expanded);
  const uniforms = [];
  const pattern = /\buniform\s+(?:(?:lowp|mediump|highp)\s+)?(float|int|vec[234])\s+([^;]+);/g;
  for (const match of text.matchAll(pattern)) {
    const [, type, names] = match;
    for (const name of names.split(",").map(n => n.trim())) {
      if (/^[A-Za-z_]\w*$/.test(name) && (name === "zTime" || name === "zFrame" || name.startsWith("ctl_"))) uniforms.push({ name, type, size: type.startsWith("vec") ? Number(type[3]) : 1 });
    }
  }
  return { source: expanded, uniforms, used: expanded !== source || uniforms.length > 0 };
}
function installShaders({ PZ, THREE, store, engine, patch, pipeline = pipelineCore.forHost(PZ, patch), onDispose = () => {} }) {
  const metadata = new WeakMap(), failed = new WeakMap(), lastError = new WeakMap(), reports = new Set();
  onDispose(pipeline.registerIncludes(library));
  onDispose(pipeline.register({
    id: "expressions-plus",
    transformSource(source) {
      const parsed = analyze(source);
      metadata.set(this, parsed);
      return parsed.source;
    },
    declare() {
      const parsed = metadata.get(this);
    for (const uniform of parsed.uniforms) {
      const value = uniform.size === 1 ? 0 : new THREE["Vector" + uniform.size]();
      this.pass.uniforms[uniform.name] = { type: uniform.size === 1 ? uniform.type === "int" ? "i" : "f" : "v" + uniform.size, value };
    }
    },
    beforeUpdate() {
    const raw = this.properties.fragShader.get();
    if (failed.get(this) === raw) { this.pass.enabled = false; return false; }
      return true;
    },
    update(frame) {
      const parsed = metadata.get(this);
      if (!parsed?.used) return;
      const sequence = ancestor(this, n => n instanceof PZ.sequence), clip = ancestor(this, n => n instanceof PZ.clip);
      const absolute = frame + (clip?.start || 0), names = new Map();
      const wanted = new Set(parsed.uniforms.filter(u => u.name.startsWith("ctl_")).map(u => u.name.slice(4)));
      for (const p of sequence && wanted.size ? store.list(sequence) : []) {
        const name = named(p).replace(/[^A-Za-z0-9_]/g, "_");
        if (!wanted.has(name)) continue;
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
          if (uniform.size === 4 && Array.isArray(value) && value.length === 3 && control.definition?.zoidiumControlKind === "Color") value = [...value, 1];
          if (uniform.size !== (Array.isArray(value) ? value.length : 1)) throw new Error("Shader control has the wrong dimension: " + uniform.name);
        }
        if (uniform.size === 1) this.pass.uniforms[uniform.name].value = uniform.type === "int" ? Math.trunc(Number(value)) : Number(value);
        else this.pass.uniforms[uniform.name].value.set(...value);
      }
      lastError.delete(this);
    },
    error(error) {
      const raw = this.properties.fragShader.get();
      const message = "Expressions+ shader error: " + error.message;
      if (!reports.has(message)) { reports.add(message); if (reports.size > 128) reports.delete(reports.values().next().value); console.warn("[Zoidium] " + message); }
      if (lastError.get(this) !== message) { lastError.set(this, message); this.onShaderError.update(message); }
      this.pass.enabled = false;
      // Include parse errors cannot recover until source changes. Missing
      // controls can recover immediately after an ordinary control edit.
      if (/include/i.test(error.message)) failed.set(this, raw);
      return true;
    },
  }));
  return { analyze, expandIncludes };
}
module.exports = { analyze, expandIncludes, stripComments, installShaders };
