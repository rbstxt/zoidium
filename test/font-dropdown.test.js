"use strict";

// The font dropdown shares ul.pz-dropdown with other pickers. The easing
// picker's rows are li > svg icon + text span, so a bare
// ".pz-dropdown li" rule would collapse their text line boxes (and feed the
// host pz_scrollTo offsetHeight math). The line-height reset must stay scoped
// to font rows: a single styled sprite span.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function stylesheet() {
  return fs.readFileSync(path.join(root, "zoidium", "ui-overrides.css"), "utf8");
}

function rules() {
  const found = [];
  for (const match of stylesheet().matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: match[1], declarations: match[2] });
  }
  return found;
}

function liNode(children) {
  return { tag: "li", children };
}

function spanNode(style) {
  return { tag: "span", style };
}

function svgNode() {
  return { tag: "svg" };
}

// Structural mirror of li:has(> span[style]:only-child).
function isFontRow(node) {
  return node.tag === "li" && node.children.length === 1 &&
    node.children[0].tag === "span" && typeof node.children[0].style === "string";
}

test("dropdown line-height reset matches font rows only", () => {
  const targets = rules().filter(rule =>
    rule.selector.includes(".pz-dropdown") && /line-height\s*:\s*0\b/.test(rule.declarations));
  assert.ok(targets.length > 0, "expected a dropdown line-height reset rule");
  for (const { selector } of targets) {
    const guards = [...selector.matchAll(/:has\(([^()]*)\)/g)].map(match => match[1]);
    assert.ok(guards.some(guard => guard.includes("span[style]") && guard.includes("only-child")),
      `dropdown line-height rule must be scoped to font rows: ${selector.trim()}`);
  }
});

test("easing rows do not satisfy the font-row shape", () => {
  // Font row: li with a single styled sprite span.
  assert.equal(isFontRow(liNode([spanNode("background-image:url('fonts.png')")])), true);
  // Easing row: li with an svg icon plus a style-less text span.
  assert.equal(isFontRow(liNode([svgNode(), spanNode(undefined)])), false);
  // A bare text span without inline style is not a sprite row either.
  assert.equal(isFontRow(liNode([spanNode(undefined)])), false);
  // Two sprite spans are not a font row.
  assert.equal(isFontRow(liNode([spanNode("a"), spanNode("b")])), false);
});
