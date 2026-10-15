"use strict";

// Disk-backed bundle assets plus the real shared module loader for the
// Easing+ activation tests. Activation loads its parts through
// context.apis.modules.createRequire (never Node's own require), so tests
// build that context here: getAsset reads the shipped sibling files from
// disk and createRequire is the real loader from zoidium/plugin-apis.js,
// evaluated in this realm so part exports compare structurally.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const pluginDir = path.join(__dirname, "..", "plugins", "easing-plus");

function loadCreateRequire() {
  if (globalThis.ZoidiumPluginApis?.modules?.createRequire) {
    return globalThis.ZoidiumPluginApis.modules.createRequire;
  }
  const apiSource = fs.readFileSync(
    path.join(__dirname, "..", "zoidium", "plugin-apis.js"),
    "utf8",
  );
  const previous = globalThis.ZoidiumPluginApis;
  try {
    vm.runInThisContext(apiSource, { filename: "zoidium/plugin-apis.js" });
    return globalThis.ZoidiumPluginApis.modules.createRequire;
  } finally {
    if (typeof previous === "undefined") delete globalThis.ZoidiumPluginApis;
    else globalThis.ZoidiumPluginApis = previous;
  }
}

const createRequire = loadCreateRequire();

function getAsset(kind, assetPath) {
  if (kind !== "text") throw new Error("Easing+ test assets are text only: " + assetPath);
  const name = String(assetPath).split("?")[0].split("/").pop();
  return fs.readFileSync(path.join(pluginDir, name), "utf8");
}

// Merges bundle loading into an activation context.
function withBundle(context) {
  return {
    ...context,
    getAsset,
    apis: { modules: { createRequire } },
  };
}

module.exports = { pluginDir, createRequire, getAsset, withBundle };
