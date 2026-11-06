(function installObjectHistoryRepair(global) {
  "use strict";

  const PZ = global.PZ;
  const prototype = PZ?.ui?.edit?.prototype;
  if (!prototype?.deleteObject || prototype.__zoidiumObjectHistoryRepair) return;
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
    }
    return result;
  };
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
