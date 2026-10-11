"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, webcrypto } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { loadManager } = require("./plugin-manager-overlays.test");
const digest = (text) => "sha256-" + createHash("sha256").update(text).digest("base64");
function fixture(kind = "extension") {
  const { sandbox, manager } = loadManager();
  const manifest = { schemaVersion: 1, id: "fixture", version: "1", kind,
    modules: kind === "core" ? [] : [{ id: "main", source: "main.js" }] };
  const text = JSON.stringify({ schemaVersion: 1, manifest, assets: { text: { "/main.js": "throw new Error('must not execute');" }, json: {} } }) + "\n";
  const plugin = { id: "fixture", name: "Fixture", version: "1", bundle: "bundle.json?v=1", integrity: digest(text) };
  sandbox.crypto = webcrypto;
  sandbox.TextEncoder = TextEncoder;
  sandbox.btoa = (value) => Buffer.from(value, "binary").toString("base64");
  sandbox.isSecureContext = true;
  const requests = [];
  sandbox.fetch = async (url, options) => { requests.push([url, options.cache]); return { ok: true, text: async () => text }; };
  return { sandbox, manager, plugin, text, requests };
}
test("bundle integrity verifies exact UTF-8 bytes before parsing or source evaluation", async () => {
  const f = fixture();
  const result = await f.manager.loadPluginPackage(f.plugin);
  assert.equal(result.manifest.id, "fixture");
  assert.deepEqual(f.requests, [["bundle.json?v=1", "no-cache"]]);
  f.sandbox.fetch = async () => ({ ok: true, text: async () => "not JSON" });
  await assert.rejects(f.manager.loadPluginPackage(f.plugin), /integrity mismatch/);
  f.plugin.integrity = digest("not JSON");
  await assert.rejects(f.manager.loadPluginPackage(f.plugin), /Unexpected token/);
});
test("missing digests, unbundled manifests, insecure contexts and absent Web Crypto fail closed", async () => {
  const f = fixture();
  await assert.rejects(f.manager.loadPluginPackage({ ...f.plugin, integrity: undefined }), /digest is missing/);
  await assert.rejects(f.manager.loadPluginPackage({ ...f.plugin, bundle: undefined, manifest: "manifest.json" }), /no verified bundle/);
  assert.equal(f.requests.length, 0);
  f.sandbox.isSecureContext = false;
  await assert.rejects(f.manager.loadPluginPackage(f.plugin), /secure context/);
  f.sandbox.isSecureContext = true;
  f.sandbox.crypto = {};
  await assert.rejects(f.manager.loadPluginPackage(f.plugin), /secure context/);
});
test("stale registry and bundle combinations refuse mismatched digest or version", async () => {
  const f = fixture();
  f.plugin.version = "2";
  await assert.rejects(f.manager.loadPluginPackage(f.plugin), /version mismatch/);
  f.plugin.version = "1";
  f.sandbox.fetch = async () => ({ ok: true, text: async () => f.text + " " });
  await assert.rejects(f.manager.loadPluginPackage(f.plugin), /integrity mismatch/);
});
test("tampered activation records an English card error, warns once and leaves other plugins running", async () => {
  const f = fixture();
  f.plugin.integrity = digest("tampered");
  const row = {};
  const state = { plugin: f.plugin, card: { dataset: {}, querySelector: () => row }, toggle: {}, runtimeModules: [] };
  f.manager.pluginStates.set(f.plugin.id, state);
  let registered = 0;
  const warnings = [];
  f.sandbox.console = { warn: (...args) => warnings.push(args), error() {} };
  for (const name of ["unregisterPlugin", "syncUsageTooltip", "syncGroupForPlugin", "closeOpenAddPickers", "restoreMissingNativeEffects", "restoreMissingPluginMaterials", "restoreMissingNumericObjects", "restoreMissingNumericLayers", "updateNativeFxUsageUi", "updatePluginObjectUsageUi", "updatePluginResourceUsageUi"]) f.manager[name] = () => {};
  f.manager.registerManifest = async () => { registered += 1; };
  await f.manager.enablePlugin(state, false);
  await f.manager.enablePlugin(state, false);
  assert.equal(registered, 0);
  assert.equal(state.card.dataset.phase, "error");
  assert.match(row.textContent, /Plugin integrity mismatch: fixture/);
  assert.equal(row.hidden, false);
  assert.match(state.lastError.message, /integrity mismatch/);
  assert.equal(warnings.length, 1);
  const healthy = { plugin: { ...f.plugin, id: "healthy" }, manifest: { modules: [] }, runtimeModules: [], card: { dataset: {}, querySelector: () => ({}) }, toggle: {} };
  f.sandbox.PZ = { zoidium: {} };
  f.sandbox.document.querySelectorAll = () => [];
  await f.manager.enablePlugin(healthy, false);
  assert.equal(healthy.card.dataset.phase, "enabled", JSON.stringify(healthy.lastError));
  assert.equal(registered, 1);
});
test("disabled project-required plugins and hidden Core use the same integrity gate", async () => {
  const f = fixture("core");
  f.plugin.integrity = digest("tampered");
  const state = { plugin: { ...f.plugin, visibility: "hidden", alwaysEnabled: true }, card: null, errorRow: {}, runtimeModules: [] };
  f.manager.pluginStates.set(f.plugin.id, state);
  f.manager.unregisterPlugin = async () => {};
  f.manager.settleRegistryReady();
  f.sandbox.ZoidiumUI = { confirm: async () => true };
  f.sandbox.console = { warn() {}, error() {} };
  await f.manager.activateProjectPlugins({}, [{ id: "fixture", name: "Fixture" }]);
  assert.equal(state.phase, "error");
  assert.match(state.errorRow.textContent, /integrity mismatch/);
  assert.equal(state.manifest, undefined);
});
test("builder writes exact bundle digests and check mode rejects a stale registry digest", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-integrity-"));
  try {
    fs.mkdirSync(path.join(root, "tools"));
    fs.mkdirSync(path.join(root, "plugins/fixture"), { recursive: true });
    for (const name of ["build-plugin-bundles.js", "validate-plugin-manifests.js", "atomic-write.js"]) fs.copyFileSync(path.join(__dirname, "../tools", name), path.join(root, "tools", name));
    fs.copyFileSync(path.join(__dirname, "../plugins/manifest.schema.json"), path.join(root, "plugins/manifest.schema.json"));
    fs.symlinkSync(path.join(__dirname, "../node_modules"), path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "plugins/fixture/main.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(root, "plugins/fixture/manifest.json"), JSON.stringify({ schemaVersion: 1, id: "fixture", name: "Fixture", version: "1", author: "Fixture", description: "Fixture", modules: [{ id: "main", source: "./plugins/fixture/main.js?v=1" }] }));
    const registryPath = path.join(root, "plugins/registry.json");
    fs.writeFileSync(registryPath, JSON.stringify({ schemaVersion: 1, plugins: [{ id: "fixture", manifest: "./plugins/fixture/manifest.json?v=1" }] }));
    const run = (...args) => spawnSync(process.execPath, [path.join(root, "tools/build-plugin-bundles.js"), ...args], { encoding: "utf8" });
    const built = run();
    assert.equal(built.status, 0, built.stderr);
    const registry = JSON.parse(fs.readFileSync(registryPath));
    assert.equal(registry.plugins[0].integrity, digest(fs.readFileSync(path.join(root, "plugins/fixture/bundle.json"))));
    assert.equal(run("--check").status, 0);
    registry.plugins[0].integrity = digest("stale");
    fs.writeFileSync(registryPath, JSON.stringify(registry));
    const checked = run("--check");
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /Registry metadata is stale/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("desktop staging preserves the registry digest and exact packaged bundle bytes", async () => {
  const { copyProjectFiles } = require("../tools/runtime-resources-stage");
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "zoidium-integrity-stage-"));
  try {
    await copyProjectFiles(root);
    const registry = JSON.parse(await fs.promises.readFile(path.join(root, "plugins/registry.json"), "utf8"));
    for (const plugin of registry.plugins) {
      const file = path.join(root, plugin.bundle.split("?", 1)[0]);
      assert.equal(digest(await fs.promises.readFile(file)), plugin.integrity, plugin.id);
    }
  } finally { await fs.promises.rm(root, { recursive: true, force: true }); }
});
test("a disabled project plugin verifies its bundle after user approval", async () => {
  const f = fixture();
  f.plugin.integrity = digest("tampered");
  const row = {};
  const state = { plugin: f.plugin, card: { dataset: { phase: "disabled" }, querySelector: () => row }, toggle: {}, runtimeModules: [] };
  f.manager.pluginStates.set(f.plugin.id, state);
  for (const name of ["unregisterPlugin", "syncUsageTooltip", "syncGroupForPlugin"]) f.manager[name] = () => {};
  f.manager.settleRegistryReady();
  f.sandbox.ZoidiumUI = { confirm: async () => false };
  f.sandbox.console = { warn() {}, error() {} };
  await f.manager.activateProjectPlugins({}, [{ id: "fixture", name: "Fixture" }]);
  assert.equal(f.requests.length, 0);
  f.sandbox.ZoidiumUI.confirm = async () => true;
  await f.manager.activateProjectPlugins({}, [{ id: "fixture", name: "Fixture" }]);
  assert.equal(f.requests.length, 1);
  assert.equal(state.card.dataset.phase, "error");
  assert.match(row.textContent, /integrity mismatch/);
  assert.equal(state.manifest, undefined);
});
