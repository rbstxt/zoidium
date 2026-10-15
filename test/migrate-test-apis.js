"use strict";

// Node test helper for the round-9 migration: installs the REAL shared
// tables (zoidium/shared/*.js attached like zoidium/plugin-apis.js attaches
// them) evaluated in THIS realm. The browser loads the shared overlay
// scripts as classic scripts, so migrated call sites always observe
// main-realm values; installing cross-realm (vm sandbox) tables here would
// make structural comparisons against test-realm literals fail on prototype
// identity. Any pre-existing ZoidiumPluginApis object is preserved and only
// extended with the six tables.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const SHARED_FILES = ["random", "props", "color", "gl", "json", "windows"];
const TABLE_NAMES = {
  random: "random",
  props: "props",
  color: "color",
  gl: "gl",
  json: "json",
  windows: "windows",
};
const GLOBAL_NAMES = {
  random: "ZoidiumSharedRandom",
  props: "ZoidiumSharedProps",
  color: "ZoidiumSharedColor",
  gl: "ZoidiumSharedGl",
  json: "ZoidiumSharedJson",
  windows: "ZoidiumSharedWindows",
};

function ensureMainRealmApis() {
  const existing = globalThis.ZoidiumPluginApis;
  if (
    existing &&
    existing.random &&
    existing.props &&
    existing.color &&
    existing.gl &&
    existing.random.sceneSeededRandom &&
    Object.getPrototypeOf(existing.random) === Object.prototype
  ) {
    return existing;
  }
  for (const name of SHARED_FILES) {
    const source = fs.readFileSync(
      path.join(projectRoot, "zoidium", "shared", name + ".js"),
      "utf8",
    );
    vm.runInThisContext(source, { filename: "zoidium/shared/" + name + ".js" });
  }
  const tables = {};
  for (const name of SHARED_FILES) {
    tables[TABLE_NAMES[name]] = globalThis[GLOBAL_NAMES[name]];
  }
  const apis = Object.assign({}, existing, tables);
  globalThis.ZoidiumPluginApis = apis;
  return apis;
}

module.exports = { ensureMainRealmApis };
