"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const projectRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(projectRoot, "plugins/plugin-manager.js"), "utf8");
function loadSearchHelpers() {
  const start = source.indexOf("function isNativeFxSearchEntry(value)");
  assert.ok(start >= 0, "native fx search helper exists");
  const end = source.indexOf("function installEffectPickerBadges()");
  assert.ok(end > start, "search helpers precede picker badges");
  const snippet = source.slice(start, end);
  const context = { NATIVE_FX_PLUGIN_ID: "native-fx", Array, Object };
  vm.createContext(context);
  vm.runInContext(snippet + "\nthis.__helpers = { isNativeFxSearchEntry, prioritizeNativeFxResults };", context);
  return context.__helpers;
}
function seenNames(ranked) {
  return JSON.parse(JSON.stringify(ranked)).map((entry) => (entry.item || entry).name);
}
test("native fx entries sort before other matches", () => {
  const { prioritizeNativeFxResults } = loadSearchHelpers();
  const nativeA = { name: "Echo", _zoidiumPluginId: "native-fx" };
  const nativeB = { name: "Drop Shadow", _zoidiumPluginId: "native-fx" };
  const otherA = { name: "Echo Wave", _zoidiumPluginId: "afterclip" };
  const otherB = { name: "Plain Echo" };
  const ranked = prioritizeNativeFxResults([otherA, nativeA, otherB, nativeB]);
  assert.deepEqual(seenNames(ranked), ["Echo", "Drop Shadow", "Echo Wave", "Plain Echo"]);
});
test("wrapped fuse results keep their shape and relative order", () => {
  const { prioritizeNativeFxResults } = loadSearchHelpers();
  const wrappedNative = { item: { name: "Echo", _zoidiumPluginId: "native-fx" } };
  const wrappedOther = { item: { name: "Echo", _zoidiumPluginId: "afterclip" } };
  assert.deepEqual(seenNames(prioritizeNativeFxResults([wrappedOther, wrappedNative])), ["Echo", "Echo"]);
  const ranked = prioritizeNativeFxResults([wrappedOther, wrappedNative]);
  assert.equal(ranked[0].item._zoidiumPluginId, "native-fx");
  assert.equal(ranked[1].item._zoidiumPluginId, "afterclip");
  assert.equal(prioritizeNativeFxResults([wrappedOther]).length, 1);
  assert.equal(prioritizeNativeFxResults([]).length, 0);
});
test("fuse search is wrapped to prioritize native fx", () => {
  assert.ok(source.includes("installNativeFxSearchPriority()"), "search priority is installed for the effect picker");
  assert.ok(source.includes("FuseApi.prototype.search"), "Fuse search results are re-ranked");
});
