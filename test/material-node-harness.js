"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
function pluginApis() {
  const context = { PZ: {}, console };
  for (const name of ["random", "props", "color", "gl", "json", "windows"]) {
    vm.runInNewContext(fs.readFileSync("zoidium/shared/" + name + ".js", "utf8"), context);
  }
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-apis.js", "utf8"), context);
  return context.ZoidiumPluginApis;
}
function harness() {
  class Vector { constructor(...v) { this.set(...v); } set(...v) { this.values = v; return this; } }
  class Color { setRGB(...v) { this.values = v; return this; } }
  class Texture { constructor(image) { this.image = image; for (const k of ["repeat", "offset", "center"]) this[k] = new Vector(); } dispose() { this.disposed = true; } }
  class Physical { constructor(options) { Object.assign(this, options); this.color = new Color(); this.emissive = new Color(); this.normalScale = new Vector(); this.defines = {}; } dispose() { this.disposed = true; } }
  const THREE = { FrontSide: 0, BackSide: 1, DoubleSide: 2, EquirectangularReflectionMapping: 303, MeshPhysicalMaterial: Physical, MeshStandardMaterial: Physical, MeshBasicMaterial: Physical, Vector2: Vector, Vector3: Vector, CanvasTexture: Texture, DataTexture: class extends Texture { constructor(data) { super({ data }); } }, LinearFilter: 1006, LinearMipMapLinearFilter: 1008, ClampToEdgeWrapping: 1, RepeatWrapping: 2, MirroredRepeatWrapping: 3 };
  const PZ = { property: { type: Object.fromEntries(["TEXT", "GRADIENT", "NUMBER", "OPTION", "COLOR", "VECTOR2", "VECTOR3", "ASSET"].map(k => [k, k])) }, asset: { type: { IMAGE: "image" }, image: class { constructor(asset) { this.asset = asset; this.loading = Promise.resolve(); } getTexture() { return new Texture(); } getImage() { return { width: 8, height: 8 }; } } }, material: { fnList: {} } };
  const document = { createElement() { const canvas = { width: 0, height: 0 }; canvas.getContext = () => ({ createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; }, putImageData(image) { canvas.data = image.data.slice(); }, drawImage() {}, getImageData() { return { data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }; } }); return canvas; } };
  const dispose = [], editors = [], panels = [];
  const context = { PZ, window: { PZ, THREE, document, setTimeout: fn => fn() }, document, plugin: { id: "material-plus", version: "6" }, lifecycle: { onDispose(fn) { dispose.push(fn); } }, apis: pluginApis(), getAsset(type, name) { return fs.readFileSync(name.replace(/^\.\//, "").split("?")[0], "utf8"); }, ui: { refreshEditors() {}, registerEditor(spec) { editors.push(spec); }, registerAttributePanel(spec) { panels.push(spec); } } };
  const unloaded = [];
  function material(type) {
    const material = { type, parentProject: { assets: { load: key => ({ key }), unload: asset => unloaded.push(asset) }, sequence: { properties: { rate: { get: () => 30 } } } }, parentLayer: {} };
    material.properties = { addAll(defs) { for (const [key, def] of Object.entries(defs)) {
      const value = def.group ? def.objects.map(o => o.value) : def.value;
      this[key] = { ...def, value, parentObject: material, _loaded: !def.dynamic, get() { if (!this._loaded) throw new Error("Dynamic property read before native load"); return this.value; }, set(value) { this._loaded = true; this.value = value; def.changed?.call(this); } };
    } }, load(data) { for (const value of Object.values(this)) if (value && typeof value === "object" && "_loaded" in value) value._loaded = true; if (data) for (const [key, value] of Object.entries(data)) this[key]?.set(value); } };
    material.properties.toJSON = function () {
      return Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value?.get === "function")
        .map(([key, property]) => [key, property.value]));
    };
    return material;
  }
  return { context, PZ, material, dispose, editors, panels, unloaded };
}
module.exports = { harness, pluginApis };
