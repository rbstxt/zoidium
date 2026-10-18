"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
function harness(initial) {
  const storage = new Map(initial || []);
  const settings = { theme: "panzoid", hue: 0, saturation: 100, themeId: null };
  let nextId = 0, applies = 0;
  const window = {
    ZoidiumUIBuilder: { themeModel: require("../zoidium/theme-model.js") },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    crypto: { randomUUID: () => "id-" + ++nextId }, dispatchEvent() {},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../zoidium/theme-state.js"), "utf8"), { window, CustomEvent: class {} });
  const state = window.ZoidiumUIBuilder.themeEditor;
  state.configure({ get: () => settings, apply: () => applies++ });
  state.openSession();
  return { state, settings, storage, applies: () => applies };
}
test("editing a built-in creates one copy and one undo entry", () => {
  const { state, settings } = harness();
  const original = JSON.stringify(state.palette());
  state.edit("main", null, "#336633");
  assert.equal(state.themes().length, 1);
  assert.equal(state.name(), "Panzoid Classic copy");
  assert.ok(settings.themeId.startsWith("user:"));
  state.undo();
  assert.equal(state.themes().length, 0);
  assert.equal(state.canUndo(), false);
  assert.equal(JSON.stringify(state.palette()), original);
  state.redo();
  assert.equal(state.selected().main, "#336633");
});
test("native picker previews commit once or cancel without an entry", () => {
  const { state } = harness();
  state.beginPreview();
  state.preview("main", null, "#ff0000");
  state.preview("main", null, "#00ff00");
  assert.equal(state.canUndo(), false);
  state.finishPreview(false);
  assert.equal(state.canUndo(), true);
  state.undo();
  assert.equal(state.canUndo(), false);
  assert.equal(state.themes().length, 0);
  state.beginPreview();
  state.preview("clips", "cm3:7", "#112233");
  state.finishPreview(true);
  assert.equal(state.themes().length, 0);
  assert.equal(state.canUndo(), false);
});
test("theme operations, import/export, deletion and Revert are undoable", () => {
  const { state, storage } = harness();
  state.duplicate(); state.rename("Test");
  state.edit("clips", "cm3:7", "#123456");
  const exported = state.export(); state.import(exported);
  assert.equal(state.name(), "Test (2)");
  assert.equal(state.selected().clips["cm3:7"], "#123456");
  state.remove(); assert.equal(state.selection(), "panzoid");
  state.undo(); assert.equal(state.name(), "Test (2)");
  state.revert(); assert.equal(state.themes().length, 0); assert.equal(state.isDirty(), false);
  state.undo(); assert.equal(state.themes().length, 2);
  const restored = harness([...storage]);
  assert.equal(restored.state.themes().length, 2);
});
test("missing selected theme and corrupt storage fall back to Classic", () => {
  const { state, settings } = harness([["zoidium.themes", "{bad"]]);
  settings.themeId = "user:missing"; settings.theme = "rose";
  state.configure({ get: () => settings, apply() {} });
  assert.equal(settings.theme, "panzoid"); assert.equal(settings.themeId, null);
  assert.equal(state.palette().focus, "#384668");
});
test("preset duplication retains exact palette and original Custom settings", () => {
  const { state, settings } = harness();
  settings.hue = 34; settings.saturation = 60;
  state.select("custom"); const palette = JSON.stringify(state.palette());
  state.duplicate(); assert.equal(JSON.stringify(state.palette()), palette);
  state.select("signal"); assert.equal(settings.hue, -18);
  state.select("gray"); assert.equal(state.palette().focus, "#505050");
});
