"use strict";
const model = require("./looks-instances.js");
const pipeline = require("./looks-passes.js");

function install(effect, PZ, THREE, Looks, legacy) {
  const tools = Looks.tools, base = { ...effect.propertyDefinitions };
  effect.looksInstances = model.empty();
  const getAsset = effect._zoidiumGetAsset.bind(effect);
  effect.looksSetInstances = function (schema, saved = {}) {
    const next = model.validate(schema, tools);
    effect._looksPipeline?.dispose();
    for (const key of Object.keys(effect.properties)) if (key.startsWith("ml_")) {
      effect.properties.remove(key); delete effect.propertyDefinitions[key];
    }
    effect.looksInstances = next;
    for (const instance of next.order) {
      const definitions = model.definitions(instance, tools, PZ);
      Object.assign(effect.propertyDefinitions, definitions);
      effect.properties.addAll(definitions);
      for (const key of Object.keys(definitions)) effect.properties[key].load(saved[key]);
    }
    effect._looksPipeline = pipeline.create(effect, THREE, tools, getAsset, makeStage);
  };
  function makeStage(instance) {
    const properties = { load() {} };
    for (const [key, definition] of Object.entries(base)) {
      properties[key] = effect.properties[model.key(instance.id, key)] || { get: () => definition.value };
    }
    properties.enabled = { get: () => 1 };
    properties.chainOrder = { get: () => JSON.stringify([instance.tool]) };
    const stage = {
      _zoidiumGetAsset: getAsset, properties, parentLayer: effect.parentLayer, parentProject: effect.parentProject,
      _looksDefaults: effect._looksDefaults, _looksPropMap: effect._looksPropMap,
      _looksToolIds: effect._looksToolIds, update: legacy.update, prepare: legacy.prepare,
      unload() { const geometry = this.pass?.quad?.geometry; legacy.unload.call(this); geometry?.dispose(); },
    };
    // load initializes uniforms and starts no asynchronous work for neutral LUTs.
    // prepare() awaits the imported LUT before a completed viewport/export draw.
    stage.loading = legacy.load.call(stage, {});
    return stage;
  }
  for (const [key, definition] of Object.entries(base)) if (key !== "enabled") {
    definition.visible = false;
  }
  effect.looksSetInstances(effect._looksSavedSchema || model.empty(), effect._looksSavedProperties);
  delete effect._looksSavedSchema; delete effect._looksSavedProperties;
  // Release the unused legacy pass and its tables, then expose one compositor
  // pass for the whole chain. Its intermediate targets remain layer-sized.
  const initialGeometry = effect.pass?.quad?.geometry;
  legacy.unload.call(effect);
  initialGeometry?.dispose();
  effect.pass = { enabled: false, needsSwap: true, clear: true, renderToScreen: false,
    uniforms: { uvScale: { value: new THREE.Vector2(1, 1) } },
    render: (...args) => effect._looksPipeline.render(...args) };
  effect.update = frame => effect._looksPipeline.update(frame);
  effect.prepare = frame => effect._looksPipeline.prepare(frame);
  effect.resize = () => {};
  effect.toJSON = () => ({ type: effect.type, properties: effect.properties, looksInstances: effect.looksInstances });
}
module.exports = { install };
