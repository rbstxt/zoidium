"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { retainedFixture } = require("./asset-retention-fixture.js");
function owner(f, name, key, assetType = 0) {
  const node = f.child(f.project.sequence, new f.Obj(name));
  const prop = new f.Property("Asset", key, 8, assetType);
  f.properties(node, { asset: prop });
  return { node, prop };
}
function read(f) { f.api.refresh(); return f.api.snapshot(); }

test("replacement edits each native property, every matching keyframe and Media template in one undo", async () => {
  const f = retainedFixture(), old = await f.add("old.png", "image/png"), next = await f.add("new.png", "image/png");
  const fields = ["Image", "Texture", "Font", "Geometry", "LUT", "Media", "Custom image"].map(name => owner(f, name, old.key).prop);
  const animated = owner(f, "Animated", old.key).prop;
  animated.keyframes = [{ frame: 0, value: old.key }, { frame: 10, value: next.key }, { frame: 20, value: old.key }];
  animated.get = frame => animated.keyframes.find(kf => kf.frame === frame)?.value;
  animated.set = (value, frame) => { animated.keyframes.find(kf => kf.frame === frame).value = value; };
  // Use native propertyOps' frame-aware semantics in the fixture too.
  const originalOps = f.PZ.ui.properties.prototype.setValue;
  f.PZ.ui.properties.prototype.setValue = function ({ property, value, frame }) {
    if (frame === undefined) return originalOps.call(this, { property, value });
    const prop = this.editor.project.addressLookup(property), previous = prop.get(frame);
    prop.set(value, frame);
    this.editor.history.pushCommand(() => this.setValue({ property, frame, value: previous }));
  };
  const data = [{ properties: { media: old.key }, object: { properties: { childProperties: { image: old.key } } } }];
  const media = { data, assets: [f.project.assets.load(old, true)] };
  f.project.media.push(media);
  const result = await f.api.replace(old.key, { itemId: next.key });
  assert.equal(result.ok, true); assert.equal(result.replaced, 10); assert.equal(result.newId, next.key);
  assert(fields.every(prop => prop.get() === next.key));
  assert(animated.keyframes.every(kf => kf.value === next.key));
  assert.equal(media.data[0].properties.media, next.key); assert.equal(media.assets[0], next);
  assert.equal(old.mediaReferences, 0); assert.equal(next.mediaReferences, 1);
  assert.equal(f.editor.history.undoStack.length, 1);
  f.editor.history.undo();
  assert(fields.every(prop => prop.get() === old.key));
  assert.deepEqual(animated.keyframes.map(kf => kf.value), [old.key, next.key, old.key]);
  assert.equal(media.data, data); assert.equal(media.assets[0], old);
  f.editor.history.redo(); assert(fields.every(prop => prop.get() === next.key));
  assert.equal(old.references, 1); assert.equal(next.references, 1);
  f.api.dispose();
});

test("replacement skips closed compositions, joins an existing operation and leaves closed Media intact", async () => {
  const f = retainedFixture(), old = await f.add("old.png", "image/png"), next = await f.add("new.png", "image/png");
  const { prop } = owner(f, "Live", old.key);
  const tracks = [{ properties: { image: old.key } }];
  const comp = { comp: { id: "closed" }, data: tracks, assets: [f.project.assets.load(old, true)] };
  f.project.media.push(comp);
  f.PZ.precomp = { entries: () => [], referenceSources: () => [{ id: "closed", name: "Closed", tracks, editing: false }] };
  f.editor.history.startOperation(); const operation = f.editor.history.operation;
  const result = await f.api.replace(old.key, { itemId: next.key });
  assert.equal(result.ok, true); assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, "closed-composition"); assert(result.skipped[0].path.includes('Comp "Closed"'));
  assert.equal(comp.data, tracks); assert.equal(comp.assets[0], old); assert.equal(prop.get(), next.key);
  assert.equal(f.editor.history.operation, operation); assert.equal(f.editor.history.undoStack.length, 0);
  f.editor.history.finishOperation(); f.editor.history.undo(); assert.equal(prop.get(), old.key);
  f.api.dispose();
});

test("file targets use retained deduplicating import; kind mismatch never imports or changes history", async () => {
  const f = retainedFixture(), old = await f.add("old.png", "image/png");
  const { prop } = owner(f, "Image", old.key);
  const wrong = await f.api.replace(old.key, { file: f.file("font.ttf", "font") });
  assert.equal(wrong.ok, false); assert.equal(wrong.reason, "kind");
  assert.equal(Object.keys(f.project.assets.list).length, 1); assert.equal(f.editor.history.undoStack.length, 0);
  const file = f.file("new.png", "new-image", "image/png");
  const result = await f.api.replace(old.key, { file });
  assert.equal(result.ok, true); assert.equal(prop.get(), "new-image"); assert.equal(f.api.retained(result.newId), true);
  assert.equal(f.editor.history.undoStack.length, 1);
  f.editor.history.undo(); assert.equal(prop.get(), old.key); assert.equal(f.project.assets.list[result.newId], undefined);
  f.editor.history.redo(); assert.equal(prop.get(), result.newId);
  const count = Object.keys(f.project.assets.list).length;
  await f.api.replace(result.newId, { file });
  assert.equal(Object.keys(f.project.assets.list).length, count);
  assert.equal(f.project.media.length, 1); assert.equal(f.project.assets.list[old.key], old);
  f.api.dispose();
});

test("builtInFonts follows the native dropdown order without creating items; missing fonts replace and undo together", async () => {
  const f = retainedFixture(); f.PZ.asset.font.preset = ["second", "first"];
  f.project.assets.createFromPreset = (_type, key) => f.asset(key, { source: 3, filename: null, url: key, references: 0, mediaReferences: 0, file: null });
  const old = await f.add("missing.ttf"); old.file = null;
  const a = owner(f, "Text one", old.key, f.PZ.asset.type.FONT), b = owner(f, "Text two", old.key, f.PZ.asset.type.FONT);
  const fonts = f.api.builtInFonts(); assert.deepEqual(Array.from(fonts, font => font.name), ["second", "first"]);
  assert.equal(Object.keys(f.project.assets.list).length, 1);
  const result = await f.api.replace(old.key, { itemId: fonts[0].id });
  assert.equal(result.ok, true); assert.equal(result.replaced, 2);
  assert.equal(a.prop.get(), fonts[0].key); assert.equal(b.prop.get(), fonts[0].key);
  assert.equal(f.project.assets.list[fonts[0].key].source, 3);
  f.editor.history.undo(); assert.equal(a.prop.get(), old.key); assert.equal(b.prop.get(), old.key);
  f.editor.history.redo(); assert.equal(a.prop.get(), fonts[0].key); f.api.dispose();
});

test("Material+ graph and IES hooks write through propertyOps and restore all payloads with one undo", async () => {
  const f = retainedFixture(), old = await f.add("old.png", "image/png"), next = await f.add("new.png", "image/png");
  const material = f.child(f.project.sequence, new f.Obj("Graph"));
  const graph = JSON.stringify({ nodes: [{ id: "a", params: { asset: old.key } }, { id: "b", params: { asset: old.key } }] });
  f.properties(material, { graph: new f.Property("Graph", graph, 7), nodeImage: new f.Property("Image", old.key) });
  material._selectedImageNode = "a";
  material.properties.nodeImage.set = () => { throw new Error("The UI mirror must not author the graph again."); };
  f.adapter("material-plus");
  const result = await f.api.replace(old.key, { itemId: next.key });
  assert.equal(result.ok, true); assert.equal(result.replaced, 2);
  assert(JSON.parse(material.properties.graph.get()).nodes.every(node => node.params.asset === next.key));
  assert.equal(f.editor.history.undoStack[0].length, 1);
  f.editor.history.undo(); assert.equal(material.properties.graph.get(), graph);
  f.editor.history.redo(); assert.equal(JSON.parse(material.properties.graph.get()).nodes[0].params.asset, next.key);
  const a = f.child(f.project.sequence, new f.Obj("Light one")), b = f.child(f.project.sequence, new f.Obj("Light two"));
  for (const light of [a, b]) f.properties(light, { iesProfile: new f.Property("Profile", "old.ies", 7), iesData: new f.Property("Data", "old profile", 7), iesFilename: new f.Property("Filename", "old.ies", 7) });
  f.adapter("trapcode-suite"); const ies = read(f).items.find(item => item.kind === "ies");
  const replacement = await f.api.replace(ies.id, { file: f.file("new.ies", "new profile", "text/plain") });
  assert.equal(replacement.ok, true); assert.equal(replacement.replaced, 2);
  for (const light of [a, b]) assert.equal(light.properties.iesData.get(), "new profile");
  f.editor.history.undo(); for (const light of [a, b]) {
    assert.equal(light.properties.iesProfile.get(), "old.ies"); assert.equal(light.properties.iesData.get(), "old profile"); assert.equal(light.properties.iesFilename.get(), "old.ies");
  }
  f.editor.history.redo(); assert.equal(b.properties.iesFilename.get(), "new.ies"); f.api.dispose();
});

test("IES replacement can use an embedded target from a closed composition without editing that composition", async () => {
  const f = retainedFixture(), light = f.child(f.project.sequence, new f.Obj("Live light"));
  f.properties(light, { iesProfile: new f.Property("Profile", "old.ies", 7), iesData: new f.Property("Data", "old profile", 7), iesFilename: new f.Property("Filename", "old.ies", 7) });
  const tracks = [{ properties: { iesData: "closed target", iesFilename: "target.ies", iesProfile: "target.ies" } }];
  f.PZ.precomp = { entries: () => [], referenceSources: () => [{ id: "closed", name: "Closed", tracks, editing: false }] };
  f.adapter("trapcode-suite");
  const view = read(f), old = view.items.find(item => item.name === "old.ies"), target = view.items.find(item => item.name === "target.ies");
  const result = await f.api.replace(old.id, { itemId: target.id });
  assert.equal(result.ok, true); assert.equal(result.newId, target.id);
  assert.equal(light.properties.iesData.get(), "closed target");
  assert.equal(tracks[0].properties.iesData, "closed target");
  f.editor.history.undo(); assert.equal(light.properties.iesData.get(), "old profile");
  f.api.dispose();
});

test("consumer patches balance native clip/image loads on edits and undo and restore owned patches on dispose", () => {
  const file = fs.readFileSync(require.resolve("../plugins/core/asset-replacement-consumers.js"), "utf8");
  const assets = { list: { old: { key: "old", references: 1 }, next: { key: "next", references: 1 } }, load(key) { const asset = this.list[key]; asset.references++; return asset; }, unload(wrapper) { wrapper.asset.references--; } };
  class Image { constructor(asset) { this.asset = asset; } getTexture() { return { dispose() {} }; } }
  class Layer { load() { this.imageProperties = { image: this.prop }; this.prop.definition.changed.call(this.prop); this.image = new Image(assets.load(this.prop.value)); this.texture = this.image.getTexture(); } }
  Layer.propertyDefinitions = { image: {} };
  const media = { changed() { if (this.value) this.parentObject.media = { asset: assets.load(this.value) }; } };
  let scheduleResets = 0;
  const PZ = { schedule: { analyzeSequence() { scheduleResets++; } }, asset: { image: Image }, clip: { propertyDefinitions: { media } }, layer: { image: Layer } };
  const sandbox = { ZoidiumAssetRegistryParts: {}, PZ }; vm.runInNewContext(file, sandbox);
  const original = media.changed, dispose = sandbox.ZoidiumAssetRegistryParts.patchReplacementConsumers(PZ);
  const clip = { parentProject: { assets }, media: { asset: assets.load("old") } }, prop = { value: "next", parentObject: clip };
  media.changed.call(prop); assert.equal(assets.list.old.references, 1); assert.equal(assets.list.next.references, 2);
  prop.value = "old"; media.changed.call(prop); assert.equal(assets.list.old.references, 2); assert.equal(assets.list.next.references, 1);
  const layer = new Layer(); layer.parentProject = { assets }; layer.prop = { value: "old", parentObject: layer, definition: Layer.propertyDefinitions.image }; layer.load();
  assert.equal(assets.list.old.references, 3); layer.prop.value = "next"; Layer.propertyDefinitions.image.changed.call(layer.prop);
  assert.equal(assets.list.old.references, 2); assert.equal(assets.list.next.references, 2); assert.equal(layer.image.asset.key, "next");
  layer.prop.value = "old"; Layer.propertyDefinitions.image.changed.call(layer.prop); assert.equal(assets.list.next.references, 1);
  assert.equal(scheduleResets, 2);
  dispose(); assert.equal(media.changed, original); assert.equal(Layer.propertyDefinitions.image.changed, undefined);
});
