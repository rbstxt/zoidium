"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { triangulate } = require("../plugins/shape-plus/text-fill");
test("the remaining polygon edge limit produces one visible notice per failure", () => {
  const notices = [], warnings = [];
  const c = { module: { exports: {} }, console: { warn: text => warnings.push(text) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: event => notices.push(event) };
  vm.runInNewContext(fs.readFileSync("plugins/shape-plus/geometry-failure.js", "utf8"), c);
  const contours = Array.from({length: 3000}, (_, glyph) =>
    Array.from({length: 24}, (_, i) => [glyph * 40 + Math.cos(i / 24 * Math.PI * 2), Math.sin(i / 24 * Math.PI * 2)]));
  assert.throws(() => triangulate(contours), /polygon edge budget exceeded/);
  const { paint } = c.module.exports;
  for (let i = 0; i < 3; i++) assert.equal(paint("long-text-fill", () => triangulate(contours)).length, 0);
  assert.equal(warnings.length, 1); assert.equal(notices.length, 1);
  assert.equal(notices[0].type, "zoidium:notification");
  assert.equal(notices[0].detail.title, "Shape+ could not render");
  assert.match(notices[0].detail.message, /polygon edge budget exceeded/);
  assert.match(notices[0].detail.message, /split the content across layers/);
  assert.deepEqual(paint("small-fill", () => triangulate([[[0,0],[10,0],[10,10],[0,10]]])),
    triangulate([[[0,0],[10,0],[10,10],[0,10]]]));
  assert.equal(notices.length, 1);
});
