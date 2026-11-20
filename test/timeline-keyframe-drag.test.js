"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  function Keyframes() {}
  Keyframes.prototype.initProxies = function () {
    this.proxies = this.ctx.container.querySelectorAll(".kfobject.selected").map(node => node.pz_object);
  };
  const path = "plugins/core/timeline-keyframe-drag.js";
  vm.runInNewContext(fs.readFileSync(path, "utf8"), { window: { PZ: { ui: { timeline: { keyframes: Keyframes } } } } });
  return Keyframes.prototype.initProxies;
}
function selected(key) {
  const node = { pz_object: key, selected: true };
  node.classList = { remove(name) { if (name === "selected") node.selected = false; } };
  return node;
}

test("a keyframe displayed in two tracks gets one drag proxy", () => {
  const key = {}, other = {};
  const nodes = [selected(key), selected(other), selected(key), selected(other)];
  const drag = { ctx: { container: { querySelectorAll() { return nodes.filter(node => node.selected); } } } };
  setup().call(drag, false);
  assert.deepEqual(drag.proxies, [key, other]);
});
