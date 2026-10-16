"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const fs = require("node:fs"), vm = require("node:vm");
const { retainedFixture } = require("./asset-retention-fixture.js");
const plain = value => JSON.parse(JSON.stringify(value));

test("the live project retains each FILE once, including created and loaded placeholders", async () => {
  const f = retainedFixture(), asset = await f.add("unused.ttf");
  assert.equal(asset.references, 1); assert.equal(f.api.retained(asset.key), true);
  f.project.assets.onAssetCreated.update(asset); f.api.snapshot();
  assert.equal(asset.references, 1); assert.equal(f.items()[0].retained, true);
  f.project.assets.load(asset); f.project.assets.unload(asset);
  assert.equal(f.project.assets.list[asset.key], asset); assert.equal(f.revoked.length, 0);
  const other = { ...f.project, assets: new f.PZ.assetList() };
  const loaded = { ...asset, key: "missing", file: null, references: 0 };
  other.assets.list.missing = loaded;
  f.editor.project = other; f.editor.onProjectChanged.update();
  assert.equal(asset.references, 0); assert.equal(f.project.assets.list[asset.key], asset);
  assert.equal(loaded.references, 1); assert.equal(f.api.retained("missing"), true);
  f.editor.project = null; f.editor.onProjectChanged.update();
  assert.equal(loaded.references, 0); assert.equal(other.assets.list.missing, loaded);
  f.api.dispose(); assert.equal(f.revoked.length, 0);
});

test("private projects and presets receive no retention references", async () => {
  const f = retainedFixture(), privateList = new f.PZ.assetList();
  const asset = await privateList.createFromFile(0, f.file("private.png"));
  assert.equal(asset.references, 0); assert.equal(f.api.retained(asset.key), false);
  const preset = { ...asset, key: "/preset", source: 3 };
  f.project.assets.list[preset.key] = preset; f.project.assets.onAssetCreated.update(preset);
  assert.equal(preset.references, 0); assert.equal(f.items().every(item => typeof item.retained === "boolean"), true);
});

test("Remove Unused deletes Media-only holds in one reversible operation with the same asset objects", async () => {
  const f = retainedFixture(), imported = await f.api.import([f.file("image.png", "png", "image/png"), f.file("font.ttf")]);
  assert.equal(imported.ok, true); assert.equal(f.project.media.length, 1); assert.equal(f.editor.history.undoStack.length, 1);
  const assets = imported.items.map(item => f.project.assets.list[item.id]), oldUrls = assets.map(a => a.url);
  const removed = f.api.removeUnused(); assert.equal(removed.removed.length, 2); assert.equal(removed.freed, 11);
  assert.equal(f.project.media.length, 0); assert.equal(f.editor.history.undoStack.length, 2);
  assert.equal(Object.keys(f.project.assets.list).length, 0);
  f.editor.history.undo(); assert.equal(f.project.media.length, 1);
  assets.forEach((asset, i) => { assert.equal(f.project.assets.list[asset.key], asset); assert.notEqual(asset.url, oldUrls[i]); assert.equal(f.api.retained(asset.key), true); });
  f.editor.history.redo(); assert.equal(f.project.media.length, 0); assert.equal(f.items().length, 0);
  f.editor.history.undo(); f.editor.history.undo(); assert.equal(f.items().length, 0);
  f.editor.history.redo(); assert.equal(f.items().length, 2); assert.equal(f.project.media.length, 1);
});

test("import deduplicates bytes and undo leaves pre-existing items alone", async () => {
  const f = retainedFixture(), old = await f.add("existing.ttf", "", "same");
  const result = await f.api.import([f.file("renamed.ttf", "same"), f.file("new.ttf"), f.file("again.ttf", "same")]);
  assert.deepEqual(plain(result.items.map(i => i.created)), [false, true, false]);
  assert.equal(f.editor.history.undoStack.length, 1);
  f.editor.history.undo(); assert.equal(f.items().length, 1); assert.equal(f.project.assets.list.same, old);
  f.editor.history.redo(); assert.equal(f.items().length, 2);
});

test("selected used items are skipped by Remove Unused; forced deletion clears properties and all matching keyframes", async () => {
  const f = retainedFixture(), asset = await f.add("used.png"), other = await f.add("other.png");
  const owner = f.child(f.project.sequence, new f.Obj("Owner")), prop = new f.Property("Image", asset.key), dynamic = new f.Property("Animated", null);
  dynamic.keyframes = [{ frame: 0, value: asset.key }, { frame: 1, value: other.key }, { frame: 2, value: asset.key }];
  f.properties(owner, { image: prop, animated: dynamic });
  assert.equal(f.api.removeUnused([asset.key]).skipped.length, 1);
  const result = await f.api.removeItems([asset.key]); assert.equal(result.ok, true); assert.equal(prop.get(), null);
  assert.deepEqual(dynamic.keyframes.map(k => k.value), [other.key]); assert.equal(f.project.assets.list[asset.key], undefined);
  assert.equal(f.editor.history.undoStack.length, 1);
  f.editor.history.undo(); assert.equal(prop.get(), asset.key); assert.equal(dynamic.keyframes.length, 3); assert.equal(f.project.assets.list[asset.key], asset);
  f.editor.history.redo(); assert.equal(prop.get(), null); assert.equal(dynamic.keyframes.length, 1);
});

test("closed composition uses refuse deletion before any edit; adapters clear through the same operation", async () => {
  const f = retainedFixture(), asset = await f.add("graph.png"), property = new f.Property("Graph", asset.key);
  f.properties(f.child(f.project.sequence, new f.Obj("Material")), { graph: property });
  const stop = f.api.registerReferences({ id: "closed", collect(_project, emit) { emit({ key: asset.key, composition: { id: "closed", name: "Closed" } }); } });
  const refused = await f.api.removeItems([asset.key]); assert.equal(refused.reason, "in-closed-composition"); assert.equal(f.editor.history.undoStack.length, 0);
  stop(); let clears = 0;
  f.api.registerReferences({ id: "graph", collect(_project, emit) { if (property.get()) emit({ key: asset.key }); }, clear() { clears++; new f.PZ.ui.properties(f.editor).setValue({ property: property.getAddress(), value: null }); } });
  const result = await f.api.removeItems([asset.key]); assert.equal(result.ok, true); assert.equal(clears, 1);
  f.editor.history.undo(); assert.equal(property.get(), asset.key); assert.equal(f.api.retained(asset.key), true);
});

test("removal joins an open operation and works for reconstructed project files", async () => {
  const f = retainedFixture(), asset = await f.add("old.ttf");
  const reloaded = { ...asset, file: f.file("old.ttf"), data: new Map(), references: 0, url: "blob:reopened" };
  f.editor.project = { ...f.project, assets: new f.PZ.assetList(), media: [] }; f.editor.project.assets.list[asset.key] = reloaded;
  f.editor.onProjectChanged.update(); f.editor.history.startOperation(); const operation = f.editor.history.operation;
  assert.equal(f.api.removeUnused().removed.length, 1); assert.equal(f.editor.history.operation, operation);
  f.editor.history.finishOperation(); f.editor.history.undo(); assert.equal(f.editor.project.assets.list[asset.key], reloaded);
  f.editor.history.redo(); assert.equal(f.editor.project.assets.list[asset.key], undefined);
});

test("unused failed and missing FILEs do not block frame completion or churn idle revisions", async () => {
  const f = retainedFixture(), asset = await f.add("failed.ttf");
  asset.data.set(f.PZ.asset.font, { zoidiumFont3dState: "failed" });
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/output-frame-store.js"), "utf8"), f.sandbox);
  const model = f.sandbox.ZoidiumOutputFrameStore;
  assert.equal(model.assetsComplete(f.project), true);
  const first = f.api.snapshot(); f.flush(); assert.equal(f.api.snapshot(), first);
  f.project.assets.load(asset); assert.equal(model.assetsComplete(f.project), true);
  const property = new f.Property("Font", asset.key);
  f.properties(f.child(f.project.sequence, new f.Obj("Text")), { font: property }); f.api.refresh();
  assert.equal(model.assetsComplete(f.project), false);
  property.set(null); f.api.refresh();
  f.project.assets.unload(asset); asset.file = null;
  assert.equal(model.assetsComplete(f.project), true);
  const privateProject = { assets: { list: { failed: { ...asset, references: 0 } } } };
  assert.equal(model.assetsComplete(privateProject), true);
});

test("intentional missing unused footage can be archived without accepting damaged attached entries", async () => {
  const { installArchive } = require("./project-archive-harness.cjs");
  const io = installArchive({ PZ: {} });
  const document = { assets: { missing: { source: 1, sha256: "missing", filename: "Missing.ttf" } } };
  await assert.rejects(io.checkAssets({ files: [] }, document, null, "save"), /missing/);
  await io.checkAssets({ files: [] }, document, { missingAssets: ["missing"], integrity: {} }, "save");
  await io.checkAssets({ files: [] }, document, { missingAssets: ["missing"], integrity: {} }, "open");
  await assert.rejects(io.checkAssets({ files: [] }, document, {
    missingAssets: ["missing"], integrity: { missing: { size: 4, sha256: "0".repeat(64) } },
  }, "open"), /missing/);
  await assert.rejects(io.checkAssets({ files: [{ name: "missing", data: new Blob([]) }] }, document, { missingAssets: ["missing"] }, "save"), /empty/);
});

test("Delete Items calls the native clip path and restores the asset before its clip inverse", async () => {
  const f = retainedFixture(), asset = await f.add("footage.mp4");
  const clip = f.child(f.project.sequence, new f.Clip("Footage"));
  f.properties(clip, { media: new f.Property("Media", asset.key) });
  const track = { clips: [clip] }; f.project.sequence.videoTracks = [track];
  let deletes = 0;
  const tracks = { deleteClip() {
    deletes++; track.clips.pop(); f.project.sequence.children.splice(f.project.sequence.children.indexOf(clip), 1);
    f.editor.history.pushCommand(() => {
      assert.equal(f.project.assets.list[asset.key], asset); assert.equal(f.api.retained(asset.key), true);
      track.clips.push(clip); f.project.sequence.children.push(clip);
      f.editor.history.pushCommand(() => tracks.deleteClip());
    });
  } };
  f.sandbox.ZoidiumAssetRegistryParts.panelsOf = () => ({ tracks });
  assert.equal((await f.api.removeItems([asset.key])).ok, true); assert.equal(deletes, 1); assert.equal(track.clips.length, 0);
  f.editor.history.undo(); assert.equal(track.clips.length, 1);
  f.editor.history.redo(); assert.equal(deletes, 2); assert.equal(f.project.assets.list[asset.key], undefined);
});

test("Material+ and IES adapter clear hooks use reversible native property edits", async () => {
  const f = retainedFixture(), asset = await f.add("graph.png");
  const owner = f.child(f.project.sequence, new f.Obj("Material"));
  const original = JSON.stringify({ nodes: [{ id: "a", params: { asset: asset.key } }, { id: "b", params: { asset: asset.key } }] });
  f.properties(owner, { graph: new f.Property("Graph", original, 7), nodeImage: new f.Property("Image", asset.key) });
  f.adapter("material-plus"); assert.equal(f.items()[0].usages.length, 2);
  assert.equal((await f.api.removeItems([asset.key])).ok, true);
  assert.equal(JSON.parse(owner.properties.graph.get()).nodes.every(node => node.params.asset === null), true);
  f.editor.history.undo(); assert.equal(owner.properties.graph.get(), original); assert.equal(f.project.assets.list[asset.key], asset);
  const light = f.child(f.project.sequence, new f.Obj("Light"));
  f.properties(light, { iesProfile: new f.Property("Profile", "Custom", 7), iesFilename: new f.Property("Filename", "Lamp.ies", 7), iesData: new f.Property("IES", "IESNA:LM-63", 7) });
  f.adapter("trapcode-suite"); const ies = f.items().find(item => item.kind === "ies");
  assert.equal((await f.api.removeItems([ies.id])).ok, true);
  assert.equal(light.properties.iesData.get(), ""); assert.equal(light.properties.iesFilename.get(), ""); assert.equal(light.properties.iesProfile.get(), "Downlight");
  f.editor.history.undo(); assert.equal(light.properties.iesData.get(), "IESNA:LM-63"); assert.equal(light.properties.iesFilename.get(), "Lamp.ies"); assert.equal(light.properties.iesProfile.get(), "Custom");
});

test("late decoder releases cannot collect a removed asset twice or delete a newer same-key import", async () => {
  const f = retainedFixture(), asset = await f.add("cached.cube", "", "same bytes");
  f.project.assets.load(asset);
  assert.equal(f.api.removeUnused().removed.length, 1); assert.equal(asset.references, 1);
  const replacement = await f.add("new.cube", "", "same bytes");
  assert.notEqual(replacement, asset); f.project.assets.unload(asset);
  assert.equal(f.project.assets.list[replacement.key], replacement); assert.equal(f.api.retained(replacement.key), true);
  assert.equal(f.revoked.length, 1); assert.equal(f.editor.history.operation, null);
});

test("Remove Unused clears stale Precomp hold keys without deleting the composition or resurrecting missing files", async () => {
  const f = retainedFixture(), asset = await f.add("former.png");
  const comp = { comp: { id: "comp-unused" }, assets: [f.project.assets.load(asset, true)] };
  f.project.media.push(comp);
  assert.equal(f.api.removeUnused().removed.length, 1); assert.equal(f.project.media[0], comp); assert.equal(comp.assets.length, 0);
  assert.equal(f.project.assets.list[asset.key], undefined);
  f.editor.history.undo(); assert.equal(f.project.assets.list[asset.key], asset); assert.equal(comp.assets[0], asset); assert.equal(asset.mediaReferences, 1);
  f.editor.history.redo(); assert.equal(comp.assets.length, 0); assert.equal(f.project.assets.list[asset.key], undefined);
});

test("an unused composition is deleted only when named, through Precomp+", async () => {
  const f = retainedFixture(), removed = [];
  f.PZ.precomp = { entries: () => [{ id: "intro", name: "Intro", length: 60 }],
    removeComp: (editor, id) => { assert.equal(editor, f.editor); removed.push(id); return { ok: true }; } };
  assert.equal(f.api.removeUnused().removed.length, 0, "Remove Unused Items keeps compositions");
  assert.deepEqual(removed, []);
  const result = f.api.removeUnused(["comp:intro"]);
  assert.deepEqual(removed, ["intro"]); assert.deepEqual(plain(result.removed.map(entry => entry.id)), ["comp:intro"]);
  f.PZ.precomp.removeComp = () => ({ ok: false, message: "Intro is used by Main." });
  const refused = f.api.removeUnused(["comp:intro"]);
  assert.equal(refused.removed.length, 0); assert.equal(refused.skipped[0].error, "Intro is used by Main.");
  f.api.dispose();
});
