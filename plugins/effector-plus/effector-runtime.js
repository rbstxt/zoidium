"use strict";

// Effector+ — deformer runtime installer.
//
// Evaluates the bundled deformer framework plus the Twist, Warp, and Voronoi
// Fracture object classes, teaches PZ.object3d.create the deformer numeric
// types 7/8/9 that upstream CM3 does not know, and runs the deform chain in
// the 3D Scene layer update. Picker entries are declared in the manifest.

const SOURCE_ORDER = [
  "deform-framework.js",
  "deformer-objects.js",
];

const DEFORMER_TYPES = [
  { type: 7, key: "twist" },
  { type: 8, key: "warp" },
  { type: 9, key: "voronoi" },
];

let installedPZ = null;
let installedCreate = null;
let installedLayerUpdate = null;

function installSources(context, PZ, THREE) {
  const getAsset = context && typeof context.getAsset === "function"
    ? context.getAsset.bind(context)
    : null;
  if (!getAsset) {
    throw new Error("Effector+ needs the plugin bundle asset resolver.");
  }
  for (const file of SOURCE_ORDER) {
    const source = getAsset("text", "./plugins/effector-plus/" + file);
    if (typeof source !== "string") {
      throw new Error("Effector+ is missing its bundled source: " + file);
    }
    // Parameters (not bare eval): the extracted core statements assign onto
    // the live PZ namespace instead of a shadowed local.
    new Function("PZ", "THREE", source)(PZ, THREE);
  }
}

function installCreateWrapper(PZ) {
  const object3d = PZ.object3d;
  if (!object3d || typeof object3d.create !== "function") {
    throw new Error("Effector+ needs PZ.object3d.create from the CM3 runtime.");
  }
  if (object3d.create.__effectorPlus) {
    object3d.create.__effectorPlusAlive = true;
    installedCreate = object3d.create;
    return;
  }
  const original = object3d.create;
  const patched = function (type) {
    if (!patched.__effectorPlusAlive) {
      return original.call(this, type);
    }
    for (const entry of DEFORMER_TYPES) {
      if (type === entry.type && object3d[entry.key]) {
        const instance = new object3d[entry.key]();
        instance.type = type;
        return instance;
      }
    }
    return original.call(this, type);
  };
  patched.__effectorPlus = true;
  patched.__effectorPlusAlive = true;
  patched.__effectorPlusOriginal = original;
  object3d.create = patched;
  installedCreate = patched;
}

function installLayerUpdate(PZ) {
  const scene = PZ.layer && PZ.layer.scene;
  if (!scene || !scene.prototype || typeof scene.prototype.update !== "function") {
    throw new Error("Effector+ needs PZ.layer.scene.prototype.update from the CM3 runtime.");
  }
  if (scene.prototype.update.__effectorPlus) {
    scene.prototype.update.__effectorPlusAlive = true;
    installedLayerUpdate = scene.prototype.update;
    return;
  }
  const original = scene.prototype.update;
  const patched = function (time) {
    const out = original.call(this, time);
    try {
      if (!patched.__effectorPlusAlive) return out;
      if (PZ.object3d && PZ.object3d.deform && typeof PZ.object3d.deform.apply === "function") {
        PZ.object3d.deform.apply(this, time);
      }
    } catch (_err) { /* never break scene rendering */ }
    return out;
  };
  patched.__effectorPlus = true;
  patched.__effectorPlusAlive = true;
  patched.__effectorPlusOriginal = original;
  scene.prototype.update = patched;
  installedLayerUpdate = patched;
}

function uninstall(PZ) {
  if (installedCreate) {
    installedCreate.__effectorPlusAlive = false;
    const object3d = PZ && PZ.object3d;
    if (object3d && object3d.create === installedCreate && installedCreate.__effectorPlusOriginal) {
      object3d.create = installedCreate.__effectorPlusOriginal;
    }
    installedCreate = null;
  }
  if (installedLayerUpdate) {
    installedLayerUpdate.__effectorPlusAlive = false;
    const scene = PZ && PZ.layer && PZ.layer.scene;
    if (scene && scene.prototype && scene.prototype.update === installedLayerUpdate &&
        installedLayerUpdate.__effectorPlusOriginal) {
      scene.prototype.update = installedLayerUpdate.__effectorPlusOriginal;
    }
    installedLayerUpdate = null;
  }
}

module.exports = {
  activate(context) {
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const THREE = (context && context.window && context.window.THREE) ||
      (typeof globalThis !== "undefined" ? globalThis.THREE : null);
    if (!PZ) {
      throw new Error("Effector+ needs the CM3 runtime.");
    }
    if (!THREE) {
      throw new Error("Effector+ needs the THREE global from the CM3 runtime.");
    }
    installSources(context, PZ, THREE);
    if (!PZ.object3d.twist || !PZ.object3d.warp || !PZ.object3d.voronoi || !PZ.object3d.deformer) {
      throw new Error("Effector+ could not define its deformer classes.");
    }
    installCreateWrapper(PZ);
    installLayerUpdate(PZ);
    installedPZ = PZ;
  },
  deactivate() {
    try {
      uninstall(installedPZ);
    } finally {
      installedPZ = null;
    }
  },
};
