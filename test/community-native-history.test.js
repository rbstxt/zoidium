"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");
const cache = process.env.ZOIDIUM_RESOURCE_DIR || path.join(__dirname, "../.zoidium-resources");
const manifest = require("../examples/community-filter/manifest.json");

test("native CM3 package paste, deletion, undo, and redo retain an unknown isolated payload exactly", {
  skip: !fs.existsSync(path.join(cache, "core-1.0.102.js")),
}, async () => {
  const c = host(), { PZ } = c;
  c.localStorage = { getItem: () => "1" };
  for (const name of ["community-projects", "community-effect-host"]) {
    vm.runInContext(fs.readFileSync(`zoidium/${name}.js`, "utf8"), c);
  }
  c.ZoidiumCommunityEffectHost.installGuards(PZ);
  const { project, layer } = fixture(c), editor = editorFor(PZ, project);
  const effect = PZ.effect.create(manifest.effects[0].id); layer.effects.push(effect);
  const payload = { type: effect.type, community: { schemaVersion: 900, packageId: manifest.id,
    packageHash: "saved hash", dataSchema: "future schema" }, properties: { anything: { expression: "must remain data" } },
    state: { nested: [null, true, 1], objects: [{ type: 1 }] } };
  await effect.load(payload);
  const expected = JSON.stringify(payload);
  assert.equal(JSON.stringify(effect), expected);
  const edit = Object.create(PZ.ui.edit.prototype); edit.editor = editor;
  const copied = JSON.parse(JSON.stringify(new PZ.package([effect])));
  assert.equal(JSON.stringify(copied.data[0]), expected);
  const create = data => {
    editor.history.startOperation();
    edit.createObject({ newParentAddress: layer.effects.getAddress(), baseType: PZ.effect, subType: effect.type, data });
    editor.history.finishOperation();
    return layer.effects[layer.effects.length - 1];
  };
  const pasted = create(copied.data[0]); await pasted.loading;
  assert.equal(JSON.stringify(pasted), expected);
  editor.history.undo(); assert.equal(pasted.parent, null);
  editor.history.redo(); const recreated = layer.effects[layer.effects.length - 1]; await recreated.loading;
  assert.notEqual(recreated, pasted); assert.equal(JSON.stringify(recreated), expected);
  editor.history.startOperation();
  edit.deleteObject({ oldParentAddress: layer.effects.getAddress(), oldIdx: layer.effects.indexOf(recreated) });
  editor.history.finishOperation();
  assert.equal(layer.effects.length, 1);
  editor.history.undo(); const restored = layer.effects[layer.effects.length - 1]; await restored.loading;
  assert.equal(JSON.stringify(restored), expected);
  editor.history.redo(); assert.equal(layer.effects.length, 1);
  assert.equal(JSON.stringify(effect), expected);
  project.unload();
});
