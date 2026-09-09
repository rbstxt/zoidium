"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

// The policy layer owns the shared PZ.zoidium namespace: integrations
// register through define() so collisions report both owners instead of
// silently overwriting each other.
function loadPolicy() {
  const source = fs.readFileSync(
    path.join(projectRoot, "zoidium", "runtime-policy.js"),
    "utf8"
  );
  const warnings = [];
  const context = {
    console: { warn(message) { warnings.push(String(message)); }, error() {} },
    Response: function () {},
    document: { createElement() { return { style: {} }; } },
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return { PZ: context.PZ, warnings };
}

test("define registers the api and reports its owner", () => {
  const { PZ } = loadPolicy();
  const api = { version: 1 };
  assert.equal(PZ.zoidium.define("widget", api, "my-plugin"), api);
  assert.equal(PZ.zoidium.widget, api);
  assert.equal(PZ.zoidium.ownerOf("widget"), "my-plugin");
});

test("a collision warns with both owners and keeps last-wins behavior", () => {
  const { PZ, warnings } = loadPolicy();
  PZ.zoidium.define("shared", { from: "first" }, "first-owner");
  const second = { from: "second" };
  PZ.zoidium.define("shared", second, "second-owner");
  assert.equal(PZ.zoidium.shared, second);
  assert.equal(PZ.zoidium.ownerOf("shared"), "second-owner");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /shared/);
  assert.match(warnings[0], /first-owner/);
  assert.match(warnings[0], /second-owner/);
});

test("re-registering the same object is not a collision", () => {
  const { PZ, warnings } = loadPolicy();
  const api = {};
  PZ.zoidium.define("stable", api, "owner");
  PZ.zoidium.define("stable", api, "owner");
  assert.equal(warnings.length, 0);
});

test("an empty namespace name throws", () => {
  const { PZ } = loadPolicy();
  assert.throws(() => PZ.zoidium.define("", {}, "owner"));
  assert.throws(() => PZ.zoidium.define(null, {}, "owner"));
});

test("ownerOf is null for unknown names", () => {
  const { PZ } = loadPolicy();
  assert.equal(PZ.zoidium.ownerOf("missing"), null);
});
