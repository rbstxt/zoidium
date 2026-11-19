"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { resourceCounter } = require("./helpers/resource-counter.js");

for (const id of ["radialblurspin", "colordiffkey", "advspill", "keycleaner", "linearcolorkey", "radiowaves", "beam", "ccpageturn", "radialshadow", "cardwipe"]) {
  test(`${id} releases resources after a filter render`, async () => {
    const counter = resourceCounter();
    const Geometry = counter.track(class {}, "geometry");
    const Material = counter.track(class { constructor(options) { Object.assign(this, options); this.defines = {}; } }, "material");
    class Vector { constructor(...values) { this.values = values; } clone() { return new Vector(...this.values); } set(...values) { this.values = values; return this; } }
    const THREE = { Vector2: Vector, Vector3: Vector, Vector4: Vector, ShaderMaterial: Material,
      DataTexture: counter.track(class {}, "texture"),
      ShaderPass: class { constructor(material) { this.material = material; this.uniforms = material.uniforms; this.quad = { geometry: new Geometry() }; } render(renderer) { renderer.render(this.quad); } } };
    const assets = { createFromPreset: () => ({}), load: value => value, unload() {} };
    const PZ = { property: { type: {} }, asset: { type: {}, shader: class { async getShader() { return ""; } } } };
    const effect = { parentProject: { assets }, _zoidiumGetAsset: (_type, name) => name.endsWith("fxtrans-math.js") ? fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects/fxtrans-math.js"), "utf8") : "", properties: { addAll() {}, load() {} } };
    const context = vm.createContext({ PZ, THREE, console, effect });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../zoidium/plugin-apis.js"), "utf8"), context);
    vm.runInContext(`(function(){${fs.readFileSync(path.join(__dirname, `../plugins/native-fx/effects/${id}.js`), "utf8")}\n}).call(effect)`, context);
    await effect.load();
    effect.pass.render({ render() {} });
    effect.unload();
    counter.assertDisposed();
  });
}
