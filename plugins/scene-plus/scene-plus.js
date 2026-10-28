"use strict";

// Effector entry: repeater and deformation effector 3D object classes.
//
// The implementation lives in small CommonJS files next to this entry:
// scene-values.js (constants and pure math), scene-fields.js (property
// definitions and readers), scene-clone.js (render-tree cloning),
// scene-effectors.js (the effector classes), scene-deform.js (scene
// deformation support), scene-repeaters.js (the repeater classes), and
// scene-state.js (shared mutable plugin state).
//
// The Zoidium runtime evaluates this entry without a `require` function, so
// sibling files are loaded lazily through the shared bundle module loader
// (`context.apis.modules.createRequire`). Under Node the same files load
// through plain relative requires, which keeps the tests working.

const SCENE_ROOT = "./plugins/scene-plus/";
const SIBLING_IDS = [
  "scene-values.js",
  "scene-fields.js",
  "scene-clone.js",
  "scene-effectors.js",
  "scene-deform.js",
  "scene-repeaters.js",
  "scene-state.js",
];

let parts = null;

function nodeRequire(id) {
  if (typeof require !== "function") return null;
  // A present Node loader must surface missing assets and evaluation errors.
  return require(id);
}

// The shared loader lives on the Zoidium API layer. Under Node it can be
// reached by requiring the API layer file; native-effect sources use the
// same loader through the global.
function sharedCreateRequire() {
  if (globalThis.ZoidiumPluginApis?.modules?.createRequire) {
    return globalThis.ZoidiumPluginApis.modules.createRequire;
  }
  const apis = nodeRequire("../../zoidium/plugin-apis.js");
  if (apis || globalThis.ZoidiumPluginApis?.modules?.createRequire) {
    return globalThis.ZoidiumPluginApis.modules.createRequire;
  }
  return null;
}

function loadParts(getAsset) {
  if (parts) return parts;
  if (typeof require === "function") {
    const loaded = {};
    let complete = true;
    for (const id of SIBLING_IDS) {
      loaded[id] = nodeRequire("./" + id);
      if (!loaded[id]) complete = false;
    }
    if (complete) {
      parts = {
        values: loaded["scene-values.js"],
        fields: loaded["scene-fields.js"],
        clone: loaded["scene-clone.js"],
        effectors: loaded["scene-effectors.js"],
        deform: loaded["scene-deform.js"],
        repeaters: loaded["scene-repeaters.js"],
        state: loaded["scene-state.js"],
      };
      populateTestSurface();
      return parts;
    }
  }
  const createRequire = sharedCreateRequire();
  if (!createRequire || typeof getAsset !== "function") {
    throw new Error("Effector requires the Zoidium bundle module loader.");
  }
  const bundleRequire = createRequire(getAsset, { root: SCENE_ROOT });
  parts = {
    values: bundleRequire("./scene-values.js"),
    fields: bundleRequire("./scene-fields.js"),
    clone: bundleRequire("./scene-clone.js"),
    effectors: bundleRequire("./scene-effectors.js"),
    deform: bundleRequire("./scene-deform.js"),
    repeaters: bundleRequire("./scene-repeaters.js"),
    state: bundleRequire("./scene-state.js"),
  };
  populateTestSurface();
  return parts;
}

// Loads the pure library from the CommonJS require when running under Node
// tests. Returns null in the Zoidium runtime, where require is undefined.
function loadLibraryFromRequire() {
  if (typeof require !== "function") return null;
  const library = {
    core: nodeRequire("./effector-core.js"),
    fracture: nodeRequire("./effector-fracture.js"),
    mesh: nodeRequire("./effector-mesh.js"),
  };
  if (!library.core || !library.fracture || !library.mesh) return null;
  return library;
}

// Evaluates the bundled library sources through the shared bundle loader.
// Each file receives a require shim that resolves sibling names in the same
// bundle.
function loadLibraryFromAssets(getAsset) {
  const createRequire = sharedCreateRequire();
  if (!createRequire || typeof getAsset !== "function") {
    throw new Error("Effector requires the plugin bundle asset resolver.");
  }
  const bundleRequire = createRequire(getAsset, { root: SCENE_ROOT });
  const core = bundleRequire("./effector-core.js");
  const fracture = bundleRequire("./effector-fracture.js");
  const mesh = bundleRequire("./effector-mesh.js");
  const jobs = bundleRequire("./effector-jobs.js");
  const names = ["earcut.js", "legacy-subdivision.js", "effector-core.js", "effector-fracture-index.js", "effector-fracture.js", "effector-mesh.js", "effector-evaluate.js"];
  const sources = {};
  for (const name of names) {
    sources[name] = getAsset("text", SCENE_ROOT + name);
  }
  return {
    core,
    fracture,
    mesh,
    jobs,
    workerSource: jobs.createWorkerSource(sources),
  };
}

function activate(context) {
  const { PZ, window, object3d } = context;
  const THREE = window?.THREE;
  if (!PZ || !THREE || !object3d || !PZ.objectList) {
    throw new Error("Effector requires the Zoidium 3D object registry.");
  }
  const p = loadParts(context.getAsset);
  const { values, effectors, deform, repeaters, state } = p;
  if (!state.library) state.library = loadLibraryFromAssets(context.getAsset);

  const unregister = [];
  context.lifecycle?.onDispose?.(() => deactivate.call(this));
  if (state.library.workerSource) {
    let redrawRequest = null;
    state.cancelRedraw = () => {
      if (redrawRequest !== null) window.cancelAnimationFrame(redrawRequest);
      redrawRequest = null;
    };
    const jobs = state.library.jobs.createMeshJobs(state.library.workerSource, window, () => {
      const viewport = window.CM?.mainViewport;
      if (!viewport?.enabled || redrawRequest !== null) return;
      redrawRequest = window.requestAnimationFrame(() => {
        redrawRequest = null;
        if (!viewport.enabled || state.meshJobs !== jobs) return;
        viewport.__zoidiumPlayerPlusRenderOnce = true;
        try { viewport._render?.(); } finally { viewport.__zoidiumPlayerPlusRenderOnce = false; }
      });
    });
    state.meshJobs = jobs;
    state.meshDeformerCache = null;
  }
  try {
    state.deformationSupport = deform.createDeformationSupport(PZ, THREE, context.editor);
    const definitions = [
      ["step", "zoidium:repeater/repeater", "Repeater"],
      ["linear", "zoidium:repeater/linear-repeater", "Linear Repeater"],
      ["random", "zoidium:repeater/random-repeater", "Random Repeater"],
      ["echo", "zoidium:repeater/echo-repeater", "Echo Repeater"],
    ];
    for (const [mode, type, name] of definitions) {
      const RepeaterObject = repeaters.createRepeaterClass(PZ, THREE, mode, type);
      unregister.push(
        object3d.registerClass({
          type,
          schemaVersion: values.SCHEMA_VERSION,
          name,
          factory: () => new RepeaterObject(),
        })
      );
    }
    const effectorClasses = [
      ["zoidium:repeater/plain", "Plain", effectors.createPlainClass(PZ, THREE)],
      ["zoidium:repeater/delay", "Delay", effectors.createDelayClass(PZ, THREE)],
      [values.TWIST_TYPE, "Twist", effectors.createTwistClass(PZ, THREE)],
      [values.WARP_TYPE, "Warp", effectors.createWarpClass(PZ, THREE)],
      [values.VORONOI_TYPE, "Voronoi Fracture", effectors.createVoronoiClass(PZ, THREE)],
    ];
    for (const [type, name, EffectorClass] of effectorClasses) {
      unregister.push(
        object3d.registerClass({
          type,
          schemaVersion: values.EFFECTOR_SCHEMA_VERSION,
          name,
          migrate: values.migrateLegacyEffectorRecord,
          factory: () => new EffectorClass(),
        })
      );
    }
  } catch (error) {
    for (const unregisterClass of unregister.reverse()) {
      try {
        unregisterClass();
      } catch (unregisterError) {
        console.warn("[Zoidium] Effector: could not roll back a 3D object class", unregisterError);
      }
    }
    state.deformationSupport?.deactivate();
    state.cancelRedraw?.();
    state.cancelRedraw = null;
    state.meshJobs?.dispose();
    state.deformationSupport = null;
    state.meshJobs = null;
    state.meshDeformerCache = null;
    throw error;
  }
  this.__zoidiumRepeaterUnregister = unregister;
  this.__zoidiumEffectorSupport = state.deformationSupport;
}

function deactivate() {
  const state = parts?.state;
  state?.cancelRedraw?.();
  if (state) state.cancelRedraw = null;
  for (const unregister of this.__zoidiumRepeaterUnregister || []) {
    try {
      unregister();
    } catch (error) {
      console.warn("[Zoidium] Effector: could not unregister a 3D object class", error);
    }
  }
  this.__zoidiumRepeaterUnregister = [];
  this.__zoidiumEffectorSupport?.deactivate?.();
  this.__zoidiumEffectorSupport = null;
  if (state) {
    state.deformationSupport = null;
    state.meshJobs?.dispose();
    state.meshJobs = null;
    state.meshDeformerCache = null;
  }
}

const testSurface = {};

function populateTestSurface() {
  if (!parts) return;
  Object.assign(testSurface, {
    defaultSourceData: parts.repeaters.defaultSourceData,
    createPropertyCategory: parts.fields.createPropertyCategory,
    createRepeaterClass: parts.repeaters.createRepeaterClass,
    nameNewSourceShapes: parts.values.nameNewSourceShapes,
    cloneMaterial: parts.clone.cloneMaterial,
    cloneRenderTree: parts.clone.cloneRenderTree,
    createDeformationSupport: parts.deform.createDeformationSupport,
    createEffectorBaseClass: parts.effectors.createEffectorBaseClass,
    installFieldHelpers: parts.deform.installFieldHelpers,
    fieldGuidePoints: parts.deform.fieldGuidePoints,
    createPlainClass: parts.effectors.createPlainClass,
    createDelayClass: parts.effectors.createDelayClass,
    createTwistClass: parts.effectors.createTwistClass,
    createWarpClass: parts.effectors.createWarpClass,
    createVoronoiClass: parts.effectors.createVoronoiClass,
    curvePolygonCount: parts.deform.curvePolygonCount,
    fieldFromProperties: parts.fields.fieldFromProperties,
    getCount: parts.values.getCount,
    getEchoFrame: parts.values.getEchoFrame,
    getEchoFrames: parts.values.getEchoFrames,
    getTransform: parts.values.getTransform,
    makeProperties: parts.fields.makeProperties,
    migrateLegacyEffectorRecord: parts.values.migrateLegacyEffectorRecord,
    migrateEffectorData: parts.values.migrateEffectorData,
    seededRandom: parts.values.seededRandom,
    getMeshDeformer: parts.deform.getMeshDeformer,
    loadLibraryFromAssets,
    library: () => parts?.state?.library,
  });
}

// Under Node the siblings load now so the test surface is populated at
// require time. In the Zoidium runtime require is undefined and loading
// waits for activate().
if (typeof require === "function") {
  loadParts();
  if (parts && !parts.state.library) {
    parts.state.library = loadLibraryFromRequire();
  }
}

module.exports = {
  activate,
  deactivate,
  _test: testSurface,
};
