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
    const data = object instanceof PZ.object3d ? JSON.parse(JSON.stringify(object)) : null;
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
  prototype.__zoidiumObjectHistoryRepair = true;
})(typeof window !== "undefined" ? window : globalThis);
