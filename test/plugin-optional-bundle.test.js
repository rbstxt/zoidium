"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const { webcrypto, createHash } = require("node:crypto");
function fixture(payload = { text: { "/plugins/example/large.js": "large" }, json: {} }, pluginId="example", resourceId="engine") {
  const body = JSON.stringify({ schemaVersion: 1, assets: payload });
  const assets = { text: {}, json: {}, optional: { engine: { source: "./plugins/" + pluginId + "/" + resourceId + ".bundle.json", integrity: "sha256-" + createHash("sha256").update(body).digest("base64") } } };
  let calls = 0, response = body;
  const manager = {};
  const window = { ZoidiumPluginManagerInternals: manager, location: new URL("https://example.test/") };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-manager-assets.js", "utf8"), { window, URL, crypto: webcrypto, TextEncoder, Uint8Array, btoa,
    fetch: async () => { calls++; return { ok: true, text: async () => response }; } });
  return { assets, manager, resolve: manager.createPluginAssetResolver(assets), calls: () => calls, response: text => { response = text; } };
}
test("optional bundle remains unloaded until requested, shares fetch, and merges verified assets", async () => {
  const f = fixture(); assert.equal(f.calls(), 0); assert.equal(f.resolve("text", "./plugins/example/large.js"), undefined);
  const a = f.resolve.loadOptional("engine"), b = f.resolve.loadOptional("engine"); assert.equal(a, b); await a;
  await f.manager.createPluginAssetResolver(f.assets).loadOptional("engine");
  assert.equal(f.calls(), 1); assert.equal(f.resolve("text", "./plugins/example/large.js"), "large");
});
test("optional bundle rejects tampering before parse and can retry", async () => {
  const f = fixture(); f.response("invalid JSON");
  await assert.rejects(f.resolve.loadOptional("engine"), /integrity mismatch/);
  assert.equal(f.resolve("text", "./plugins/example/large.js"), undefined);
  await assert.rejects(f.resolve.loadOptional("engine"), /integrity mismatch/); assert.equal(f.calls(), 2);
});
test("optional bundle rejects cross-origin sources", async () => {
  const f = fixture(); f.assets.optional.engine.source = "https://other.test/plugins/example/engine.bundle.json";
  await assert.rejects(f.resolve.loadOptional("engine"), /URL/); assert.equal(f.calls(), 0);
});

test("optional bundles accept missing text or JSON maps",async()=>{
 for(const payload of [{text:{"/plugins/example/image.png":"data:image/png;base64,AA=="}},{json:{"/plugins/example/data.json":{value:1}}},{}]){
  const f=fixture(payload);await f.resolve.loadOptional("engine");assert.equal(f.calls(),1);
 }
});
test("manifest id grammars are accepted by optional bundle URL validation",async()=>{
 const schema=JSON.parse(fs.readFileSync("plugins/manifest.schema.json","utf8"));
 const pluginPattern=new RegExp(schema.properties.id.pattern), resourcePattern=new RegExp(schema.definitions.identifier.pattern);
 for(const [pluginId,resourceId]of [["a","b"],["0-shape-plus","0_text-engine_2"]]){
  assert.ok(pluginPattern.test(pluginId));assert.ok(resourcePattern.test(resourceId));
  const f=fixture({},pluginId,resourceId);await f.resolve.loadOptional("engine");assert.equal(f.calls(),1);
 }
 for(const id of ["Upper","has.dot","with/slash"])assert.equal(pluginPattern.test(id),false);
});
