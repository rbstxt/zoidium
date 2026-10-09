"use strict";

// Camera+ — C4D camera, tracking camera, and depth-of-field runtime.
//
// Evaluates the bundled OpenZoid camera sources (shake engine, camera
// object, camera layer, DOF pass, focus UI, sequence tracking, compositor
// renderLayer) and wires them into the upstream runtime:
// - PZ.layer.create gains the Camera layer (type 9).
// - PZ.expression.methods gains focusDistanceTo for focus expressions.
// - THREE.RenderPass renders through the per-object DOF pass when enabled.
// - The Scene update syncs the active camera object into its DOF pass.
// - The base layer update applies shared-camera tracking after the native
//   pass, and disposes tracked-video GPU objects on unload.
// - The property-button dispatcher routes the focus actions.
// - Track headers gain the 3D tracking toggle with Transform bootstrap.

const SOURCE_ORDER = [
  "vibrate.js",
  "camera-class.js",
  "camera-layer.js",
  "scene-dof.js",
  "sequence-tracking.js",
  "render-layer.js",
  "depth-passes.js",
  "render-sequence.js",
  "focus-ui.js",
];

let installedPZ = null;
let installedLayerCreate = null;
let installedLayerLoad = null;
let installedCameraLoad = null;
let installedPropertyListLoad = null;
let installedSequenceUpdate = null;
let installedLayerUpdate = null;
let installedLayerUnload = null;
let installedSceneUpdate = null;
let installedSceneUnload = null;
let installedDispatcher = null;
let installedTrackLabel = null;
let installedRenderPass = null;
let installedCompositorReset = null;

function installSources(context, PZ, THREE) {
  const getAsset = context && typeof context.getAsset === "function"
    ? context.getAsset.bind(context)
    : null;
  if (!getAsset) {
    throw new Error("Camera+ needs the plugin bundle asset resolver.");
  }
  for (const file of SOURCE_ORDER) {
    const source = getAsset("text", "./plugins/camera-plus/" + file);
    if (typeof source !== "string") {
      throw new Error("Camera+ is missing its bundled source: " + file);
    }
    // Parameters (not bare eval): the extracted core statements assign onto
    // the live namespaces instead of a shadowed local.
    new Function("PZ", "THREE", source)(PZ, THREE);
  }
}

function installLayerProperties(PZ) {
  if (!PZ.layer || !PZ.layer.propertyDefinitions) {
    throw new Error("Camera+ needs PZ.layer.propertyDefinitions from the CM3 runtime.");
  }
  const D = PZ.layer.propertyDefinitions;
  if (!D.depth) {
    D.depth = {
      dynamic: true,
      name: "Depth",
      type: PZ.property.type.NUMBER,
      value: 0,
      min: -1000,
      max: 1000,
      step: 1,
      decimals: 0,
    };
  }
  if (!D.motionBlurAmount) {
    D.motionBlurAmount = {
      dynamic: true,
      name: "Motion Blur",
      type: PZ.property.type.NUMBER,
      value: 1,
      min: 0,
      max: 1,
      step: 0.01,
      decimals: 2,
    };
  }
  if (!D.rotationX) {
    D.rotationX = {
      dynamic: true,
      name: "Rotation X (3D)",
      type: PZ.property.type.NUMBER,
      scaleFactor: Math.PI / 180,
      value: 0,
      step: 3,
      decimals: 1,
    };
  }
  if (!D.rotationY) {
    D.rotationY = {
      dynamic: true,
      name: "Rotation Y (3D)",
      type: PZ.property.type.NUMBER,
      scaleFactor: Math.PI / 180,
      value: 0,
      step: 3,
      decimals: 1,
    };
  }
}

function ensureLayerProperty(layer, key) {
  try {
    if (!layer || !layer.properties || layer.properties[key]) return;
    const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const def = PZNow && PZNow.layer && PZNow.layer.propertyDefinitions &&
      PZNow.layer.propertyDefinitions[key];
    if (!def || !PZNow.property || typeof PZNow.property.create !== "function") return;
    const created = PZNow.property.create(def);
    // Shell only, never seeded here: the native load() that follows seeds
    // keyframes exactly once (from data, or one default). Seeding here as
    // well would duplicate the frame-0 keyframe whenever a load follows,
    // wedging the keyframe binary search on later no-arg reads.
    if (layer.properties.add && typeof layer.properties.add === "function") {
      layer.properties.add(key, created);
    } else {
      layer.properties[key] = created;
    }
  } catch (_error) { /* tracking degrades without the property */ }
}

function initializeCreatedProperty(created) {
  // Seed default keyframes on a backfilled DYNAMIC property that has none
  // yet, so live reads (including the unguarded render-path reads)
  // terminate. Strictly seed-when-empty: seeding over existing keyframes
  // would duplicate the frame-0 keyframe and wedge the keyframe binary
  // search. Static properties are deliberately untouched (their get()
  // never throws and load(null) would null out the value). Never called
  // on the load path (the native load seeds exactly once); only on
  // update/render paths where no load follows.
  try {
    if (created && created.keyframes && created.keyframes.length === 0 &&
        typeof created.load === "function") {
      created.load(null);
    }
  } catch (_error) { /* best effort */ }
}

function installSequenceProperties(PZ) {
  if (!PZ.sequence || !PZ.sequence.propertyDefinitions) {
    return;
  }
  // Depth of field lives on camera objects only: the sequence carries no
  // DOF controls (no dof/dofAperture/dofFocusDistance/dofNear/dofFar here).
  // Only motion-blur controls are defined at sequence level.
  const D = PZ.sequence.propertyDefinitions;
  if (!D.motionBlurTrackFrame) {
    D.motionBlurTrackFrame = {
      dynamic: true,
      name: "Track Frame",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "auto;previous;next",
    };
  }
  if (!D.motionBlurSensitivity) {
    D.motionBlurSensitivity = {
      dynamic: true,
      name: "Motion Sensitivity",
      type: PZ.property.type.NUMBER,
      value: 100,
      min: 0,
      max: 200,
      step: 1,
      decimals: 0,
    };
  }
  if (!D.motionBlurVideoMode) {
    D.motionBlurVideoMode = {
      dynamic: true,
      name: "Video Blur Mode",
      type: PZ.property.type.OPTION,
      value: 0,
      items: "blend;warp",
    };
  }
}

function ensureSequenceProperties(sequence) {
  if (!sequence || !sequence.properties) return;
  try {
    const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const defs = PZNow && PZNow.sequence && PZNow.sequence.propertyDefinitions;
    if (!defs) return;
    for (const key of ["motionBlurTrackFrame", "motionBlurSensitivity", "motionBlurVideoMode"]) {
      try {
        if (!sequence.properties[key] && defs[key] && PZNow.property &&
            typeof PZNow.property.create === "function" &&
            typeof sequence.properties.add === "function") {
          // Shell only: a later native load seeds it exactly once.
          const created = PZNow.property.create(defs[key]);
          sequence.properties.add(key, created);
        }
        // Live seed when no load follows (render paths read these every
        // frame, some without guards) — seed-when-empty only.
        initializeCreatedProperty(sequence.properties[key]);
      } catch (_err) { /* best effort per key */ }
    }
  } catch (_err) { /* best effort */ }
}

function installFocusExpression(PZ) {
  if (!PZ.expression || !PZ.expression.methods) return;
  if (typeof PZ.expression.methods.focusDistanceTo === "function") return;
  PZ.expression.methods.focusDistanceTo = function (e, t) {
    if (!e || !e.parentProject || !e.threeObj) {
      return 0;
    }
    let r = null;
    try {
      r = e.parentProject.addressLookup(t);
    } catch (err) {
      return 0;
    }
    if (!(r instanceof PZ.object3d)) {
      r = r && r.object;
    }
    if (!r || !r.threeObj) {
      return 0;
    }
    r.threeObj.updateMatrixWorld(true);
    e.threeObj.updateMatrixWorld(true);
    const THREE = (typeof globalThis !== "undefined" ? globalThis.THREE : null);
    if (!THREE || typeof THREE.Vector3 !== "function") return 0;
    let i = new THREE.Vector3();
    let a = new THREE.Vector3();
    r.threeObj.getWorldPosition(i);
    e.threeObj.getWorldPosition(a);
    return i.distanceTo(a);
  };
}

function installRenderPassDof(PZ, THREE) {
  if (!THREE || !THREE.RenderPass || !THREE.RenderPass.prototype) {
    throw new Error("Camera+ needs THREE.RenderPass from the CM3 runtime.");
  }
  const proto = THREE.RenderPass.prototype;
  if (proto.render && proto.render.__cameraPlus) {
    proto.render.__cameraPlusAlive = true;
    return;
  }
  const original = proto.render;
  const patched = function (e, t, r, i) {
    if (patched.__cameraPlusAlive === false) {
      return original.call(this, e, t, r, i);
    }
    this.scene.overrideMaterial = this.overrideMaterial;
    this.envMap.render(e);
    this.motionBlur.render(e);
    if (this.dof && this.dof.enabled && !this.globalDof) {
      this.dof.render(e, t, this.scene, this.camera, t.viewport, i);
    } else {
      e.render(this.scene, this.camera, t, i);
    }
    this.scene.overrideMaterial = null;
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.render = patched;
  installedRenderPass = patched;
}

function installLayerCreate(PZ) {
  const layer = PZ.layer;
  if (!layer || typeof layer.create !== "function") {
    throw new Error("Camera+ needs PZ.layer.create from the CM3 runtime.");
  }
  if (layer.create.__cameraPlus) {
    layer.create.__cameraPlusAlive = true;
    installedLayerCreate = layer.create;
    return;
  }
  const original = layer.create;
  const patched = function (e) {
    if (patched.__cameraPlusAlive !== false && e === 9 && layer.camera) {
      const t = new layer.camera();
      t.type = e;
      return t;
    }
    return original.call(this, e);
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  layer.create = patched;
  installedLayerCreate = patched;
}

function installSequenceUpdate(PZ) {
  const proto = PZ.sequence && PZ.sequence.prototype;
  if (!proto || typeof proto.update !== "function") {
    throw new Error("Camera+ needs PZ.sequence.prototype.update from the CM3 runtime.");
  }
  if (proto.update.__cameraPlus) {
    proto.update.__cameraPlusAlive = true;
    return;
  }
  const original = proto.update;
  const patched = function (e) {
    const out = original.call(this, e);
    try {
      if (patched.__cameraPlusAlive !== false && typeof this.applySharedCamera === "function") {
        this.applySharedCamera(e);
      }
    } catch (_err) { /* never break sequence updates */ }
    return out;
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.update = patched;
}

// Shared-camera tracking follow, transcribed from the OpenZoid layer update.
// Runs after the native update (which positions the composite quad and
// updates effects); recomputes the same locals and overwrites placement
// when a shared camera leads this layer.
function NeverMatches() {}

function applyLayerTracking(layer, time) {
  const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null) || {};
  for (const key of ["depth", "motionBlurAmount", "rotationX", "rotationY"]) {
    ensureLayerProperty(layer, key);
  }
  // Live-seed shells that will never see a load (e.g. layers whose load
  // predates this pack): seed-when-empty only, so later data-less loads
  // cannot duplicate keyframes.
  try {
    for (const key of ["depth", "motionBlurAmount", "rotationX", "rotationY"]) {
      if (layer.properties) initializeCreatedProperty(layer.properties[key]);
    }
  } catch (_err) { /* reads fall back to defaults */ }
  let t = [0, 0];
  let r = 0;
  let i = [1, 1];
  let rx = 0;
  let ry = 0;
  let depth = 0;
  try {
    if (layer.properties.position) t = layer.properties.position.get(time);
    if (layer.properties.rotation) r = layer.properties.rotation.get(time);
    if (layer.properties.scale) i = layer.properties.scale.get(time);
  } catch (err) { /* keep defaults */ }
  try {
    if (layer.properties.rotationX) rx = layer.properties.rotationX.get(time);
    if (layer.properties.rotationY) ry = layer.properties.rotationY.get(time);
  } catch (err) { /* keep defaults */ }
  try {
    if (layer.properties.depth) depth = layer.properties.depth.get(time);
  } catch (err) { /* keep defaults */ }
  let cam = null;
  let track = null;
  let isMasterScene = false;
  const isScene = layer instanceof ((PZNow.layer && PZNow.layer.scene) || NeverMatches);
  const isCameraLayer = layer instanceof ((PZNow.layer && PZNow.layer.camera) || NeverMatches);
  const isPrecomp = layer instanceof ((PZNow.layer && PZNow.layer.composite) || NeverMatches);
  const isAdjustment = layer instanceof ((PZNow.layer && PZNow.layer.adjustment) || NeverMatches);
  try {
    let p = layer.parent;
    let guard = 0;
    while (p && guard++ < 24) {
      if (p instanceof ((PZNow.track && PZNow.track.video) || NeverMatches)) {
        track = p;
        break;
      }
      try {
        p = p.parent;
      } catch (err2) {
        break;
      }
    }
    let insideCard = false;
    try {
      let q = layer.parent;
      let g2 = 0;
      while (q && g2++ < 24) {
        if (q !== layer && q instanceof ((PZNow.layer && PZNow.layer.composite) || NeverMatches)) {
          try {
            const effs = q.effects;
            for (let k = 0; effs && k < effs.length; k++) {
              if (effs[k] && effs[k].type === "transform") {
                insideCard = true;
                break;
              }
            }
          } catch (e3) { /* ignore */ }
          if (insideCard) break;
        }
        try {
          q = q.parent;
        } catch (e3) {
          break;
        }
      }
    } catch (e3) { /* ignore */ }
    if (track && track.track3d && isScene && layer.pass && layer.pass.camera) {
      // Master check mirrors the open layer update: only the scene that owns
      // the shared camera counts as master.
      try {
        if (layer.parentProject && layer.parentProject.sequence &&
            layer.parentProject.sequence.getSharedCamera) {
          const sc = layer.parentProject.sequence.getSharedCamera();
          if (sc && sc.scene === layer) isMasterScene = true;
        }
      } catch (err2) { /* ignore */ }
    }
    if (track && track.track3d && !insideCard && !isMasterScene && !isScene && !isCameraLayer) {
      if (layer.parentProject && layer.parentProject.sequence && layer.parentProject.sequence.getSharedCamera) {
        cam = layer.parentProject.sequence.getSharedCamera();
      }
    }
  } catch (err) { /* no shared camera */ }
  layer.follow3dVideo = false;
  let followEff = null;
  if (cam && !isScene && !isCameraLayer && !isMasterScene) {
    try {
      for (let k = 0; k < layer.effects.length; k++) {
        const ef = layer.effects[k];
        if (ef && ef.type === "transform" && ef.pass && ef.pass.camera && ef.pass.quad) {
          followEff = ef;
          break;
        }
      }
    } catch (err) { /* ignore */ }
  }
  if (cam && followEff) {
    try {
      const res = layer.properties.resolution.get();
      const tmax = Math.max(res[0] || 1920, res[1] || 1080);
      const k = tmax / 80;
      const cp = cam.position || [0, 0, 80];
      const cr = cam.rotation || [0, 0, 0];
      const Pc = followEff.pass;
      Pc.camera.position.set((cp[0] || 0) * k, (cp[1] || 0) * k, ((cp[2] !== undefined ? cp[2] : 80) - 80) * k);
      Pc.camera.rotation.set(cr[0] || 0, cr[1] || 0, cr[2] || 0);
      try {
        if (cam.three && cam.three.isPerspectiveCamera && Pc.camera.isPerspectiveCamera && cam.three.fov) {
          Pc.camera.fov = cam.three.fov;
          Pc.camera.updateProjectionMatrix();
        }
      } catch (err2) { /* ignore */ }
      const off = typeof followEff.offsetZ === "number" ? followEff.offsetZ : -tmax;
      Pc.quad.position.set(t[0], t[1], depth * k + off);
      Pc.quad.rotation.set(rx, ry, r);
      Pc.quad.scale.set(i[0], i[1], 1);
      try {
        // Camera-tracked footage turned past 90 degrees must show
        // mirrored instead of backface-culled black (the modified
        // Transform carries DoubleSide; stock CM3 is FrontSide).
        const THREE = (typeof globalThis !== "undefined" ? globalThis.THREE : null);
        const qm = Pc.quad && Pc.quad.material;
        if (THREE && qm && qm.side !== THREE.DoubleSide) {
          qm.side = THREE.DoubleSide;
          qm.needsUpdate = true;
        }
      } catch (_sideErr) { /* cosmetic only */ }
    } catch (err) { /* ignore */ }
    try {
      layer.composite.group.position.set(0, 0, 0);
      layer.composite.group.rotation.set(0, 0, 0);
      layer.composite.group.scale.set(1, 1, 1);
    } catch (err) { /* ignore */ }
  } else if (cam && !isScene && !isCameraLayer && !isMasterScene && (layer.type === 0 || layer.type === 3) && cam.three && cam.three.isPerspectiveCamera && (layer.texture instanceof ((typeof globalThis !== "undefined" && globalThis.THREE && globalThis.THREE.Texture) || NeverMatches))) {
    try {
      let seqRes = [1920, 1080];
      try {
        seqRes = layer.parentProject.sequence.properties.resolution.get();
      } catch (err2) { /* ignore */ }
      const THREE = (typeof globalThis !== "undefined" ? globalThis.THREE : null);
      if (!layer.video3d && THREE) {
        const g = new THREE.PlaneGeometry(1, 1);
        const m = new THREE.MeshBasicMaterial({ color: 16777215, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(g, m);
        const sc = new THREE.Scene();
        sc.add(mesh);
        let fov0 = 60;
        try {
          if (cam.three.fov > 1 && cam.three.fov < 179) fov0 = cam.three.fov;
        } catch (err2) { /* ignore */ }
        layer.video3d = { scene: sc, mesh: mesh, mat: m, geo: g, cam: null, restFov: fov0, seqW: seqRes[0] || 1920, seqH: seqRes[1] || 1080 };
      }
      const v = layer.video3d;
      v.mat.map = layer.texture;
      v.cam = cam.three;
      const aspect = (v.seqW || 1920) / Math.max(v.seqH || 1080, 1);
      const S = ((2 * 80 * Math.tan(((v.restFov || 60) * Math.PI) / 360) * aspect) / Math.max(v.seqW || 1920, 1)) || 0.085;
      let lres = [v.seqW, v.seqH];
      try {
        lres = layer.properties.resolution.get();
      } catch (err2) { /* ignore */ }
      v.mesh.scale.set((lres[0] || v.seqW) * S * i[0], (lres[1] || v.seqH) * S * i[1], 1);
      v.mesh.position.set(t[0] * S, t[1] * S, depth * 0.1);
      v.mesh.rotation.set(rx, ry, r);
      layer.follow3dVideo = true;
    } catch (err) {
      layer.follow3dVideo = false;
    }
    try {
      if (layer.follow3dVideo) {
        layer.composite.group.position.set(0, 0, 0);
        layer.composite.group.rotation.set(0, 0, 0);
        layer.composite.group.scale.set(1, 1, 1);
      } else {
        layer.composite.group.position.set(t[0], t[1], 0);
        layer.composite.group.rotation.set(rx, ry, r);
        layer.composite.group.scale.set(i[0], i[1], 1);
      }
    } catch (err) { /* ignore */ }
  } else if (cam && cam.position && !isPrecomp && !isAdjustment) {
    const cx = cam.position[0] || 0;
    const cy = cam.position[1] || 0;
    const cz = cam.position[2] !== undefined ? cam.position[2] : 80;
    const crx = cam.rotation ? cam.rotation[0] || 0 : 0;
    const cry = cam.rotation ? cam.rotation[1] || 0 : 0;
    const crz = cam.rotation ? cam.rotation[2] || 0 : 0;
    const dist = Math.max(cz - depth, 1);
    const persp = 80 / dist;
    try {
      layer.composite.group.position.set((t[0] - cx) * persp, (t[1] - cy) * persp, 0);
      layer.composite.group.rotation.set(rx - crx, ry - cry, r - crz);
      layer.composite.group.scale.set(i[0] * persp, i[1] * persp, 1);
    } catch (err) { /* ignore */ }
  } else {
    try {
      layer.composite.group.position.set(t[0], t[1], 0);
      layer.composite.group.rotation.set(rx, ry, r);
      layer.composite.group.scale.set(i[0], i[1], 1);
    } catch (err) { /* ignore */ }
  }
  try {
    if (layer.composite.quad.material.uniforms.opacity) {
      layer.composite.quad.material.uniforms.opacity.value = layer.properties.opacity.get(time);
    }
  } catch (err) { /* ignore */ }
}

function installLayerLoad(PZ) {
  // Layers constructed before (or without) this pack miss the tracking
  // properties entirely: the vanilla constructor never creates them and
  // load() drops unknown data keys. Backfill BEFORE the native load so
  // saved values land on live controls instead of being dropped — and so
  // the native load performs the keyframe seeding exactly once (seeding
  // before a data-less load would duplicate the frame-0 keyframe and wedge
  // the keyframe search on later no-arg reads).
  const proto = PZ.layer && PZ.layer.prototype;
  if (!proto || typeof proto.load !== "function") {
    throw new Error("Camera+ needs PZ.layer.prototype.load from the CM3 runtime.");
  }
  if (proto.load.__cameraPlus) {
    proto.load.__cameraPlusAlive = true;
    installedLayerLoad = proto.load;
    return;
  }
  const original = proto.load;
  const patched = function () {
    try {
      if (patched.__cameraPlusAlive !== false) {
        for (const key of ["depth", "motionBlurAmount", "rotationX", "rotationY"]) {
          ensureLayerProperty(this, key);
        }
      }
    } catch (_err) { /* never break layer loading */ }
    return original.apply(this, arguments);
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.load = patched;
  installedLayerLoad = patched;
}

function installCameraLoad(PZ) {
  const proto = PZ.object3d && PZ.object3d.camera && PZ.object3d.camera.prototype;
  if (!proto || typeof proto.load !== "function") {
    throw new Error("Camera+ needs the camera object load from the CM3 runtime.");
  }
  if (proto.load.__cameraPlus) {
    proto.load.__cameraPlusAlive = true;
    return;
  }
  const original = proto.load;
  const patched = function () {
    try {
      if (patched.__cameraPlusAlive !== false) {
        for (const key of ["dof", "dofAperture", "dofFocusDistance", "dofFocusAreaWidth", "dofNearBlurLevel", "dofFarBlurLevel"]) {
          ensureCameraProperty(this, key);
        }
      }
    } catch (_err) { /* never break camera loading */ }
    return original.apply(this, arguments);
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.load = patched;
  installedCameraLoad = patched;
}

function hasSeededKeyframes(prop, depth) {
  // True when this property (or any nested child) already carries
  // keyframes. Used to keep data-less loads from seeding a second
  // default keyframe onto it.
  try {
    if (!prop || (depth || 0) > 4) return false;
    if (prop.keyframes && prop.keyframes.length) return true;
    const kids = prop.objects;
    if (kids && typeof kids.length === "number") {
      for (let i = 0; i < kids.length; i++) {
        if (hasSeededKeyframes(kids[i], (depth || 0) + 1)) return true;
      }
    }
  } catch (_err) { /* treat as unseeded */ }
  return false;
}

function installPropertyListLoad(PZ) {
  // The native propertyList.load() seeds a default keyframe for every
  // child when it gets no data — even for properties that already carry
  // keyframes (e.g. a tracking prop seeded before a data-less load). The
  // duplicate same-frame keyframe wedges the keyframe binary search on
  // later no-arg reads (compositeDepth reads depth with no time) and
  // freezes the page. Hide already-seeded children from data-less loads;
  // loads carrying real data behave exactly as before.
  const proto = PZ.propertyList && PZ.propertyList.prototype;
  if (!proto || typeof proto.load !== "function") {
    throw new Error("Camera+ needs PZ.propertyList.prototype.load from the CM3 runtime.");
  }
  if (proto.load.__cameraPlus) {
    proto.load.__cameraPlusAlive = true;
    installedPropertyListLoad = proto.load;
    return;
  }
  const original = proto.load;
  const patched = function (e) {
    if (patched.__cameraPlusAlive === false) return original.apply(this, arguments);
    try {
      if ((e === undefined || e === null) && this) {
        const stash = [];
        for (const k of Object.keys(this)) {
          let p = null;
          try { p = this[k]; } catch (_get) { p = null; }
          if (hasSeededKeyframes(p, 0)) stash.push(k);
        }
        if (stash.length) {
          const kept = {};
          for (const k of stash) { kept[k] = this[k]; delete this[k]; }
          try {
            return original.apply(this, arguments);
          } finally {
            for (const k of stash) { try { this[k] = kept[k]; } catch (_restore) {} }
          }
        }
      }
    } catch (_err) { /* fall through to the native load */ }
    return original.apply(this, arguments);
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.load = patched;
  installedPropertyListLoad = patched;
}

function installLayerUpdate(PZ) {
  const proto = PZ.layer && PZ.layer.prototype;
  if (!proto || typeof proto.update !== "function") {
    throw new Error("Camera+ needs PZ.layer.prototype.update from the CM3 runtime.");
  }
  if (proto.update.__cameraPlus) {
    proto.update.__cameraPlusAlive = true;
    return;
  }
  const original = proto.update;
  const patched = function (e) {
    const out = original.call(this, e);
    try {
      if (patched.__cameraPlusAlive !== false) applyLayerTracking(this, e);
    } catch (_err) { /* never break layer updates */ }
    return out;
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.update = patched;
}

function installLayerUnload(PZ) {
  const proto = PZ.layer && PZ.layer.prototype;
  if (!proto || typeof proto.unload !== "function") return;
  if (proto.unload.__cameraPlus) {
    proto.unload.__cameraPlusAlive = true;
    return;
  }
  const original = proto.unload;
  const patched = function () {
    const out = original.apply(this, arguments);
    try {
      if (patched.__cameraPlusAlive === false) return out;
      if (this.video3d) {
        try { this.video3d.scene.remove(this.video3d.mesh); } catch (_e) {}
        try { this.video3d.geo.dispose(); } catch (_e) {}
        try { this.video3d.mat.dispose(); } catch (_e) {}
        this.video3d = null;
      }
      if (this.motionBlurHistory) {
        try { this.motionBlurHistory.dispose(); } catch (_e) {}
        this.motionBlurHistory = null;
      }
      if (this._mbPool) {
        try { for (const entry of this._mbPool) entry.dispose(); } catch (_e) {}
        this._mbPool = null;
      }
    } catch (_err) { /* best effort */ }
    return out;
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.unload = patched;
}

function ensureCameraProperty(cameraObject, key) {
  try {
    if (!cameraObject || !cameraObject.properties || cameraObject.properties[key]) return;
    const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const def = PZNow && PZNow.object3d && PZNow.object3d.camera &&
      PZNow.object3d.camera.propertyDefinitions &&
      PZNow.object3d.camera.propertyDefinitions[key];
    if (!def || !PZNow.property || typeof PZNow.property.create !== "function") return;
    const created = PZNow.property.create(def);
    if (cameraObject.properties.add && typeof cameraObject.properties.add === "function") {
      cameraObject.properties.add(key, created);
    } else {
      cameraObject.properties[key] = created;
    }
  } catch (_error) { /* tracking degrades without the property */ }
}

// Per-object DOF sync, transcribed from the OpenZoid Scene update: the
// active camera object drives its scene pass DOF unit every frame.
function installSceneDof(PZ, THREE) {
  const proto = PZ.layer && PZ.layer.scene && PZ.layer.scene.prototype;
  if (!proto || typeof proto.update !== "function") {
    throw new Error("Camera+ needs the Scene layer update from the CM3 runtime.");
  }
  if (proto.update.__cameraPlusDof) {
    proto.update.__cameraPlusDofAlive = true;
    return;
  }
  const original = proto.update;
  const patched = function (e) {
    const out = original.call(this, e);
    try {
      if (patched.__cameraPlusDofAlive === false) return out;
      if (!this.pass) return out;
      if (!this.pass.dof && THREE && THREE.SceneDof) {
        this.pass.dof = new THREE.SceneDof();
      }
      const r = this.pass.dof;
      if (!r) return out;
      let cameraObject = null;
      try {
        for (const s of this.objects) {
          // Duck-typed: pre-enable cameras are vanilla-class instances.
          if ((s instanceof PZ.object3d.camera || (s && s.type === 6)) && s.threeObj === this.pass.camera) {
            cameraObject = s;
            break;
          }
        }
      } catch (_err) { /* ignore */ }
      if (cameraObject && cameraObject.threeObj) {
        // Cameras created before this pack enabled carry the vanilla
        // property set; backfill the DOF controls so the sync below holds.
        for (const key of ["dof", "dofAperture", "dofFocusDistance", "dofFocusAreaWidth", "dofNearBlurLevel", "dofFarBlurLevel"]) {
          ensureCameraProperty(cameraObject, key);
        }
        // Live-seed shells that will never see a load (seed-when-empty).
        try {
          for (const key of ["dof", "dofAperture", "dofFocusDistance", "dofFocusAreaWidth", "dofNearBlurLevel", "dofFarBlurLevel"]) {
            if (cameraObject.properties) initializeCreatedProperty(cameraObject.properties[key]);
          }
        } catch (_seedErr) { /* reads fall back to defaults */ }
        r.enabled = cameraObject.properties.dof.get(e) === 1;
        if (r.enabled) {
          r.aperture = cameraObject.properties.dofAperture.get(e);
          r.focusDistance = cameraObject.properties.dofFocusDistance.get(e);
          r.focusAreaWidth = cameraObject.properties.dofFocusAreaWidth.get(e);
          r.nearBlurLevel = cameraObject.properties.dofNearBlurLevel.get(e);
          r.farBlurLevel = cameraObject.properties.dofFarBlurLevel.get(e);
          r.near = cameraObject.threeObj.near;
          r.far = cameraObject.threeObj.far;
          r.orthographic = cameraObject.objectType === 2 ? 1 : 0;
        }
      } else {
        r.enabled = false;
      }
    } catch (_err) { /* never break scene rendering */ }
    return out;
  };
  patched.__cameraPlusDof = true;
  patched.__cameraPlusDofAlive = true;
  patched.__cameraPlusDofOriginal = original;
  proto.update = patched;
}

function installSceneUnload(PZ) {
  const proto = PZ.layer && PZ.layer.scene && PZ.layer.scene.prototype;
  if (!proto || typeof proto.unload !== "function") return;
  if (proto.unload.__cameraPlusDof) {
    proto.unload.__cameraPlusDofAlive = true;
    return;
  }
  const original = proto.unload;
  const patched = function () {
    try {
      if (patched.__cameraPlusDofAlive !== false && this.pass && this.pass.dof &&
          typeof this.pass.dof.unload === "function") {
        this.pass.dof.unload();
      }
    } catch (_err) { /* best effort */ }
    return original.apply(this, arguments);
  };
  patched.__cameraPlusDof = true;
  patched.__cameraPlusDofAlive = true;
  patched.__cameraPlusDofOriginal = original;
  proto.unload = patched;
}

function routeFocusAction(action, list, target) {
  const editor = (list && list.editor) || state.editor || globalThis.CM;
  if (!editor) return false;
  const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
  if (!PZNow || !PZNow.ui || !PZNow.ui.controls) return false;
  if (action === "focusDistanceLink") {
    if (typeof PZNow.ui.controls.showFocusTargetMenu === "function") {
      PZNow.ui.controls.showFocusTargetMenu(null, target, "link");
      return true;
    }
    return false;
  }
  if (action === "focusDistanceSet") {
    if (typeof PZNow.ui.controls.showFocusTargetMenu === "function") {
      PZNow.ui.controls.showFocusTargetMenu(null, target, "set");
      return true;
    }
    return false;
  }
  if (action === "focusDistanceUnlink") {
    try {
      editor.history.startOperation();
      editor.propertyOps.setExpression({ property: target.getAddress(), expression: null });
      editor.history.finishOperation();
    } catch (_err) { /* ignore */ }
    return true;
  }
  return false;
}

const state = {
  active: false,
  editor: null,
  installedDispatcher: null,
  saved: null,
  THREE: null,
};

function flagged(fn) {
  if (typeof fn !== "function") return null;
  if (fn.__cameraPlus === true || fn.__cameraPlusDof === true) return fn;
  return null;
}

function snapshotWrappers(PZ, THREE) {
  installedLayerCreate = (PZ.layer && flagged(PZ.layer.create)) || null;
  installedSequenceUpdate = (PZ.sequence && PZ.sequence.prototype && flagged(PZ.sequence.prototype.update)) || null;
  installedLayerUpdate = (PZ.layer && PZ.layer.prototype && flagged(PZ.layer.prototype.update)) || null;
  installedLayerUnload = (PZ.layer && PZ.layer.prototype && flagged(PZ.layer.prototype.unload)) || null;
  installedSceneUpdate = (PZ.layer && PZ.layer.scene && PZ.layer.scene.prototype && flagged(PZ.layer.scene.prototype.update)) || null;
  installedSceneUnload = (PZ.layer && PZ.layer.scene && PZ.layer.scene.prototype && flagged(PZ.layer.scene.prototype.unload)) || null;
  installedRenderPass = (THREE && THREE.RenderPass && THREE.RenderPass.prototype && flagged(THREE.RenderPass.prototype.render)) || null;
  installedCompositorReset = (PZ.compositor && PZ.compositor.prototype && flagged(PZ.compositor.prototype.reset)) || null;
}

function restoreIfTop(holder, key, ref) {
  try {
    if (ref && holder && holder[key] === ref && ref.__cameraPlusOriginal) {
      holder[key] = ref.__cameraPlusOriginal;
    }
  } catch (_error) { /* best effort */ }
}

function uninstallAll(PZ, THREE) {
  for (const ref of [installedLayerCreate, installedSequenceUpdate, installedLayerUpdate,
      installedLayerUnload, installedSceneUpdate, installedSceneUnload, installedRenderPass,
      installedTrackLabel, installedCompositorReset, installedRenderSequenceEnsure,
      installedLayerLoad, installedCameraLoad, installedPropertyListLoad]) {
    try {
      if (ref) {
        ref.__cameraPlusAlive = false;
        ref.__cameraPlusDofAlive = false;
      }
    } catch (_error) { /* best effort */ }
  }
  try {
    if (PZ && PZ.layer) {
      restoreIfTop(PZ.layer, "create", installedLayerCreate);
      if (PZ.layer.prototype) {
        restoreIfTop(PZ.layer.prototype, "update", installedLayerUpdate);
        restoreIfTop(PZ.layer.prototype, "unload", installedLayerUnload);
        restoreIfTop(PZ.layer.prototype, "load", installedLayerLoad);
      }
      if (PZ.propertyList && PZ.propertyList.prototype) {
        restoreIfTop(PZ.propertyList.prototype, "load", installedPropertyListLoad);
      }
      if (PZ.layer.scene && PZ.layer.scene.prototype) {
        // The scene update wrapper carries the dof flag family.
        const current = PZ.layer.scene.prototype.update;
        if (current && current.__cameraPlusDof && installedSceneUpdate === current &&
            current.__cameraPlusDofOriginal) {
          PZ.layer.scene.prototype.update = current.__cameraPlusDofOriginal;
        }
        restoreIfTop(PZ.layer.scene.prototype, "unload", installedSceneUnload);
      }
    }
    if (PZ && PZ.sequence && PZ.sequence.prototype) {
      restoreIfTop(PZ.sequence.prototype, "update", installedSequenceUpdate);
      // Method additions from this pack (absent upstream) are removed.
      for (const key of ["collectSceneEntries", "getSharedCamera", "applySharedCamera"]) {
        try { delete PZ.sequence.prototype[key]; } catch (_error) { /* best effort */ }
      }
    }
    if (THREE && THREE.RenderPass && THREE.RenderPass.prototype) {
      restoreIfTop(THREE.RenderPass.prototype, "render", installedRenderPass);
    }
    if (PZ && PZ.compositor && PZ.compositor.prototype) {
      restoreIfTop(PZ.compositor.prototype, "reset", installedCompositorReset);
      restoreIfTop(PZ.compositor.prototype, "renderSequence", installedRenderSequenceEnsure);
    }
    if (state.saved) {
      if (PZ && PZ.object3d && state.saved.cameraClass) {
        try {
          if (PZ.object3d.camera && PZ.object3d.camera.__cameraPlusReplaced) {
            PZ.object3d.camera = state.saved.cameraClass;
          }
        } catch (_error) { /* best effort */ }
      }
      if (PZ && PZ.compositor && PZ.compositor.prototype && state.saved.renderLayer) {
        try {
          if (PZ.compositor.prototype.renderLayer &&
              PZ.compositor.prototype.renderLayer.__cameraPlusReplaced) {
            PZ.compositor.prototype.renderLayer = state.saved.renderLayer;
          }
        } catch (_error) { /* best effort */ }
      }
      try { delete PZ.vibrate; } catch (_error) { /* best effort */ }
      try { delete THREE.SceneDof; delete THREE.SceneDofShader; } catch (_error) { /* best effort */ }
      if (PZ && PZ.expression && PZ.expression.methods) {
        try { delete PZ.expression.methods.focusDistanceTo; } catch (_error) { /* best effort */ }
      }
      if (PZ && PZ.layer && PZ.layer.propertyDefinitions) {
        for (const key of ["depth", "motionBlurAmount", "rotationX", "rotationY"]) {
          try { delete PZ.layer.propertyDefinitions[key]; } catch (_error) { /* best effort */ }
        }
      }
    }
  } catch (_error) { /* best effort */ }
  installedLayerCreate = installedSequenceUpdate = installedLayerUpdate = null;
  installedLayerUnload = installedSceneUpdate = installedSceneUnload = null;
  installedRenderPass = installedTrackLabel = installedCompositorReset = null;
  installedRenderSequenceEnsure = installedLayerLoad = installedCameraLoad = null;
  installedPropertyListLoad = null;
  state.saved = null;
}

let installedRenderSequenceEnsure = null;

function installRenderSequenceEnsure(PZ) {
  // The replaced renderSequence reads sequence properties that only exist
  // when this pack defined them. Sequences constructed before enablement
  // lack them, so ensure on every render (cheap guarded lookups).
  const proto = PZ.compositor && PZ.compositor.prototype;
  if (!proto || typeof proto.renderSequence !== "function") {
    throw new Error("Camera+ needs PZ.compositor.prototype.renderSequence from the CM3 runtime.");
  }
  if (proto.renderSequence.__cameraPlusEnsured) {
    proto.renderSequence.__cameraPlusEnsuredAlive = true;
    installedRenderSequenceEnsure = proto.renderSequence;
    return;
  }
  const original = proto.renderSequence;
  const patched = function (e) {
    try {
      if (patched.__cameraPlusEnsuredAlive !== false && this._sequence) {
        ensureSequenceProperties(this._sequence);
      }
    } catch (_err) { /* best effort */ }
    return original.call(this, e);
  };
  patched.__cameraPlusEnsured = true;
  patched.__cameraPlusEnsuredAlive = true;
  patched.__cameraPlusEnsuredOriginal = original;
  proto.renderSequence = patched;
  installedRenderSequenceEnsure = patched;
}

function installCompositorReset(PZ, THREE) {  const proto = PZ.compositor && PZ.compositor.prototype;
  if (!proto || typeof proto.reset !== "function") {
    throw new Error("Camera+ needs PZ.compositor.prototype.reset from the CM3 runtime.");
  }
  if (proto.reset.__cameraPlus) {
    proto.reset.__cameraPlusAlive = true;
    installedCompositorReset = proto.reset;
    return;
  }
  const original = proto.reset;
  const patched = function (e, t) {
    const out = original.call(this, e, t);
    try {
      if (patched.__cameraPlusAlive === false) return out;
      if (!THREE || typeof THREE.WebGLRenderTarget !== "function") return out;
      if (this.depthBuffer) {
        try { this.depthBuffer.dispose(); } catch (_x) { /* ignore */ }
      }
      this.depthBuffer = new THREE.WebGLRenderTarget(e, t, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        stencilBuffer: false,
      });
      if (this.sceneDepthBuffer) {
        try { this.sceneDepthBuffer.dispose(); } catch (_x) { /* ignore */ }
      }
      this.sceneDepthBuffer = new THREE.WebGLRenderTarget(e, t, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false,
      });
      if (!this.sceneDepthMaterial && THREE.MeshDepthMaterial) {
        this.sceneDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      }
      this.sceneDepthReady = false;
      try {
        if (!this.dofScene && THREE.Scene) {
          this.dofScene = new THREE.Scene();
        }
        if (!this.dofCamera && THREE.OrthographicCamera) {
          this.dofCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        }
        if (!this.dofQuad && THREE.Mesh && THREE.PlaneBufferGeometry && THREE.ShaderMaterial &&
            THREE.SceneDofShader) {
          this.dofQuad = new THREE.Mesh(
            new THREE.PlaneBufferGeometry(2, 2),
            new THREE.ShaderMaterial({
              uniforms: {
                tColor: { type: "t", value: null },
                tDepth: { type: "t", value: null },
                resolution: { type: "v2", value: new THREE.Vector2(1, 1) },
                uvScale: { type: "v2", value: new THREE.Vector2(1, 1) },
                near: { type: "f", value: 0 },
                far: { type: "f", value: 1000 },
                aperture: { type: "f", value: 0 },
                focusDistance: { type: "f", value: 0 },
                orthographic: { type: "f", value: 1 },
              },
              vertexShader: THREE.SceneDofShader.vertexShader,
              fragmentShader: [
                "uniform sampler2D tColor;",
                "uniform sampler2D tDepth;",
                "uniform vec2 resolution;",
                "uniform vec2 uvScale;",
                "uniform float near;",
                "uniform float far;",
                "uniform float aperture;",
                "uniform float focusDistance;",
                "uniform float orthographic;",
                "varying vec2 vUv;",
                "varying vec2 vUvScaled;",
                "const int MAX_SAMPLES = 24;",
                "void main() {",
                "    vec2 coord = vUvScaled;",
                "    float d = clamp( texture2D( tDepth, coord ).r, 0.0, 1.0 );",
                "    float linearDepth = mix( near, far, d );",
                "    float factor = abs( linearDepth - focusDistance ) / max( focusDistance, 1.0 ) / 4.0;",
                "    float maxRadiusPx = clamp( aperture * 0.02 * min( resolution.x, resolution.y ) * factor, 0.0, 28.0 );",
                "    vec4 color = texture2D( tColor, coord );",
                "    if ( maxRadiusPx < 0.25 ) { gl_FragColor = color; return; }",
                "    vec4 sum = color * color.a;",
                "    float total = color.a;",
                "    for ( int i = 1; i < MAX_SAMPLES; i++ ) {",
                "        float ang = 2.39996322972865332 * float( i );",
                "        float r = sqrt( float( i ) / float( MAX_SAMPLES - 1 ) ) * maxRadiusPx;",
                "        vec2 off = vec2( cos( ang ), sin( ang ) ) * r * vec2( 1.0 / resolution.x, 1.0 / resolution.y );",
                "        vec2 sp = clamp( coord + off, vec2( 0.0 ), vec2( 1.0 ) );",
                "        vec4 c = texture2D( tColor, sp );",
                "        float sd = clamp( texture2D( tDepth, sp ).r, 0.0, 1.0 );",
                "        float w = max( 0.0, 1.0 - abs( sd - d ) * 8.0 );",
                "        w *= w * c.a;",
                "        sum += c * w;",
                "        total += w;",
                "    }",
                "    gl_FragColor = vec4( ( sum / max( total, 0.0001 ) ).rgb, color.a );",
                "}",
              ].join("\n"),
              transparent: true,
            })
          );
          this.dofQuad.material.premultipliedAlpha = true;
          this.dofScene.add(this.dofQuad);
        }
      } catch (_dofErr) { /* best effort */ }
      try {
        if (this._sequence) ensureSequenceProperties(this._sequence);
      } catch (_err) { /* best effort */ }
    } catch (_err) { /* never break compositor resets */ }
    return out;
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.reset = patched;
  installedCompositorReset = patched;
}

function installDispatcher(PZ) {
  const controls = PZ && PZ.ui && PZ.ui.controls;
  if (!controls) return;
  // No dispatcher at all (vanilla upstream): install the minimal compat
  // router so focus actions work with Camera+ alone.
  if (typeof controls.runPropertyAction !== "function") {
    controls.runPropertyAction = function (list, target, action, el) {
      routeFocusAction(action, list, target);
    };
    controls.runPropertyAction.__cameraPlusCompat = true;
    state.installedCompatDispatcher = true;
    return;
  }
  // The Setup Legacy compat dispatcher (same flag family) only routes its
  // own two actions, so wrap it as well: focus actions route here first.
  if (state.installedDispatcher) return;
  const original = controls.runPropertyAction;
  const patched = function (list, target, action, el) {
    if (patched.__cameraPlusDead) {
      return original.call(this, list, target, action, el);
    }
    if (routeFocusAction(action, list, target)) return;
    return original.call(this, list, target, action, el);
  };
  patched.__cameraPlusOriginal = original;
  controls.runPropertyAction = patched;
  state.installedDispatcher = patched;
}

function uninstallDispatcher(PZ) {
  if (state.installedDispatcher) {
    state.installedDispatcher.__cameraPlusDead = true;
    const controls = PZ && PZ.ui && PZ.ui.controls;
    if (controls && controls.runPropertyAction === state.installedDispatcher) {
      controls.runPropertyAction = state.installedDispatcher.__cameraPlusOriginal || controls.runPropertyAction;
    }
    state.installedDispatcher = null;
  }
  if (state.installedCompatDispatcher) {
    try {
      const controls = PZ && PZ.ui && PZ.ui.controls;
      if (controls && controls.runPropertyAction &&
          controls.runPropertyAction.__cameraPlusCompat) {
        delete controls.runPropertyAction;
      }
    } catch (_error) { /* best effort */ }
    state.installedCompatDispatcher = false;
  }
}

function cameraPresetJson() {
  // Mirrors the OpenZoid Camera track template: a video track whose clip
  // holds a Camera layer with a default perspective camera object.
  return {
    properties: { name: "Camera", icon: "camera" },
    preset: true,
    assets: [],
    data: [{
      type: 0,
      clips: [{
        start: 0, length: 180, offset: 0, type: 0, link: null,
        properties: { name: "Camera" },
        object: { type: 9, effects: [], objects: [{ type: 6, objectType: 1 }] },
      }],
    }],
    baseType: "track",
  };
}

function mediaHasCameraPreset(media) {
  if (!media || !Array.isArray(media)) return false;
  return media.some((m) => {
    try {
      const clips = m && m.data && m.data[0] && m.data[0].clips;
      return !!(clips && clips[0] && clips[0].object && clips[0].object.type === 9);
    } catch (_error) {
      return false;
    }
  });
}

function installCameraPreset(CM) {
  try {
    if (CM.defaultProject && Array.isArray(CM.defaultProject.media) &&
        !mediaHasCameraPreset(CM.defaultProject.media)) {
      CM.defaultProject.media.push(cameraPresetJson());
    }
  } catch (_error) { /* best effort */ }
  // Live project media entries must be loaded instances (raw JSON breaks
  // project traversal), mirroring how newComp builds comp media.
  try {
    const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    if (CM.project && Array.isArray(CM.project.media) &&
        !mediaHasCameraPreset(CM.project.media) &&
        PZNow && typeof PZNow.media === "function") {
      const media = new PZNow.media();
      media.loading = media.load(cameraPresetJson());
      CM.project.media.push(media);
    }
  } catch (_error) { /* best effort */ }
}

function uninstallCameraPreset(CM) {
  const dropFrom = (list) => {
    if (!Array.isArray(list)) return;
    for (let i = list.length - 1; i >= 0; i--) {
      try {
        const m = list[i];
        const clips = m && m.data && m.data[0] && m.data[0].clips;
        if (m && m.preset === true && clips && clips[0] && clips[0].object &&
            clips[0].object.type === 9) {
          list.splice(i, 1);
        }
      } catch (_error) { /* best effort */ }
    }
  };
  try {
    if (CM.defaultProject) dropFrom(CM.defaultProject.media);
  } catch (_error) { /* best effort */ }
  try {
    if (CM.project) dropFrom(CM.project.media);
  } catch (_error) { /* best effort */ }
}

function installTrackToggle(PZ) {
  const proto = PZ.ui && PZ.ui.timeline && PZ.ui.timeline.tracks && PZ.ui.timeline.tracks.prototype;
  if (!proto || typeof proto.createTrackLabel !== "function") {
    throw new Error("Camera+ needs the timeline track labels from the CM3 runtime.");
  }
  if (proto.createTrackLabel.__cameraPlus) {
    proto.createTrackLabel.__cameraPlusAlive = true;
    installedTrackLabel = proto.createTrackLabel;
    return;
  }
  if (typeof proto.ensureVideo3DTransform !== "function") {
    proto.ensureVideo3DTransform = function (editor, track) {
      if (!editor || !track || !editor.playback || !editor.project) return;
      let frame = 0;
      try {
        frame = editor.playback.currentFrame;
      } catch (e) { /* ignore */ }
      let clip = null;
      try {
        clip = track.getCurrentClip(frame);
      } catch (e) { /* ignore */ }
      if (!clip || !clip.object) return;
      const layer = clip.object;
      if (layer.type !== 0 && layer.type !== 3 && layer.type !== 2) return;
      if (layer.type === 2) {
        try {
          if (!editor.project.sequence.getSharedCamera()) return;
        } catch (e) {
          return;
        }
      }
      try {
        for (const eff of layer.effects) {
          if (eff && eff.type === "transform") return;
        }
      } catch (e) { /* ignore */ }
  try {
    const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
        const eff = PZNow.effect.create("transform");
        editor.history.startOperation();
        layer.effects.push(eff);
        eff.loading = eff.load({ type: "transform" });
        editor.history.pushCommand(
          function (info) {
            try {
              const arr = info.list;
              const at = arr.indexOf(info.eff);
              if (at >= 0) {
                const gone = arr.splice(at, 1)[0];
                try { gone.unload(); } catch (e2) { /* ignore */ }
              }
            } catch (e2) { /* ignore */ }
            try {
              editor.history.pushCommand(
                function (info2) {
                  try {
                    info2.list.push(info2.eff);
                    info2.eff.loading = info2.eff.load({ type: "transform" });
                  } catch (e3) { /* ignore */ }
                },
                info
              );
            } catch (e2) { /* ignore */ }
          },
          { list: layer.effects, eff: eff }
        );
        editor.history.finishOperation();
      } catch (e) { /* ignore */ }
    };
  }
  const original = proto.createTrackLabel;
  const patched = function (e, t, i) {
    const s = original.call(this, e, t, i);
    try {
      if (patched.__cameraPlusAlive === false) return s;
      if (t !== 0) return s;
      const editor = this && this.timeline && this.timeline.editor;
      addToggleToLabel(s, e, editor);
    } catch (_err) { /* never break track labels */ }
    return s;
  };
  patched.__cameraPlus = true;
  patched.__cameraPlusAlive = true;
  patched.__cameraPlusOriginal = original;
  proto.createTrackLabel = patched;
  installedTrackLabel = patched;
  // Labels already on screen were built before this wrapper existed;
  // redraw timelines so the toggle appears without reopening the project.
  try {
    refreshTimelines();
  } catch (_error) { /* best effort */ }
}

function addToggleToLabel(label, track, editor) {
  // Shared by the createTrackLabel wrapper (future labels) and the post-pass
  // below (labels built before this pack enabled). Returns true when a
  // toggle was installed.
  try {
    if (!label || typeof label.insertBefore !== "function" || !label.children) return false;
    if (!track) return false;
    if (label.querySelector && label.querySelector("button[data-camera-track]")) return false;
    const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const btn3d = document.createElement("button");
    btn3d.title = track.track3d
      ? "3D tracking on: videos follow via 3D Transform"
      : "3D tracking off: enable to follow shared camera";
    btn3d.style = "min-width: 22px;height: 16px;vertical-align:inherit;font-size:10px;color:#ccc;background:transparent;border:1px solid #555;border-radius:3px;cursor:pointer;padding:0 2px;";
    btn3d.classList.add("actionbutton");
    if (btn3d.setAttribute) btn3d.setAttribute("data-camera-track", "1");
    const update3dBtn = () => {
      btn3d.innerText = "3D";
      btn3d.style.color = track.track3d ? "#fff" : "#888";
      btn3d.style.background = track.track3d ? "#8a2828" : "transparent";
      btn3d.style.borderColor = track.track3d ? "#8a2828" : "#555";
      btn3d.title = track.track3d
        ? "3D tracking on: videos follow via 3D Transform"
        : "3D tracking off: enable to follow shared camera";
    };
    update3dBtn();
    btn3d.onclick = () => {
      track.track3d = !track.track3d;
      update3dBtn();
      try {
        if (editor.project) editor.project.ui.dirty = true;
      } catch (err) { /* ignore */ }
      if (track.track3d) {
        try {
          const proto = PZNow && PZNow.ui && PZNow.ui.timeline && PZNow.ui.timeline.tracks &&
            PZNow.ui.timeline.tracks.prototype;
          if (proto && typeof proto.ensureVideo3DTransform === "function") {
            proto.ensureVideo3DTransform(editor, track);
          }
        } catch (err) { /* ignore */ }
      }
    };
    label.insertBefore(btn3d, label.children[1] || null);
    // The upstream label grid fits exactly three columns (name, eye,
    // delete); the extra toggle needs the four-column grid the OpenZoid
    // label uses, or the delete cross wraps onto its own row.
    try {
      label.style.gridTemplateColumns = "1fr auto auto auto";
    } catch (_gridErr) { /* cosmetic only */ }
    return true;
  } catch (_err) {
    return false;
  }
}

function enhanceExistingLabels() {
  // Labels already on screen were built before this pack enabled and never
  // passed through the wrapper. Match them to tracks in document order
  // (video labels precede audio labels, mirroring redraw) and install the
  // toggle like the wrapper does.
  try {
    const editors = [];
    try {
      if (typeof globalThis !== "undefined") {
        if (globalThis.CM) editors.push(globalThis.CM);
        if (globalThis.ZOIDIUM_EDITOR && globalThis.ZOIDIUM_EDITOR !== globalThis.CM) {
          editors.push(globalThis.ZOIDIUM_EDITOR);
        }
        if (globalThis.VE) editors.push(globalThis.VE);
      }
    } catch (_error) { /* ignore */ }
    for (const editor of editors) {
      const seq = editor && editor.project && editor.project.sequence;
      if (!seq) continue;
      const eyes = Array.from(
        document.querySelectorAll('button[title="disable track"], button[title="enable track"]')
      );
      const videoCount = Array.isArray(seq.videoTracks) ? seq.videoTracks.length : 0;
      eyes.forEach((eye, idx) => {
        const label = eye.parentElement;
        const isVideo = idx < videoCount;
        const track = isVideo
          ? seq.videoTracks[idx]
          : (seq.audioTracks || [])[idx - videoCount];
        if (!isVideo || !track) return;
        addToggleToLabel(label, track, editor);
      });
    }
  } catch (_error) { /* best effort */ }
}

function removeToggleButtons() {
  try {
    const buttons = document.querySelectorAll("button[data-camera-track]");
    buttons.forEach((btn) => {
      try {
        if (btn.parentElement) {
          btn.remove();
          // Restore the three-column grid when no toggle remains.
          const leftovers = btn.parentElement.querySelector("button[data-camera-track]");
          if (!leftovers) {
            try {
              btn.parentElement.style.gridTemplateColumns = "1fr auto auto";
            } catch (_gridErr) { /* cosmetic only */ }
          }
        }
      } catch (_error) { /* best effort */ }
    });
  } catch (_error) { /* best effort */ }
}

function refreshTimelines() {
  enhanceExistingLabels();
}

module.exports = {
  activate(context) {
    const PZ = (context && context.PZ) ||
      (typeof globalThis !== "undefined" ? globalThis.PZ : null);
    const THREE = (context && context.window && context.window.THREE) ||
      (typeof globalThis !== "undefined" ? globalThis.THREE : null);
    if (!PZ) {
      throw new Error("Camera+ needs the CM3 runtime.");
    }
    if (!THREE) {
      throw new Error("Camera+ needs the THREE global from the CM3 runtime.");
    }
    if (state.active) return;
    // Snapshot replace targets before the sources overwrite them.
    state.saved = {
      cameraClass: PZ.object3d && PZ.object3d.camera,
      renderLayer: PZ.compositor && PZ.compositor.prototype && PZ.compositor.prototype.renderLayer,
    };
    state.THREE = THREE;
    installSources(context, PZ, THREE);
    if (!PZ.layer.camera || !PZ.object3d.camera || !PZ.vibrate) {
      throw new Error("Camera+ could not define its camera classes.");
    }
    try { PZ.object3d.camera.__cameraPlusReplaced = true; } catch (_error) { /* best effort */ }
    try {
      if (PZ.compositor && PZ.compositor.prototype && PZ.compositor.prototype.renderLayer) {
        PZ.compositor.prototype.renderLayer.__cameraPlusReplaced = true;
      }
    } catch (_error) { /* best effort */ }
    installLayerProperties(PZ);
    installSequenceProperties(PZ);
    installFocusExpression(PZ);
    installRenderPassDof(PZ, THREE);
    installLayerLoad(PZ);
    installCameraLoad(PZ);
    installPropertyListLoad(PZ);
    installRenderSequenceEnsure(PZ);
    installCompositorReset(PZ, THREE);
    installLayerCreate(PZ);
    installSequenceUpdate(PZ);
    installLayerUpdate(PZ);
    installLayerUnload(PZ);
    installSceneDof(PZ, THREE);
    installSceneUnload(PZ);
    installDispatcher(PZ);
    installTrackToggle(PZ);
    state.editor = (context && context.editor) ||
      (typeof globalThis !== "undefined" ? globalThis.CM : null);
    installCameraPreset(state.editor);
    snapshotWrappers(PZ, THREE);
    installedPZ = PZ;
    state.active = true;
  },
  deactivate() {
    try {
      const THREE = state.THREE ||
        (typeof globalThis !== "undefined" ? globalThis.THREE : null);
      uninstallDispatcher(installedPZ);
      if (installedTrackLabel) {
        installedTrackLabel.__cameraPlusAlive = false;
        try {
          const PZNow = (typeof globalThis !== "undefined" ? globalThis.PZ : null);
          const proto = PZNow && PZNow.ui && PZNow.ui.timeline && PZNow.ui.timeline.tracks &&
            PZNow.ui.timeline.tracks.prototype;
          if (proto && proto.createTrackLabel === installedTrackLabel &&
              installedTrackLabel.__cameraPlusOriginal) {
            proto.createTrackLabel = installedTrackLabel.__cameraPlusOriginal;
          }
        } catch (_error) { /* best effort */ }
        installedTrackLabel = null;
      }
      uninstallAll(installedPZ, THREE);
      try {
        removeToggleButtons();
      } catch (_error) { /* best effort */ }
      try {
        uninstallCameraPreset(state.editor);
      } catch (_error) { /* best effort */ }
    } finally {
      installedPZ = null;
      state.editor = null;
      state.active = false;
    }
  },
};
