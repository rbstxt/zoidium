"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness");

function fixture(keys) {
  const native = nativeHost(), { PZ, THREE, context } = native;
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { PZ, addEventListener() {} }, navigator: {} });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/object-history.js"), "utf8"), context);
  class Consumer extends PZ.object3d.group {
    load(data) {
      super.load({ properties: {}, objects: [] });
      this.assets = data.keys.map(key => this.parentProject.assets.load(key));
    }
    unload() { for (const asset of this.assets) this.parentProject.assets.unload(asset); }
    toJSON() { return { type: this.type, keys: this.assets.map(asset => asset.key) }; }
  }
  const create = PZ.object3d.create;
  PZ.object3d.create = type => {
    if (type !== "test:consumer") return create(type);
    const object = new Consumer(); object.type = type; return object;
  };
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  const project = new PZ.project();
  project.ui = { onChanged: new PZ.observable() };
  project.threeObj = new THREE.Object3D();
  project.objects = new PZ.objectList(project, PZ.object3d);
  project.children.push(project.objects);
  editor.project = project;
  project.assets.onAssetRemoved.watch(PZ.ui.editor.prototype.assetRemoved.bind(editor));
  const edit = Object.create(PZ.ui.edit.prototype); edit.editor = editor;
  const source = PZ.object3d.create("test:consumer"); project.objects.push(source); source.load({ keys });
  const assets = source.assets.slice();
  assets.forEach((asset, i) => asset.data.set("decoded", "image-" + i));
  function operation(fn) { editor.history.startOperation(); fn(); editor.history.finishOperation(); }
  return { PZ, editor, project, edit, source, assets, operation };
}

for (const keys of [["/assets/texture.png"], ["/assets/texture.png", "/assets/layer-map.png"]]) {
  test(`3D delete history restores ${keys.length} preset asset identities before reloading consumers`,
    { skip: !fs.existsSync(core) }, () => {
      const { PZ, editor, project, edit, source, assets, operation } = fixture(keys);
      const address = project.objects.getAddress();
      const before = JSON.parse(JSON.stringify(project.assets));
      operation(() => edit.deleteObject({ oldParentAddress: address, oldIdx: 0 }));
      assert.equal(project.objects.length, 0);
      for (const key of keys) assert.equal(project.assets.list[key], undefined);
      for (let cycle = 0; cycle < 3; cycle++) {
        editor.history.undo();
        const restored = project.objects[0];
        assert.notEqual(restored, source);
        restored.assets.forEach((asset, i) => {
          assert.equal(asset, assets[i]);
          assert.equal(project.assets.list[keys[i]], asset);
          assert.equal(asset.references, 1);
          assert.equal(asset.data.get("decoded"), "image-" + i);
        });
        assert.deepEqual(JSON.parse(JSON.stringify(project.assets)), before);
        editor.history.redo();
        for (const key of keys) assert.equal(project.assets.list[key], undefined);
      }
      editor.history.undo();
      const data = JSON.parse(JSON.stringify(project.objects[0]));
      operation(() => edit.createObject({ newParentAddress: address, baseType: PZ.object3d,
        subType: data.type, data }));
      for (const asset of assets) assert.equal(asset.references, 2);
      editor.history.undo();
      for (const asset of assets) {
        assert.equal(asset.references, 1);
        assert.equal(project.assets.list[asset.key], asset, "undoing a duplicate keeps the original consumer's asset");
      }
      assert.deepEqual(JSON.parse(JSON.stringify(project.assets)), before);
    });
}

test("native clip delete and duplicate history restore shared assets before loading layers", { skip: !fs.existsSync(core) }, () => {
  const keys = ["/assets/vertex.glsl", "/assets/fragment.glsl"];
  const { PZ, editor, project, assets, operation } = fixture(keys);
  class Clip extends PZ.object {
    load(data) { this.assets = data.keys.map(key => this.parentProject.assets.load(key)); }
    unload() { for (const asset of this.assets) this.parentProject.assets.unload(asset); }
    toJSON() { return { object: { type: 0 }, keys: this.assets.map(asset => asset.key) }; }
  }
  // Transfer the fixture's acquired assets to the clip's layer consumer.
  project.objects.splice(0, 1);
  const track = new PZ.track.video(); project.sequence.videoTracks.push(track);
  const clip = new Clip(); clip.assets = assets; clip.start = 0; clip.length = 60; track.clips.push(clip);
  PZ.clip.create = () => new Clip();
  PZ.schedule.analyzeSequence = () => {};
  const tracks = Object.create(PZ.ui.timeline.tracks.prototype);
  tracks.timeline = { sequence: project.sequence, editor };
  tracks.sequence = project.sequence;
  tracks.updateSequenceLength = () => {};
  const check = () => track.clips[0].assets.forEach((asset, i) => {
    assert.equal(asset, assets[i]);
    assert.equal(project.assets.list[keys[i]], asset);
    assert.equal(asset.references, 1);
  });
  operation(() => tracks.deleteClip({ type: 0, oldTrackIdx: 0, oldIdx: 0 }));
  editor.history.undo(); check();
  editor.history.redo();
  for (const key of keys) assert.equal(project.assets.list[key], undefined);
  editor.history.undo(); check();
  const data = JSON.parse(JSON.stringify(track.clips[0]));
  operation(() => tracks.createClip({ type: 0, newTrackIdx: 0, newIdx: 1, start: 60, length: 60, data }));
  for (const asset of assets) assert.equal(asset.references, 2);
  editor.history.undo(); check();
});
