"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateManifest } = require("../tools/validate-plugin-manifests");

const projectRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

test("the core plugin is hidden and always enabled", () => {
  const manifest = readJson("plugins/core/manifest.json");
  assert.equal(manifest.kind, "core");
  assert.equal(manifest.visibility, "hidden");
  assert.equal(manifest.alwaysEnabled, true);
  validateManifest(manifest, "plugins/core/manifest.json");

  const registry = readJson("plugins/registry.json");
  const entry = registry.plugins.find((plugin) => plugin.id === "core");
  assert.ok(entry, "core is registered");
  assert.equal(entry.visibility, "hidden");
  assert.equal(entry.alwaysEnabled, true);
});

test("core scripts on disk match the runtime load order", () => {
  const manifest = readJson("plugins/core/manifest.json");
  const fromManifest = manifest.coreScripts.map((script) => script.source);
  for (const source of fromManifest) {
    const diskPath = path.join(projectRoot, source.replace(/^\.\//, "").split("?")[0]);
    assert.ok(fs.existsSync(diskPath), `core script exists: ${source}`);
  }
  const configSource = fs.readFileSync(path.join(projectRoot, "zoidium/runtime-config.js"), "utf8");
  const fromConfig = [...configSource.matchAll(/"(\.\/plugins\/core\/[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(fromConfig, fromManifest);
});

test("every registered plugin declares its kind", () => {
  const registry = readJson("plugins/registry.json");
  for (const entry of registry.plugins) {
    const manifestPath = entry.manifest.replace(/^\.\//, "").split("?")[0];
    const manifest = readJson(manifestPath);
    assert.ok(manifest.kind, `${entry.id} declares kind`);
    validateManifest(manifest, manifestPath);
  }
});

test("kind requirements reject mismatched manifests", () => {
  // native-fx content passes the schema through its nativeEffects branch,
  // so a shader-pack kind label on it reaches (and fails) the kind check.
  const manifest = readJson("plugins/native-fx/manifest.json");
  assert.equal(manifest.kind, "native-fx");
  assert.throws(
    () => validateManifest({ ...manifest, kind: "shader-pack" }, "fixture"),
    /required sections/
  );
});

test("hidden plugins never touch panel cards", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins/plugin-manager.js"),
    "utf8"
  );
  assert.ok(
    source.includes("if (!state.card || !state.toggle) return;"),
    "usage UI skips hidden plugins without cards"
  );
});
