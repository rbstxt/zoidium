"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Shape+ bundle declares each local module needed by its runtime", () => {
  const manifest = require("../plugins/shape-plus/manifest.json");
  const root = path.resolve(__dirname, "../plugins/shape-plus");
  const declared = new Set(manifest.resources.map(resource => resource.source.split("?")[0]
    .replace("./plugins/shape-plus/", "")));
  const pending = ["runtime.js"];
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    assert.ok(declared.has(file), `Missing bundled module: ${file}`);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(/require\(["'](\.\/[^"']+\.js)["']\)/g)) {
      pending.push(path.normalize(path.join(path.dirname(file), match[1])));
    }
  }
});
