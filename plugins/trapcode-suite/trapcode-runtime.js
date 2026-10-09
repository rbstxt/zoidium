"use strict";

// OpenZoid Trapcode Suite — runtime installer.
//
// Evaluates the bundled sources in dependency order (helpers, designer,
// Particular, Form, Plexus, C4D lights) and teaches PZ.object3d.create the
// Trapcode numeric types 10/11/12 that upstream CM3 does not know. The 3D
// picker entries are declared in the plugin manifest and owned by the plugin
// manager.
//
// Optical Flares (type 13) is a separate pack and is not installed here.
//
// The suite also restores the OpenZoid expression upgrade stock CM3 lacks:
// wiggle() and companion methods on PZ.expression.methods, the evaluation
// context (current frame/property/value) in PZ.expression.prototype.evaluate,
// and the property passthrough the context depends on. Methods install
// missing-only; wrappers chain with revive and restore.

const SOURCE_ORDER = [
  "trapcode-common.js",
  "designer.js",
  "particular.js",
  "form.js",
  "plexus.js",
  "lights-c4d.js",
];

const TRAPCODE_TYPES = [
  { type: 10, key: "particular" },
  { type: 11, key: "form" },
  { type: 12, key: "plexus" },
];

const WINDOW_PREFIX = "trapcode-suite:";

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
    throw new Error("Trapcode Suite needs the plugin bundle asset resolver.");
  }
  for (const file of SOURCE_ORDER) {
    const source = getAsset("text", "./plugins/trapcode-suite/" + file);
    if (typeof source !== "string") {
      throw new Error("Trapcode Suite is missing its bundled source: " + file);
    }
    // Pass PZ/THREE as parameters: the legacy sources open with
    // `var PZ = PZ || {}`, which under a bare eval would shadow the global
    // with undefined and drop every definition. As parameters the var
    // merges with the argument binding and definitions land on the runtime.
    new Function("PZ", "THREE", source)(PZ, THREE);
  }
}

function installCreateWrapper(PZ) {
  const object3d = PZ.object3d;
  if (!object3d || typeof object3d.create !== "function") {
    throw new Error("Trapcode Suite needs PZ.object3d.create from the CM3 runtime.");
  }
  if (object3d.create.__trapcodeSuite) {
    // Already wrapped (for example by an earlier enable): revive the link
    // instead of stacking a second wrapper.
    object3d.create.__trapcodeSuiteAlive = true;
    installedCreate = object3d.create;
    return;
  }
  const original = object3d.create;
  const patched = function (type) {
    // If another pack wrapped above us and we are disabled out of order,
    // stay out of the way instead of intercepting a dead chain link.
    if (!patched.__trapcodeSuiteAlive) {
      return original.call(this, type);
    }
    for (const entry of TRAPCODE_TYPES) {
      if (type === entry.type && object3d[entry.key]) {
        const instance = new object3d[entry.key]();
        instance.type = type;
        return instance;
      }
    }
    return original.call(this, type);
  };
  patched.__trapcodeSuite = true;
  patched.__trapcodeSuiteAlive = true;
  patched.__trapcodeSuiteOriginal = original;
  object3d.create = patched;
  installedCreate = patched;
}

function uninstallCreateWrapper(PZ) {
  if (installedCreate) {
    installedCreate.__trapcodeSuiteAlive = false;
  }
  const object3d = PZ && PZ.object3d;
  if (object3d && installedCreate && object3d.create === installedCreate) {
    object3d.create = installedCreate.__trapcodeSuiteOriginal || object3d.create;
  }
  installedCreate = null;
}

// OpenZoid expression support (wiggle and friends) lives in
// trapcode-common.js so it stays unit-testable; the runtime only wires
// it into the live PZ instance here.
function installExpressionSupport(PZ) {
  const T = PZ.trapcode || {};
  if (typeof T.installExpressionSupport !== "function") {
    throw new Error("Trapcode Suite needs the expression support from its bundle.");
  }
  T.installExpressionSupport(PZ);
}

function uninstallExpressionSupport(PZ) {
  try {
    const T = (PZ && PZ.trapcode) || {};
    if (typeof T.uninstallExpressionSupport === "function") {
      T.uninstallExpressionSupport(PZ);
    }
  } catch (_error) { /* best effort */ }
}

function installLights(PZ) {
  const T = PZ.trapcode || {};
  if (!T.lights || typeof T.lights.install !== "function") {
    throw new Error("Trapcode Suite needs its C4D light bundle.");
  }
  T.lights.install(PZ);
}

function uninstallLights(PZ) {
  try {
    const T = (PZ && PZ.trapcode) || {};
    if (T.lights && typeof T.lights.uninstall === "function") T.lights.uninstall();
  } catch (_error) { /* best effort */ }
}

function closeWindows() {
  try {
    const ui = typeof globalThis !== "undefined" ? globalThis.ZoidiumUI : null;
    if (ui && typeof ui.closeWindows === "function") ui.closeWindows(WINDOW_PREFIX);
  } catch (_error) { /* best effort */ }
}

// Unwinds whatever an activation attempt managed to install, in reverse.
function rollback(PZ) {
  uninstallLights(PZ);
  uninstallExpressionSupport(PZ);
  uninstallCreateWrapper(PZ);
  closeWindows();
}

module.exports = {
  activate(context) {
    const { PZ, THREE } = runtimeGlobals(context);
    if (!PZ) {
      throw new Error("Trapcode Suite needs the CM3 runtime.");
    }
    if (!THREE) {
      throw new Error("Trapcode Suite needs the THREE global from the CM3 runtime.");
    }
    try {
      installSources(context, PZ, THREE);
      if (!PZ.object3d.particular || !PZ.object3d.form || !PZ.object3d.plexus) {
        throw new Error("Trapcode Suite could not define its 3D object classes.");
      }
      installCreateWrapper(PZ);
      installExpressionSupport(PZ);
      installLights(PZ);
    } catch (error) {
      rollback(PZ);
      throw error;
    }
    installedPZ = PZ;
  },
  deactivate() {
    const PZ = installedPZ;
    try {
      closeWindows();
      uninstallLights(PZ);
    } finally {
      try {
        uninstallCreateWrapper(PZ);
      } finally {
        try {
          uninstallExpressionSupport(PZ);
        } finally {
          installedPZ = null;
        }
      }
    }
  },
};
