"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { managerSource } = require("./plugin-manager-source");
const { loadSharedTables } = require("./shared-test-apis");
const root = path.resolve(__dirname, "..");

function fixture() {
  const unloaded = [];
  const images = [];
  const passes = [];
  class Vector {
    constructor(...values) { this.set(...values); }
    set(...values) { this.values = values; return this; }
    copy(other) { this.values = other.values.slice(); return this; }
  }
  class Texture {
    constructor() { this.image = { width: 32, height: 16 }; this.disposed = 0; }
    dispose() { this.disposed += 1; }
  }
  class Material {
    constructor(options) { Object.assign(this, options); }
    dispose() {}
  }
  class Pass {
    constructor(material) { this.material = material; this.uniforms = material.uniforms; }
    render() { passes.push({ map: this.uniforms.tMap?.value, source: this.uniforms.tSource?.value }); }
  }
  class Image {
    constructor(asset) { this.asset = asset; this.texture = new Texture(); this.loading = Promise.resolve(); images.push(this); }
    getTexture(flag) { assert.equal(flag, true); return this.texture; }
  }
  const THREE = {
    Vector2: Vector, Vector3: Vector, Matrix3: Vector, ShaderMaterial: Material,
    MeshBasicMaterial: Material, ShaderPass: Pass, DataTexture: Texture,
    LinearFilter: 1006, NoBlending: 0,
    CopyShader: {}, UniformsUtils: { clone: () => ({
      uvScale: { value: new Vector(1, 1) }, uvOffset: { value: new Vector(0, 0) }, opacity: { value: 1 },
    }) },
  };
  const project = { assets: { load: (key) => ({ key }), unload: (image) => unloaded.push(image) }, sequence: {} };
  const PZ = { asset: { type: { IMAGE: 1 }, image: Image }, property: { type: { LIST: 20, ASSET: 30 } }, zoidium: {} };
  const sandbox = { console, PZ, THREE, Uint8Array, module: { exports: {} }, require, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  const apis = { ...loadSharedTables(), defineFrameSampler(spec) {
    this.properties.addAll(spec.properties);
    Object.assign(this, spec.lifecycle);
  } };
  apis.gl = { createRenderTarget: (_three, width, height) => ({ width, height, texture: {}, dispose() {} }),
    sameSize: (target, width, height) => target?.width === width && target?.height === height };
  sandbox.ZoidiumPluginApis = apis;
  const state = { PZ, consumers: new Set(), contextStack: [], editor: { project } };
  function factory(file) {
    sandbox.module = { exports: {} };
    sandbox.require = (id) => id === "./layer-input-state.js" ? require("../plugins/layer-input/layer-input-state") : require(id);
    vm.runInContext(`(function () { ${fs.readFileSync(path.join(root, "plugins/layer-input", file), "utf8")}\n})();`, sandbox);
    return sandbox.module.exports;
  }
  const deps = {};
  Object.assign(deps, factory("layer-input-render.js")(state, deps));
  Object.assign(deps, {
    getSourceProperties: (consumer) => consumer.properties?.source ? [consumer.properties.source] : [],
    getConsumerTrack: () => null, getSourceProperty: (consumer) => consumer.properties?.source,
    setConsumerSource() {},
    readNumericProperty: (property, frame, fallback) => property?.get(frame) ?? fallback,
  });
  PZ.layerInput = { ...deps, setSource: deps.setConsumerSource, resolveEffect: deps.resolveConsumer };
  state.api = PZ.layerInput;
  function object(type) {
    const result = { type, parentProject: project, _zoidiumGetAsset: () => "shader" };
    const properties = result.properties = {
      addAll(definitions) {
        for (const [key, definition] of Object.entries(definitions)) {
          const property = { definition, parentObject: result, value: definition.value,
            get() { return this.value; },
            set(value) { this.value = value; definition.changed?.call(this); },
            toJSON() { return this.value; },
          };
          this[key] = property;
        }
      },
      load(data) { for (const [key, value] of Object.entries(data || {})) this[key]?.set(value); },
      toJSON() { return Object.fromEntries(Object.entries(this).filter(([, p]) => p?.get).map(([key, p]) => [key, p.get()])); },
    };
    return result;
  }
  function effect(file, type) {
    const effect = object(type);
    sandbox.effect = effect;
    const source = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInContext(`(function () { ${source}\n}).call(effect);`, sandbox);
    return effect;
  }
  return { PZ, project, effect, object, unloaded, images, passes,
    materialFactory: () => factory("layer-input-host.js")(state, deps).createLayerSourceMaterialFactory(), deps };
}

for (const [name, filename] of [
  ["Time Displacement", "plugins/native-fx/effects/timedisplacement.js"],
  ["Layer Input", "plugins/layer-input/layer-input-effect.js"],
  ["Layer Input Displacement Map", "plugins/layer-input/layer-input-displacement-effect.js"],
  ["Layer Source", null],
]) {
  test(`${name}: legacy source defaults and native image asset lifecycle`, async () => {
    const f = fixture();
    const consumer = filename ? f.effect(filename, name) : f.object("layersource");
    if (!filename) f.materialFactory().call(consumer);
    if (name === "Time Displacement") delete f.PZ.layerInput;
    await consumer.load({ properties: {} });
    assert.equal(consumer.properties.source.get(), "");
    assert.equal(consumer.properties.sourceImage.get(), null);
    assert.equal(f.images.length, 0, "loading an old project creates no image resource");
    assert.equal(consumer.properties.sourceImage.definition.assetType, f.PZ.asset.type.IMAGE);
    assert.equal(consumer.properties.sourceImage.definition.accept, "image/*");
    const items = consumer.properties.source.definition.items;
    assert.ok(items.some((item) => item.name === "Image" && item.value === "image"));
    const input = { width: 320, height: 180, texture: { name: "current-layer" } };
    if (name === "Time Displacement") {
      f.PZ.zoidium.temporal = { resolveFrameSamples: () => [{ index: 0, texture: {} }] };
    }
    function render() {
      consumer.update(0);
      if (consumer.pass) consumer.pass.render({}, {}, input);
    }
    render();
    const oldMap = consumer._zoidiumTimeDisplacementPass?.uniforms.tMap.value;
    consumer.properties.source.set("image");
    render();
    if (name === "Time Displacement") assert.equal(consumer._zoidiumTimeDisplacementPass.uniforms.tMap.value, oldMap);
    else if (consumer.pass) assert.equal(consumer.pass.uniforms.sourceReady.value, 0);
    else assert.equal(consumer.threeObj.opacity, 0);
    consumer.properties.sourceImage.set("first-image");
    const first = f.images[0];
    await consumer.prepare(0);
    render();
    const texture = consumer.pass
      ? (consumer._zoidiumTimeDisplacementPass?.uniforms.tMap.value || consumer.pass.uniforms.tSource.value)
      : consumer.threeObj.map;
    assert.equal(texture, first.texture);
    assert.equal(texture.minFilter, 1006);
    assert.equal(texture.generateMipmaps, false);
    assert.equal(JSON.parse(JSON.stringify(consumer.toJSON())).properties.sourceImage, "first-image");
    consumer.properties.sourceImage.set("second-image");
    assert.equal(f.unloaded[0], first);
    assert.equal(first.texture.disposed, 1);
    const second = f.images[1];
    consumer.properties.sourceImage.set(null);
    assert.equal(f.unloaded[1], second);
    assert.equal(second.texture.disposed, 1);
    consumer.properties.sourceImage.set("third-image");
    const third = f.images[2];
    consumer.unload();
    assert.equal(f.unloaded[2], third);
    assert.equal(third.texture.disposed, 1);
  });
}

test("Time Displacement reverts its action sentinel on decline and approval", async () => {
  for (const approved of [false, true]) {
    const f = fixture();
    const effect = f.effect("plugins/native-fx/effects/timedisplacement.js", "timedisplacement");
    delete f.PZ.layerInput;
    await effect.load();
    effect.properties.source.set("image");
    let requests = 0;
    let registrations = 0;
    let finish;
    f.PZ.zoidium.requestPlugin = async (id, reason) => {
      assert.equal(id, "layer-input");
      assert.match(reason, /another layer/);
      requests += 1;
      await new Promise((resolve) => { finish = resolve; });
      if (approved) f.PZ.layerInput = {
        getSourceOptions: () => [{ value: "track:id:second" }],
        registerConsumer: (consumer) => { assert.equal(consumer, effect); registrations += 1; },
      };
      return approved;
    };
    effect.properties.source.set("other-layer");
    assert.equal(effect.properties.source.get(), "image", "the temporary action cannot enter project data");
    effect.properties.source.set("other-layer");
    assert.equal(requests, 1, "repeated clicks share the pending request");
    finish();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(effect._zoidiumSourceRequest, false);
    assert.equal(effect.properties.source.get(), "image");
    assert.equal(Boolean(f.PZ.layerInput), approved);
    assert.equal(registrations, approved ? 1 : 0);
  }
});

test("requestPlugin confirms experimental activation and refreshes editors only on success", async () => {
  const source = managerSource();
  const start = source.indexOf("  async function requestPlugin(");
  const end = source.indexOf("  async function disablePlugin(", start);
  for (const approved of [false, true]) {
    let enabled = false;
    let confirms = 0;
    let refreshes = 0;
    const state = { plugin: { name: "Layer Input", category: "experimental" } };
    const sandbox = {
      manager: { registryReady: Promise.resolve() }, pluginStates: new Map([["layer-input", state]]),
      pluginIsEnabled: () => enabled,
      enablePlugin: async (requested, persist) => { assert.equal(requested, state); assert.equal(persist, true); enabled = true; },
      ZoidiumUI: { confirm: async (options) => {
        confirms += 1;
        assert.match(options.message, /needs another layer/);
        assert.match(options.message, /This feature is extremely experimental and may cause unexpected crashes\./);
        return approved;
      } },
      document: { querySelectorAll: () => [{ isConnected: true, pz_listChanged: () => { refreshes += 1; } }] },
    };
    const request = vm.runInNewContext(source.slice(start, end) + "\nrequestPlugin", sandbox);
    assert.equal(await request("unknown"), false);
    assert.equal(await request("layer-input", "Time Displacement needs another layer."), approved);
    assert.equal(enabled, approved);
    assert.equal(refreshes, approved ? 1 : 0);
    if (approved) assert.equal(await request("layer-input"), true);
    assert.equal(confirms, 1);
  }
});
