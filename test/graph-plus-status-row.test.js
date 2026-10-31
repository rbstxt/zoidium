"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Hover details replace the last status pill. The bar must stay one fixed row so
// the canvas above it never resizes under the pointer.
test("Graph Editor status bar stays one fixed-height row", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "plugins", "graph-plus", "theme.js"), "utf8");
  const rules = css.match(/\.g2-(?:wrap )?\.?g2-status\{[^}]*\}|\.g2-status\{[^}]*\}/g) || [];
  assert.ok(rules.length >= 2);
  for (const rule of rules) assert.doesNotMatch(rule, /flex-wrap:\s*wrap/);
  assert.ok(rules.some((rule) => /height:34px/.test(rule)));
  assert.match(css, /\.g2-status \.g2-pill:last-child\{[^}]*text-overflow:ellipsis/);
});
