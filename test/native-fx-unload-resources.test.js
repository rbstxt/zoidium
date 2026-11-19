"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { resourceCounter } = require("./helpers/resource-counter.js");

for (const filename of ["echo", "timeremap", "timedifference", "timedisplacement", "ccwidetime"]) {
  test(`${filename} releases both shader passes after rendering`, async () => {
    const counter = resourceCounter();
    const Geometry = counter.track(class {}, "pass geometry");
    const Material = counter.track(class { constructor(options) { Object.assign(this, options); } }, "material");
    class Vector2 { set() { return this; } copy() { return this; } }
    const uniforms = { uvScale: { value: new Vector2() }, uvOffset: { value: new Vector2() },
      opacity: { value: 1 }, tDiffuse: { value: null } };
    const THREE = {
      Vector2, ShaderMaterial: Material, CopyShader: { uniforms, vertexShader: "", fragmentShader: "" },
      UniformsUtils: { clone: () => ({ uvScale: { value: new Vector2() }, uvOffset: { value: new Vector2() },
        opacity: { value: 1 }, tDiffuse: { value: null } }) },
      ShaderPass: class { constructor(material) { this.material = material; this.uniforms = material.uniforms; this.quad = { geometry: new Geometry() }; } render() {} },
    };
    let lifecycle;
    const apis = {
      defineFrameSampler(spec) { lifecycle = spec.lifecycle; },
      defineTemporal() {}, installFrameSamplerContext() {},
      modules: { createRequire: () => (file) => require(path.join("../plugins/native-fx/time-remap", file)) },
    };
    const effect = { _zoidiumGetAsset: () => "void main() {}", properties: { load() {}, source: { get: () => "" } } };
    const PZ = { property: { type: {} }, asset: { type: {} } };
    const source = fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects", `${filename}.js`), "utf8");
    new Function("PZ", "THREE", "ZoidiumPluginApis", source).call(effect, PZ, THREE, apis);
    await lifecycle.load();
    effect.pass.render({}, {}, { texture: {}, width: 1, height: 1 });
    lifecycle.unload();
    lifecycle.unload();
    counter.assertDisposed();
  });
}

for (const filename of ["timeoffset", "posterizetime"]) {
  test(`${filename} evaluates without allocating render resources`, () => {
    const vm = require("node:vm");
    const counter = resourceCounter();
    const THREE = new Proxy({}, { get(_target, name) { return counter.track(class {}, String(name)); } });
    const effect = { properties: { addAll(definitions) { for (const [name, definition] of Object.entries(definitions)) this[name] = { get: () => definition.value }; }, load() {} } };
    const context = vm.createContext({ PZ: { property: { type: {} } }, THREE, effect });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../zoidium/plugin-apis.js"), "utf8"), context);
    vm.runInContext(`(function(){${fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects", `${filename}.js`), "utf8")}\n}).call(effect)`, context);
    effect.load();
    effect.update(0);
    effect._zoidiumTemporal.getOperator(effect, 0);
    effect.unload();
    counter.assertDisposed();
  });
}
