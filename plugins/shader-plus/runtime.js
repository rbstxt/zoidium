"use strict";
// Binds Shader+ kinds to CM3's Custom Shader effect. CM3 compiles first; this
// layer then adds constants, replaces the native `#define` of texture kinds
// with samplers/arrays, and overrides discrete uniforms each frame. Shaders
// without Shader+ properties are left exactly as CM3 built them.
const { KINDS, MAX_PALETTE, kindOf, items, constants, heldValue, discreteValue, MACROS } = require("./kinds.js");
const { SIZE, bakeGradient, bakeCurve, parsePalette, parseText } = require("./bake.js");
const { rasterize } = require("./text-raster.js");
const FONT_TIMEOUT_MS = 20000;

function installRuntime({ PZ, THREE, doc, patch, curves, editor, presetFont }) {
  const entries = new WeakMap(), live = new Set();
  const proto = PZ.effect.shader.prototype;

  function lutTexture() {
    const texture = new THREE.DataTexture(new Uint8Array(SIZE * 4), SIZE, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
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
    effect.fragmentShaderNeedsUpdate = true;
    doc.dispatchEvent(new CustomEvent("zoidium:asset-reloaded", { detail: { source: "shader-plus" } }));
    editor()?.project?.ui?.onChanged?.update?.();
    editor()?.mainViewport?.requestRender?.();
  }

  function entryFor(effect, property, kind) {
    let entry = entries.get(property);
    if (!entry || entry.kind !== kind) {
      if (entry) dispose(property);
      entry = { kind, key: null, effect };
      if (kind === "gradient" || kind === "curve") entry.texture = lutTexture();
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
    if (entry.fontKey === key) return entry.fontAsset;
    if (entry.fontAsset) project?.assets.unload(entry.fontAsset);
    entry.fontKey = key; entry.fontAsset = key && project ? project.assets.load(key) : null;
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
    const entry = entryFor(effect, property, kind), settings = property.definition.zoidiumShader || {};
    const value = property.get();
    if (kind === "gradient") {
      const key = JSON.stringify([value, settings.interpolation, settings.space, settings.cyclic]);
      if (entry.key !== key) { entry.texture.image.data.set(bakeGradient(value, settings)); entry.texture.needsUpdate = true; entry.key = key; }
    } else if (kind === "curve") {
      if (entry.key !== value) { entry.texture.image.data.set(bakeCurve(value, curves)); entry.texture.needsUpdate = true; entry.key = value; }
    } else if (kind === "palette") {
      if (entry.key !== value) {
        const { colors } = parsePalette(value);
        entry.vectors.forEach((v, i) => v.fromArray(colors[i] || [0, 0, 0, 0]));
        entry.count = colors.length; entry.key = value;
      }
    } else if (kind === "text" && entry.key !== value) { entry.key = value; bakeText(effect, property, entry, value); }
    return entry;
  }

  function configure(effect) {
    const uniforms = effect.pass.uniforms, defines = effect.pass.material.defines;
    let textures = false;
    for (const property of effect.customProperties) {
      const kind = kindOf(property);
      if (!kind) continue;
      const name = effect.fixPropertyName(property.properties.name.get());
      if (kind === "dropdown" || kind === "staticDropdown") Object.assign(defines, constants(name, items(property.definition)));
      if (!KINDS[kind].texture) continue;
      textures = true;
      delete defines[name];
      const entry = prepareEntry(effect, property, kind);
      if (kind === "gradient") uniforms[name] = { type: "t", value: entry.texture };
      if (kind === "curve") {
        const range = property.definition.zoidiumShader.range;
        uniforms[name] = { type: "t", value: entry.texture };
        uniforms[name + "_range"] = { type: "v2", value: new THREE.Vector2(Number(range?.[0]) || 0, Number.isFinite(Number(range?.[1])) ? Number(range[1]) : 1) };
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
    if (textures) Object.assign(defines, MACROS);
  }

  function dispose(property) {
    const entry = entries.get(property);
    if (!entry) return;
    entry.token = null;
    entry.texture?.dispose();
    if (entry.fontAsset) entry.effect?.parentProject?.assets.unload(entry.fontAsset);
    entries.delete(property); live.delete(property);
  }

  patch(proto, "updateFragmentShader", original => function updateWithShaderPlus() {
    const result = original.apply(this, arguments);
    try { configure(this); } catch (error) { report(this, error.message); }
    return result;
  });
  patch(proto, "update", original => function updateDiscreteKinds(frame) {
    const result = original.apply(this, arguments);
    const uniforms = this.pass?.uniforms;
    if (!uniforms || !this.customProperties) return result;
    for (const property of this.customProperties) {
      const kind = kindOf(property);
      if (!kind || !KINDS[kind].discrete) continue;
      const uniform = uniforms[this.fixPropertyName(property.properties.name.get())];
      if (uniform) uniform.value = discreteValue(kind, heldValue(property, frame), property.definition);
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
    dispose(property);
    return original.apply(this, arguments);
  });
  patch(proto, "unload", original => function unloadWithShaderPlus() {
    for (const property of this.customProperties || []) dispose(property);
    return original.apply(this, arguments);
  });

  return {
    configure, prepareEntry,
    entry: property => entries.get(property) || null,
    disposeAll() { for (const property of Array.from(live)) dispose(property); },
  };
}

module.exports = { installRuntime };
