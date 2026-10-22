"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { checkDocsLinks } = require("../tools/check-docs-links");
const reference = require("../plugins/shader-plus/reference");

test("generated documentation contains every editor reference anchor and auxiliary binding", async () => {
  const { referenceMarkdown } = await import("../site/loaders/reference.mjs");
  const body = referenceMarkdown(reference);
  const anchors = [...body.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...anchors].sort(), reference.entries.map(e => e.id).sort());
  assert.equal(new Set(anchors).size, anchors.length);
  for (const entry of reference.entries) {
    assert.ok(body.includes(entry.signature), entry.id);
    for (const auxiliary of entry.auxiliary || []) assert.ok(body.includes(auxiliary.signature), entry.id);
  }
  assert.equal(reference.docsUrl, "/docs/reference/shader/");
});

test("canonical Markdown links retain fragments and route to the documentation site", async () => {
  const { rewriteLink } = await import("../site/loaders/sources.mjs");
  assert.equal(rewriteLink("plugin-ui.md#controls", "docs/plugin-api.md"), "/docs/development/plugin-ui/#controls");
  assert.equal(rewriteLink("../plugins/constraints/README.md", "docs/project-compatibility.md"), "/docs/features/constraints/");
  assert.equal(rewriteLink("https://example.com/a#b", "docs/plugin-api.md"), "https://example.com/a#b");
  assert.equal(rewriteLink("#local", "docs/plugin-api.md"), "#local");
});

test("built link check resolves clean URLs, escaped anchors and local assets and rejects missing targets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-docs-links-"));
  try {
    fs.mkdirSync(path.join(root, "docs/reference"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs/index.html"), '<a href="/docs/reference/#kind.point">Point</a><img src="/asset.svg">');
    fs.writeFileSync(path.join(root, "docs/reference/index.html"), '<h2 id="kind.point">Point</h2><a href="../">Home</a>');
    fs.writeFileSync(path.join(root, "asset.svg"), "<svg/>");
    assert.deepEqual(checkDocsLinks(root), { pages: 2, checked: 3, problems: [] });
    fs.appendFileSync(path.join(root, "docs/index.html"), '<a href="/docs/reference/#missing">Bad anchor</a><a href="/absent/">Missing</a>');
    const result = checkDocsLinks(root);
    assert.equal(result.problems.length, 2);
    assert.match(result.problems[0], /missing anchor/);
    assert.match(result.problems[1], /missing target/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
