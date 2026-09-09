"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  requestPathname,
  shouldServeFromProject,
} = require("../tools/serve-with-resources");

test("development server recognizes live Zoidium runtime files", () => {
  assert.equal(requestPathname("/zoidium/runtime-loader.js?v=1"), "zoidium/runtime-loader.js");
  assert.equal(shouldServeFromProject("/zoidium/runtime-loader.js?v=1"), true);
  assert.equal(shouldServeFromProject("/plugins/core/temporal-render.js"), true);
  assert.equal(shouldServeFromProject("/plugins/player-plus/bundle.json?v=3"), true);
});

test("development server does not expose unrelated repository files", () => {
  assert.equal(shouldServeFromProject("/plugins/player-plus/player-plus.js"), false);
  assert.equal(shouldServeFromProject("/package.json"), false);
  assert.equal(shouldServeFromProject("/plugins/../package.json"), false);
});
