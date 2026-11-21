"use strict";
// Layer Input registers its static-property define cleanup with the shared
// shader pipeline. Both the live compile and the editor checker preview must
// drop the track-token define, and the preview must not touch live state.
const test = require("node:test"), assert = require("node:assert/strict");
const path = require("node:path");
const { forHost } = require("../plugins/core/shader-pipeline.js");

const PLUGIN_ROOT = path.join(__dirname, "..", "plugins", "layer-input") + path.sep;
// Each activation reads the pipeline once, so every test starts from a fresh
// plugin module (and fresh module-level state).
function freshPlugin() {
  for (const id of Object.keys(require.cache)) if (id.startsWith(PLUGIN_ROOT)) delete require.cache[id];
  return require("../plugins/layer-input/layer-input");
}

const FRAGMENT = "uniform sampler2D Texture_1_Source;\nvoid main() { gl_FragColor = texture2D(Texture_1_Source, vUvScaled); }";

function createShaderContext() {
  const project = { traverse() {} };
  class Shader {
    constructor() {
      this.customProperties = [];
      this.pass = { uniforms: {}, material: { defines: {}, vertexShader: "vertex", fragmentShader: "" } };
    }
    // Same shape as CM3: wipe both maps, then rebuild them from the properties.
    updateFragmentShader() {
      const uniforms = {}, defines = {};
      for (const property of this.customProperties) {
        const name = this.fixPropertyName(property.properties.name.get());
        if (property.definition.dynamic) uniforms[name] = { type: "f", value: property.get() };
        else defines[name] = property.get();
      }
      uniforms.tDiffuse = { type: "t", value: null };
      this.pass.uniforms = uniforms;
      this.pass.material.defines = defines;
      this.pass.material.fragmentShader = this.properties.fragShader.get();
      this.pass.material.needsUpdate = true;
    }
    update() { this.updateFragmentShader(); }
    fixPropertyName(name) { return String(name).replace(/\s/g, "_"); }
    async load() {}
    unload() {}
  }
  const PZ = {
    effect: { shader: Shader, group: class Group {} },
    property: { type: { LIST: 10 } },
    ui: { objectTypes: { get: () => [] } },
  };
  const context = {
    editor: { project },
    PZ,
    document: {
      activeElement: null,
      createElement: () => ({ id: "", textContent: "", remove() {} }),
      getElementById: () => null,
      head: { appendChild() {} },
    },
    window: { clearTimeout, setTimeout },
    apis: {},
  };
  return { PZ, context, Shader, project };
}

function layerProperty(name, value = "") {
  return {
    definition: { name, type: 10, _zoidiumLayerSource: true, _zoidiumShaderLayerSource: true },
    properties: { name: { get: () => name } },
    get: () => value,
  };
}
function staticProperty(name, value) {
  return { definition: { name, type: 10 }, properties: { name: { get: () => name } }, get: () => value };
}
function shaderEffect(Shader, project, properties) {
  const effect = new Shader();
  effect.type = 1;
  effect.parentProject = project;
  effect.properties = { fragShader: { get: () => FRAGMENT } };
  effect.customProperties = properties;
  return effect;
}

function withTextures(run) {
  const previous = global.THREE, created = [];
  global.THREE = {
    RGBAFormat: 2, LinearFilter: 3,
    DataTexture: class DataTexture {
      constructor() { created.push(this); this.image = { data: new Uint8Array(4) }; }
      dispose() {}
    },
  };
  try { return run(created); } finally { global.THREE = previous; }
}

test("checker preview removes an empty Layer Input define and keeps unrelated defines", () => withTextures(created => {
  const { PZ, context, Shader, project } = createShaderContext(), pipeline = forHost(PZ);
  context.apis.shaderPipeline = pipeline;
  const Plugin = freshPlugin();
  Plugin.activate(context);
  try {
    const effect = shaderEffect(Shader, project, [layerProperty("Texture_1_Source"), staticProperty("Mode", "2")]);
    const liveSnapshot = JSON.stringify(effect.pass);
    const preview = pipeline.preview(effect, FRAGMENT);
    assert.deepEqual(preview.defines, { Mode: "2" });
    assert.equal(created.length, 0, "preview must not allocate a texture");
    assert.equal(JSON.stringify(effect.pass), liveSnapshot, "preview must not touch the live pass");

    effect.updateFragmentShader();
    assert.deepEqual(effect.pass.material.defines, { Mode: "2" });
    assert.equal(effect.pass.uniforms.Texture_1_Source.type, "t");
    assert.ok(effect.pass.uniforms.Texture_1_Source.value, "the live path binds the sampler uniform");
    assert.equal(created.length, 1);
  } finally {
    Plugin.deactivate();
  }
}));

test("a nonempty Layer Input token is removed from both the preview and the live defines", () => withTextures(() => {
  const { PZ, context, Shader, project } = createShaderContext(), pipeline = forHost(PZ);
  context.apis.shaderPipeline = pipeline;
  const Plugin = freshPlugin();
  Plugin.activate(context);
  try {
    const effect = shaderEffect(Shader, project, [layerProperty("Texture_1_Source", "track:id:7")]);
    assert.deepEqual(pipeline.preview(effect, FRAGMENT).defines, {});
    effect.updateFragmentShader();
    assert.deepEqual(effect.pass.material.defines, {});
    assert.equal(effect.pass.uniforms.Texture_1_Source.type, "t");
  } finally {
    Plugin.deactivate();
  }
}));

test("the cleanup stage keeps working beside a later or earlier declaration stage", () => withTextures(() => {
  for (const order of ["before", "after"]) {
    const { PZ, context, Shader, project } = createShaderContext(), pipeline = forHost(PZ);
    context.apis.shaderPipeline = pipeline;
    const other = {
      id: "shader-plus-test",
      declare() { this.pass.material.defines.Mode = 1; },
      previewDeclare() { this.pass.material.defines.Mode = 1; },
    };
    if (order === "before") pipeline.register(other);
    const Plugin = freshPlugin();
    Plugin.activate(context);
    try {
      if (order === "after") pipeline.register(other);
      const effect = shaderEffect(Shader, project, [layerProperty("Texture_1_Source")]);
      assert.deepEqual(pipeline.preview(effect, FRAGMENT).defines, { Mode: 1 }, order);
      effect.updateFragmentShader();
      assert.deepEqual(effect.pass.material.defines, { Mode: 1 }, order);
    } finally {
      Plugin.deactivate();
    }
  }
}));

test("disabling Layer Input removes the stage and re-enabling installs it once", () => withTextures(() => {
  const { PZ, context, Shader, project } = createShaderContext(), pipeline = forHost(PZ);
  context.apis.shaderPipeline = pipeline;
  const Plugin = freshPlugin();
  Plugin.activate(context);
  const effect = shaderEffect(Shader, project, [layerProperty("Texture_1_Source")]);
  try {
    assert.deepEqual(pipeline.preview(effect, FRAGMENT).defines, {});
  } finally {
    Plugin.deactivate();
  }
  assert.deepEqual(pipeline.preview(effect, FRAGMENT).defines, { Texture_1_Source: "" });
  // A second registration with the same stage id would throw.
  Plugin.activate(context);
  try {
    assert.deepEqual(pipeline.preview(effect, FRAGMENT).defines, {});
  } finally {
    Plugin.deactivate();
  }
}));

test("without a pipeline the prototype fallback still cleans live defines and restores", () => withTextures(() => {
  const { PZ, context, Shader, project } = createShaderContext();
  const nativeCompile = PZ.effect.shader.prototype.updateFragmentShader;
  const Plugin = freshPlugin();
  Plugin.activate(context);
  try {
    assert.notEqual(PZ.effect.shader.prototype.updateFragmentShader, nativeCompile);
    const effect = shaderEffect(Shader, project, [layerProperty("Texture_1_Source"), staticProperty("Mode", "2")]);
    effect.updateFragmentShader();
    assert.deepEqual(effect.pass.material.defines, { Mode: "2" });
    assert.equal(effect.pass.uniforms.Texture_1_Source.type, "t");
  } finally {
    Plugin.deactivate();
  }
  assert.equal(PZ.effect.shader.prototype.updateFragmentShader, nativeCompile);
}));
