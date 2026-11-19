"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const math = require("../plugins/native-fx/effects/fxtrans-math.js");

test("CC Pixel Polly releases its copy pass geometry after rendering before the start", async () => {
  class Resource { constructor() { this.disposed = 0; } dispose() { this.disposed++; } }
  class Material extends Resource { constructor(options) { super(); Object.assign(this, options); } }
  class Vector { set() {} copy() {} }
  class Geometry extends Resource {}
  let copy;
  const THREE = {
    ShaderMaterial: Material, Vector2: Vector, BufferGeometry: Geometry,
    Scene: class { add() {} }, OrthographicCamera: class {},
    Mesh: class { constructor(geometry, material) { this.geometry = geometry; this.material = material; } },
  };
  const effect = { _zoidiumGetAsset() {}, properties: { addAll() {}, load() {} } };
  const context = vm.createContext({ THREE, effect, PZ: { property: { type: {} } },
    ZoidiumPluginApis: { modules: { createRequire: () => () => math }, gl: {
      createCopyPass: () => (copy = { uniforms: { tDiffuse: {} }, material: new Resource(),
        quad: { geometry: new Geometry() }, render() {} }),
    } },
  });
  const source = fs.readFileSync(path.join(__dirname, "../plugins/native-fx/effects/ccpixelpolly.js"), "utf8");
  new vm.Script(`(function () { ${source}\n}).call(effect);`).runInContext(context);
  await effect.load();
  effect.pass.render({}, {}, { width: 100, height: 100, texture: {} });
  effect.unload();
  assert.equal(copy.material.disposed, 1);
  assert.equal(copy.quad.geometry.disposed, 1);
});
