"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createFontPreviews } = require("../plugins/asset-manager/assets-font-previews.js");
function fixture() {
  const faces = [], loaded = new Set(), changes = [];
  class Face {
    constructor(family) { this.family = family; faces.push(this); }
    load() { return new Promise((resolve, reject) => { this.resolve = () => resolve(this); this.reject = reject; }); }
  }
  const previews = createFontPreviews({ fonts: loaded }, Face, item => changes.push(item));
  const item = { id: "font", name: "Font.ttf", url: "blob:first" };
  return { faces, loaded, changes, previews, item };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("closing Assets before a font settles cannot register the face or repaint", async () => {
  for (const rejects of [false, true]) {
    const f = fixture(); f.previews.family(f.item); f.previews.dispose();
    if (rejects) f.faces[0].reject(new Error("Canceled")); else f.faces[0].resolve();
    await flush();
    assert.equal(f.loaded.size, 0); assert.equal(f.changes.length, 0);
  }
});

test("removal and same-key replacement discard loaded and pending font faces", async () => {
  const f = fixture(); f.previews.family(f.item); f.faces[0].resolve(); await flush();
  assert.equal(f.loaded.size, 1);
  f.previews.prune([]); assert.equal(f.loaded.size, 0);
  f.previews.family(f.item);
  const replacement = { ...f.item, url: "blob:second" };
  f.previews.prune([replacement]); f.previews.family(replacement);
  f.faces[1].resolve(); await flush(); assert.equal(f.loaded.size, 0);
  f.faces[2].resolve(); await flush(); assert.deepEqual([...f.loaded], [f.faces[2]]);
  assert.equal(f.previews.family(replacement), f.faces[2].family);
  assert.equal(f.faces.length, 3);
  f.previews.dispose(); assert.equal(f.loaded.size, 0);
});
