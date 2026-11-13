"use strict";
// Mask persistence on native layers.
//
// The plugin manager retains unknown layer fields across load and save, but
// only the values present at load time: a field the pen adds later would not
// reach the saved document, and a loaded field never becomes a live layer
// property for rendering. This wrapper closes both gaps for the mask field
// specifically, mirroring the track-field pattern:
// - load: after the native load, a plain-array mask field on the incoming
//   data is validated and installed as a live own property of the layer.
//   Anything else (missing, corrupt) leaves the layer untouched.
// - toJSON: a live mask array on the layer is cloned into the saved JSON.
// Disabling the plugin restores the native methods; saved projects keep
// their mask data through the manager's own retention either way.
const { FIELD, validateMasks } = require("./mask-model.js");
const clone = value => JSON.parse(JSON.stringify(value));

function installMaskPersistence(PZ, onDispose) {
  if (!PZ?.layer?.prototype) throw Error("Layer masks need the native layer runtime");
  const prototype = PZ.layer.prototype;
  const originalLoad = prototype.load;
  const originalToJSON = prototype.toJSON;
  function loadWithMasks(data) {
    const result = originalLoad.apply(this, arguments);
    try {
      const masks = data && typeof data === "object" ? data[FIELD] : undefined;
      if (masks !== undefined) {
        validateMasks(masks);
        this[FIELD] = clone(masks);
      }
    } catch (_error) {
      delete this[FIELD];
    }
    return result;
  }
  function serializeMasks() {
    const json = originalToJSON.apply(this, arguments);
    try {
      const masks = this[FIELD];
      if (masks !== undefined && json && typeof json === "object" && !Array.isArray(json)) {
        validateMasks(masks);
        json[FIELD] = clone(masks);
      }
    } catch (_error) {
      /* Corrupt live state never breaks saving; the field is dropped. */
    }
    return json;
  }
  prototype.load = loadWithMasks;
  prototype.toJSON = serializeMasks;
  onDispose(() => {
    // Restore only what is still ours; a wrapper further out owns the chain
    // then, and removing from the middle would corrupt it.
    if (prototype.load === loadWithMasks) prototype.load = originalLoad;
    if (prototype.toJSON === serializeMasks) prototype.toJSON = originalToJSON;
  });
}

module.exports = { installMaskPersistence };
