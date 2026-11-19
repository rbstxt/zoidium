"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("Drop Shadow releases the GPU resources created by each load", async () => {
  const resources = [];
  class Resource {
    constructor() { this.disposed = 0; resources.push(this); }
    dispose() { this.disposed++; }
  }
  class Material extends Resource {
    constructor(options) { super(); Object.assign(this, options); this.defines = {}; }
    clone() { return new Material({ uniforms: this.uniforms }); }
  }
  class Geometry extends Resource {}
  class Target extends Resource {}
  class ShaderPass {
    constructor(material) { this.material = material; this.uniforms = material.uniforms; this.quad = { geometry: new Geometry() }; }
  }
  class Vector { set() {} copy() {} }
  const THREE = {
    ShaderMaterial: Material, ShaderPass, Vector2: Vector, Vector3: Vector,
    OrthographicCamera: class {}, Scene: class { add() {} },
    Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; } },
    PlaneBufferGeometry: Geometry,
  };
  const PZ = {
    property: { type: { OPTION: 1, COLOR: 2, NUMBER: 3 } },
    asset: { type: { SHADER: 1 }, shader: class { async getShader() { return "shader"; } } },
  };
  const effect = {
    properties: { addAll() {}, load() {} },
    parentProject: { assets: { createFromPreset() {}, load() {}, unload() {} } },
  };
  const context = vm.createContext({ THREE, PZ, effect,
    ZoidiumPluginApis: { gl: { createRenderTarget: () => new Target() } } });
  const source = fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects/dropshadow.js"), "utf8");
  new vm.Script(`(function () { ${source}\n}).call(effect);`).runInContext(context);
  await effect.load();
  effect.unload();
  assert.equal(resources.length, 9);
  assert.ok(resources.every((resource) => resource.disposed === 1),
    `undisposed resources: ${resources.filter((resource) => !resource.disposed).length}`);
});
