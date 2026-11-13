"use strict";
// Shader+ Path property: the empty-value sentinel, reference handling and
// the documented example's uniform contract.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const { parseReference } = require("../plugins/shape-plus/mask-model.js");

test("Path defaults to JSON null, which parses to a missing source", () => {
  // Native history redo of a TEXT empty-string write restores the
  // definition instead of the value (a host bug reproduced in isolation),
  // so the kind defaults to JSON "null" and never writes "".
  assert.equal(KINDS.path.create().value, "null");
  assert.equal(parseReference(KINDS.path.create().value), null);
});

test("documented glow example binds only uniforms the host provides", () => {
  // The host binds <Name>Coverage, <Name>Points, <Name>Length and
  // <Name>Count (path-sample.js bind). The flagship example once gated its
  // glow on GlowCount, which is never set and renders nothing; this pins
  // the whole example contract for EN and JA.
  for (const file of ["docs/shader-properties.md", "docs/ja/shader-properties.md"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const block = text.slice(text.indexOf("Example: draw a glow") > 0 ? text.indexOf("Example: draw a glow") : text.indexOf("例: パスに沿ったグロー"));
    const fence = block.slice(block.indexOf("```glsl"));
    const source = fence.slice("```glsl".length, fence.indexOf("```", "```glsl".length));
    const declared = [...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map(m => m[1]);
    const bound = ["Coverage", "Points", "Length", "Count"].map(suffix => "GlowPath" + suffix);
    for (const name of declared.filter(name => name.startsWith("Glow"))) {
      assert.ok(bound.includes(name), file + ": " + name + " is not bound by the host");
    }
    assert.ok(declared.includes("GlowPathCoverage"), file + ": example must sample coverage");
    assert.ok(declared.includes("GlowPathPoints"), file + ": example must sample points");
    assert.ok(declared.includes("GlowPathCount"), file + ": example must gate on the bound count");
    // Balanced braces keep the snippet compiling; the browser probe draws
    // the exact example and asserts a non-empty glow.
    assert.equal((source.match(/{/g) || []).length, (source.match(/}/g) || []).length, file + ": unbalanced braces");
  }
});
