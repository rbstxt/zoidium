(function installObjectHistoryRepair(global) {
  "use strict";

  const PZ = global.PZ;
  const prototype = PZ?.ui?.edit?.prototype;
  if (!prototype?.deleteObject || prototype.__zoidiumObjectHistoryRepair) return;
  const assetList = PZ.assetList?.prototype, editor = PZ.ui.editor?.prototype;
  if (assetList?.removeIfUnused && editor?.assetRemoved) {
    const owners = new WeakMap(), remove = assetList.removeIfUnused, removed = editor.assetRemoved;
    assetList.removeIfUnused = function (asset) {
      const previous = owners.get(asset);
      owners.set(asset, this);
      try { return remove.apply(this, arguments); }
      finally {
        if (previous) owners.set(asset, previous);
        else owners.delete(asset);
      }
    };
    editor.assetRemoved = function (asset) {
      // Native editor listeners can outlive their project. Retired cleanup
      // must not write asset inverses into the current project's history.
      const owner = owners.get(asset);
      if (!this.history?.operation || owner && owner !== this.project?.assets) return;
      return removed.apply(this, arguments);
    };
  }
  function restoreAssetsFirst(operation, start) {
    if (!operation || typeof PZ.asset !== "function") return;
    const assetRestores = [];
    for (let index = start; index < operation.length; index++) {
      if (operation[index].params instanceof PZ.asset) assetRestores.push(operation.splice(index--, 1)[0]);
    }
    // Undo runs commands in reverse. Restore removed assets before the JSON
    // loader acquires them, so native restore() cannot overwrite a new live
    // asset with the zero-reference instance removed during unload().
    operation.push(...assetRestores);
  }
  const original = prototype.deleteObject;
  prototype.deleteObject = function deleteObject(params) {
    const list = this.editor.project.addressLookup(params.oldParentAddress);
    const object = list[params.oldIdx];
    // Native history retains the unloaded object, including CPU geometry and
    // plugin caches. Store the same data used to reopen a saved 3D object.
    // Capture before unload, since plugins can release their serializable state.
    let data = null;
    if (object instanceof PZ.object3d) {
      // A type with no project JSON keeps native undo data, so Delete still works.
      try { data = JSON.parse(JSON.stringify(object)); } catch { data = null; }
    }
    const operation = this.editor.history.operation;
    const start = operation?.length || 0;
    const result = original.apply(this, arguments);
    if (data && operation) {
      for (let index = start; index < operation.length; index++) {
        if (operation[index].params?.data === object) operation[index].params.data = data;
      }
      restoreAssetsFirst(operation, start);
    }
    return result;
  };
  const tracks = PZ.ui.timeline?.tracks?.prototype;
  if (typeof tracks?.deleteClip === "function") {
    const deleteClip = tracks.deleteClip;
    tracks.deleteClip = function () {
      const operation = this.timeline.editor.history.operation;
      const start = operation?.length || 0;
      const result = deleteClip.apply(this, arguments);
      restoreAssetsFirst(operation, start);
      return result;
    };
  }
  const keydown = prototype.keydown;
  if (typeof keydown === "function") {
    prototype.keydown = function (event) {
      const key = event.key.toLowerCase();
      const removes = ["delete", "del", "backspace"].includes(key);
      const copies = event.ctrlKey && ["c", "x"].includes(key);
      if ((removes || copies) && !PZ.ui.toolbar.prototype.shouldIgnoreKeydown(event.target, event.key)) {
        const rows = Array.from(this.el.querySelectorAll(".selected"));
        const selected = new Set(rows.map(row => row.pz_object));
        let changed = false;
        for (const row of rows) {
          for (let parent = row.pz_object.parent; parent; parent = parent.parent) {
            if (!selected.has(parent)) continue;
            // The parent already owns this subtree. Deleting the child again
            // resolves a detached address; copying it again duplicates it.
            row.classList.remove("selected");
            changed = true;
            break;
          }
        }
        if (changed) this.selectItems();
      }
      return keydown.apply(this, arguments);
    };
  }
  prototype.__zoidiumObjectHistoryRepair = true;
})(typeof window !== "undefined" ? window : globalThis);
