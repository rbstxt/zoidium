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
