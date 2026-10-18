"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const model = require("../zoidium/theme-model.js");

test("standalone help follows saved themes and storage updates without CM3", () => {
  const values = new Map(), events = {};
  const theme = { id: "user:light", name: "Light", main: "#cad9f4", overrides: {}, clips: {} };
  const storage = new Map([
    ["zoidium.editor-settings", JSON.stringify({ themeId: theme.id })],
    ["zoidium.themes", JSON.stringify({ version: 1, themes: [theme] })],
  ]);
  const window = {
    ZoidiumUIBuilder: { themeModel: model },
    localStorage: { getItem: key => storage.get(key) },
    document: { documentElement: { style: { setProperty: (key, value) => values.set(key, value) } } },
    addEventListener: (type, fn) => { events[type] = fn; },
  };
  vm.runInNewContext(fs.readFileSync("zoidium/theme-document.js", "utf8"), { window });
  assert.equal(values.get("--zui-bg"), "#2a2a2a");
  assert.notEqual(values.get("--zoidium-theme-focus"), "#384668");
  storage.set("zoidium.editor-settings", "{}"); events.storage();
  assert.equal(values.get("--zui-bg"), "#2a2a2a");
  assert.equal(values.get("--zoidium-theme-focus"), "#384668");
});
