"use strict";
const { fixture } = require("./asset-registry-fixture.js");
function retainedFixture() {
  const revoked = [], created = [];
  const f = fixture({ edits: true, globals: { URL: { createObjectURL(file) { const url = "blob:" + created.length; created.push({ url, file }); return url; }, revokeObjectURL(url) { revoked.push(url); } } },
    setup({ PZ, project, editor, sandbox }) {
      const Observable = project.assets.onAssetCreated.constructor;
      class AssetList {
        constructor() { this.list = {}; this.onAssetCreated = new Observable(); this.onAssetRemoved = new Observable(); }
        load(key, media) {
          const asset = typeof key === "string" ? this.list[key] : key;
          if (!asset) throw new Error("Missing asset: " + key);
          asset[media ? "mediaReferences" : "references"]++;
          return asset;
        }
        unload(asset, media) { asset[media ? "mediaReferences" : "references"]--; this.removeIfUnused(asset); }
        removeIfUnused(asset) {
          if (asset.references <= 0 && asset.mediaReferences <= 0) {
            sandbox.URL.revokeObjectURL(asset.url); delete this.list[asset.key]; this.onAssetRemoved.update(asset);
          }
        }
        restore(asset) { this.list[asset.key] = asset; this.onAssetCreated.update(asset); }
        async createFromFile(type, file, key) {
          key ||= await PZ.asset.hash(file);
          if (this.list[key]) return this.list[key];
          const asset = { key, filename: file.name, source: 1, file, url: sandbox.URL.createObjectURL(file), size: file.size,
            references: 0, mediaReferences: 0, data: new Map() };
          this.list[key] = asset; this.onAssetCreated.update(asset); return asset;
        }
      }
      PZ.assetList = AssetList; project.assets = new AssetList();
      PZ.asset.hash = file => file.text(); PZ.asset.type.AV = 3; PZ.asset.type.MISC = 5;
      PZ.ui = { editor: function () {} };
      PZ.ui.editor.prototype.init = function () {};
      PZ.ui.editor.prototype.assetRemoved = function (asset) { this.history.pushCommand(() => this.project.assets.restore(asset)); };
      function history() {
        return { undoStack: [], redoStack: [], operation: null,
          startOperation() { this.operation = []; },
          pushCommand(fn, params) { this.operation.push(() => fn(params)); },
          finishOperation(redo) {
            if (this.operation.length) (redo === true ? this.redoStack : this.undoStack).push(this.operation);
            this.operation = null; if (redo === undefined) this.redoStack = []; project.ui.onChanged.update();
          },
          undo() { if (!this.undoStack.length) return; const op = this.undoStack.pop(); this.startOperation(); op.slice().reverse().forEach(fn => fn()); this.finishOperation(true); },
          redo() { if (!this.redoStack.length) return; const op = this.redoStack.pop(); this.startOperation(); op.slice().reverse().forEach(fn => fn()); this.finishOperation(false); },
        };
      }
      editor.history = history();
      project.assets.onAssetRemoved.watch(asset => PZ.ui.editor.prototype.assetRemoved.call(editor, asset));
      project.sequence.videoTracks = []; project.sequence.audioTracks = [];
      PZ.ui.media = class {
        async importFile(file) { const asset = await editor.project.assets.createFromFile(0, file); return { assets: [asset.key] }; }
        createMedia({ address, data }) {
          const assets = data.assets.map(key => editor.project.assets.load(key, true));
          editor.project.media.splice(address[1], 0, { assets });
          editor.history.pushCommand(() => PZ.ui.media.prototype.deleteMedia.call(this, { address }));
        }
        deleteMedia({ address }) {
          const media = editor.project.media[address[1]], data = { assets: media.assets.map(a => a.key) };
          media.assets.forEach(asset => editor.project.assets.unload(asset, true));
          editor.project.media.splice(address[1], 1);
          editor.history.pushCommand(() => PZ.ui.media.prototype.createMedia.call(this, { address, data }));
        }
      };
      PZ.ui.properties = class {
        constructor(editor) { this.editor = editor; }
        setValue({ property, value }) {
          const prop = this.editor.project.addressLookup(property), old = prop.get(); prop.set(value);
          this.editor.history.pushCommand(() => this.setValue({ property, value: old }));
        }
        deleteKeyframe({ property, frame }) {
          const prop = this.editor.project.addressLookup(property), kf = prop.keyframes.find(k => k.frame === frame);
          prop.keyframes.splice(prop.keyframes.indexOf(kf), 1);
          this.editor.history.pushCommand(() => this.createKeyframe({ property, kf }));
        }
        createKeyframe({ property, kf }) {
          const prop = this.editor.project.addressLookup(property); prop.keyframes.push(kf);
          this.editor.history.pushCommand(() => this.deleteKeyframe({ property, frame: kf.frame }));
        }
      };
    } });
  function file(name, bytes = name, type = "") { return Object.assign(new Blob([bytes], { type }), { name }); }
  async function add(name, type = "", bytes = name) { return f.project.assets.createFromFile(0, file(name, bytes, type)); }
  function items() { f.api.refresh(); return f.api.snapshot().items; }
  return { ...f, revoked, created, file, add, items };
}
module.exports = { retainedFixture };
