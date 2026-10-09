"use strict";

// Camera+ — a separate camera object for scenes, with depth of field, vibrate,
// and focus tools. The CM3 camera and its rendering are left untouched.
//
// Object type zoidium:camera-plus/camera ("Camera+") is registered through the
// Zoidium 3D object registry and appears under Camera in the 3D picker.
//
// Selection rule: a Scene renders through the first active Camera+ among its
// direct child objects, in list order. When a scene has none, its pass keeps
// the CM3 camera exactly as CM3 set it. With no Camera+ in a project, the
// hooks below change nothing that CM3 computes.
//
// Hooks, each installed only while the plugin is enabled and each undone on
// disable (only when the host still references the replacement):
// - THREE.RenderPass.prototype.render: delegates to the original unless the
//   scene's Camera+ enabled depth of field on this pass.
// - PZ.layer.scene.prototype.update / unload: sync the pass camera and the
//   depth-of-field state after CM3's own update.
// - PZ.layer.create(9): Davidium Camera layers load as inert layers. Their
//   camera data is not migrated.
// - PZ.expression.methods.focusDistanceTo: the focus link expression method.
// - Property control "camera-plus/focus-tools": the focus button row.
//
// Sources in ./plugins/camera-plus/*.js are evaluated through the bundle asset
// resolver and publish their parts on a shared `parts` object.

const PART_FILES = ["vibrate.js", "scene-dof.js", "camera-class.js", "focus-ui.js"];
const LEGACY_LAYER_TYPE = 9;
const CAMERA_OBJECT_TYPE_NUMBER = 6;
const REPORT_PREFIX = "Camera+:";

let active = null;
let hooks = null;

function loadParts(getAsset, PZ, THREE) {
  if (typeof getAsset !== "function") {
    throw new Error("Camera+ needs the plugin bundle asset resolver.");
  }
  const parts = {};
  for (const file of PART_FILES) {
    const source = getAsset("text", "./plugins/camera-plus/" + file);
    if (typeof source !== "string") {
      throw new Error("Camera+ is missing its bundled source: " + file);
    }
    // Parameters (not bare eval) keep the parts isolated from module scope.
    new Function("PZ", "THREE", "parts", source)(PZ, THREE, parts);
  }
  return parts;
}

function createTeardown() {
  const undo = [];
  let finished = false;
  return {
    push(step) {
      undo.push(step);
    },
    run() {
      if (finished) return;
      finished = true;
      for (const step of undo.splice(0).reverse()) {
        try {
          step();
        } catch (error) {
          console.error(REPORT_PREFIX, "cleanup step failed", error);
        }
      }
    },
  };
}

// Replace a method only while it is reachable; undo restores the original
// only if the host still references this replacement.
function patchMethod(holder, key, replacement, teardown) {
  const original = holder[key];
  holder[key] = replacement;
  teardown.push(function () {
    if (holder[key] === replacement) holder[key] = original;
  });
}

function requireMember(value, label) {
  if (value === undefined || value === null) {
    throw new Error("Camera+ needs " + label + " from the CM3 runtime.");
  }
  return value;
}

function requireMethod(holder, key, label) {
  if (!holder || typeof holder[key] !== "function") {
    throw new Error("Camera+ needs " + label + " from the CM3 runtime.");
  }
  return holder[key];
}

function activateCameraPlus(context, teardown) {
  const PZ = requireMember(context.PZ || globalThis.PZ, "PZ");
  const THREE = requireMember((context.window && context.window.THREE) || globalThis.THREE, "THREE");
  const object3d = context.object3d;
  const apis = context.apis;
  const ZoidiumUI = (context.window && context.window.ZoidiumUI) || globalThis.ZoidiumUI || null;

  if (!object3d || typeof object3d.registerClass !== "function") {
    throw new Error("Camera+ needs the Zoidium 3D object registry.");
  }
  if (!apis || !apis.propertyControls || typeof apis.propertyControls.register !== "function") {
    throw new Error("Camera+ needs ZoidiumPluginApis.propertyControls.");
  }
  if (!ZoidiumUI || !ZoidiumUI.controls) {
    throw new Error("Camera+ needs ZoidiumUI.");
  }
  requireMethod(PZ.layer && PZ.layer.scene && PZ.layer.scene.prototype, "update", "PZ.layer.scene.prototype.update");
  requireMethod(PZ.layer && PZ.layer.scene && PZ.layer.scene.prototype, "unload", "PZ.layer.scene.prototype.unload");
  requireMethod(PZ.layer, "create", "PZ.layer.create");
  requireMethod(THREE.RenderPass && THREE.RenderPass.prototype, "render", "THREE.RenderPass.prototype.render");
  requireMember(PZ.expression && PZ.expression.methods, "PZ.expression.methods");
  requireMember(PZ.ui && PZ.ui.properties, "PZ.ui.properties");
  requireMember(PZ.object3d && PZ.object3d.camera, "PZ.object3d.camera");

  const parts = loadParts(context.getAsset, PZ, THREE);
  const camera = parts.camera;
  const focus = parts.focus;
  const SceneDof = parts.dof.createSceneDofClass(THREE);
  const CameraPlus = camera.createClass(PZ, THREE, parts.vibrate);
  const worldDistance = camera.worldDistance;

  let live = true;
  let focusWindowKey = 0;
  const scenes = new Map(); // scene -> { previousCamera, dof }
  let reported = false;

  function getEditor() {
    return globalThis.CM || context.editor || null;
  }

  function currentProject() {
    const editor = getEditor();
    return editor && editor.project ? editor.project : null;
  }

  // ---- scene selection and depth of field ---------------------------------

  function isCameraPlusObject(object) {
    return !!object && object.type === camera.OBJECT_TYPE && !object._zoidiumMissingObject;
  }

  function findActiveCamera(scene) {
    const objects = scene.objects;
    if (!objects) return null;
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      if (isCameraPlusObject(object) && object.threeObj && object.isActive()) return object;
    }
    return null;
  }

  // The CM3 camera of a scene: its first camera object (cameras are not
  // Camera+ objects). Used to hand the pass back on restore.
  function defaultCameraOf(scene) {
    const objects = scene.objects;
    if (!objects) return null;
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i];
      if (!object || object._zoidiumMissingObject || isCameraPlusObject(object)) continue;
      if (object instanceof PZ.object3d.camera || object.type === CAMERA_OBJECT_TYPE_NUMBER) {
        if (object.threeObj) return object.threeObj;
      }
    }
    return null;
  }

  function restoreScene(scene, entry) {
    const pass = scene.pass;
    if (pass) {
      pass.__cameraPlusDof = null;
      const own = defaultCameraOf(scene);
      pass.camera = own || entry.previousCamera || pass.camera;
    }
    if (entry.dof) {
      entry.dof.unload();
      entry.dof = null;
    }
  }

  function syncScene(scene, time) {
    const pass = scene.pass;
    if (!pass) return;
    const cameraObject = findActiveCamera(scene);
    let entry = scenes.get(scene) || null;
    if (!cameraObject) {
      if (entry) {
        restoreScene(scene, entry);
        scenes.delete(scene);
      }
      return;
    }
    if (!entry) {
      entry = { previousCamera: pass.camera, dof: null };
      scenes.set(scene, entry);
    }
    pass.camera = cameraObject.threeObj;
    const settings = cameraObject.readDepthOfField(time);
    if (settings) {
      if (!entry.dof) entry.dof = new SceneDof();
      entry.dof.configure(settings);
      entry.dof.enabled = true;
      pass.__cameraPlusDof = entry.dof;
    } else {
      if (entry.dof) entry.dof.enabled = false;
      pass.__cameraPlusDof = null;
    }
  }

  function reportOnce(error) {
    if (reported) return;
    reported = true;
    console.error(REPORT_PREFIX, "scene camera sync failed; the scene keeps its CM3 camera", error);
  }

  function restoreAllScenes() {
    for (const [scene, entry] of Array.from(scenes.entries())) {
      restoreScene(scene, entry);
    }
    scenes.clear();
  }

  teardown.push(function () {
    live = false;
  });
  teardown.push(restoreAllScenes);

  // ---- object class ------------------------------------------------------

  const unregisterClass = object3d.registerClass({
    type: camera.OBJECT_TYPE,
    schemaVersion: camera.SCHEMA_VERSION,
    name: "Camera+",
    factory: () => new CameraPlus(),
  });
  teardown.push(function () {
    unregisterClass();
  });

  // ---- render pass depth of field -----------------------------------------

  const renderPassProto = THREE.RenderPass.prototype;
  const originalRender = renderPassProto.render;
  patchMethod(renderPassProto, "render", function renderWithCameraPlus(renderer, target, readTarget, forceClear) {
    const dof = this.__cameraPlusDof;
    if (!live || !dof || !dof.enabled) {
      return originalRender.apply(this, arguments);
    }
    this.scene.overrideMaterial = this.overrideMaterial;
    this.envMap.render(renderer);
    this.motionBlur.render(renderer);
    dof.render(renderer, target, this.scene, this.camera, target.viewport, forceClear);
    this.scene.overrideMaterial = null;
  }, teardown);

  // ---- scene update and unload ---------------------------------------------

  const sceneProto = PZ.layer.scene.prototype;
  const originalSceneUpdate = sceneProto.update;
  patchMethod(sceneProto, "update", function updateWithCameraPlus(time) {
    const out = originalSceneUpdate.apply(this, arguments);
    if (live) {
      try {
        syncScene(this, time);
      } catch (error) {
        reportOnce(error);
      }
    }
    return out;
  }, teardown);

  const originalSceneUnload = sceneProto.unload;
  patchMethod(sceneProto, "unload", function unloadWithCameraPlus() {
    if (live) {
      const entry = scenes.get(this);
      if (entry) {
        restoreScene(this, entry);
        scenes.delete(this);
      }
    }
    return originalSceneUnload.apply(this, arguments);
  }, teardown);

  // ---- legacy Davidium Camera layers ----------------------------------------

  const originalLayerCreate = PZ.layer.create;
  patchMethod(PZ.layer, "create", function createWithCameraPlus(type) {
    if (live && type === LEGACY_LAYER_TYPE) {
      // Inert layer: it draws nothing and holds no camera, so it cannot
      // override a scene's camera. Its saved data is ignored.
      const layer = new PZ.layer();
      layer.type = LEGACY_LAYER_TYPE;
      return layer;
    }
    return originalLayerCreate.apply(this, arguments);
  }, teardown);

  // ---- focus tools ---------------------------------------------------------

  const focusOptions = {
    PZ: PZ,
    THREE: THREE,
    ui: context.ui,
    getEditor: getEditor,
    objectType: camera.OBJECT_TYPE,
    worldDistance: worldDistance,
    nextKey: function () {
      focusWindowKey += 1;
      return focusWindowKey;
    },
  };
  const openFocusTools = function (owner) {
    return focus.createFocusTools(focusOptions, owner).openWindow();
  };

  const expressionMethod = focus.createExpressionMethod({
    THREE: THREE,
    getEditor: getEditor,
    worldDistance: worldDistance,
  });
  expressionMethod.__cameraPlus = true;
  const methods = PZ.expression.methods;
  if (typeof methods[focus.METHOD_NAME] === "function" && !methods[focus.METHOD_NAME].__cameraPlus) {
    throw new Error("Camera+ cannot define " + focus.METHOD_NAME + ": the name is already in use.");
  }
  methods[focus.METHOD_NAME] = expressionMethod;
  teardown.push(function () {
    if (methods[focus.METHOD_NAME] === expressionMethod) delete methods[focus.METHOD_NAME];
  });

  const unregisterControl = apis.propertyControls.register(camera.FOCUS_CONTROL_ID, {
    type: PZ.property.type.TEXT,
    create: function (property, controlContext) {
      return focus.createControl({ PZ: PZ, zoidiumUI: ZoidiumUI, openFor: openFocusTools }, property, controlContext);
    },
  });
  teardown.push(function () {
    unregisterControl();
  });

  hooks = {
    legacyLayersPresent() {
      const project = currentProject();
      if (!project || typeof project.forEachItemOfType !== "function") return false;
      let found = false;
      project.forEachItemOfType(PZ.layer, function (layer) {
        if (layer.type === LEGACY_LAYER_TYPE) found = true;
      });
      return found;
    },
  };
  teardown.push(function () {
    hooks = null;
  });
}

module.exports = {
  activate(context) {
    if (active) return;
    const teardown = createTeardown();
    if (context && context.lifecycle && typeof context.lifecycle.onDispose === "function") {
      context.lifecycle.onDispose(function () {
        teardown.run();
      });
    }
    try {
      activateCameraPlus(context, teardown);
    } catch (error) {
      teardown.run();
      throw error;
    }
    active = teardown;
  },
  deactivate() {
    const current = active;
    active = null;
    if (current) current.run();
  },
  isInUse() {
    return hooks ? hooks.legacyLayersPresent() : false;
  },
};
