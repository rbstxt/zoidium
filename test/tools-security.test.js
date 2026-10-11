"use strict";

// Characterization tests for the tools-security area. These pin the current
// behavior of tools/runtime-resources.js and tools/build-particles-plus-sprites.js
// before the files are split into smaller modules, and they keep passing
// unchanged after the split because the original entry paths stay compatible.

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const runtime = require("../tools/runtime-resources");

test("runtime-resources facade keeps its public API", () => {
  for (const key of [
    "assertCacheRootSafe",
    "assertFetchedResourcePath",
    "buildResourceStage",
    "copyProjectFiles",
    "readRegularFile",
    "replaceDirectoryAtomically",
    "stageResultFromMetadata",
    "savedPageFetch",
    "parseCliArgs",
    "cacheMetadataName",
    "cacheSchemaVersion",
    "defaultFetchTimeoutMs",
    "defaultResourceCacheRoot",
    "defaultSourcePage",
    "defaultVideoEditorSourcePage",
    "discoverEditorEntryScript",
    "discoverHtmlReferences",
    "discoverTextReferences",
    "ensureResourceCache",
    "fetchResourceGraph",
    "fetchBytes",
    "inspectResourceCache",
    "normalizeResourcePath",
    "normalizeSourcePageUrl",
    "patchIndexHtml",
    "patchThreeR91Source",
    "patchThreeRuntimeStage",
    "prepareRuntimeStage",
    "projectRoot",
    "resourceRootFor",
    "safeStagePath",
  ]) {
    assert.ok(runtime[key] !== undefined, `missing export: ${key}`);
  }
});

test("resource path normalization pins traversal rejection", () => {
  assert.equal(runtime.normalizeResourcePath("assets/../effect/test.js"), "effect/test.js");
  assert.throws(() => runtime.normalizeResourcePath("../outside.js"), /Invalid CM3 resource path/);
  assert.throws(() => runtime.normalizeResourcePath("%2e%2e%2foutside.js"), /Invalid CM3 resource path/);
  assert.throws(() => runtime.assertFetchedResourcePath("plugins/evil.js"), /collides/);
});

test("source page patch pins bootstrap markers", () => {
  const source = [
    "<!doctype html>",
    "<head>",
    '<script src="core-1.0.0.js"></script>',
    '<script src="clipmaker-1.0.0.js"></script>',
    "<script>PZ.ui.ads.init(); initTool();</script>",
    "</head>",
  ].join("\n");
  const patched = runtime.patchIndexHtml(source);
  assert.match(patched, /zoidium\/runtime-config\.js/);
  assert.match(patched, /zoidium-runtime-profiles\.js/);
  assert.match(patched, /zoidium\/runtime-loader\.js/);
  assert.doesNotMatch(patched, /initTool\s*\(\s*\)\s*;/);
});

test("CLI parsing pins known options", () => {
  assert.equal(runtime.parseCliArgs(["--", "--setup"]).setup, true);
  assert.throws(() => runtime.parseCliArgs(["--bogus"]), /Unknown option/);
});

test("particles-plus sprite catalog validates at 128x128", () => {
  const result = spawnSync(process.execPath, ["tools/build-particles-plus-sprites.js", "--check"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Particles\+ sprites valid: 54 x 128x128/);
});
