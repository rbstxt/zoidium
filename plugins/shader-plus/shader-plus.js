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
  for (const path of ["./plugins/native-fx/colorcurves.css", "./plugins/shader-plus/style.css", "./plugins/shader-plus/code-window.css", "./plugins/native-fx/curve-options.css"]) {
    const style = doc.createElement("style"); style.textContent = context.getAsset("text", path); doc.head.append(style); disposers.push(() => style.remove());
  }
  const curves = shared("./material-plus/graph-curves.js");
  const register = (id, type, create) => disposers.push(context.apis.propertyControls.register(id, { type, create }));
  const controls = require("./controls.js").installControls({ PZ, doc, editor, register });
  require("./angle-control.js").registerAngle({ PZ, doc, register, commit: controls.commit });
  // Snap for native number rows. CM3's Time sample rows are bare native rows
  // that Shader+ never creates, so the opt-in check wraps generateInput
  // itself: definitions without an active snap take the original path
  // bit-for-bit, and only Shader+ kinds listed in snap.js are eligible. The
  // PZ.ui.input prototype is never touched; the created instance alone gets
  // an own-property set override for the duration of its row creation.
  const snap = require("./snap.js");
  patch(PZ.ui.controls, "generateInput", original => function generateInputWithSnap(property) {
    if (snap.isSnapActive(property?.definition)) return snap.createWithSnap(PZ, property, () => original.call(this, property));
    return original.call(this, property);
  });
  require("./texture-controls.js").installTextureControls({ PZ, doc, curves, register, commit: controls.commit });
  const runtime = require("./runtime.js").installRuntime({ PZ, THREE: win.THREE, doc, patch, curves, editor, presetFont, pipeline: context.apis.shaderPipeline, onDispose: fn => disposers.push(fn) });
  disposers.push(() => runtime.disposeAll());
  require("./font-assets.js").registerFontAssets(context, runtime);
  const codeWindows = require("./code-window.js").installCodeWindows({ context, patch, presetFont });
  const authoring = require("./editor.js").installEditor({ context, patch, presetFont });
  const api = { runtime, authoring, codeWindows };
  win.ZoidiumShaderPlus = api;
  disposers.push(() => { if (win.ZoidiumShaderPlus === api) delete win.ZoidiumShaderPlus; });
}
module.exports = { activate };
