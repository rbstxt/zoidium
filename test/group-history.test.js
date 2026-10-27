"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "plugins", "core", "empty-keyframes.js"), "utf8");

// Mirrors the CM3 group loader's legacy animated propagation and recursive load.
class Group {
  constructor(children) { this.objects = children; }
  get animated() { return this.objects.some(child => child.animated); }
  toJSON() { return { objects: this.objects }; }
  load(data) {
    if (!data) return;
    if (data.animated !== undefined) for (const child of data.objects) child.animated = data.animated;
    this.objects.forEach((child, i) => child.load(data.objects[i]));
  }
}
class Keyframes {
  constructor(value) { this.animated = true; this.keyframes = [{ frame: 12, value }]; }
  toJSON() { return { animated: this.animated, keyframes: this.keyframes }; }
  load(data) { this.animated = data.animated; this.keyframes = data.keyframes; }
}
const realm = { PZ: { property: { dynamic: { group: Group } } } };
vm.runInNewContext(source, realm);

test("live nested groups reload with their keyframes without mutating the deleted object", () => {
  const old = new Group([new Group([new Keyframes(7)])]);
  const fresh = new Group([new Group([new Keyframes(0)])]);
  fresh.load(old);
  assert.equal(fresh.objects[0].objects[0].keyframes[0].value, 7);
  assert.equal(fresh.objects[0].objects[0].keyframes[0].frame, 12);
  assert.equal(old.objects[0].objects[0].animated, true);
});

test("plain legacy data still reaches the original loader", () => {
  const fresh = new Group([new Keyframes(0)]);
  fresh.load({ animated: false, objects: [{ keyframes: [{ frame: 0, value: 3 }] }] });
  assert.equal(fresh.objects[0].animated, false);
  assert.equal(fresh.objects[0].keyframes[0].value, 3);
});
