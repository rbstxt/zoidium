"use strict";

// OpenZoid Optical Flares — runtime installer.
//
// Evaluates the bundled sources in dependency order (shared helpers, flare
// object, Options window) and teaches PZ.object3d.create the Optical Flares
// numeric type 13 that upstream CM3 does not know. The 3D picker entry is
// declared in the plugin manifest and owned by the plugin manager.

const SOURCE_ORDER = [
  "trapcode-common.js",
  "optflares.js",
  "optflares-editor.js",
];

const FONT_STYLE_ID = "zoidium-flares-font-style";
const FONT_URL = "./plugins/optical-flares/inter-font.css";

// The SaaS-themed Options window uses Inter type from the bundled
// inter-font.css asset (same variable-font bytes as the Legacy pack's
// tracery-font.css, duplicated so each pack stays self-contained).
// Installed once per document; removed again on deactivate.
function installFont(context) {
  try {
    if (typeof document === "undefined" || document.getElementById(FONT_STYLE_ID)) {
      return;
    }
    const getAsset = context && typeof context.getAsset === "function"
      ? context.getAsset.bind(context)
      : null;
    const bundled = getAsset ? getAsset("text", FONT_URL) : undefined;
    if (typeof bundled === "string") {
      const style = document.createElement("style");
      style.id = FONT_STYLE_ID;
      style.textContent = bundled;
      document.head.appendChild(style);
    }
    if (document.fonts && typeof document.fonts.load === "function") {
      document.fonts.load("600 20px Inter");
      document.fonts.load("400 14px Inter");
    }
  } catch (_error) { /* font is decorative */ }
}

function uninstallFont() {
  try {
    if (typeof document === "undefined") return;
    const el = document.getElementById(FONT_STYLE_ID);
    if (el) el.remove();
  } catch (_error) { /* best effort */ }
}

// The PZ instance seen at activate time. deactivate() must unwrap that same
// instance instead of re-resolving globals, which may differ (or be gone).
let installedPZ = null;
// Our own create wrapper, so out-of-order disables still switch it off even
// when another pack wrapped above us in the chain.
let installedCreate = null;

function runtimeGlobals(context) {
  const PZ = (context && context.PZ) ||
    (typeof globalThis !== "undefined" ? globalThis.PZ : null);
  const THREE = (context && context.window && context.window.THREE) ||
    (typeof globalThis !== "undefined" ? globalThis.THREE : null);
  return { PZ, THREE };
}

function installSources(context, PZ, THREE) {
  const getAsset = context && typeof context.getAsset === "function"
    ? context.getAsset.bind(context)
    : null;
  if (!getAsset) {
    throw new Error("Optical Flares needs the plugin bundle asset resolver.");
  }
  for (const file of SOURCE_ORDER) {
    const source = getAsset("text", "./plugins/optical-flares/" + file);
    if (typeof source !== "string") {
      throw new Error("Optical Flares is missing its bundled source: " + file);
    }
    // Pass PZ/THREE as parameters: the legacy sources open with
    // `var PZ = PZ || {}`, which under a bare eval would shadow the global
    // with undefined and drop every definition. As parameters the var
    // merges with the argument binding and definitions land on the runtime.
    new Function("PZ", "THREE", source)(PZ, THREE);
  }
}

function reconcileDesigner(PZ) {
  // optflares.js registers its Options window with the Trapcode designer when
  // the designer is already present. When this pack activates first, do it
  // here so enable order never matters. Idempotent: registerConfig assigns.
  if (
    PZ.trapcode && PZ.trapcode.designer &&
    PZ.object3d && PZ.object3d.optflares &&
    !PZ.object3d.optflares.designer &&
    PZ.opticalflares && typeof PZ.opticalflares.open === "function"
  ) {
    PZ.trapcode.designer.registerConfig(PZ.object3d.optflares, {
      title: "Optical Flares Options",
      customOpen: function (root, designer) {
        if (PZ.opticalflares && PZ.opticalflares.open) {
          PZ.opticalflares.open(root, designer);
        }
      },
    });
  }
}

function installCreateWrapper(PZ) {
  const object3d = PZ.object3d;
  if (!object3d || typeof object3d.create !== "function") {
    throw new Error("Optical Flares needs PZ.object3d.create from the CM3 runtime.");
  }
  if (object3d.create.__opticalFlares) {
    // Already wrapped (for example by an earlier enable): revive the link
    // instead of stacking a second wrapper.
    object3d.create.__opticalFlaresAlive = true;
    installedCreate = object3d.create;
    return;
  }
  const original = object3d.create;
  const patched = function (type) {
    // If another pack wrapped above us and we are disabled out of order,
    // stay out of the way instead of intercepting a dead chain link.
    if (!patched.__opticalFlaresAlive) {
      return original.call(this, type);
    }
    if (type === 13 && object3d.optflares) {
      const instance = new object3d.optflares();
      instance.type = type;
      return instance;
    }
    return original.call(this, type);
  };
  patched.__opticalFlares = true;
  patched.__opticalFlaresAlive = true;
  patched.__opticalFlaresOriginal = original;
  object3d.create = patched;
  installedCreate = patched;
}

function uninstallCreateWrapper(PZ) {
  if (installedCreate) {
    installedCreate.__opticalFlaresAlive = false;
  }
  const object3d = PZ && PZ.object3d;
  if (object3d && installedCreate && object3d.create === installedCreate) {
    object3d.create = installedCreate.__opticalFlaresOriginal || object3d.create;
  }
  installedCreate = null;
}

module.exports = {
  activate(context) {
    const { PZ, THREE } = runtimeGlobals(context);
    if (!PZ) {
      throw new Error("Optical Flares needs the CM3 runtime.");
    }
    if (!THREE) {
      throw new Error("Optical Flares needs the THREE global from the CM3 runtime.");
    }
    installSources(context, PZ, THREE);
    if (!PZ.object3d.optflares || !PZ.opticalflares) {
      throw new Error("Optical Flares could not define its 3D object class.");
    }
    reconcileDesigner(PZ);
    installCreateWrapper(PZ);
    installFont(context);
    installedPZ = PZ;
  },
  deactivate() {
    try {
      uninstallCreateWrapper(installedPZ);
    } finally {
      try {
        uninstallFont();
      } finally {
        installedPZ = null;
      }
    }
  },
};
