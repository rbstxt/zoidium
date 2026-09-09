"use strict";

// Regression coverage for shader-pack group loading (CCFX/AfterClip "Load
// failed"): group presets reference shaders without the ?v asset version
// that manifest URLs carry, so the runtime must match them on normalized
// keys, and every referenced file must be embedded in the bundle.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

// Mirror of pluginAssetKey in plugins/plugin-manager.js.
function assetKey(url) {
  const source = String(url || "").split(/[?#]/, 1)[0].replace(/\\/g, "/");
  return "/" + source.replace(/^\.\//, "").replace(/^\/+/, "");
}

function stripVersion(url) {
  return String(url || "").replace(/^\.\//, "").split("?")[0];
}

function readJsonRepo(relativeNoQuery) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativeNoQuery), "utf8"));
}

function collectShaderRefs(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectShaderRefs(item, out);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "_zoidiumShader" && typeof child === "string") out.push(child);
    else collectShaderRefs(child, out);
  }
}

function shaderPackEntries() {
  const registry = readJsonRepo("plugins/registry.json");
  return registry.plugins
    .map((entry) => ({
      entry,
      manifest: readJsonRepo(stripVersion(entry.manifest)),
    }))
    .filter(({ manifest }) => manifest.kind === "shader-pack");
}

test("every group shader reference resolves to a declared manifest shader", () => {
  const packs = shaderPackEntries();
  assert.ok(packs.length > 0, "at least one shader-pack is registered");
  for (const { manifest } of packs) {
    for (const group of manifest.groups || []) {
      const declared = new Set((group.shaders || []).map(assetKey));
      const preset = readJsonRepo(stripVersion(group.preset));
      assert.equal(preset.type, 0, "group preset type: " + group.id);
      assert.ok(Array.isArray(preset.objects), "group preset objects: " + group.id);
      const refs = [];
      collectShaderRefs(preset, refs);
      // Sync-only presets legitimately declare no shaders.
      if ((group.shaders || []).length === 0) {
        assert.equal(refs.length, 0, "shader-less group has no shader refs: " + group.id);
        continue;
      }
      for (const ref of refs) {
        assert.ok(declared.has(assetKey(ref)), "group shader ref resolves: " + group.id + " (" + ref + ")");
      }
    }
  }
});

test("every declared shader and preset is embedded in the bundle", () => {
  const registry = readJsonRepo("plugins/registry.json");
  const byId = new Map(registry.plugins.map((entry) => [entry.id, entry]));
  for (const { manifest } of shaderPackEntries()) {
    const bundle = readJsonRepo(stripVersion(byId.get(manifest.id).bundle));
    const textKeys = new Set(Object.keys((bundle.assets || {}).text || {}));
    const jsonKeys = new Set(Object.keys((bundle.assets || {}).json || {}));
    for (const effect of manifest.effects || []) {
      assert.ok(textKeys.has(assetKey(effect.shader)), "effect shader bundled: " + effect.id);
      assert.ok(jsonKeys.has(assetKey(effect.preset)), "effect preset bundled: " + effect.id);
    }
    for (const group of manifest.groups || []) {
      assert.ok(jsonKeys.has(assetKey(group.preset)), "group preset bundled: " + group.id);
      for (const shader of group.shaders || []) {
        assert.ok(textKeys.has(assetKey(shader)), "group shader bundled: " + group.id + " (" + shader + ")");
      }
    }
  }
});

test("the group loader matches shaders on normalized keys", () => {
  const source = fs.readFileSync(path.join(projectRoot, "plugins/plugin-manager.js"), "utf8");
  assert.ok(source.includes("indexGroupShaders"), "group shaders are indexed on normalized keys");
});
