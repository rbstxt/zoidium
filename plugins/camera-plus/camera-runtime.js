"use strict";

// Camera+ — a separate camera object for scenes, with depth of field, vibrate,
// and focus tools. The CM3 camera and its rendering are left untouched.
//
// Object type zoidium:camera-plus/camera ("Camera+") is registered through the
// Zoidium 3D object registry and appears under Camera in the 3D picker.
//
// Selection rule: a Scene renders through the first active Camera+ among its
// child objects, in depth-first list order. When a scene has none, its pass keeps
// the CM3 camera exactly as CM3 set it. With no Camera+ in a project, the
// hooks below change nothing that CM3 computes.
//
// Hooks, each installed only while the plugin is enabled and each undone on
// disable (only when the host still references the replacement):
// - THREE.RenderPass.prototype.render: delegates to the original unless the
//   scene's Camera+ enabled depth of field on this pass.
// - PZ.layer.scene.prototype.update / unload: sync the pass camera and the
//   depth-of-field state after CM3's own update.
// - The stock `instanceof PZ.object3d.camera` check (used only by the
//   editor viewport helper) recognises Camera+, and THREE.CameraHelper
//   refreshes every render: a selected Camera+ shows the stock frustum.
// - Shared-camera layer registration and deterministic second-pass tracking.
// - PZ.expression.methods.focusDistanceTo: the focus link expression method.
// - Property control "camera-plus/focus-tools": the focus button row.
//
// Sources in ./plugins/camera-plus/*.js are evaluated through the bundle asset
// resolver and publish their parts on a shared `parts` object.

const PART_FILES = ["vibrate.js", "scene-dof.js", "scene-motion-blur.js", "camera-class.js", "focus-ui.js", "shared-depth.js", "shared-camera.js"];
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
  requireMethod(apis.timeline, "registerTrackButton", "ZoidiumPluginApis.timeline.registerTrackButton");
  requireMethod(apis.timeline, "registerTrackField", "ZoidiumPluginApis.timeline.registerTrackField");
  requireMethod(apis.media, "registerPreset", "ZoidiumPluginApis.media.registerPreset");
  requireMethod(apis.layers, "registerType", "ZoidiumPluginApis.layers.registerType");
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
  const SceneMotionBlur = parts.motion.createSceneMotionBlurClass(THREE);
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

  function findActiveCamera(scene, time) {
    function walk(objects) {
      for (const object of objects || []) {
        if (object.properties?.enabled && object.properties.enabled.get(time) !== 1) continue;
        if (isCameraPlusObject(object) && object.threeObj && object.isActive()) return object;
        // Repeater clones do not represent a single authored camera pose.
        if (object.__zoidiumRepeater) continue;
        const child = object.objects && walk(object.objects);
        if (child) return child;
      }
      return null;
    }
    return walk(scene.objects);
  }

  // Preserve the exact native camera the Scene used before borrowing one.
  // If it was removed, use the last authored native camera as CM3 load does.
  function nativeCameraObjectOf(scene, preferred) {
    const cameras = [];
    function walk(objects) {
      for (const object of objects || []) {
        if (!object || object._zoidiumMissingObject || object.__zoidiumRepeater) continue;
        if (!isCameraPlusObject(object) && (object instanceof PZ.object3d.camera || object.type === CAMERA_OBJECT_TYPE_NUMBER) && object.threeObj) cameras.push(object);
        if (object.objects) walk(object.objects);
      }
    }
    walk(scene.objects);
    const previous = preferred || scenes.get(scene)?.previousCamera || scene.pass?.camera;
    return cameras.find(object => object.threeObj === previous) || cameras[cameras.length - 1] || null;
  }

  function restoreScene(scene, entry) {
    const pass = scene.pass;
    if (pass) {
      pass.__cameraPlusDof = null;
      pass.__cameraPlusState = null;
      const own = nativeCameraObjectOf(scene, entry.previousCamera)?.threeObj;
      pass.camera = own || entry.previousCamera || pass.camera;
    }
    if (entry.blur) { entry.blur.unload(); entry.blur = null; }
    if (entry.dof) {
      entry.dof.unload();
      entry.dof = null;
    }
  }

  function syncScene(scene, time, sharedCamera, master) {
    const pass = scene.pass;
    if (!pass) return;
    let entry = scenes.get(scene) || null;
    const cameraObject = sharedCamera || (entry && entry.sampling ? entry.cameraObject : findActiveCamera(scene, time));
    if (!cameraObject) {
      if (entry) {
        restoreScene(scene, entry);
        scenes.delete(scene);
      }
      return;
    }
    if (!entry) {
      entry = { previousCamera: pass.camera, dof: null, blur: null, scene };
      scenes.set(scene, entry);
    }
    pass.camera = cameraObject.threeObj;
    entry.cameraObject = cameraObject;
    if (!entry.sampling) {
      entry.time = time;
      entry.motion = cameraObject.readMotionBlur?.(master ? master.local : time) || null;
      entry.master = master;
    }
    if (entry.motion && !entry.blur) entry.blur = new SceneMotionBlur();
    pass.__cameraPlusState = entry;
    const cameraTime = master ? master.local : entry.sampling && entry.master ? entry.master.local + time - entry.time : time;
    const settings = cameraObject.readDepthOfField?.(cameraTime);
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
    const state = this.__cameraPlusState;
    const pass = this;
    function draw(output, clear) {
      const dof = pass.__cameraPlusDof;
      if (!live || !dof || !dof.enabled || pass.__cameraPlusGlobalDof) {
        return originalRender.call(pass, renderer, output, readTarget, clear);
      }
      const previous = pass.scene.overrideMaterial;
      try {
        pass.scene.overrideMaterial = pass.overrideMaterial;
        pass.envMap.render(renderer);
        pass.motionBlur.render(renderer);
        dof.render(renderer, output, pass.scene, pass.camera, output.viewport, clear);
      } finally {
        pass.scene.overrideMaterial = previous;
      }
    }
    if (live && state && state.motion && !state.sampling) {
      state.sampling = true;
      try {
        return state.blur.render(renderer, target, state.time, state.motion,
          (frame) => {
            if (state.master) {
              const masterTime = state.master.local + frame - state.time;
              state.master.layer.update(masterTime);
            }
            state.scene.update(frame);
          }, draw, forceClear);
      } finally {
        state.sampling = false;
      }
    }
    return draw(target, forceClear);
  }, teardown);

  // ---- scene update and unload ---------------------------------------------

  const sceneProto = PZ.layer.scene.prototype;
  const originalSceneUpdate = sceneProto.update;
  patchMethod(sceneProto, "update", function updateWithCameraPlus(time) {
    // CM3 captures future model-view matrices before updating the output
    // frame. With Camera+, compute that future camera view explicitly; the
    // camera inverse left by the previous render is not a valid sample.
    if (live && this.motionBlur?.velocityBuffer) {
      const entry = scenes.get(this);
      const sampledCamera = entry?.sampling ? entry.cameraObject : shared.cameraFor(this, time + .5) || findActiveCamera(this, time);
      if (sampledCamera) {
        for (const object of this.objects) object.update(time + 0.5);
        this.threeObj.updateMatrixWorld(true);
        sampledCamera.threeObj.matrixWorldInverse.getInverse(sampledCamera.threeObj.matrixWorld);
        this.pass.camera = sampledCamera.threeObj;
      }
    }
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

  function migrateCameraData(data) {
    if (!data || typeof data !== "object") return data;
    if (data.type === 6 && Object.keys(data.properties || {}).some(key => /^(dof|vibrate|focalLength|filmGate|zoom|filmOffset|projection)/.test(key))) {
      const properties = Object.assign({}, data.properties);
      const depthOfField = Object.assign({}, properties.depthOfField);
      for (const [oldKey, newKey] of Object.entries({
        dof: "enabled", dofFocusDistance: "focusDistance", dofAperture: "aperture",
        dofFocusAreaWidth: "focusAreaWidth", dofNearBlurLevel: "nearBlurLevel", dofFarBlurLevel: "farBlurLevel",
      })) {
        if (properties[oldKey] !== undefined) depthOfField[newKey] = properties[oldKey];
      }
      properties.depthOfField = depthOfField;
      properties.projection = data.objectType === 2 ? "orthographic" : "perspective";
      return { type: camera.OBJECT_TYPE, schemaVersion: camera.SCHEMA_VERSION, properties };
    }
    return Object.assign({}, data, data.objects ? { objects: data.objects.map(migrateCameraData) } : {});
  }

  const shared = parts.shared({ PZ, THREE, apis, teardown, patchMethod,
    migrateCameraData, syncScene, findActiveCamera, nativeCameraObjectOf, plugin: context.plugin, getProject: currentProject });
  const projectChanged = getEditor()?.onProjectChanged;
  if (projectChanged?.watch && projectChanged?.unwatch) {
    let previousProject = currentProject();
    const onProjectChanged = () => {
      const next = currentProject();
      if (previousProject && previousProject !== next) previousProject.forEachItemOfType(PZ.object3d, object => {
        if (isCameraPlusObject(object)) object.unload();
      });
      previousProject = next;
      restoreAllScenes();
      shared.projectChanged();
    };
    teardown.push(() => projectChanged.unwatch(onProjectChanged));
    projectChanged.watch(onProjectChanged);
  }

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
  const openFocusTools = function (owner, mode) {
    const tools = focus.createFocusTools(focusOptions, owner);
    if (mode === "unlink") return tools.unlink();
    return mode ? tools.openTargetWindow(mode) : tools.openWindow();
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

  // Editor viewport frustum helper: teach the stock camera check to
  // recognise Camera+ and refresh the helper every render, so a selected
  // Camera+ shows the same orange frustum as the stock camera.
  installCameraHelper({ PZ: PZ, THREE: THREE, teardown: teardown, isCameraPlusObject: isCameraPlusObject });

  hooks = {
    legacyLayersPresent() {
      const project = currentProject();
      if (!project || typeof project.forEachItemOfType !== "function") return false;
      let found = false;
      project.forEachItemOfType(PZ.layer, function (layer) {
        if (layer.type === LEGACY_LAYER_TYPE || layer.__cameraPlusLegacy) found = true;
      });
      return found || !!project.sequence?.videoTracks?.some(track => track.track3d);
    },
  };
  teardown.push(function () {
    hooks = null;
  });
}

// Editor viewport frustum helper for Camera+ objects. CM3 shows a
// THREE.CameraHelper (on layer 1, viewport-only) for the selected stock
// camera and a BoxHelper for other 3D objects. Camera+ objects fail the
// stock `instanceof PZ.object3d.camera` check, so that check is taught to
// recognise Camera+ as well. This is looked up at call time (unlike
// PZ.ui.helper3d.prototype.objectsChanged, which viewports bind at
// construction), so it applies to every viewport, present and future, and
// shares the stock behaviour exactly: shown only for a single selection in
// the editor viewport, hidden otherwise, never in renders or exports.
// The stock CameraHelper computes its frustum once, but Camera+ film
// properties are dynamic, so its constructor is wrapped to refresh on every
// render (the stock BoxHelper precedent) and to follow the live camera
// object across perspective/orthographic swaps.
function installCameraHelper(options) {
  const PZ = options.PZ;
  const THREE = options.THREE;
  const teardown = options.teardown;
  const isCameraPlusObject = options.isCameraPlusObject;
  const cameraClass = PZ.object3d && PZ.object3d.camera;
  if (typeof cameraClass !== "function") return;
  if (typeof THREE.CameraHelper !== "function") return;
  const hasInstanceKey = Symbol.hasInstance;
  const originalDescriptor = Object.getOwnPropertyDescriptor(cameraClass, hasInstanceKey);
  const originalHasInstance = cameraClass[hasInstanceKey];
  Object.defineProperty(cameraClass, hasInstanceKey, {
    configurable: true,
    value: function cameraPlusHasInstance(instance) {
      if (instance && isCameraPlusObject(instance)) return true;
      return originalHasInstance.call(this, instance);
    },
  });
  teardown.push(function () {
    try {
      if (originalDescriptor) Object.defineProperty(cameraClass, hasInstanceKey, originalDescriptor);
      else delete cameraClass[hasInstanceKey];
    } catch (error) {
      console.error(REPORT_PREFIX, "camera helper check cleanup failed", error);
    }
  });

  const OriginalCameraHelper = THREE.CameraHelper;
  const created = new Set();
  function PatchedCameraHelper(camera) {
    OriginalCameraHelper.call(this, camera);
    created.add(this);
    const helper = this;
    this.onBeforeRender = function () {
      const owner = helper.camera && helper.camera.__cameraPlusOwner;
      const live = (owner && owner.threeObj) || helper.camera;
      if (live && helper.camera !== live) {
        helper.camera = live;
        helper.matrix = live.matrixWorld;
      }
      helper.update();
    };
  }
  PatchedCameraHelper.prototype = OriginalCameraHelper.prototype;
  patchMethod(THREE, "CameraHelper", PatchedCameraHelper, teardown);

  // Remove helpers created here and rebuild the stock disabled appearance
  // for a still-selected Camera+, so disabling leaves the viewport as if
  // the plugin was never enabled.
  teardown.push(function () {
    for (const helper of Array.from(created)) {
      created.delete(helper);
      try {
        if (!helper.parent) continue;
        const viewport = helper.parent;
        viewport.remove(helper);
        const owner = helper.camera && helper.camera.__cameraPlusOwner;
        if (owner && owner.threeObj && isCameraPlusObject(owner) && typeof THREE.BoxHelper === "function") {
          const fallback = new THREE.BoxHelper(owner.threeObj);
          fallback.layers.set(1);
          fallback.onBeforeRender = function () {
            fallback.update();
          };
          viewport.add(fallback);
        }
      } catch (error) {
        console.error(REPORT_PREFIX, "camera helper cleanup failed", error);
      }
    }
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
