"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

// ZoidiumUI is a required dependency: consumers call it directly instead of
// guarding each call and reimplementing its builders as a fallback.
const consumers = [
  "zoidium/settings.js",
  "zoidium/project-restore.js",
  "plugins/plugin-manager.js",
];

test("consumers call ZoidiumUI directly without existence guards", () => {
  for (const relative of consumers) {
    const source = fs.readFileSync(path.join(projectRoot, relative), "utf8");
    assert.doesNotMatch(source, /typeof\s+(global\.)?ZoidiumUI/, relative);
    assert.doesNotMatch(source, /ZoidiumUI\s*&&/, relative);
    assert.doesNotMatch(source, /&&\s*(global\.)?ZoidiumUI/, relative);
  }
});

test("ui-kit exposes the full shared builder surface", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "zoidium", "ui-kit.js"),
    "utf8"
  );
  const context = { console };
  context.window = context;
  vm.runInNewContext(source, context);
  const api = context.ZoidiumUI;
  for (const name of [
    "getElevator",
    "createMenubarTab",
    "createPageHeader",
    "notify",
    "createSearchBox",
    "attachSearchFilter",
    "createButton",
  ]) {
    assert.equal(typeof api[name], "function", name);
  }
  assert.ok(Object.isFrozen(api));
});
