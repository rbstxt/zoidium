"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadManager } = require("./plugin-manager-overlays.test");
test("storage and placeholder failures keep their existing defaults and warn once per key", async () => {
  const { sandbox, manager } = loadManager();
  const warnings = [];
  sandbox.console = { warn: (...args) => warnings.push(args) };
  sandbox.localStorage = { getItem() { throw new Error("read denied"); }, setItem() { throw new Error("write denied"); } };
  for (let i = 0; i < 2; i += 1) {
    assert.equal(manager.isPersistedEnabled("fixture"), false);
    assert.equal(manager.isExplicitlyDisabled("fixture"), false);
    assert.equal(manager.isSaveApprovalRemembered("fixture"), false);
    manager.rememberSaveApproval("fixture");
    manager.persistEnabled("fixture", true);
  }
  assert.equal(warnings.length, 5);
  sandbox.PZ = { object3d: class {} };
  sandbox.ZoidiumPluginApis = { props: { cloneJson() { throw new Error("bad JSON"); } } };
  const missing = manager.createMissingNumericObject(7, "fixture", "object");
  await missing.load({ type: 7 });
  await missing.load({ type: 7 });
  assert.equal(JSON.stringify(missing.toJSON()), '{"type":7}');
  assert.equal(JSON.stringify(missing.toJSON()), '{"type":7}');
  assert.equal(warnings.length, 7);
});


test("bundle failures retain proof that plugin activation never started", async () => {
  const { sandbox, manager } = loadManager();
  sandbox.PZ = {};
  sandbox.console = { error() {} };
  manager.unregisterPlugin = async () => {};
  manager.loadPluginPackageForState = async () => { throw new Error("bundle unavailable"); };
  const state = manager.createHiddenPluginState({ id: "fixture", name: "Fixture" });
  await manager.enablePlugin(state, false);
  assert.equal(manager.getDebugPlugins()[0].activationStarted, false);
  assert.equal(manager.getDebugPlugins()[0].phase, "error");
  assert.equal(manager.getDebugPlugins()[0].lastError.message, "bundle unavailable");
  manager.loadPluginPackageForState = async () => ({ manifest: {}, assets: {} });
  manager.registerManifest = async () => { throw new Error("activation failed after shared patch"); };
  await manager.enablePlugin(state, false);
  assert.equal(manager.getDebugPlugins()[0].activationStarted, true);
  assert.equal(manager.getDebugPlugins()[0].lastError.message, "activation failed after shared patch");
  await manager.unregisterPlugin(state.plugin.id);
  state.manifest = null;
  manager.loadPluginPackageForState = async () => { throw new Error("bundle unavailable again"); };
  await manager.enablePlugin(state, false);
  assert.equal(manager.getDebugPlugins()[0].activationStarted, true, "rollback and a later fetch failure cannot prove shared patches were restored");
});
