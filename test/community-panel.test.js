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

for (const denied of [false, true]) test(`named project warnings and the fallback choice remain available with storage ${denied ? "denied" : "open"}`, async () => {
  const listeners = new Map(), notices = [];
  const input = { addEventListener() {} }, importButton = { addEventListener() {} }, refreshButton = { addEventListener() {} };
  const fallback = { addEventListener: (_event, fn) => listeners.set("fallback", fn) }, status = {}, warnings = {};
  const nodes = { input, "[data-community-import]": importButton, "[data-community-refresh]": refreshButton,
    "[data-community-fallback]": fallback, '[role="status"]': status, "[data-community-project-warnings]": warnings,
    ".zoidium-plugin-category-list": { replaceChildren() {} } };
  const section = { querySelector: selector => nodes[selector], querySelectorAll: () => [importButton, refreshButton, fallback] };
  const state = { safeMode: false, packages: [] };
  let choices = 0;
  const root = { document: { createElement: () => section },
    CM: { project: { toJSON: () => ({ plugins: [] }) } },
    ZoidiumPluginManagerInternals: { projectPluginRequirements: () => [{ id: "community-test", name: "Named missing package" }] },
    ZoidiumCommunityProjects: { enabled: () => true, isCommunity: id => id.startsWith("community-"), warning: p => p.name + " requires saved hash and schema." },
    ZoidiumCommunityExport: { async requestFallback() { choices++; return true; } },
    ZoidiumUI: { notify: value => notices.push(value) },
    ZoidiumCommunityStore: { createStore: () => ({ async open() { if (denied) throw new Error("Database denied"); return state; },
      view: () => state, close() {} }) },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../zoidium/community-plugin-panel.js"), "utf8"), { window: root, document: root.document });
  const mounted = root.ZoidiumPluginManagerInternals.mountCommunityPanel({ appendChild() {} }, { plugins: [] });
  await mounted.initialized;
  assert.equal(fallback.disabled, false);
  if (!denied) {
    assert.match(warnings.textContent, /Named missing package.*saved hash and schema.*not installed/);
    assert.equal(status.textContent, "No community plugins installed.");
  }
  listeners.get("fallback")(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(choices, 1); assert.equal(notices[0].title, "Fallback export selected");
  assert.equal(fallback.disabled, false);
});
