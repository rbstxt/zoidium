"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite } = require("./trapcode-env.js");

for (const [file, type] of [["particular.js", "particular"], ["form.js", "form"]]) {
  test(`${type} releases consumer textures on replacement and unload`, () => {
    const { PZ } = loadSuite(["trapcode-common.js", file]);
    const prototype = type === "particular" ? PZ.object3d.particular.system.prototype : PZ.object3d.form.instance.prototype;
    let value = "first";
    const textures = [];
    const released = [];
    const project = { assets: { load: key => ({ key }), unload: image => released.push(image.asset.key) } };
    PZ.trapcode.findParent = () => project;
    PZ.asset.image = class {
      constructor(asset) { this.asset = asset; }
      getTexture() {
        const texture = { disposed: 0, dispose() { this.disposed++; } };
        textures.push(texture);
        return texture;
      }
    };
    const instance = {
      properties: { particle: { texture: { get: () => value } } },
      material: { uniforms: { image: { value: null } }, dispose() {} },
      _assets: { clear() {} },
    };
    prototype.redrawTexture.call(instance);
    value = "second";
    prototype.redrawTexture.call(instance);
    assert.equal(textures[0].disposed, 1);
    assert.equal(textures[1].disposed, 0);
    prototype.unload.call(instance);
    assert.equal(textures[1].disposed, 1);
    assert.equal(instance.material.uniforms.image.value, null);
    assert.deepEqual(released, ["first", "second"]);
    prototype.unload.call(instance);
    assert.equal(textures[1].disposed, 1);
  });
}

test("Particular disposes each layer-map texture independently of its decoded asset", () => {
  const { PZ } = loadSuite(["trapcode-common.js", "particular.js"]);
  const prototype = PZ.object3d.particular.system.prototype;
  let disposed = 0;
  PZ.trapcode.findParent = () => ({ assets: { load: key => ({ key }), unload() {} } });
  PZ.asset.image = class {
    getTexture() { return { dispose: () => disposed++ }; }
  };
  const instance = { material: { uniforms: { layerColor: { value: null }, layerSize: { value: null } }, dispose() {} } };
  prototype.loadLayerTexture.call(instance, { get: () => "color" }, "layerColorTex", "layerColor");
  prototype.loadLayerTexture.call(instance, { get: () => "size" }, "layerSizeTex", "layerSize");
  prototype.loadLayerTexture.call(instance, { get: () => "replacement" }, "layerColorTex", "layerColor");
  assert.equal(disposed, 1);
  prototype.unload.call(instance);
  assert.equal(disposed, 3);
});
