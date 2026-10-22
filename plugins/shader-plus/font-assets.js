"use strict";
const { parseText, parseJSON } = require("./bake.js");
function registerFontAssets(context, runtime) {
  const { PZ, editor } = context, api = context.apis.assets;
  if (!api?.registerReferences) return;
  function visit(project, fn) {
    project.forEachItemOfType(PZ.property, p => { if (p.definition.zoidiumShader?.kind === "text") fn(p); });
  }
  function change(oldKey, newKey) {
    const ops = new PZ.ui.properties(editor);
    visit(editor.project, p => {
      if (parseText(p.get()).font === oldKey) ops.setValue({ property: p.getAddress(), value: JSON.stringify({ ...parseJSON(p.get()), font: newKey }) });
    });
  }
  function stored(value, path, composition, emit) {
    if (!value || typeof value !== "object") return;
    if (value.type?.zoidiumShader?.kind === "text") {
      const key = parseText(value.value).font;
      if (key) emit({ key, path: path.concat(value.properties?.name || "Text"), composition, revealable: false, assetType: PZ.asset.type.FONT });
    }
    for (const child of Object.values(value)) if (child && typeof child === "object") stored(child, path, composition, emit);
  }
  context.lifecycle.onDispose(api.registerReferences({
    id: "shader-plus/fonts", label: "Shader+ text fonts",
    collect(project, emit) {
      visit(project, p => {
        const key = parseText(p.get()).font;
        if (key) emit({ key, path: [p.parentObject?.properties?.name?.get() || "Shader", p.properties.name.get()], owner: p.parentObject, property: p, address: p.getAddress(), assetType: PZ.asset.type.FONT, revealable: true });
      });
      if (editor.project === project) for (const source of PZ.precomp?.referenceSources?.(editor) || []) {
        if (!source.editing) stored(source.tracks, ['Comp "' + source.name + '"'], { id: source.id, name: source.name }, emit);
      }
    },
    replace: change,
    clear: key => change(key, null),
    reload: key => runtime.reloadFont(key),
  }));
}
module.exports = { registerFontAssets };
