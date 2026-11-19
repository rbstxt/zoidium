"use strict";

const assert = require("node:assert/strict");

function resourceCounter() {
  const resources = [];
  function track(Class, name) {
    return class extends Class {
      constructor(...args) {
        super(...args);
        this.disposals = 0;
        resources.push({ name, value: this });
      }
      dispose() { this.disposals++; }
    };
  }
  function assertDisposed() {
    for (const { name, value } of resources) {
      assert.equal(value.disposals, 1, `${name} must be disposed once`);
    }
  }
  return { track, assertDisposed };
}
module.exports = { resourceCounter };
