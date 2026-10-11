"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { managerFiles } = require("./plugin-manager-source");
const { loadSharedTables } = require("./shared-test-apis");
function loadManager() {
  const storage = new Map();
  const events = [];
  const sandbox = {
    console, ZoidiumPluginApis: loadSharedTables(),
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    document: { dispatchEvent: (event) => events.push(event), querySelector: () => null },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    setTimeout() {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const file of managerFiles().filter((file) => file !== "./plugins/plugin-manager.js")) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), sandbox, { filename: file });
  }
  return { sandbox, manager: sandbox.ZoidiumPluginManagerInternals, storage, events };
}
test("ordered manager overlays share persistence, trackers, and picker state", async () => {
  const { sandbox, manager: m, events } = loadManager();
  const data = { properties: { amount: [1, 2] } };
  const copy = sandbox.ZoidiumPluginApis.props.cloneJson(data);
  assert.deepEqual(JSON.parse(JSON.stringify(copy)), data);
  assert.notEqual(copy.properties.amount, data.properties.amount);
  assert.equal(m.cloneJson, undefined, "no local clone helper remains");
  m.persistEnabled("fixture", true);
  assert.equal(m.shouldStartEnabled({ id: "fixture" }), true);
  m.persistEnabled("fixture", false);
  assert.equal(m.shouldStartEnabled({ id: "fixture", defaultEnabled: true }), false);
  assert.equal(m.shouldStartEnabled({ id: "core", alwaysEnabled: true }), true);
  m.settleRegistryReady();
  await m.registryReady;
  assert.equal(m.registryReadySettled, true);
  const project = {};
  sandbox.CM = { project };
  const effect = { parentProject: project };
  m.trackNativeEffect(effect, { id: "fixture", name: "Fixture", effect: "fx", effectName: "FX" }, true);
  assert.equal(m.getDebugProjectUsage().totalInstances, 1);
  assert.equal(m.getDebugProjectUsage().missingInstances, 1);
  assert.equal(events[0].type, "zoidium:plugin-usage-progress");
  m.untrackNativeEffect(effect);
  assert.equal(m.getDebugProjectUsage().totalInstances, 0);
  const toggle = {};
  const label = { dataset: {}, title: "Toggle Fixture" };
  m.setPluginUsageUi({ card: { querySelector: () => label }, toggle }, true);
  assert.equal(toggle.disabled, true);
  assert.equal(label.title, m.DEFAULT_IN_USE_REASON);
  sandbox.PZ = { effect: { getTypes: () => [] }, material: { getTypes: () => [] }, ui: { objectTypes: { get: () => [] } }, object3d: {}, zoidium: { object3d: { unregisterPlugin() {} } } };
  sandbox.ZoidiumUI = { closeWindows() {} };
  sandbox.document.querySelectorAll = () => [];
  sandbox.MutationObserver = class { observe() {} };
  sandbox.document.body = {};
  m.installEffectPickerBadges();
  assert.ok(m.effectBadgeObserver);
  // Unregister must read the observer installed by the picker overlay.
  let scheduled = 0;
  m.scheduleEffectPickerBadges = () => { scheduled += 1; };
  await m.unregisterPlugin("fixture");
  assert.equal(scheduled, 1);
});
test("startup retains namespace exports and waits for the ordered overlays", async () => {
  const { sandbox, manager: m } = loadManager();
  const calls = [];
  sandbox.PZ = { effect: {}, ui: { objectTypes: {} }, zoidium: { define(name, api, owner) { calls.push([name, typeof api, owner]); } } };
  for (const name of ["installProjectPluginHooks", "installEditorPluginHooks", "installObject3DUsageTracker", "installMissingNativeFactories", "installNumericFallbacks", "configureBundledLightDefault", "createTab", "installEffectPickerBadges"]) m[name] = () => {};
  m.fetchJson = async () => ({ schemaVersion: 1, plugins: [] });
  m.createPanel = () => ({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/plugin-manager.js"), "utf8"), sandbox);
  await m.registryReady;
  assert.deepEqual(calls.map((call) => call[0]), ["getDebugPlugins", "getDebugProjectUsage", "trackPluginMaterial", "untrackPluginMaterial", "trackPluginResource", "untrackPluginResource"]);
  assert.ok(calls.every((call) => call[1] === "function" && call[2] === "plugin-manager"));
});
test("manager numeric fallbacks use the shared JSON clone for load and save", async () => {
  const { sandbox, manager: m } = loadManager();
  sandbox.PZ = { object3d: class {} };
  let clones = 0;
  const shared = sandbox.ZoidiumPluginApis.props.cloneJson;
  sandbox.ZoidiumPluginApis = { ...sandbox.ZoidiumPluginApis, props: {
    cloneJson(value) { clones += 1; return shared(value); },
  } };
  const object = m.createMissingNumericObject(7, "fixture", "twist");
  const data = { type: 7, properties: { amount: [3] } };
  await object.load(data);
  data.properties.amount[0] = 9;
  const saved = object.toJSON();
  assert.equal(saved.properties.amount[0], 3);
  saved.properties.amount[0] = 12;
  assert.equal(object.toJSON().properties.amount[0], 3);
  assert.equal(clones, 3);
});
test("manager source evaluator preserves native receivers and module arguments", () => {
  const { sandbox, manager: m } = loadManager();
  sandbox.fixtureGlobal = 7;
  const instance = {};
  assert.equal(m.evaluatePluginSource("this.value = fixtureGlobal; return this.value;", [], [], instance), 7);
  assert.equal(instance.value, 7);
  const module = { exports: {} };
  const plugin = { id: "fixture" };
  m.evaluatePluginSource("exports.id = plugin.id; module.exports.global = fixtureGlobal;", ["module", "exports", "plugin"], [module, module.exports, plugin]);
  assert.deepEqual(module.exports, { id: "fixture", global: 7 });
  assert.throws(() => m.evaluatePluginSource("throw new Error('fixture failure');"), /fixture failure/);
  assert.throws(() => m.evaluatePluginSource("broken syntax !"), /Unexpected/);
  const sources = managerFiles().map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8")).join("\n");
  assert.equal((sources.match(/new Function\(/g) || []).length, 1);
});
module.exports = { loadManager };
