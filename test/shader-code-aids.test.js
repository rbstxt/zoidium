"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { completions, symbols, wordAt } = require("../plugins/shader-plus/code-assist.js");
const { toggleComments, bracketEdit, enterEdit, createUndo } = require("../plugins/shader-plus/code-edit.js");
test("completion ranks exact-case property prefixes before reference, builtins and local identifiers", () => {
  const entries = [{ name: "MixAmount", property: true }, { name: "mixHelper" }, { name: "mixColor", property: true }];
  assert.deepEqual(completions("float mixed;\nmi", 15, entries).map(e => e.name), ["mixColor", "mixHelper", "min", "mix", "mixed", "MixAmount"]);
});
test("reference helpers, GLSL and local identifiers complete without duplicates", () => {
  assert.ok(completions("zGra", 4, symbols(null)).some(e => e.name === "zGradient"));
  assert.deepEqual(completions("float myLocal; myL", 18, []).map(e => e.name), ["myLocal"]);
  assert.equal(completions("// zGra", 7, []).length, 0);
  assert.equal(new Set(completions("zC", 2, symbols(null)).map(e=>e.name)).size, completions("zC", 2, symbols(null)).length);
  assert.deepEqual(wordAt("zGradient(x)", 3), { start: 0, end: 9, word: "zGradient" });
});
test("comment toggle handles indentation, blank lines and selection ending on newline", () => {
  const source = "  a\n\n  b\nc";
  const commented = toggleComments(source, 0, 9);
  assert.equal(commented.text, "  // a\n\n  // b\nc");
  assert.equal(toggleComments(commented.text, commented.start, commented.end).text, source);
  assert.equal(toggleComments("a\nb", 0, 2).text, "// a\nb");
  assert.equal(toggleComments("  // a", 4, 4).text, "  a");
});
test("brackets wrap selections, skip closers, remove empty pairs and ignore comments", () => {
  assert.deepEqual(bracketEdit("abc", 0, 3, "("), { text: "(abc)", start: 1, end: 4 });
  assert.deepEqual(bracketEdit("()", 1, 1, ")"), { text: "()", start: 2, end: 2 });
  assert.deepEqual(bracketEdit("[]", 1, 1, "Backspace"), { text: "", start: 0, end: 0 });
  assert.equal(bracketEdit("// test", 7, 7, "("), null);
});
test("Enter indents blocks and separates paired braces", () => {
  assert.deepEqual(enterEdit("  if (x) {}", 10, 10), { text: "  if (x) {\n    \n  }", start: 15, end: 15 });
  assert.deepEqual(enterEdit("  foo();", 8, 8), { text: "  foo();\n  ", start: 11, end: 11 });
});
test("editor undo is isolated, tracks selections, supports redo and resets on external change", () => {
  const h = createUndo({ text: "", start: 0, end: 0 });
  h.record({ text: "a", start: 1, end: 1 }); h.before({ start: 0, end: 1 }); h.record({ text: "b", start: 1, end: 1 });
  assert.deepEqual(h.undo(), { text: "a", start: 0, end: 1 }); assert.equal(h.redo().text, "b");
  h.reset({ text: "applied", start: 0, end: 0 }); assert.equal(h.undo(), null);
});
