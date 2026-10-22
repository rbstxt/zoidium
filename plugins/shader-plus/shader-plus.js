"use strict";
function activate(context) {
  const { PZ, window: win, document: doc } = context;
  const require = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/shader-plus/" });
  const shared = context.apis.modules.createRequire(context.getAsset, { root: "./plugins/" });
  const disposers = []; let live = true;
  context.lifecycle.onDispose(() => { live = false; for (const dispose of disposers.splice(0).reverse()) dispose(); });
  function patch(holder, key, make) {
    const original = holder[key], implementation = make(original);
    const replacement = function () { return (live ? implementation : original).apply(this, arguments); };
    holder[key] = replacement;
    disposers.push(() => { if (holder[key] === replacement) holder[key] = original; });
  }
  const editor = () => context.editor;
  const presetFont = () => "/assets/fonts/2d/bebas.ttf";
  for (const path of ["./plugins/native-fx/colorcurves.css", "./plugins/shader-plus/style.css"]) {
    const style = doc.createElement("style"); style.textContent = context.getAsset("text", path); doc.head.append(style); disposers.push(() => style.remove());
  }
  const curves = shared("./material-plus/graph-curves.js");
  require("./controls.js").installControls({ PZ, doc, curves, editor, register: (id, type, create) => disposers.push(context.apis.propertyControls.register(id, { type, create })) });
  const runtime = require("./runtime.js").installRuntime({ PZ, THREE: win.THREE, doc, patch, curves, editor, presetFont, pipeline: context.apis.shaderPipeline, onDispose: fn => disposers.push(fn) });
  disposers.push(() => runtime.disposeAll());
  const authoring = require("./editor.js").installEditor({ context, patch, presetFont });
  const api = { runtime, authoring };
  win.ZoidiumShaderPlus = api;
  disposers.push(() => { if (win.ZoidiumShaderPlus === api) delete win.ZoidiumShaderPlus; });
}
module.exports = { activate };
