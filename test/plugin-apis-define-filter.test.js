"use strict";

// defineFilter disposes its ShaderMaterial exactly once on unload, even when
// the effect's own onUnload already disposed it, and tolerates a missing pass.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function host() {
  let disposeCalls = 0;
  const unloadedAssets = [];
  class ShaderMaterial {
    constructor(parameters) {
      Object.assign(this, parameters);
      this.defines = {};
    }

    dispose() {
      disposeCalls += 1;
    }
  }
  class ShaderPass {
    constructor(material) {
      this.material = material;
      this.uniforms = material.uniforms;
    }
  }
  const assets = {
    created: [],
    createFromPreset: (type, source) => ({ type, source }),
    load: (preset) => {
      assets.created.push(preset);
      return preset;
    },
    unload: (asset) => unloadedAssets.push(asset),
  };
  const context = {
    console,
    PZ: {
      asset: { type: { SHADER: 1 }, shader: class Shader { async getShader() { return "void main() {}"; } } },
      property: { type: {} },
    },
    THREE: { ShaderMaterial, ShaderPass },
  };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-apis.js", "utf8"), context);
  return {
    apis: context.ZoidiumPluginApis,
    assets,
    unloadedAssets,
    disposeCount: () => disposeCalls,
  };
}

function fakeEffect(overrides = {}) {
  return {
    properties: { addAll() {}, load() {} },
    parentProject: { assets: overrides.assets },
    parentLayer: { properties: { resolution: { get: () => [1920, 1080] } } },
    _zoidiumGetAsset: () => "void main() {}",
    shaderUrl: "/plugins/fixture/filter.glsl",
  };
}

const spec = {
  properties: { enabled: { value: 1 } },
  uniforms: {},
  fragShader: "void main() {}",
  onUnload: (effect) => effect.pass.material.dispose(),
};

test("unload disposes the filter material idempotently", async () => {
  const harness = host();
  const effect = fakeEffect({ assets: harness.assets });
  harness.apis.defineFilter.call(effect, spec);
  await effect.load({});
  effect.unload();
  assert.equal(harness.disposeCount(), 1);
  effect.unload();
  assert.equal(harness.disposeCount(), 1, "expected a repeated unload to stay disposed once");
});

test("unload without an onUnload dispose still releases the material", async () => {
  const harness = host();
  const effect = fakeEffect({ assets: harness.assets });
  harness.apis.defineFilter.call(effect, { properties: {}, uniforms: {}, fragShader: "void main() {}" });
  await effect.load({});
  effect.unload();
  assert.equal(harness.disposeCount(), 1);
});

test("unload tolerates a missing pass", async () => {
  const harness = host();
  const effect = fakeEffect({ assets: harness.assets });
  harness.apis.defineFilter.call(effect, { properties: {}, uniforms: {}, fragShader: "void main() {}" });
  await effect.load({});
  effect.pass = null;
  assert.doesNotThrow(() => effect.unload());
  assert.equal(harness.disposeCount(), 0);
});
