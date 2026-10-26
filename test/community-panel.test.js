"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");

test("a denied database open and close leave Community import disabled", async () => {
  const input = { addEventListener() {} }, importButton = { addEventListener() {} }, refreshButton = { addEventListener() {} };
  const status = {}, list = {};
  const nodes = { input, "[data-community-import]": importButton, "[data-community-refresh]": refreshButton,
    '[role="status"]': status, ".zoidium-plugin-category-list": list };
  const section = { querySelector: selector => nodes[selector], querySelectorAll: () => [importButton, refreshButton] };
  const sandbox = { document: { createElement: () => section }, window: {
    ZoidiumPluginManagerInternals: {},
    ZoidiumCommunityStore: { createStore: () => ({
      async open() { throw new Error("Community storage is denied."); },
      async close() { throw new Error("The database never opened."); },
    }) },
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../zoidium/community-plugin-panel.js"), "utf8"), sandbox);
  const panel = { appendChild(value) { assert.equal(value, section); } };
  const mounted = sandbox.window.ZoidiumPluginManagerInternals.mountCommunityPanel(panel, { plugins: [] });
  await mounted.initialized;
  assert.equal(importButton.disabled, true);
  assert.equal(refreshButton.disabled, true);
  assert.equal(status.textContent, "Community storage is denied.");
});
