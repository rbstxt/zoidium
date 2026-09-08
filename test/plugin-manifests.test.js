"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { validateManifest, validateRegisteredManifests } = require("../tools/validate-plugin-manifests");

const projectRoot = path.resolve(__dirname, "..");

test("all registered plugin manifests match the schema", () => {
  const registry = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "plugins/registry.json"), "utf8")
  );
  assert.equal(validateRegisteredManifests(), registry.plugins.length);
});

test("object classes must stay inside their plugin namespace", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "plugins/geometry-plus/manifest.json"), "utf8")
  );
  manifest.objectClasses = [
    {
      ...manifest.objectClasses[0],
      type: "zoidium/foreign-plugin/object",
    },
  ];

  assert.throws(() => validateManifest(manifest, "fixture"), /manifest schema|namespace/);
});
