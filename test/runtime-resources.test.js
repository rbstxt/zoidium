"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  discoverTextReferences,
  normalizeResourcePath,
  patchIndexHtml,
} = require("../tools/runtime-resources");

test("resource paths reject traversal outside the stage", () => {
  assert.equal(normalizeResourcePath("assets/../effect/test.js"), "effect/test.js");
  assert.throws(() => normalizeResourcePath("../outside.js"), /Invalid CM3 resource path/);
  assert.throws(() => normalizeResourcePath("%2e%2e%2foutside.js"), /Invalid CM3 resource path/);
});

test("CM3 site-root shader paths are remapped into the source directory", () => {
  const references = discoverTextReferences(
    'this.shaderfile = "blend";',
    "https://panzoid.com/legacy/gen3/effect/example.js",
    "https://panzoid.com/legacy/gen3/clipmaker.html",
    "https://panzoid.com/legacy/gen3/"
  );
  assert.deepEqual(references.get("assets/shaders/fragment/blend.glsl"), {
    sourcePath: "assets/shaders/fragment/blend.glsl",
    url: "https://panzoid.com/legacy/gen3/assets/shaders/fragment/blend.glsl",
  });
});

test("the source page patch defers CM3 initialization and adds the bootstrap", () => {
  const source = [
    "<!doctype html>",
    "<head>",
    '<script src="core-1.0.0.js"></script>',
    '<script src="clipmaker-1.0.0.js"></script>',
    "<script>PZ.ui.ads.init(); initTool();</script>",
    "</head>",
  ].join("\n");

  const patched = patchIndexHtml(source);
  assert.match(patched, /zoidium\/runtime-config\.js/);
  assert.match(patched, /zoidium\/runtime-policy\.js/);
  assert.match(patched, /zoidium\/runtime-loader\.js/);
  assert.doesNotMatch(patched, /PZ\.ui\.ads\.init\s*\(\)\s*;/);
  assert.doesNotMatch(patched, /initTool\s*\(\)\s*;/);
});
