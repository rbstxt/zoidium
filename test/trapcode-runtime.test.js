"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const runtimePath = require.resolve("../plugins/trapcode-suite/trapcode-runtime");

test("activation evaluates sources once and preserves existing class identity across reactivation", () => {
  delete require.cache[runtimePath];
  let runtime = require(runtimePath);
  const factories = new Map();
  const PZ = {object3d: {create: type => {
    const instance = factories.get(type)?.factory();
    if (instance) instance.type = type;
    return instance;
  }}};
  let evaluations = 0;
  const source = `PZ.trapcode = PZ.trapcode || {installExpressionSupport(){}, uninstallExpressionSupport(){}, lights:{install(){}, uninstall(){}}};
    PZ.object3d.particular = PZ.object3d.particular || class {};
    PZ.object3d.form = PZ.object3d.form || class {};
    PZ.object3d.plexus = PZ.object3d.plexus || class {};`;
  const context = {PZ, window: {THREE: {}}, getAsset() { evaluations++; return source; },
    object3d: { registerClass(entry) { factories.set(entry.type, entry); return () => factories.delete(entry.type); } },
    lifecycle: { onDispose() {} }};
  runtime.activate(context);
  const originalClass = PZ.object3d.particular;
  const existing = PZ.object3d.create(10);
  runtime.deactivate();
  assert.equal(factories.size, 0);
  assert.equal(PZ.zoidium.legacyObject3dTypes.size, 0);
  delete require.cache[runtimePath];
  runtime = require(runtimePath);
  runtime.activate(context);
  assert.equal(evaluations, 6);
  assert.equal(PZ.object3d.particular, originalClass);
  assert.ok(existing instanceof PZ.object3d.particular);
  assert.equal(existing.type, "zoidium:trapcode-suite/particular");
  runtime.deactivate();
});

test("detached parent lists and cycles do not crash ancestor lookup", () => {
  const {PZ} = require("./trapcode-env").loadSuite(["trapcode-common.js"]);
  class Sequence {}
  const list = {parent: null};
  assert.equal(PZ.trapcode.findParent({parent: list}, Sequence), null);
  list.parent = list;
  assert.equal(PZ.trapcode.findParent({parent: list}, Sequence), null);
});
