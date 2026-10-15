"use strict";

// SEC-07: skin CSS is untrusted. Remote url() fetches and @import are
// stripped so a skin can neither phone home nor pull a hostile font, and
// @keyframes names are namespaced per skin id so suites cannot collide.

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");

const { kitScripts, readScript } = require("./uikit-files");
const { FakeElement } = require("./fake-dom");

function loadKit() {
  const head = new FakeElement("head");
  head.children = [];
  head.appendChild = function (child) { this.children.push(child); return child; };
  const context = {
    console: { error() {} },
    document: {
      head: head,
      createElement: (tag) => new FakeElement(tag),
      querySelector: () => null,
    },
  };
  context.window = context;
  vm.createContext(context);
  for (const file of kitScripts()) vm.runInContext(readScript(file), context, { filename: file });
  const css = () => head.children.map((child) => child.textContent).join("\n");
  return { api: context.ZoidiumUI, css };
}

test("remote url() declarations are dropped while data: URLs survive", () => {
  const { api, css } = loadKit();
  api.registerSkin("suite:tracker", [
    ".ok { color: red; }",
    '.ping { background: url("https://tracker.example/ping?x=1"); }',
    ".sneaky { list-style: square URL(http://tracker.example/a.png); color: blue; }",
    ".icon { background: url(data:image/png;base64,iVBORw0KGgo=); }",
    ".unquoted { background: url(https://tracker.example/b.png); }",
  ].join("\n"));
  const out = css();
  assert.ok(out.includes(".ok{"), out);
  assert.ok(!out.includes("tracker.example"), "no remote fetch survives: " + out);
  assert.ok(!out.includes("ping{"), "a rule emptied by stripping is dropped: " + out);
  assert.ok(out.includes("data:image/png;base64,iVBORw0KGgo="), "embedded data survives: " + out);
});

test("@import is removed without corrupting the next rule", () => {
  const { api, css } = loadKit();
  api.registerSkin("suite:imports", [
    '@import "https://evil.example/x.css";',
    "@import url(https://evil.example/y.css);",
    ".after { color: green; }",
  ].join("\n"));
  const out = css();
  assert.ok(!out.includes("@import"), out);
  assert.ok(!out.includes("evil.example"), out);
  assert.ok(out.includes(".after{"), "the rule after @import still scopes: " + out);
});

test("@font-face keeps data: fonts but loses remote sources", () => {
  const { api, css } = loadKit();
  api.registerSkin("suite:fonts", [
    '@font-face { font-family: "Remote"; src: url("https://fonts.example/a.woff2"); }',
    '@font-face { font-family: "Local"; src: url(data:font/woff2;base64,d09GRg==); }',
  ].join("\n"));
  const out = css();
  assert.ok(!out.includes("fonts.example"), out);
  assert.ok(out.includes("data:font/woff2;base64,d09GRg=="), out);
});

test("@keyframes are namespaced per skin and references follow", () => {
  const { api, css } = loadKit();
  api.registerSkin("suite:a", [
    "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }",
    ".x { animation: fade 1s ease; }",
    ".y { animation-name: fade; }",
    ".z { color: red; }",
  ].join("\n"));
  api.registerSkin("other:b", "@keyframes fade { from { opacity: 1; } }");
  const out = css();
  assert.ok(out.includes("@keyframes zui-suite_a-fade{"), out);
  assert.ok(out.includes("@keyframes zui-other_b-fade{"), "same name in two skins never collides: " + out);
  assert.ok(out.includes("animation: zui-suite_a-fade 1s ease;"), out);
  assert.ok(out.includes("animation-name: zui-suite_a-fade;"), out);
  assert.ok(!out.includes("animation: fade"), out);
  assert.ok(!out.includes("@keyframes fade{"), out);
});

test("keyframes inside @media resolve against the skin namespace", () => {
  const { api, css } = loadKit();
  api.registerSkin("suite:media", [
    "@keyframes spin { to { transform: rotate(1turn); } }",
    "@media (prefers-reduced-motion: no-preference) { .w { animation-name: spin; } }",
  ].join("\n"));
  const out = css();
  assert.ok(out.includes("@keyframes zui-suite_media-spin{"), out);
  assert.ok(out.includes("animation-name: zui-suite_media-spin;"), out);
});
