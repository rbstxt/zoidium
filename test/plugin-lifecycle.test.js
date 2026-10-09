"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../plugins/plugin-manager.js"), "utf8");
function lifecycleFactory(events) {
  const start = source.indexOf("  function createModuleLifecycle(");
  const end = source.indexOf("  async function registerManifest(", start);
  return vm.runInNewContext(source.slice(start, end) + "\ncreateModuleLifecycle", {
    console: { error: (...args) => events.push(["error", ...args]) },
  });
}
test("cleanup waits in reverse order, continues after failures, and runs once", async () => {
  const events = [];
  const lifecycle = lifecycleFactory(events)("fixture");
  lifecycle.onDispose(async () => { await Promise.resolve(); events.push("first"); });
  lifecycle.onDispose(() => { events.push("second"); throw new Error("cleanup failure"); });
  lifecycle.onDispose(() => events.push("third"));
  await lifecycle.dispose();
  await lifecycle.dispose();
  assert.equal(events[0], "third");
  assert.equal(events[1], "second");
  assert.equal(events[2][0], "error");
  assert.equal(events[3], "first");
  assert.equal(events.length, 4);
  assert.throws(() => lifecycle.onDispose(() => {}), /already ended/);
});
test("a module that fails partway through activation is owned and cleaned up", async () => {
  const events = [];
  const start = source.indexOf("      for (const [definition, source] of sources)");
  const end = source.indexOf("\n    const effects = getEffectTypes();", start);
  const loop = source.slice(start, end).replace(/\n    }\s*$/, "");
  const state = { runtimeModules: [] };
  const sandbox = {
    state, plugin: { id: "fixture" }, manifest: {}, window: {}, document: {}, PZ: {},
    getAsset() {}, createModuleLifecycle: lifecycleFactory(events),
    sources: [[{ id: "broken" }, `module.exports = {
      activate(context) {
        context.lifecycle.onDispose(async () => { await Promise.resolve(); context.window.dirty = false; });
        context.window.dirty = true;
        throw new Error("activation failed");
      },
      deactivate() {}
    };`]],
  };
  await assert.rejects(vm.runInNewContext("(async () => {" + loop + "})()", sandbox), /activation failed/);
  assert.equal(sandbox.window.dirty, true);
  assert.equal(state.runtimeModules.length, 1);
  await state.runtimeModules[0].deactivate();
  assert.equal(sandbox.window.dirty, false);
  await state.runtimeModules[0].deactivate();
});
test("multiple picker entries of one plugin register without duplicates", () => {
  const start = source.indexOf("for (const definition of manifest.objectTypes");
  const end = source.indexOf("const objectClasses = manifest.objectClasses", start);
  const entries = [];
  const context = {
    manifest: { objectTypes: [
      { target: "object3d", name: "First", type: 7, list: [] },
      { target: "object3d", name: "Second", type: 8, list: [] },
    ] }, plugin: { id: "fixture" }, state: { replacedObjectTypes: [] }, getObjectTypes: () => entries,
  };
  const loop = source.slice(start, end);
  vm.runInNewContext(loop, context);
  vm.runInNewContext(loop, context);
  assert.deepEqual(entries.map((entry) => entry.name), ["First", "Second"]);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function transitionHarness() {
  const events = [];
  const activation = deferred();
  const cleanup = deferred();
  let activations = 0;
  let cleanups = 0;
  const state = { plugin: { id: "fixture", name: "Fixture" }, manifest: {}, runtimeModules: [], card: {}, toggle: { checked: true } };
  const sandbox = {
    PZ: {}, trackedNativeEffects: new Set(), trackedPluginMaterials: new Set(),
    trackedPluginObjects: new Set(), missingPluginObjects: new Set(),
    trackedPluginResources: new Set(), missingPluginResources: new Set(),
    projectUsesNumericPlugin: () => false,
    async registerManifest() { activations += 1; events.push("activate:" + activations); if (activations === 1) await activation.promise; },
    async unregisterPlugin() { cleanups += 1; events.push("cleanup:" + cleanups); await cleanup.promise; },
    restoreMissingNativeEffects() {}, restoreMissingPluginMaterials() {},
    restoreMissingNumericObjects() {}, restoreMissingNumericLayers() {},
    updateCard(_state, value) { events.push(value); }, persistEnabled() {},
    updateNativeFxUsageUi() {}, updatePluginObjectUsageUi() {}, updatePluginResourceUsageUi() {},
    manifestFeatureCount: () => 0, emitState() {}, rememberPluginError() {}, console,
  };
  const begin = source.indexOf("  async function enablePlugin(");
  const end = source.indexOf("  function compatBadgeHtml(", begin);
  const functions = vm.runInNewContext(source.slice(begin, end) + "\n({enablePlugin,disablePlugin})", sandbox);
  return { ...functions, state, events, activation, cleanup, activations: () => activations, cleanups: () => cleanups };
}

async function settle() { await new Promise((resolve) => setImmediate(resolve)); }

test("two disable requests during activation share one awaited cleanup", async () => {
  const h = transitionHarness();
  const enabling = h.enablePlugin(h.state, true);
  const first = h.disablePlugin(h.state, true);
  const second = h.disablePlugin(h.state, true);
  assert.ok(h.state.disablePromise, "reserve disable before activation settles");
  h.activation.resolve();
  await settle();
  assert.equal(h.cleanups(), 1);
  assert.ok(h.state.disablePromise);
  h.cleanup.resolve();
  await Promise.all([enabling, first, second]);
  assert.equal(h.cleanups(), 1);
  assert.equal(h.state.disablePromise, null);
  assert.equal(h.events.filter((event) => event === "disabled").length, 1);
});

test("enable requested during pending disable waits for cleanup and activates again", async () => {
  const h = transitionHarness();
  const initial = h.enablePlugin(h.state, true);
  const disable = h.disablePlugin(h.state, true);
  const enableAgain = h.enablePlugin(h.state, true);
  h.activation.resolve();
  await settle();
  assert.equal(h.activations(), 1);
  assert.equal(h.cleanups(), 1);
  h.cleanup.resolve();
  await Promise.all([initial, disable, enableAgain]);
  assert.equal(h.activations(), 2);
  assert.equal(h.events.at(-1), "enabled");
  assert.ok(h.events.indexOf("disabled") < h.events.indexOf("activate:2"));
});
