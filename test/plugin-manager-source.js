"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
function managerFiles() {
  const sandbox = { window: {} };
  require("node:vm").runInNewContext(fs.readFileSync(path.join(root, "zoidium/runtime-config.js"), "utf8"), sandbox);
  return sandbox.window.ZOIDIUM_RUNTIME.postInitScripts.filter((file) => file.startsWith("./plugins/plugin-manager"));
}
// Source-slice tests pin the same function bodies across the overlay split.
// Full-overlay tests separately exercise the imports and shared mutable state.
function managerSource() {
  const chunks = [];
  for (const file of managerFiles()) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/  \/\/ BEGIN manager body (\d+)\n([\s\S]*?)  \/\/ END manager body/g)) {
      chunks.push({ order: Number(match[1]), source: match[2] });
    }
  }
  return chunks.sort((a, b) => a.order - b.order).map((chunk) => chunk.source)
    .join("").replace(/manager\.(projectHooksInstalled|editorHooksInstalled|effectBadgeObserver|effectBadgeUpdateScheduled|nativeFxSearchPatched|registryReadySettled|resolveRegistryReady)\b/g, "$1");
}
function evaluationSource() {
  const source = managerSource();
  return source.slice(source.indexOf("  function evaluatePluginSource("), source.indexOf("  async function fetchJson("));
}
module.exports = { managerSource, managerFiles, evaluationSource };
