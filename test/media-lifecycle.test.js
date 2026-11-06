"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs");
const source = fs.readFileSync(require.resolve("../plugins/core/media-lifecycle.js"), "utf8");
function fixture(loaded = true) {
  const revoked = [], rows = [];
  class Observable {
    constructor() { this.watchers = []; }
    watch(fn) { this.watchers.push(fn); fn(); }
    unwatch(fn) { this.watchers.splice(this.watchers.indexOf(fn), 1); }
    update() { for (const fn of this.watchers) fn(); }
  }
  class Panel {
    constructor() { this.el = { children: rows }; this.fuse = { list: [] }; }
    createItem(media) {
      const row = { images: [], querySelectorAll() { return this.images; } };
      media.onLoaded.watch(() => {
        if (!media.loaded) return;
        if (media.thumbnail) { row.images.push({ src: "blob:thumbnail" }); delete media.thumbnail; }
        this.fuse.list.push({ el: row });
      });
      rows.push(row); return row;
    }
    mediaDeleted(_media, index) { rows.splice(index, 1); }
    redrawList() { rows.length = 0; this.fuse.list = []; }
  }
  const PZ = { ui: { media: { list: { project: Panel } } } };
  vm.runInNewContext(source, { PZ, Blob, URL: { revokeObjectURL: url => revoked.push(url) } });
  const panel = new Panel(), media = { loaded, thumbnail: new Blob(["image"]), onLoaded: new Observable() };
  return { panel, media, revoked, rows };
}

test("deletion releases thumbnail URLs, loaded callbacks, and search rows", () => {
  const f = fixture(); const row = f.panel.createItem(f.media);
  assert.equal(f.panel.fuse.list[0].el, row);
  f.panel.mediaDeleted(f.media, 0);
  assert.equal(f.panel.fuse.list.length, 0); assert.equal(f.media.onLoaded.watchers.length, 0);
  assert.deepEqual(f.revoked, ["blob:thumbnail"]);
});

test("deleting pending media prevents late thumbnail allocation and detached search rows", () => {
  const f = fixture(false); f.panel.createItem(f.media); f.panel.mediaDeleted(f.media, 0);
  f.media.loaded = true; f.media.onLoaded.update();
  assert.equal(f.panel.fuse.list.length, 0); assert.equal(f.media.onLoaded.watchers.length, 0);
  assert.deepEqual(f.revoked, []);
});

test("redraw and project replacement release every old row, including late-loaded thumbnails", () => {
  const f = fixture(false); f.panel.createItem(f.media);
  f.media.loaded = true; f.media.onLoaded.update();
  f.panel.redrawList();
  assert.equal(f.rows.length, 0); assert.equal(f.media.onLoaded.watchers.length, 0);
  assert.deepEqual(f.revoked, ["blob:thumbnail"]);
});
