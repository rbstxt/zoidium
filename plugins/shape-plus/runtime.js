"use strict";
const { createModel, defaults } = require("./model.js");
const { createLayerClass, TYPE } = require("./layer.js");
const { titles } = require("./properties.js");
function gradientFacade(property, frame) {
  return new Proxy(property, { get(target, key) {
    if (key === "definition") return { ...target.definition, zoidiumControl: undefined };
    // The classic picker mutates its working array before calling set().
    // A snapshot prevents that mutation from leaking into the preceding
    // held key when editStart creates a new key at the local frame.
    if (key === "get") return () => JSON.parse(JSON.stringify(target.get(frame())));
    if (key === "set") return value => target.set(value, frame());
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
function install(context) {
  const PZ = window.PZ, THREE = window.THREE, apis = context.apis;
  const textService = require("./text-service.js").createService(context);
  const { Content } = createModel(PZ, textService), Layer = createLayerClass(PZ, THREE, Content);
  const own = cleanup => context.lifecycle.onDispose(cleanup);
  const plugin = { id: "shape-plus", name: "Shape+", version: context.plugin?.version || "1", author: "Zoidium" };
  own(apis.layers.registerType({ id: "shape-plus/shape-layer", type: TYPE, name: "Shape+", plugin, factory: () => new Layer() }));
  own(apis.layers.registerPicker({ type: TYPE, name: "Shape+", desc: "Ordered vector paths, groups, fills and strokes." }));
  const data = { type: TYPE, schemaVersion: 1, renderVersion: 1, properties: { name: "Shape+" }, effects: [], contents: defaults() };
  own(apis.media.registerPreset({ id: "shape-plus/shape-layer", name: "Shape+", icon: "shape", json: {
    assets: [], baseType: "track", data: [{ type: 0, clips: [{ type: 0, start: 0, length: 180, offset: 0, link: null, properties: { name: "Shape+" }, object: data }] }],
  } }));
  PZ.ui.objectTypes.set(Content, Object.keys(titles).map(kind => ({ type: kind, name: titles[kind], desc: "Add " + titles[kind].toLowerCase() + " to the contents." })));
  own(() => PZ.ui.objectTypes.delete(Content));
  // CM3's picker reads/writes without a frame. Supply local UI time while
  // preserving the real property identity, address, observables and history.
  own(apis.propertyControls.register("shape-plus/gradient", { type: PZ.property.type.GRADIENT, create(property) {
    const frame = () => window.CM.playback.currentFrame - property.frameOffset;
    const facade = gradientFacade(property, frame);
    return PZ.ui.controls.generateGradientInput(facade);
  } }));
  // The group is a real native dynamic.group. Its aggregate row controls all
  // channels; the ordinary child rows expose numeric editing in Objects.
  own(apis.propertyControls.register("shape-plus/path", { type: PZ.property.type.NUMBER, create(property) {
    const element = document.createElement("div"); element.className = "editbox";
    element.pz_update = () => { element.textContent = property.objects.length / 6 + " vertices"; };
    element.pz_update(); return element;
  } }));
  require("./text-controls.js").install(context);
  // Controls must exist before an enabled panel regenerates saved Path rows.
  // Reverse disposal then removes the overlay/panels before their controls.
  require("./native-ui.js").install(PZ, Layer, Content, own);
  require("./editor.js").install(context, Layer, Content);
  require("./convert-native.js").install(context, Layer);
  require("./workflow.js").install(context, Layer, Content);
}
module.exports = { install, gradientFacade };
