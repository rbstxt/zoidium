"use strict";

// Node test helper for the zoidium/shared modules. Production call sites call
// the shared tables directly (the overlay scripts load before any plugin code
// runs), so tests that evaluate those sources must provide the tables:
//
// - Sources evaluated in the main realm (Camera+ parts via new Function,
//   openzoid-legacy setup modules via require): require this file and call
//   ensureGlobalApis() once. It installs the real tables on
//   globalThis.ZoidiumPluginApis without clobbering an existing object.
// - Sources evaluated in a vm sandbox: run sharedSource(name) in that sandbox
//   before the production source, then point the sandbox's ZoidiumPluginApis
//   (or ZoidiumSharedJson on a window fake) at the loaded tables.

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const ALL = ["random", "props", "color", "gl", "json", "windows"];
const GLOBAL_NAMES = {
  random: "ZoidiumSharedRandom",
  props: "ZoidiumSharedProps",
  color: "ZoidiumSharedColor",
  gl: "ZoidiumSharedGl",
  json: "ZoidiumSharedJson",
  windows: "ZoidiumSharedWindows",
};

function sharedSource(name) {
  return fs.readFileSync(path.join(projectRoot, "zoidium", "shared", name + ".js"), "utf8");
}

let cachedTables = null;

function loadSharedTables() {
  if (cachedTables) return cachedTables;
  const sandbox = {};
  vm.createContext(sandbox);
  for (const name of ALL) {
    vm.runInContext(sharedSource(name), sandbox, { filename: "shared/" + name + ".js" });
  }
  cachedTables = {};
  for (const name of ALL) {
    cachedTables[name] = sandbox[GLOBAL_NAMES[name]];
  }
  return cachedTables;
}

function ensureGlobalApis() {
  const tables = loadSharedTables();
  const existing = globalThis.ZoidiumPluginApis;
  if (existing && existing.random && existing.props && existing.gl) return existing;
  const apis = Object.assign({}, existing, tables);
  globalThis.ZoidiumPluginApis = apis;
  return apis;
}

module.exports = {
  sharedSource,
  loadSharedTables,
  ensureGlobalApis,
};
