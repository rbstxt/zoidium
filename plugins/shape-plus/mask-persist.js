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

function installMaskClipTrim(PZ, onDispose) {
  const tracks = PZ.ui?.timeline?.tracks?.prototype;
  const moveClip = tracks?.moveClip;
  if (typeof moveClip !== "function") return;
  function moveClipWithMasks(edit) {
    const { type, oldTrackIdx, oldIdx, offset } = edit || {};
    const layer = type === 0 && this.timeline.sequence.videoTracks[oldTrackIdx]?.clips[oldIdx]?.object;
    const current = layer?.[FIELD];
    if (!current?.length || !Number.isFinite(offset) || offset === 0)
      return moveClip.apply(this, arguments);

    // CM3 shifts native property keyframes on a left trim. Mask paths live
    // outside that property tree, so shift their local frames in the same
    // command, before CM3 notifies the timeline. Its inverse also runs here.
    const next = clone(current);
    for (const mask of next) {
      const path = mask.properties.path;
      for (const channel of path.objects || [path])
        for (const key of channel.keyframes) key.frame += offset;
    }
    layer[FIELD] = next;
    try {
      return moveClip.apply(this, arguments);
    } catch (error) {
      layer[FIELD] = current;
      throw error;
    }
  }
  tracks.moveClip = moveClipWithMasks;
  onDispose(() => { if (tracks.moveClip === moveClipWithMasks) tracks.moveClip = moveClip; });
}

function installMaskPersistence(PZ, onDispose) {
  if (!PZ?.layer?.prototype) throw Error("Layer masks need the native layer runtime");
  const prototypes = [PZ.layer.prototype, PZ.layer.adjustment?.prototype, PZ.layer.scene?.prototype]
    .filter((prototype, index, list) => prototype && list.indexOf(prototype) === index);
  for (const prototype of prototypes) {
    const hadOwnLoad = Object.hasOwn(prototype, "load");
    const hadOwnToJSON = Object.hasOwn(prototype, "toJSON");
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
      if (prototype.load === loadWithMasks) {
        if (hadOwnLoad) prototype.load = originalLoad;
        else delete prototype.load;
      }
      if (prototype.toJSON === serializeMasks) {
        if (hadOwnToJSON) prototype.toJSON = originalToJSON;
        else delete prototype.toJSON;
      }
    });
  }
  installMaskClipTrim(PZ, onDispose);
}

module.exports = { installMaskPersistence };
