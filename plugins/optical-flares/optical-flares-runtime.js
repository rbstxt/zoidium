"use strict";

// OpenZoid Optical Flares - runtime installer.
//
// Evaluates the bundled sources in dependency order and teaches
// PZ.object3d.create the Optical Flares numeric type 13 that upstream CM3 does
// not know. The object picker entries come from the plugin manifest.
//
// Host changes are registered with context.lifecycle.onDispose before they are
// made, so a failed activation and a normal disable both run the same undo
// steps in reverse order.

const SOURCE_FOLDER = "./plugins/optical-flares/";
const SOURCE_ORDER = ["optflares-math.js", "optflares.js", "optflares-window.js"];
const FLARE_TYPE = 13;
const GEAR_ATTRIBUTE = "data-designer-gear";

// Wraps PZ.object3d.create. Disabling leaves the wrapper in the chain as a
// pass-through when another pack wrapped above it, so an out-of-order disable
// never breaks the sibling's link.
function installCreateWrapper(PZ, undo) {
  const object3d = PZ.object3d;
  const original = object3d.create;
  let alive = true;
  const patched = function (type) {
    if (alive && type === FLARE_TYPE) {
      const instance = new object3d.optflares();
      instance.type = type;
      return instance;
    }
    return original.call(this, type);
  };
  patched.__opticalFlares = true;
  object3d.create = patched;
  undo.push(() => {
    alive = false;
    if (object3d.create === patched) object3d.create = original;
  });
}

// Adds an options gear to each flare row in CM3 object lists. The gear uses the
// same attribute as the Trapcode designer gear, so when both packs are active
// only one button is rendered per row.
function installGear(PZ, openWindow, undo) {
  const prototype = PZ.ui.edit.prototype;
  const original = prototype.generateItemCommands;
  let alive = true;
  const patched = function (item, target) {
    const out = original.call(this, item, target);
    if (!alive) return out;
    try {
      const Flare = PZ.object3d.optflares;
      if (!Flare || !(target instanceof Flare)) return out;
      if (!(target.parent instanceof PZ.objectList)) return out;
      if (!this.options || !this.options.showListItemButtons) return out;
      if (typeof this.generateButton !== "function") return out;
      const host = item && item.children && item.children[1];
      if (!host || typeof host.insertBefore !== "function") return out;
      if (host.querySelector && host.querySelector("button[" + GEAR_ATTRIBUTE + "]")) return out;
      const gear = this.generateButton("settings");
      gear.title = "Optical Flares options";
      gear.setAttribute(GEAR_ATTRIBUTE, "1");
      gear.onclick = (event) => {
        event.stopPropagation();
        openWindow(target);
      };
      host.insertBefore(gear, host.firstElementChild);
    } catch (error) {
      console.error("Optical Flares could not add its options button", error);
    }
    return out;
  };
  patched.__opticalFlaresGear = true;
  prototype.generateItemCommands = patched;
  undo.push(() => {
    alive = false;
    if (prototype.generateItemCommands === patched) prototype.generateItemCommands = original;
  });
}

// Screen-space flare quads have no geometry velocity and are not environment
// geometry. Hide them only for these auxiliary passes, restoring visibility
// even when the host render throws.
function installAuxiliaryPasses(PZ, undo) {
  // CM3's velocity update replaces every node's onBeforeRender callback.
  // Preserve the flare's projection callback for the subsequent color pass.
  const velocity = PZ.motionBlur && PZ.motionBlur.prototype;
  if (velocity && typeof velocity.update === "function") {
    const original = velocity.update;
    let alive = true;
    const patched = function () {
      if (!alive) return original.apply(this, arguments);
      const callbacks = [];
      this.scene?.traverse?.((node) => {
        if (node.__zoidiumOpticalFlareQuad) callbacks.push([node, node.onBeforeRender]);
      });
      try { return original.apply(this, arguments); }
      finally { for (const [node, callback] of callbacks) node.onBeforeRender = callback; }
    };
    velocity.update = patched;
    undo.push(() => {
      alive = false;
      if (velocity.update === patched) velocity.update = original;
    });
  }
  for (const Class of [PZ.motionBlur, PZ.envMap]) {
    const prototype = Class && Class.prototype;
    if (!prototype || typeof prototype.render !== "function") continue;
    const original = prototype.render;
    let alive = true;
    const patched = function () {
      if (!alive) return original.apply(this, arguments);
      const hidden = [];
      this.scene?.traverse?.((node) => {
        if (node.__zoidiumOpticalFlareQuad) {
          hidden.push([node, node.visible]);
          node.visible = false;
        }
      });
      try { return original.apply(this, arguments); }
      finally { for (const [node, visible] of hidden) node.visible = visible; }
    };
    prototype.render = patched;
    undo.push(() => {
      alive = false;
      if (prototype.render === patched) prototype.render = original;
    });
  }
}

let host = null;

module.exports = {
  activate(context) {
    const PZ = (context && context.PZ) || (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const THREE = (context && context.window && context.window.THREE) ||
      (typeof globalThis !== "undefined" ? globalThis.THREE : null);
    if (!PZ) throw new Error("Optical Flares needs the CM3 runtime.");
    if (!THREE) throw new Error("Optical Flares needs the THREE global from the CM3 runtime.");
    if (typeof context.getAsset !== "function") {
      throw new Error("Optical Flares needs the plugin bundle asset resolver.");
    }
    if (!PZ.object3d || typeof PZ.object3d.create !== "function") {
      throw new Error("Optical Flares needs PZ.object3d.create from the CM3 runtime.");
    }
    if (!PZ.ui || !PZ.ui.edit || !PZ.ui.edit.prototype ||
        typeof PZ.ui.edit.prototype.generateItemCommands !== "function") {
      throw new Error("Optical Flares needs the CM3 object list editor.");
    }
    if (PZ.object3d.optflares || PZ.opticalflares) {
      throw new Error("Optical Flares is already installed in this runtime.");
    }

    const undo = [];
    context.lifecycle.onDispose(() => {
      while (undo.length) {
        try {
          undo.pop()();
        } catch (error) {
          console.error("Optical Flares cleanup step failed", error);
        }
      }
    });

    undo.push(() => {
      host = null;
    });
    undo.push(() => {
      const element = PZ.object3d.optflares && PZ.object3d.optflares.element;
      if (element && PZ.ui && PZ.ui.objectTypes) PZ.ui.objectTypes.delete(element);
      delete PZ.object3d.optflares;
      delete PZ.opticalflares;
    });
    for (const file of SOURCE_ORDER) {
      const source = context.getAsset("text", SOURCE_FOLDER + file);
      if (typeof source !== "string") {
        throw new Error("Optical Flares is missing its bundled source: " + file);
      }
      // Sources take PZ and THREE as parameters, so their `var PZ = PZ || {}`
      // merges with the runtime globals instead of shadowing them.
      new Function("PZ", "THREE", source)(PZ, THREE);
    }
    if (!PZ.object3d.optflares || !PZ.opticalflares || !PZ.opticalflares.openWindow) {
      throw new Error("Optical Flares could not define its 3D object class.");
    }

    const editor = () => (typeof window !== "undefined" && window.CM) || context.editor || null;
    const openWindow = (root) => {
      const target = editor();
      if (!target) return null;
      return PZ.opticalflares.openWindow(context.ui, target, root);
    };
    PZ.opticalflares.open = (root) => openWindow(root);

    installCreateWrapper(PZ, undo);
    installAuxiliaryPasses(PZ, undo);
    installGear(PZ, openWindow, undo);
    host = PZ;
  },
  // The plugin manager refuses to disable the pack while a flare is in the
  // open project.
  isInUse() {
    return Boolean(host && host.opticalflares && host.opticalflares.isInUse && host.opticalflares.isInUse());
  },
};
