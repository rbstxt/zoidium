"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const { webcrypto, createHash } = require("node:crypto");
function fixture() {
  const body = JSON.stringify({ schemaVersion: 1, assets: { text: { "/plugins/example/large.js": "large" }, json: {} } });
  const assets = { text: {}, json: {}, optional: { engine: { source: "./plugins/example/engine.bundle.json", integrity: "sha256-" + createHash("sha256").update(body).digest("base64") } } };
  let calls = 0, response = body;
  const manager = {};
  const window = { ZoidiumPluginManagerInternals: manager, location: new URL("https://example.test/") };
  vm.runInNewContext(fs.readFileSync("zoidium/plugin-manager-assets.js", "utf8"), { window, URL, crypto: webcrypto, TextEncoder, Uint8Array, btoa,
    fetch: async () => { calls++; return { ok: true, text: async () => response }; } });
  return { assets, resolve: manager.createPluginAssetResolver(assets), calls: () => calls, response: text => { response = text; } };
}
test("optional bundle remains unloaded until requested, shares fetch, and merges verified assets", async () => {
  const f = fixture(); assert.equal(f.calls(), 0); assert.equal(f.resolve("text", "./plugins/example/large.js"), undefined);
  const a = f.resolve.loadOptional("engine"), b = f.resolve.loadOptional("engine"); assert.equal(a, b); await a;
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
