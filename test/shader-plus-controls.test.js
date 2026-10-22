"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { installControls } = require("../plugins/shader-plus/controls.js");
const { registerFontAssets } = require("../plugins/shader-plus/font-assets.js");
test("a repeated textarea change followed by blur commits exactly one native edit", () => {
  let starts = 0, finishes = 0, value = "before";
  const box = {}, anchor = { parentElement: box };
  const PZ = { property: { type: {} }, ui: { controls: {
    editStart() { starts++; box.pz_frame = 10; }, editFinish() { finishes++; },
  } } };
  const { commit } = installControls({ PZ, doc: {}, register() {}, editor: () => ({ playback: { currentFrame: 10 } }) });
  const property = { frameOffset: 0, get: () => value, set: next => { value = next; } };
  commit(anchor, property, "after"); commit(anchor, property, "after");
  assert.equal(starts, 1); assert.equal(finishes, 1); assert.equal(value, "after");
});
test("font references include TEXT payloads and use the registry's outer history operation", () => {
  let adapter, disposed = false; const writes = [];
  const p = { definition: { zoidiumShader: { kind: "text" } }, get: () => '{"font":"font-key","text":"Hello"}', getAddress: () => [1], properties: { name: { get: () => "Title" } }, parentObject: { properties: { name: { get: () => "Shader" } } } };
  const project = { forEachItemOfType(type, visit) { visit(p); } };
  const context = { editor: { project }, PZ: { property: class {}, asset: { type: { FONT: 1 } }, ui: { properties: class { setValue(data) { writes.push(data); } } } }, lifecycle: { onDispose(fn) { this.dispose = fn; } }, apis: { assets: { registerReferences(value) { adapter = value; return () => { disposed = true; }; } } } };
  registerFontAssets(context, { reloadFont() {} });
  const refs = []; adapter.collect(project, ref => refs.push(ref));
  assert.equal(refs.length, 1); assert.equal(refs[0].key, "font-key"); assert.deepEqual(refs[0].path, ["Shader", "Title"]);
  adapter.replace("font-key", "new-font"); assert.deepEqual(JSON.parse(writes[0].value), { font: "new-font", text: "Hello" });
  context.lifecycle.dispose(); assert.equal(disposed, true);
});
