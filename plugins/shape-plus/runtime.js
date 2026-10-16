"use strict";
const { createModel, defaults } = require("./model.js");
const { createLayerClass, TYPE } = require("./layer.js");
const { titles } = require("./properties.js");
function install(context) {
  const PZ = window.PZ, THREE = window.THREE, apis = context.apis;
  const { Content } = createModel(PZ), Layer = createLayerClass(PZ, THREE, Content);
  const own = cleanup => context.lifecycle.onDispose(cleanup);
  require("./native-ui.js").install(PZ, Layer, Content, own);
  require("./editor.js").install(context, Layer, Content);
  const plugin = { id: "shape-plus", name: "Shape+", version: context.plugin?.version || "1", author: "Zoidium" };
  own(apis.layers.registerType({ id: "shape-plus/shape-layer", type: TYPE, name: "Shape+", plugin, factory: () => new Layer() }));
  own(apis.layers.registerPicker({ type: TYPE, name: "Shape+", desc: "Ordered vector paths, groups, fills and strokes." }));
  const data = { type: TYPE, schemaVersion: 1, renderVersion: 1, properties: { name: "Shape+" }, effects: [], contents: defaults() };
  own(apis.media.registerPreset({ id: "shape-plus/shape-layer", name: "Shape+", icon: "shape", json: {
    assets: [], baseType: "track", data: [{ type: 0, clips: [{ type: 0, start: 0, length: 180, offset: 0, link: null, properties: { name: "Shape+" }, object: data }] }],
  } }));
  PZ.ui.objectTypes.set(Content, Object.keys(titles).map(kind => ({ type: kind, name: titles[kind], desc: "Add " + titles[kind].toLowerCase() + " to the contents." })));
  own(() => PZ.ui.objectTypes.delete(Content));
  // The group is a real native dynamic.group. Its aggregate row controls all
  // channels; the ordinary child rows expose numeric editing in the Edit tree.
  own(apis.propertyControls.register("shape-plus/path", { type: PZ.property.type.NUMBER, create(property) {
    const element = document.createElement("div"); element.className = "editbox";
    element.pz_update = () => { element.textContent = property.objects.length / 6 + " vertices"; };
    element.pz_update(); return element;
  } }));
}
module.exports = { install };
