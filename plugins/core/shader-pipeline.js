(function (global) {
  "use strict";
  const hosts = new WeakMap();
  function stripComments(source) { return source.replace(/\/\*[\s\S]*?\*\//g, s => s.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, ""); }
  function expandIncludes(source, library, locations) {
    if (!/\/\/\s*#include\s*<zoidium\//.test(source)) { if (locations) source.split("\n").forEach((_, i) => locations.push(i + 1)); return source; }
    const emitted = new Set();
    function expand(text, depth = 0, owner = null) {
      if (depth > 8) throw new Error("Shader include nesting limit exceeded");
      let comment = false;
      return text.split("\n").map((line, index) => {
        const sourceLine = owner ?? index + 1;
        const directive = !comment && /^\s*\/\/\s*#include\s*<zoidium\/([a-z]+)>\s*\r?$/.exec(line);
        if (directive) {
          const name = directive[1];
          if (!Object.hasOwn(library, name)) throw new Error("Unknown Zoidium shader include: " + name);
          if (emitted.has(name)) { locations?.push(sourceLine); return ""; }
          emitted.add(name); return expand(library[name], depth + 1, sourceLine);
        }
        for (let i = 0; i < line.length - 1; i++) {
          const pair = line.slice(i, i + 2);
          if (!comment && pair === "//") break;
          if (!comment && pair === "/*") { comment = true; i++; }
          else if (comment && pair === "*/") { comment = false; i++; }
        }
        locations?.push(sourceLine); return line;
      }).join("\n");
    }
    return expand(source);
  }
  function forHost(PZ, patch) {
    if (hosts.has(PZ)) return hosts.get(PZ);
    const stages = new Map(), includes = Object.create(null), sources = new WeakMap();
    let includeVersion = 0;
    const proto = PZ.effect.shader.prototype;
    const wrap = patch || ((holder, key, make) => { holder[key] = make(holder[key]); });
    function handle(effect, error) {
      let handled = false;
      for (const stage of stages.values()) if (stage.error?.call(effect, error)) handled = true;
      if (!handled) throw error;
      if (effect.pass) effect.pass.enabled = false;
    }
    let compile;
    wrap(proto, "updateFragmentShader", original => compile = function compilePipeline() {
      const property = this.properties.fragShader, raw = property.get();
      let source = expandIncludes(raw, includes);
      for (const stage of stages.values()) source = stage.transformSource?.call(this, source, raw) ?? source;
      sources.set(this, source);
      const own = Object.getOwnPropertyDescriptor(property, "get");
      if (source !== raw) property.get = () => source;
      let result;
      try { result = original.apply(this, arguments); }
      finally { if (own) Object.defineProperty(property, "get", own); else delete property.get; }
      for (const stage of stages.values()) (this.zoidiumShaderPreview && stage.previewDeclare || stage.declare)?.call(this, source);
      return result;
    });
    wrap(proto, "update", original => function updatePipeline(frame) {
      try {
        for (const stage of stages.values()) if (stage.beforeUpdate?.call(this, frame) === false) return;
        const result = original.apply(this, arguments);
        for (const stage of stages.values()) stage.update?.call(this, frame, sources.get(this));
        return result;
      } catch (error) { handle(this, error); }
    });
    const api = {
      preview(effect, raw) {
        // A facade owns all compiled state. Never patch a live property or pass.
        const scratch = Object.create(effect);
        scratch.zoidiumShaderPreview = true;
        scratch.properties = { ...effect.properties, fragShader: { get: () => raw } };
        scratch.pass = { uniforms: {}, material: { defines: {} } };
        compile.call(scratch);
        const locations = [], expanded = expandIncludes(raw, includes, locations);
        return { source: sources.get(scratch), expanded, locations, defines: scratch.pass.material.defines, vertexShader: effect.pass.material.vertexShader };
      },
      register(stage) {
        if (!stage?.id || stages.has(stage.id)) throw new Error("Shader pipeline stage needs a unique id");
        stages.set(stage.id, stage);
        return () => { if (stages.get(stage.id) === stage) stages.delete(stage.id); };
      },
      registerIncludes(library) {
        for (const key of Object.keys(library)) if (Object.hasOwn(includes, key)) throw new Error("Duplicate shader include: " + key);
        Object.assign(includes, library); includeVersion++;
        return () => { for (const key of Object.keys(library)) if (includes[key] === library[key]) delete includes[key]; includeVersion++; };
      },
      get includeVersion() { return includeVersion; },
      expandIncludes: source => expandIncludes(source, includes),
      source: effect => sources.get(effect),
    };
    hosts.set(PZ, api); return api;
  }
  const api = { forHost, expandIncludes, stripComments };
  if (typeof module !== "undefined") module.exports = api;
  else global.ZoidiumShaderPipeline = api;
})(typeof window !== "undefined" ? window : globalThis);
