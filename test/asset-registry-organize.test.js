"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { retainedFixture } = require("./asset-retention-fixture.js");

// A minimal CM3 project class so the organizer can wrap toJSON/load.
function projectClass(PZ) {
  PZ.project = class {
    toJSON() { return { assets: this.assets?.list || {}, media: [], sequence: {} }; }
    load(data) { this.loaded = data; }
  };
}

function organized() {
  const f = retainedFixture({ setup: ({ PZ }) => projectClass(PZ) });
  const plain = value => JSON.parse(JSON.stringify(value));
  const view = () => { f.api.refresh(); const s = f.api.snapshot(); return { folders: plain(s.folders), items: plain(s.items.map(i => [i.id, i.folder, i.label])) }; };
  return { ...f, view };
}

test("folders and labels are single undo steps and survive undo/redo", async () => {
  const f = organized();
  await f.add("logo.png", "image/png");
  const footage = f.api.createFolder("Footage");
  const logos = f.api.createFolder("Logos", footage);
  assert.ok(f.api.moveItems(["logo.png"], logos));
  assert.ok(f.api.setLabel(["logo.png", logos], 11));
  assert.deepEqual(f.view().items, [["logo.png", logos, 11]]);
  assert.equal(f.view().folders.find(folder => folder.id === logos).label, 11);
  f.editor.history.undo();
  assert.deepEqual(f.view().items, [["logo.png", logos, 0]]);
  f.editor.history.undo();
  assert.deepEqual(f.view().items, [["logo.png", null, 0]]);
  f.editor.history.redo(); f.editor.history.redo();
  assert.deepEqual(f.view().items, [["logo.png", logos, 11]]);
  assert.equal(f.editor.history.undoStack.length, 4);
});

test("folders cannot move into themselves; deleting a folder moves its contents up", async () => {
  const f = organized();
  await f.add("a.png", "image/png");
  const outer = f.api.createFolder("Outer"), inner = f.api.createFolder("Inner", outer);
  f.api.moveItems(["a.png"], inner);
  assert.equal(f.api.moveItems([outer], inner), false);
  assert.equal(f.api.moveItems([outer], outer), false);
  assert.ok(f.api.deleteFolder(inner));
  assert.deepEqual(f.view().items, [["a.png", outer, 0]]);
  assert.deepEqual(f.view().folders.map(folder => folder.name), ["Outer"]);
  f.editor.history.undo();
  assert.deepEqual(f.view().items, [["a.png", inner, 0]]);
  assert.equal(f.api.renameFolder(outer, "  "), false);
  assert.ok(f.api.renameFolder(outer, "Media"));
  assert.equal(f.view().folders.find(folder => folder.id === outer).name, "Media");
});

test("metadata saves in a Zoidium root field and loads back; removed items are dropped on save", async () => {
  const f = organized();
  // Make the fixture project an instance so the wrapped methods apply.
  Object.setPrototypeOf(f.project, f.PZ.project.prototype);
  await f.add("keep.png", "image/png");
  await f.add("gone.png", "image/png");
  const folder = f.api.createFolder("Footage");
  f.api.moveItems(["keep.png", "gone.png"], folder);
  f.api.setLabel(["keep.png"], 3);
  delete f.project.assets.list["gone.png"];
  const json = JSON.parse(JSON.stringify(f.project));
  assert.deepEqual(json.zoidiumAssets, {
    version: 1,
    folders: [{ id: folder, name: "Footage", parent: null, label: 0 }],
    items: { "keep.png": { folder, label: 3 } },
  });
  const reopened = new f.PZ.project();
  reopened.load({ ...json, zoidiumAssets: { ...json.zoidiumAssets, folders: json.zoidiumAssets.folders.concat({ id: "x", name: "Bad", parent: "x", label: 99 }) } });
  f.editor.project = reopened;
  reopened.assets = f.project.assets; reopened.media = []; reopened.sequence = f.project.sequence; reopened.ui = f.project.ui;
  const view = f.view();
  assert.deepEqual(view.items.find(item => item[0] === "keep.png"), ["keep.png", folder, 3]);
  assert.equal(view.folders.find(entry => entry.id === "x").label, 0);
  // A project without the field (older saves, CM3) has no folders.
  const old = new f.PZ.project(); old.load({ assets: {}, media: [], sequence: {} });
  assert.equal(JSON.stringify(old).includes("zoidiumAssets"), false);
});

test("assign sets a matching asset property in one undo step and refuses other kinds", async () => {
  const f = organized();
  await f.add("logo.png", "image/png");
  const owner = f.child(f.project.sequence, new f.Obj("Layer"));
  const image = new f.Property("Image", null, 8, f.PZ.asset.type.IMAGE);
  const font = new f.Property("Font", null, 8, f.PZ.asset.type.FONT);
  f.properties(owner, { image, font });
  assert.deepEqual({ ...f.api.assign("logo.png", font.getAddress()) }, { ok: false, reason: "kind" });
  assert.equal(f.api.assign("logo.png", image.getAddress()).ok, true);
  assert.equal(image.get(), "logo.png");
  f.editor.history.undo();
  assert.equal(image.get(), null);
  image.animated = true;
  assert.equal(f.api.assign("logo.png", image.getAddress()).reason, "animated");
});

test("propertyAt resolves CM3 property rows and dragMedia finds the footage's Media item", async () => {
  const f = organized();
  const asset = await f.add("clip.mp4", "video/mp4");
  const image = new f.Property("Image", null, 8, f.PZ.asset.type.IMAGE);
  f.properties(f.child(f.project.sequence, new f.Obj("Layer")), { image });
  const row = { pz_object: image };
  const inner = { closest: selector => (selector === "li" ? row : null) };
  assert.equal(f.api.propertyAt(inner).kind, "image");
  assert.equal(f.api.propertyAt({ closest: () => ({ pz_object: { definition: { type: 7 } } }) }), null);
  assert.equal(f.api.dragMedia("clip.mp4"), null);
  const media = { assets: [asset] };
  f.project.media.push(media);
  assert.equal(f.api.dragMedia("clip.mp4"), media);
});
