"use strict";
// Binds Shader+ kinds to CM3's Custom Shader effect. CM3 compiles first; this
// layer then adds constants, replaces the native `#define` of texture kinds
// with samplers/arrays. Native number values stay unchanged. Shaders
// without Shader+ properties are left exactly as CM3 built them.
const { KINDS, MAX_PALETTE, kindOf, items, constants } = require("./kinds.js");
const { SIZE, CURVE_SIZE, parseCurve, parseJSON, bakeGradient, bakeCurve, parsePalette, parseText } = require("./bake.js");
const { rasterize } = require("./text-raster.js");
const { helpers, bindCurveRanges } = require("./glsl-library.js");
const FONT_TIMEOUT_MS = 20000;

function installRuntime({ PZ, THREE, doc, patch, curves, editor, presetFont, pipeline, onDispose = () => {} }) {
  const entries = new WeakMap(), live = new Set();
  const proto = PZ.effect.shader.prototype;
  // CM3 static.load treats a falsy record.value as the entire record. A
  // numeric string keeps native OPTION zero loadable in vanilla CM3 too.
  patch(PZ.property.static.prototype, "toJSON", original => function serializeStaticDropdown() {
    const data = original.apply(this, arguments);
    if (kindOf(this) === "staticDropdown" && data.value === 0) data.value = "0";
    return data;
  });
  patch(PZ.property.static.prototype, "load", original => function loadStaticDropdown(data) {
    if (kindOf(this) === "staticDropdown" && data?.value === 0) data = { ...data, value: "0" };
    return original.call(this, data);
  });

  function lutTexture(kind) {
    const size = kind === "curve" ? CURVE_SIZE : SIZE;
    const renderer = editor()?.mainViewport?.renderer;
    const half = kind === "curve" && !!renderer?.extensions?.get("OES_texture_half_float") && !!renderer.extensions.get("OES_texture_half_float_linear") && !!renderer.extensions.get("EXT_color_buffer_half_float");
    const texture = new THREE.DataTexture(half ? new Uint16Array(size * 4) : new Uint8Array(size * 4), size, 1, THREE.RGBAFormat, half ? THREE.HalfFloatType : THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
  }
  function imageTexture(data, width, height) {
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; texture.needsUpdate = true;
    return texture;
  }

  function report(effect, message) {
    const text = "Shader+: " + message;
    console.warn("[Zoidium] " + text);
    effect?.onShaderError?.update(text);
  }
  function refresh(effect) {
    doc.dispatchEvent(new CustomEvent("zoidium:asset-reloaded", { detail: { source: "shader-plus" } }));
    editor()?.project?.ui?.onChanged?.update?.();
    editor()?.mainViewport?.requestRender?.();
  }

  function entryFor(effect, property, kind) {
    let entry = entries.get(property);
    if (!entry || entry.kind !== kind) {
      if (entry) dispose(property);
      entry = { kind, key: null, effect };
      if (kind === "gradient" || kind === "curve") entry.texture = lutTexture(kind);
      if (kind === "curve") entry.range = new THREE.Vector2(0, 1);
      if (kind === "palette") { entry.vectors = Array.from({ length: MAX_PALETTE }, () => new THREE.Vector4()); entry.count = 0; }
      if (kind === "text") {
        entry.texture = imageTexture(new Uint8Array(4), 1, 1);
        entry.size = new THREE.Vector2(1, 1); entry.grid = new THREE.Vector2(1, 1); entry.aspect = 1; entry.count = 1;
      }
      entries.set(property, entry); live.add(property);
    }
    entry.effect = effect;
    return entry;
  }

  // Font asset references live inside the JSON value, so this layer owns
  // them: the project keeps an imported font while a text property uses it.
  function holdFont(entry, project, key) {
    if (entry.fontKey === key && entry.fontProject === project) return entry.fontAsset;
    if (entry.fontAsset) entry.fontProject?.assets.unload(entry.fontAsset);
    entry.fontProject = project; entry.fontKey = key; entry.fontAsset = key && project ? project.assets.load(key) : null;
    return entry.fontAsset;
  }

  function bakeText(effect, property, entry, value) {
    const options = parseText(value), project = effect.parentProject;
    const asset = holdFont(entry, project, options.font || presetFont());
    const token = entry.token = {};
    entry.pending = (async () => {
      if (!asset) throw new Error("Choose a font for " + property.properties.name.get());
      let timer;
      const font = await Promise.race([
        new PZ.asset.font(asset).getFont(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The font could not be loaded")), FONT_TIMEOUT_MS); }),
      ]).finally(() => clearTimeout(timer));
      if (entry.token !== token) return;
      const raster = rasterize(doc, font, options);
      entry.texture.dispose();
      entry.texture = imageTexture(raster.data, raster.width, raster.height);
      entry.size.set(raster.width, raster.height); entry.grid.set(raster.grid[0], raster.grid[1]);
      entry.aspect = raster.width / raster.height; entry.count = raster.count;
      refresh(effect);
    })().catch(error => { if (entry.token === token) report(effect, error.message); }).finally(() => { if (entry.token === token) entry.pending = null; });
  }

  function prepareEntry(effect, property, kind) {
    const entry = entryFor(effect, property, kind);
    const value = property.get();
    if (kind === "gradient") {
      const key = value;
      if (entry.key !== key) { entry.texture.image.data.set(bakeGradient(value)); entry.texture.wrapS = parseJSON(value).cyclic ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; entry.texture.needsUpdate = true; entry.key = key; }
    } else if (kind === "curve") {
      if (entry.key !== value) {
        const half = entry.texture.type === THREE.HalfFloatType;
        const data = bakeCurve(value, curves, half);
        if (half) for (let i = 0; i < data.length; i++) entry.texture.image.data[i] = halfBits(data[i]);
        else entry.texture.image.data.set(data);
        entry.range.fromArray(parseCurve(value, curves).range);
        entry.texture.needsUpdate = true; entry.key = value;
      }
    } else if (kind === "palette") {
      if (entry.key !== value) {
        const { colors } = parsePalette(value);
        entry.vectors.forEach((v, i) => v.fromArray(colors[i] || [0, 0, 0, 0]));
        entry.count = colors.length; entry.key = value;
      }
    } else if (kind === "text" && entry.key !== value) { entry.key = value; bakeText(effect, property, entry, value); }
    return entry;
  }

  function configure(effect, source = pipeline.source(effect) || "") {
    const uniforms = effect.pass.uniforms, defines = effect.pass.material.defines;
    const referenced = new Set(source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ").match(/[A-Za-z_]\w*/g) || []);
    for (const property of effect.customProperties) {
      const kind = kindOf(property);
      if (!kind) continue;
      const name = effect.fixPropertyName(property.properties.name.get());
      if (kind === "dropdown" || kind === "staticDropdown") {
        for (const [key, index] of Object.entries(constants(name, items(property.definition)))) if (referenced.has(key)) defines[key] = index;
      }
      if (!KINDS[kind].texture) continue;
      delete defines[name];
      const entry = prepareEntry(effect, property, kind);
      if (kind === "gradient") uniforms[name] = { type: "t", value: entry.texture };
      if (kind === "curve") {
        uniforms[name] = { type: "t", value: entry.texture };
        uniforms[name + "_range"] = { type: "v2", value: entry.range };
      }
      if (kind === "palette") {
        uniforms[name] = { type: "v4v", value: entry.vectors };
        uniforms[name + "_count"] = { type: "i", value: entry.count };
      }
      if (kind === "text") {
        uniforms[name] = { type: "t", value: entry.texture };
        uniforms[name + "_size"] = { type: "v2", value: entry.size };
        uniforms[name + "_grid"] = { type: "v2", value: entry.grid };
        uniforms[name + "_aspect"] = { type: "f", value: entry.aspect };
        uniforms[name + "_count"] = { type: "f", value: entry.count };
      }
    }
  }

  function dispose(property) {
    const entry = entries.get(property);
    if (!entry) return;
    entry.token = null;
    entry.texture?.dispose();
    if (entry.fontAsset) entry.fontProject?.assets.unload(entry.fontAsset);
    entries.delete(property); live.delete(property);
  }

  onDispose(pipeline.registerIncludes(helpers));
  onDispose(pipeline.register({
    id: "shader-plus",
    transformSource(source) {
      const names = new Set();
      for (const p of this.customProperties || []) if (kindOf(p) === "curve") names.add(this.fixPropertyName(p.properties.name.get()));
      return names.size ? bindCurveRanges(source, names) : source;
    },
    declare(source) { configure(this, source); },
    update() {
      // Native NUMBER/VECTOR values are never overridden here.
      for (const property of this.customProperties || []) {
        const kind = kindOf(property);
        if (!kind || !KINDS[kind].texture) continue;
        const entry = prepareEntry(this, property, kind);
        const name = this.fixPropertyName(property.properties.name.get());
        if (kind === "text" && this.pass.uniforms[name]) {
          this.pass.uniforms[name].value = entry.texture;
          this.pass.uniforms[name + "_aspect"].value = entry.aspect;
          this.pass.uniforms[name + "_count"].value = entry.count;
        }
        if (kind === "palette" && this.pass.uniforms[name + "_count"]) this.pass.uniforms[name + "_count"].value = entry.count;
      }
    },
  }));
  const changed = new Map();
  patch(proto, "propertyAdded", original => function addShaderProperty(property) {
    const result = original.apply(this, arguments);
    const kind = kindOf(property);
    if (kind && KINDS[kind].texture) {
      property.onChanged.unwatch(this.updateFn);
      const update = () => { prepareEntry(this, property, kindOf(property)); refresh(this); };
      changed.set(property, { update, effect: this }); property.onChanged.watch(update);
    }
    return result;
  });
  // Exports await font loading so the first frame never misses its text.
  patch(proto, "prepare", original => async function prepareWithShaderPlus() {
    await original.apply(this, arguments);
    for (const property of this.customProperties || []) {
      if (kindOf(property) !== "text") continue;
      prepareEntry(this, property, "text");
      await entries.get(property)?.pending;
    }
  });
  patch(proto, "load", original => async function loadWithShaderPlus() {
    const result = await original.apply(this, arguments);
    for (const property of this.customProperties || []) {
      if (kindOf(property) === "text") holdFont(entryFor(this, property, "text"), this.parentProject, parseText(property.get()).font || presetFont());
    }
    return result;
  });
  patch(proto, "propertyRemoved", original => function propertyRemovedWithShaderPlus(property) {
    if (changed.has(property)) property.onChanged.unwatch(changed.get(property).update);
    changed.delete(property); dispose(property);
    return original.apply(this, arguments);
  });
  patch(proto, "unload", original => function unloadWithShaderPlus() {
    for (const property of this.customProperties || []) {
      if (changed.has(property)) property.onChanged.unwatch(changed.get(property).update);
      changed.delete(property); dispose(property);
    }
    return original.apply(this, arguments);
  });

  return {
    configure, prepareEntry,
    entry: property => entries.get(property) || null,
    disposeAll() {
      for (const [property, { update, effect }] of changed) {
        property.onChanged.unwatch(update); property.onChanged.watch(effect.updateFn); effect.fragmentShaderNeedsUpdate = true;
      }
      changed.clear();
      for (const property of Array.from(live)) { entries.get(property).effect.fragmentShaderNeedsUpdate = true; dispose(property); }
    },
  };
}

// Samples are normalized, so this finite 0..1 conversion covers every LUT.
function halfBits(value) {
  if (value <= 0) return 0;
  if (value < Math.pow(2, -14)) return Math.round(value / Math.pow(2, -24));
  const exponent = Math.floor(Math.log2(value));
  return ((exponent + 15) << 10) + Math.round((value / Math.pow(2, exponent) - 1) * 1024);
}
module.exports = { installRuntime, halfBits };
