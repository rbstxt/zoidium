"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function host(options = {}) {
  const vertex = deferred(), fragment = deferred(), hook = deferred();
  const materials = [], passes = [], unloaded = [], reads = [], loadedProperties = [];
  const assets = {
    createFromPreset: (_type, source) => ({ source }), load: (preset) => preset,
    unload: (shader) => unloaded.push(shader),
  };
  const project = { assets };
  const effect = { parentProject: project, properties: {
    addAll() {}, load: (data) => loadedProperties.push(data),
  } };
  const context = {
    PZ: { asset: { type: { SHADER: 1 }, shader: class {
      constructor(asset) { this.asset = asset; }
      getShader() {
        const isVertex = this.asset.source.includes("vertex");
        reads.push(isVertex ? "vertex" : "fragment");
        return (isVertex ? vertex : fragment).promise;
      }
    } } },
    THREE: {
      ShaderMaterial: class {
        constructor(parameters) {
          Object.assign(this, parameters);
          this.defines = {};
          this.disposals = 0;
          materials.push(this);
        }
        dispose() { this.disposals++; }
      },
      ShaderPass: class {
        constructor(material) {
          this.material = material;
          this.uniforms = material.uniforms;
          passes.push(this);
          if (options.duringPass) options.duringPass(effect);
        }
      },
    },
  };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-apis.js", "utf8"), context);
  context.ZoidiumPluginApis.defineFilter.call(effect, {
    properties: {}, fragShaderUrl: "/filter.glsl",
    uniforms: { amount: { type: "f", value: 0.75 } }, defines: { TEST: 1 },
    onLoad: options.onLoad ? () => hook.promise : undefined,
  });
  return { effect, project, assets, vertex, fragment, hook, materials, passes, unloaded, reads, loadedProperties };
}

test("filter unloaded during vertex loading never reads the fragment or publishes resources", async () => {
  const h = host();
  const loading = h.effect.load({ properties: { stale: true } });
  h.effect.unload();
  Object.defineProperty(h.effect, "parentProject", { get() { throw new Error("detached ancestry"); } });
  h.vertex.resolve("vertex"); h.fragment.resolve("fragment");
  await loading;
  assert.deepEqual(h.reads, ["vertex"]);
  assert.equal(h.materials.length, 0);
  assert.equal(h.passes.length, 0);
  assert.equal(h.effect.pass, undefined);
  assert.equal(h.loadedProperties.length, 0);
  h.effect.unload();
  assert.equal(h.unloaded.length, 2, "shader releases use the captured owner exactly once");
});

test("filter unloaded during fragment loading never creates a material", async () => {
  const h = host();
  const loading = h.effect.load({});
  h.vertex.resolve("vertex");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.reads, ["vertex", "fragment"]);
  h.effect.unload();
  h.fragment.resolve("fragment");
  await loading;
  assert.equal(h.materials.length, 0);
  assert.equal(h.loadedProperties.length, 0);
});

test("filter moved to another project releases shaders through the original owner", async () => {
  const h = host();
  const loading = h.effect.load({});
  h.effect.parentProject = { assets: { unload() { throw new Error("wrong asset owner"); } } };
  h.vertex.resolve("vertex"); h.fragment.resolve("fragment");
  await loading;
  assert.equal(h.materials.length, 0);
  assert.equal(h.unloaded.length, 2);
});

test("filter invalidated during pass construction disposes its unpublished material", async () => {
  const h = host({ duringPass: (effect) => effect.unload() });
  h.vertex.resolve("vertex"); h.fragment.resolve("fragment");
  await h.effect.load({});
  assert.equal(h.effect.pass, undefined);
  assert.equal(h.materials[0].disposals, 1);
  assert.equal(h.loadedProperties.length, 0);
});

test("filter unloaded during onLoad does not load saved properties", async () => {
  const h = host({ onLoad: true });
  const loading = h.effect.load({});
  h.vertex.resolve("vertex"); h.fragment.resolve("fragment");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.passes.length, 1);
  h.effect.unload();
  h.hook.resolve();
  await loading;
  assert.equal(h.materials[0].disposals, 1);
  assert.equal(h.loadedProperties.length, 0);
});

test("a newer filter load keeps its pass and properties when an older continuation resumes", async () => {
  const h = host();
  const loading = h.effect.load({ properties: { generation: 1 } });
  h.effect.unload();
  const replacement = h.effect.load({ properties: { generation: 2 } });
  h.vertex.resolve("vertex"); h.fragment.resolve("fragment");
  await Promise.all([loading, replacement]);
  assert.equal(h.materials.length, 1);
  assert.deepEqual(h.loadedProperties, [{ generation: 2 }]);
  assert.equal(h.effect.pass, h.passes[0]);
  assert.equal(h.effect.pass.material.vertexShader, "vertex");
  assert.equal(h.effect.pass.material.fragmentShader, "fragment");
  assert.equal(h.effect.pass.uniforms.amount.value, 0.75);
  assert.equal(h.effect.pass.material.defines.TEST, 1);
  assert.equal(h.effect.pass.material.premultipliedAlpha, true);
  h.effect.unload(); h.effect.unload();
  assert.equal(h.materials[0].disposals, 1);
  assert.equal(h.unloaded.length, 4);
});

test("attached filter shader failures still reject the load", async () => {
  const h = host();
  const loading = h.effect.load({});
  h.vertex.reject(new Error("shader failure"));
  await assert.rejects(loading, /shader failure/);
  h.effect.unload();
});
