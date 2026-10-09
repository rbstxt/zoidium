"use strict";

// OpenZoid Legacy — export-time true-datamosh installer.
//
// The realtime Datamosh effect only simulates compression breaks with a
// feedback buffer. The bundled datamosh-render.js performs byte-exact I-frame
// removal on exported WebM/VP8/VP9 files. This module installs it as
// PZ.datamoshRender while the plugin is enabled.
module.exports = {
  activate(context) {
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    if (!PZ) {
      throw new Error("OpenZoid Legacy needs the CM3 runtime.");
    }
    if (PZ.datamoshRender) return;
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    const source = getAsset
      ? getAsset("text", "./plugins/openzoid-legacy/datamosh-render.js")
      : undefined;
    if (typeof source !== "string") {
      throw new Error("OpenZoid Legacy is missing its bundled datamosh renderer.");
    }
    new Function("PZ", source)(PZ);
    if (!PZ.datamoshRender) {
      throw new Error("OpenZoid Legacy could not install the datamosh renderer.");
    }
  },
  deactivate() {},
};
