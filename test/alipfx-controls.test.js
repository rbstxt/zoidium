"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { applyControls } = require("../tools/alipfx-controls.js");
const mapping = require("../plugins/alipfx/controls.json");
const manifest = require("../plugins/alipfx/manifest.json");
test("the five AlipFX control mappings change only editor metadata", () => {
  assert.equal(Object.keys(mapping).length, 5);
  for (const [id, controls] of Object.entries(mapping)) {
    const spec = manifest.effects.find(effect => effect.id === id);
    const preset = JSON.parse(fs.readFileSync(path.join(__dirname, "..", spec.preset.split("?")[0]), "utf8"));
    const strip = value => {
      const copy = structuredClone(value);
      for (const p of copy.customProperties) { delete p.type.zoidiumShader; delete p.type.zoidiumControl; }
      return copy;
    };
    const native = strip(preset), upgraded = applyControls(structuredClone(native), controls);
    assert.deepEqual(upgraded, preset, id);
    assert.deepEqual(strip(upgraded), native, id);
  }
});
test("AlipFX metadata refuses missing properties and non-number storage", () => {
  assert.throws(() => applyControls({ customProperties: [] }, { Mode: { kind: "dropdown" } }), /dynamic NUMBER/);
  assert.throws(() => applyControls({ customProperties: [{ properties: { name: "Mode" }, type: { type: 7 } }] }, { Mode: { kind: "dropdown" } }), /dynamic NUMBER/);
});
