(function installObjectHistoryRepair(global) {
  "use strict";

  const PZ = global.PZ;
  const tracks = PZ?.ui?.timeline?.tracks?.prototype;
  if (tracks?.deleteClip && !tracks.deleteClip.__zoidiumReleasesRenderLists) {
    const deleteClip = tracks.deleteClip;
    const wrapped = function deleteClipAndReleaseRenderLists() {
      const result = deleteClip.apply(this, arguments);
      // r91 keeps an opaque/transparent list for each scene and camera pair.
      // A deleted scene can otherwise retain its meshes through those lists.
      this.timeline.editor.mainViewport?.renderer?.renderLists?.dispose?.();
      return result;
    };
    wrapped.__zoidiumReleasesRenderLists = true;
    tracks.deleteClip = wrapped;
  }
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
  prototype.__zoidiumObjectHistoryRepair = true;
})(typeof window !== "undefined" ? window : globalThis);
