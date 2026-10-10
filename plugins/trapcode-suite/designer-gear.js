"use strict";

// OpenZoid Rowbyte & Red Giant Suite — designer entry points.
//
// Binds the designer windows to this module's context.ui and registers the
// designer look (the "designer" skin) plus one editor per Trapcode object.
// Zoidium then shows the settings gear on object rows and an "Open Designer"
// button above their properties. Every registration is released when the
// module is disabled, so nothing of the CM3 object panel is patched here.

const state = {
  active: false,
};

// The object classes that carry a designer config (registered by their
// modules when the sources are evaluated).
const DESIGNER_KEYS = ["particular", "form", "plexus"];

function designerEntries(PZ) {
  const objects = PZ.object3d || {};
  return DESIGNER_KEYS
    .map((key) => objects[key])
    .filter((cls) => cls && cls.designer)
    .map((cls) => ({ cls, config: cls.designer }));
}

module.exports = {
  activate(context) {
    if (state.active) return;
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const designer = PZ && PZ.trapcode && PZ.trapcode.designer;
    const ui = context && context.ui;
    if (!designer || !ui) {
      throw new Error("Designer windows need the Trapcode runtime and the Zoidium window kit.");
    }
    const entries = designerEntries(PZ);
    if (!entries.length) {
      throw new Error("Designer windows have no object configs to open.");
    }
    context.lifecycle.onDispose(designer.bind(ui));
    ui.registerSkin("designer", designer.skinCss);
    for (const { cls, config } of entries) {
      ui.registerEditor({
        title: config.title || "Trapcode Designer",
        label: "Open Designer",
        icon: "settings",
        match: (target) => target instanceof cls,
        open: (target) => designer.open(target),
      });
    }
    state.active = true;
  },
  deactivate() {
    state.active = false;
  },
};
