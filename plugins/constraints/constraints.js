"use strict";

// Constraints — Blender-style object constraints for CM3 3D objects.
// Track To is the first constraint type: an object's track axis points at a
// target object of the same 3D Scene layer on every frame.
//
// Hooks, each installed only while the plugin is enabled and each undone on
// disable (only when the host still references the replacement):
// - PZ.object3d.create: wraps each new object's load so the constraint rows
//   are attached after the object's own properties have loaded.
// - PZ.layer.scene.prototype.update: post pass after CM3 updated the scene.
// - PZ.layer.scene.prototype.load: groups the objects of a loaded scene into
//   one batch so duplicated or pasted scenes keep their internal links.
// - PZ.motionBlur.prototype.update: applies the constraints to the half-frame
//   sample CM3 takes for its velocity buffer.
// - PZ.ui.viewport.prototype._render: the editor-only relationship line.
// - Property controls constraints/track-to, track-axis and up-axis.
//
// A project without constraints renders exactly as before: the pass finds
// no constrained object and changes nothing, and default-valued rows are not
// serialized.

const PLUGIN_ID = "constraints";

let active = null;

function createTeardown() {
  const steps = [];
  let finished = false;
  return {
    push(step) {
      steps.push(step);
    },
    run() {
      if (finished) return;
      finished = true;
      for (const step of steps.splice(0).reverse()) {
        try {
          step();
        } catch (error) {
          console.error("[Zoidium] Constraints: cleanup step failed", error);
        }
      }
    },
  };
}

function patchMethod(holder, key, makeReplacement, teardown) {
  const original = holder[key];
  const replacement = makeReplacement(original);
  holder[key] = replacement;
  teardown.push(() => {
    if (holder[key] === replacement) holder[key] = original;
  });
  return original;
}

function currentProjects(editor) {
  const projects = [];
  if (editor?.project) projects.push(editor.project);
  return projects;
}

function install(context, teardown) {
  const PZ = context.PZ || globalThis.PZ;
  const win = context.window || globalThis;
  const THREE = win.THREE || globalThis.THREE;
  const apis = context.apis;
  if (!PZ?.object3d || typeof PZ.object3d.create !== "function" || !PZ.layer?.scene?.prototype || !THREE) {
    throw new Error("Constraints needs the CM3 3D object and scene runtime.");
  }
  if (!apis?.propertyControls?.register || !apis?.modules?.createRequire) {
    throw new Error("Constraints needs ZoidiumPluginApis.propertyControls and modules.");
  }
  const require = apis.modules.createRequire(context.getAsset, { root: "./plugins/constraints/" });
  const { createPropertyStore } = require("./constraint-properties.js");
  const { createEvaluator } = require("./track-to-evaluate.js");
  const { createControls } = require("./constraint-ui.js");
  const { installOverlay } = require("./constraint-overlay.js");

  let live = true;
  teardown.push(() => { live = false; });
  const editor = () => win.CM || context.editor || null;

  const store = createPropertyStore({
    PZ,
    crypto: win.crypto || globalThis.crypto,
    onStructureChanged: () => evaluator.invalidate(),
    onValueChanged: () => {
      const project = editor()?.project;
      if (project?.ui) project.ui.dirty = true;
    },
  });
  const evaluator = createEvaluator({
    THREE, PZ, patch: (holder, key, make) => patchMethod(holder, key, make, teardown),
    store,
    report: (message, error) => (error ? console.warn(message, error) : console.warn(message)),
  });

  // Each object created while the plugin is enabled loads, then receives its
  // constraint rows with the saved values from the same data.
  function wrapLoad(object) {
    if (!object || typeof object.load !== "function") return object;
    const nativeLoad = object.load;
    Object.defineProperty(object, "load", {
      configurable: true,
      writable: true,
      enumerable: false,
      value: function loadWithConstraints(data) {
        if (!live) return nativeLoad.apply(this, arguments);
        store.beginLoad();
        let result;
        try {
          result = nativeLoad.apply(this, arguments);
          if (result && typeof result.then === "function") {
            result = result.then((value) => {
              if (live) store.attach(this, data);
              return value;
            });
          } else {
            store.attach(this, data);
          }
        } finally {
          store.endLoad();
        }
        return result;
      },
    });
    return object;
  }

  patchMethod(PZ.object3d, "create", (original) => function createWithConstraints() {
    const object = original.apply(this, arguments);
    return live ? wrapLoad(object) : object;
  }, teardown);

  const sceneProto = PZ.layer.scene.prototype;
  patchMethod(sceneProto, "load", (original) => function loadSceneWithConstraints() {
    if (!live) return original.apply(this, arguments);
    store.beginLoad();
    try {
      return original.apply(this, arguments);
    } finally {
      store.endLoad();
      evaluator.invalidate();
    }
  }, teardown);

  patchMethod(sceneProto, "update", (original) => function updateSceneWithConstraints(time) {
    const result = original.apply(this, arguments);
    if (live) {
      try {
        evaluator.applyScene(this, time);
      } catch (error) {
        console.warn("[Zoidium] Constraints: scene evaluation failed", error);
      }
    }
    return result;
  }, teardown);

  // CM3 samples every object at frame + 0.5 for its velocity buffer and then
  // updates the scene's world matrices. Apply the constraints to that sample.
  const motionBlurProto = PZ.motionBlur?.prototype;
  if (motionBlurProto && typeof motionBlurProto.update === "function") {
    patchMethod(motionBlurProto, "update", (original) => function updateMotionBlurWithConstraints(time) {
      const layer = this.layer;
      const scene = this.scene;
      if (!live || !this.velocityBuffer || !scene || !layer || !evaluator.hasConstraints(layer)) {
        return original.apply(this, arguments);
      }
      const ownDescriptor = Object.getOwnPropertyDescriptor(scene, "updateMatrixWorld");
      const inherited = scene.updateMatrixWorld;
      scene.updateMatrixWorld = function updateMatrixWorldWithConstraints() {
        const out = inherited.apply(this, arguments);
        evaluator.applyScene(layer, time + 0.5);
        return out;
      };
      try {
        return original.apply(this, arguments);
      } finally {
        if (ownDescriptor) Object.defineProperty(scene, "updateMatrixWorld", ownDescriptor);
        else delete scene.updateMatrixWorld;
      }
    }, teardown);
  }

  const controls = createControls({ PZ, document: win.document, store, evaluator });
  for (const unregister of controls.register(apis.propertyControls)) teardown.push(unregister);

  teardown.push(installOverlay({ PZ, THREE, store, evaluator }));

  // Objects of a project that was already open receive their rows now. Their
  // saved constraint values were dropped by CM3 if the plugin was disabled
  // when the project loaded; reopening the project restores them.
  for (const project of currentProjects(editor())) {
    try {
      project.forEachItemOfType(PZ.object3d, (object) => store.attach(object, null));
    } catch (error) {
      console.warn("[Zoidium] Constraints: could not prepare the open project", error);
    }
  }
  teardown.push(() => store.detachAll(currentProjects(editor())));

  return {
    isInUse() {
      for (const project of currentProjects(editor())) {
        let used = false;
        try {
          project.forEachItemOfType(PZ.object3d, (object) => {
            if (!used && store.isAttached(object) && store.readTarget(object)) used = true;
          });
        } catch (_error) {
          used = false;
        }
        if (used) return true;
      }
      return false;
    },
  };
}

module.exports = {
  activate(context) {
    if (active) return;
    const teardown = createTeardown();
    context.lifecycle?.onDispose?.(() => teardown.run());
    try {
      const runtime = install(context, teardown);
      active = { teardown, runtime };
    } catch (error) {
      teardown.run();
      throw error;
    }
  },
  deactivate() {
    const current = active;
    active = null;
    if (current) current.teardown.run();
  },
  isInUse() {
    return Boolean(active?.runtime?.isInUse());
  },
  inUseReason() {
    return "This project uses Track To constraints. Set every Track to row to None to disable Constraints.";
  },
  PLUGIN_ID,
};
