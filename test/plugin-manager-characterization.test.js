"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { managerSource } = require("./plugin-manager-source");
const source = managerSource();
function section(begin, end, names, sandbox = {}) {
  return vm.runInNewContext(source.slice(source.indexOf(begin), source.indexOf(end)) + `\n({${names}})`, sandbox);
}
test("manager bundle assets normalize paths and ignore inherited assets", () => {
  const api = section("  function pluginAssetKey", "  function validateManifest", "pluginAssetKey,createPluginAssetResolver,bundledText,bundledJson");
  assert.equal(api.pluginAssetKey("./plugins\\fixture/main.js?v=2#x"), "/plugins/fixture/main.js");
  const text = Object.create({ "/inherited": "unsafe" });
  text["/main.js"] = "module source";
  const assets = { text, json: { "/preset.json": { value: 3 } } };
  const get = api.createPluginAssetResolver(assets);
  assert.equal(get("text", "./main.js?v=2"), "module source");
  assert.equal(get("text", "/inherited"), undefined);
  assert.equal(api.bundledText(assets, "main.js"), "module source");
  assert.equal(api.bundledJson(assets, "preset.json").value, 3);
  assert.throws(() => api.bundledText(assets, "missing", "fixture"), /Missing bundled text asset: fixture/);
});
test("manager effect and group loaders require bundle assets", async () => {
  const api = section("  function createLazyEffectData", "  async function loadPluginPackage",
    "createLazyEffectData,loadGroupData", {
      SHADER_PLUGIN_MARKER: "// @zoidium-plugin ",
      ZoidiumPluginApis: { props: { cloneJson: (value) => JSON.parse(JSON.stringify(value)) } },
    });
  const plugin = { id: "fixture", name: "Fixture", author: "Author", version: 1 };
  await assert.rejects(
    api.createLazyEffectData(plugin, { id: "effect" }, new Map(), null)(),
    /requires bundle assets: fixture\/effect/,
  );
  await assert.rejects(
    api.createLazyEffectData(plugin, { id: "effect" }, new Map(), undefined)(),
    /requires bundle assets: fixture\/effect/,
  );
  await assert.rejects(
    api.loadGroupData(plugin, { id: "group" }, new Map(), null),
    /requires bundle assets: fixture\/group/,
  );
});
test("manager shader markers keep serialized metadata and use the last marker", () => {
  const api = section("  function createPluginMarker", "  function createLazyEffectData", "createPluginMarker,readPluginMarker", { SHADER_PLUGIN_MARKER: "// @zoidium-plugin " });
  const marker = api.createPluginMarker({ id: "fixture", name: "Fixture", author: "Author", version: 7 }, { id: "effect" });
  assert.equal(marker, '// @zoidium-plugin {"id":"fixture","name":"Fixture","author":"Author","version":"7","effect":"effect"}');
  assert.equal(JSON.stringify(api.readPluginMarker({ value: "// @zoidium-plugin {}\n" + marker + "\nvoid main() {}" })), '{"id":"fixture","name":"Fixture","author":"Author","version":"7","effect":"effect"}');
  assert.equal(api.readPluginMarker("// @zoidium-plugin broken"), null);
});
