"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const approvals = require("../tools/preview-cache-approvals");

function sourceTree(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-approval-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, text) => {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  for (const file of ["plugins/example/render.js", "plugins/core/output-frame-cache.js", "fonts/ui.woff2",
    "zoidium/render.js", "tools/preview-cache-oracle.js", "tools/preview-cache-oracle-fixtures.js", "tools/preview-cache-approvals.js"]) write(file, "original");
  write("plugins/registry.json", '{"plugins": [{"id":"example", "integrity":"old"}]}');
  write("plugins/example/manifest.json", '{"version":"1"}');
  write("zoidium/runtime-config.js", 'assetVersion: 1, registryUrl: "./plugins/registry.json?v=1", preInitScripts: ["a", "b"]');
  return { directory, write, digest: () => approvals.fingerprint(directory) };
}
for (const file of ["plugins/example/render.js", "plugins/core/output-frame-cache.js", "plugins/example/manifest.json",
  "zoidium/render.js", "fonts/ui.woff2", "tools/preview-cache-oracle-fixtures.js", "tools/preview-cache-oracle.js", "tools/preview-cache-approvals.js"]) {
  test("approval fingerprint changes after editing " + file, t => {
    const tree = sourceTree(t), before = tree.digest();
    tree.write(file, "modified");
    assert.notEqual(tree.digest(), before);
  });
}
test("new runtime dependencies change the approval fingerprint", t => {
  const tree = sourceTree(t), before = tree.digest();
  tree.write("plugins/another/render.js", "new render wrapper");
  assert.notEqual(tree.digest(), before);
});
test("generated bundles, receipts, docs and deployment versions do not invalidate a passing matrix", t => {
  const tree = sourceTree(t), before = tree.digest();
  tree.write("plugins/example/bundle.json", "rebuilt");
  tree.write("plugins/registry.json", '{"plugins": [{"id":"example", "integrity":"new"}]}');
  tree.write("plugins/core/output-frame-approvals.js", "new receipt");
  tree.write("plugins/example/README.md", "documentation");
  tree.write("zoidium/runtime-config.js", 'assetVersion: 999, registryUrl: "./plugins/registry.json?v=999", preInitScripts: ["a", "b"]');
  assert.equal(tree.digest(), before);
});
test("runtime bootstrap changes still invalidate approvals", t => {
  const tree = sourceTree(t), before = tree.digest();
  tree.write("zoidium/runtime-config.js", 'assetVersion: 1, registryUrl: "./plugins/registry.json?v=1", preInitScripts: ["b", "a"]');
  assert.notEqual(tree.digest(), before);
});
test("recorded preview cache approvals cover the current source and complete oracle matrix", () => approvals.check());

test("plugin activation defaults change the approval fingerprint", t => {
  const tree = sourceTree(t), before = tree.digest();
  tree.write("plugins/registry.json", '{"plugins":[{"id":"example","defaultEnabled":true}]}');
  assert.notEqual(tree.digest(), before);
});
