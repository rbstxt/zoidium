"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { resourceCounter } = require("./helpers/resource-counter.js");

for (const id of ["radialblurspin", "colordiffkey", "advspill", "keycleaner", "linearcolorkey", "radiowaves", "beam", "ccpageturn", "radialshadow", "cardwipe", "colorcurves", "numbers", "timecode"]) {
  test(`${id} releases resources after a filter render`, async () => {
    const counter = resourceCounter();
    const Geometry = counter.track(class {}, "geometry");
    const Material = counter.track(class { constructor(options) { Object.assign(this, options); this.defines = {}; } }, "material");
    class Vector { constructor(...values) { this.values = values; } clone() { return new Vector(...this.values); } set(...values) { this.values = values; return this; } }
    const THREE = { Vector2: Vector, Vector3: Vector, Vector4: Vector, ShaderMaterial: Material,
      DataTexture: counter.track(class { constructor(data, width, height) { this.image = { data, width, height }; } }, "texture"),
      ShaderPass: class { constructor(material) { this.material = material; this.uniforms = material.uniforms; this.quad = { geometry: new Geometry() }; } render(renderer) { renderer.render(this.quad); } } };
    const assets = { createFromPreset: () => ({}), load: value => value, unload() {} };
    const PZ = { ui: { controls: { generateTextInput() {} } }, property: { type: { TEXT: 7 } }, asset: { type: {}, shader: class { async getShader() { return ""; } } } };
    const effect = { parentProject: { assets }, parentLayer: { properties: { resolution: { get: () => [32, 24] } } },
      _zoidiumGetAsset: (_type, name) => {
        const relative = String(name).replace(/^\.?\//, "").split("?")[0];
        const file = path.join(__dirname, "..", relative);
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      },
      properties: { addAll(definitions) { for (const [key, def] of Object.entries(definitions)) this[key] = { get: () => def.group ? def.objects.map(item => item.value) : def.value }; }, load() {} } };
    const context = vm.createContext({ PZ, THREE, console, effect });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../zoidium/plugin-apis.js"), "utf8"), context);
    vm.runInContext(`(function(){${fs.readFileSync(path.join(__dirname, `../plugins/native-fx/effects/${id}.js`), "utf8")}\n}).call(effect)`, context);
    await effect.load();
    if (["colorcurves", "numbers", "timecode"].includes(id)) effect.update(0);
    effect.pass.render({ render() {} });
    effect.unload();
    counter.assertDisposed();
  });
}
