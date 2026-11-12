"use strict";
// The Toggle checkbox display must follow the editor theme instead of the
// browser-default white square and blue tick. The row keeps a real checkbox
// input (keyboard, focus ring, and click behaviour unchanged); only its
// painting comes from the --zui-* theme tokens.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { installControls } = require("../plugins/shader-plus/controls.js");

const css = fs.readFileSync(path.join(__dirname, "../plugins/shader-plus/style.css"), "utf8");
const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(match => match[1].includes(".zsp-checkbox"))
  .map(match => ({ selector: match[1].trim(), body: match[2] }));
const bodies = rules.map(rule => rule.body).join("\n");

test("the Toggle checkbox is drawn with theme tokens, not literal colors", () => {
  assert.ok(rules.length >= 3, "expected base, :checked, and focus rules for .zsp-checkbox");
  assert.ok(bodies.includes("var(--zui-bg-input)"), "off state uses the theme input background");
  assert.ok(bodies.includes("var(--zui-accent)"), "on state uses the theme accent");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(bodies), "no literal hex colors in .zsp-checkbox rules");
  assert.ok(!/\brgba?\s*\(/.test(bodies), "no literal rgb() colors in .zsp-checkbox rules");
  assert.ok(!/\bhsla?\s*\(/.test(bodies), "no literal hsl() colors in .zsp-checkbox rules");
});

test("the Toggle checkbox keeps a real focusable input with appearance:none", () => {
  const base = rules.find(rule => rule.selector === ".zsp-checkbox");
  assert.ok(base, "expected a base .zsp-checkbox rule");
  assert.ok(base.body.includes("appearance: none"), "base rule disables native painting with appearance: none");
  assert.ok(rules.some(rule => rule.selector.includes(":checked")), "expected a :checked rule for the on state");
  assert.ok(rules.some(rule => rule.selector.includes(":focus-visible")), "expected a :focus-visible focus ring");
});

test("the Toggle checkbox row still renders a real checkbox input", () => {
  const { document } = require("./property-groups-ui-harness");
  const controls = new Map(), doc = document();
  let value = 0;
  const p = { definition: { zoidiumShader: { display: "checkbox" } }, properties: { name: { get: () => "Enabled" } }, frameOffset: 0,
    getAddress: () => [0], get: () => value, set(next) { value = next; } };
  const project = { addressLookup: () => p };
  const frame = {};
  const PZ = { property: { type: { NUMBER: 0 } }, ui: { controls: {
    editStart() { frame.current = 9; }, editFinish() {},
  } } };
  installControls({ PZ, doc, register: (id, type, create) => controls.set(id, create), editor: () => ({ project, playback: { currentFrame: 9 } }) });
  const box = controls.get("shader-plus/checkbox")(p), input = box.children[0];
  assert.equal(input.tagName, "INPUT");
  assert.equal(input.getAttribute("type"), "checkbox");
  assert.ok(input.classList.contains("zsp-checkbox"));
  box.pz_update(9); assert.equal(input.checked, false);
  input.checked = true; input.onchange(); assert.equal(value, 1);
});
