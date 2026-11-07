"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness");
const source = fs.readFileSync(path.join(__dirname, "../plugins/core/clipboard-assets.js"), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture() {
  const { PZ, context } = nativeHost();
  let clipboard = "";
  Object.assign(context, { Image: class {}, CSS: { supports: () => true }, File, Blob,
    navigator: { clipboard: { writeText(text) { clipboard = text; }, async readText() { return clipboard; } } } });
  context.window = context;
  context.addEventListener = () => {};
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  vm.runInContext(source, context);
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  context.CM = editor;
  PZ.effect.fnList["clipboard-probe"] = Promise.resolve(function () {
    this.properties.addAll({ texture: { name: "Texture", type: PZ.property.type.ASSET, value: null },
      graph: { name: "Graph", type: PZ.property.type.TEXT, value: "" } });
    this.load = data => this.properties.load(data?.properties);
    this.toJSON = () => ({ type: this.type, properties: this.properties });
    this.unload = () => {};
  });
  function project() {
    const value = new PZ.project();
    value.sequence.properties.load();
    const track = new PZ.track.video(); value.sequence.videoTracks.push(track);
    const clip = new PZ.clip.video(4); track.clips.push(clip);
    editor.project = value;
    return { value, list: clip.object.effects };
  }
  function edit(object) {
    return Object.assign(Object.create(PZ.ui.edit.prototype), {
      editor, selection: [object], el: {}, list: { children: [] },
    });
  }
  const key = (view, name, tagName = "DIV") => view.keydown({ key: name, ctrlKey: true,
    target: { tagName }, stopPropagation() {} });
  const original = project();
  const file = new File(["synthetic image bytes"], "checker.png", { type: "image/png" });
  const asset = await original.value.assets.createFromFile(null, file, "clipboard-image");
  const effect = PZ.effect.create("clipboard-probe"); original.list.push(effect);
  await effect.load({ properties: { texture: asset.key } });
  return { PZ, editor, project, original, asset, effect, edit, key,
    clipboard: () => clipboard, write: text => { clipboard = text; } };
}

test("native cross-project paste restores files before loading consumers without sharing asset state", { skip: !fs.existsSync(core) }, async () => {
  const f = await fixture();
  const before = plain(f.effect);
  await f.key(f.edit(f.effect), "c");
  const copiedText = f.clipboard();
  const destination = f.project();
  await f.key(f.edit(destination.list), "v");
  await destination.list[0].loading;
  assert.deepEqual(plain(destination.list[0]), before);
  const copied = destination.value.assets.list[f.asset.key];
  assert.notEqual(copied, f.asset);
  assert.notEqual(copied.data, f.asset.data);
  assert.notEqual(copied.url, f.asset.url);
  assert.equal(await copied.file.text(), await f.asset.file.text());
  assert.equal(copied.filename, "checker.png");
  copied.references += 1;
  assert.equal(f.asset.references, 0);
  assert.equal(f.clipboard(), copiedText, "the native clipboard JSON stays unchanged");
  f.editor.history.undo();
  assert.equal(destination.list.length, 0);
  f.editor.history.redo();
  await destination.list[0].loading;
  assert.deepEqual(plain(destination.list[0]), before);
});

test("JSON-valued shader and node properties retain their embedded file references", { skip: !fs.existsSync(core) }, async () => {
  const f = await fixture();
  f.effect.properties.texture.set(null);
  f.effect.properties.graph.set(JSON.stringify({ nodes: [{ texture: f.asset.key }] }));
  await f.key(f.edit(f.effect), "c");
  assert.deepEqual(JSON.parse(f.clipboard())[0].assets, [], "native ASSET discovery misses the graph");
  const destination = f.project();
  await f.key(f.edit(destination.list), "v");
  assert.equal(await destination.value.assets.list[f.asset.key].file.text(), "synthetic image bytes");
});

test("same-project paste preserves existing assets and fills missing file placeholders in another project", { skip: !fs.existsSync(core) }, async () => {
  const f = await fixture();
  await f.key(f.edit(f.effect), "c");
  await f.key(f.edit(f.effect), "v");
  assert.equal(f.original.value.assets.list[f.asset.key], f.asset);
  const destination = f.project();
  const placeholder = destination.value.assets.load(f.asset.key);
  await f.key(f.edit(destination.list), "v");
  assert.equal(destination.value.assets.list[f.asset.key], placeholder);
  assert.equal(placeholder.references, 1);
  assert.equal(await placeholder.file.text(), "synthetic image bytes");
});

test("unrelated clipboard text, incompatible destinations, and input-field paste import no files", { skip: !fs.existsSync(core) }, async () => {
  const f = await fixture();
  await f.key(f.edit(f.effect), "c");
  const text = f.clipboard(), destination = f.project();
  f.write("[]");
  await f.key(f.edit(destination.list), "v");
  f.write(text);
  await f.key(f.edit(destination.list), "v", "INPUT");
  await f.key(f.edit(destination.value.sequence.videoTracks), "v");
  assert.equal(Object.keys(destination.value.assets.list).length, 0);
  assert.equal(destination.list.length, 0);
});
