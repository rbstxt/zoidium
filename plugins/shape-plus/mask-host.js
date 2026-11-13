"use strict";
// Path host for layer masks: the adapter that lets the Shape+ pen, pointer,
// transform and action modules edit a mask collection on a native
// Scene/Adjustment layer without knowing it is not a Shape+ layer.
//
// The adapter object exposes exactly the Shape+ layer surface those modules
// read: `contents` (a live array of real Content path items, one per mask),
// `getAddress`, `tryGetParentOfType`, `type` and `signature`. Persistence is
// JSON: read() clones the live items, write() normalizes, validates, stores
// the plain JSON on the native layer field and rebuilds the live items.
// Mask parameters (mode, feather, opacity, invert) ride on the item JSON as
// extra top-level fields; live Content instances only ever own the path
// geometry, so parameter reads always go through the collection JSON.
//
// Groups cannot exist in a mask collection (AE semantics are a flat list).
// The pen creates a one-path group through the shared planner; the host
// unwraps that artifact on write and rejects anything else structural.
const { clone, validate } = require("./model.js");
const { FIELD, validateMasks, ensureNames, coercePath } = require("./mask-model.js");

function readField(nativeLayer) {
  const data = nativeLayer?.[FIELD];
  return Array.isArray(data) ? data : [];
}

function createMaskHost({ nativeLayer, Content, editor, project }) {
  if (!nativeLayer || !Content || !editor || !project) throw Error("Layer mask host needs a layer, Content, editor and project");
  let nativeAddress = null;
  try {
    nativeAddress = nativeLayer.getAddress();
  } catch (_error) {
    nativeAddress = null;
  }
  const state = { source: undefined, items: [] };
  let warned = false;
  function warn(error) {
    if (warned) return;
    warned = true;
    if (typeof console !== "undefined") console.warn("[Shape+] layer masks unavailable: " + error.message);
  }
  function sync() {
    const data = readField(nativeLayer);
    if (data !== state.source) {
      let items = [];
      try {
        validateMasks(data);
        items = data.map(itemData => {
          const item = new Content(itemData.kind, itemData);
          item.load(itemData);
          return item;
        });
      } catch (error) {
        warn(error);
      }
      state.items = items;
      state.source = data;
    }
    return state.items;
  }
  function owns(target) {
    return !!target && target === nativeLayer;
  }
  function valid() {
    if (editor.project !== project || !nativeAddress) return false;
    try {
      return project.addressLookup(nativeAddress) === nativeLayer;
    } catch (_error) {
      return false;
    }
  }
  // Strip the pen's one-path group wrapper; anything else structural is a
  // programming error and fails loudly instead of silently changing meaning.
  // Missing mask parameters default (the pen creates bare Shape+ paths);
  // present-but-invalid parameters still fail validation below.
  function normalize(data) {
    if (!Array.isArray(data)) throw Error("Layer masks must be an array");
    const flat = [];
    for (const entry of data) {
      if (entry && entry.kind === "group" && Array.isArray(entry.contents) && entry.contents.length === 1 &&
          entry.contents[0] && entry.contents[0].kind === "path") {
        flat.push(entry.contents[0]);
        continue;
      }
      if (!entry || entry.kind !== "path") throw Error("Layer masks hold only paths");
      flat.push(entry);
    }
    for (const item of flat) {
      if (item.mode === undefined) item.mode = "add";
      if (item.feather === undefined) item.feather = 0;
      if (item.opacity === undefined) item.opacity = 1;
      if (item.invert === undefined) item.invert = 0;
      if (item.properties && typeof item.properties === "object")
        item.properties.path = coercePath(item.properties.path, item.vertexIds.length * 6);
    }
    return ensureNames(flat);
  }
  function write(data) {
    const normalized = normalize(clone(data));
    validate(normalized);
    validateMasks(normalized);
    nativeLayer[FIELD] = normalized;
    state.source = null;
    sync();
  }
  const adapter = { Content, type: "zoidium:layer-mask/host", signature: null };
  Object.defineProperty(adapter, "contents", { configurable: true, get: sync });
  adapter.getAddress = () => nativeLayer.getAddress();
  adapter.tryGetParentOfType = type => nativeLayer.tryGetParentOfType(type);
  Object.defineProperty(adapter, "parent", { configurable: true, get: () => nativeLayer.parent });
  Object.defineProperty(adapter, "parentObject", { configurable: true, get: () => nativeLayer.parentObject });
  const host = {
    adapter,
    contents: sync,
    owns,
    valid,
    write,
    persist() {
      write(clone(sync()));
    },
    allows(action) {
      return action === "duplicate" || action === "delete" || action === "forward" ||
        action === "backward" || action === "move";
    },
    // The pen draws bare paths: no group wrapper, no paints.
    addItemDefaults: { paints: [], groupsOnly: false },
  };
  return host;
}

module.exports = { createMaskHost, readField };
