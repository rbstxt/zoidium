"use strict";

// Coverage for the Camera+ runtime: sources evaluate, classes/methods land,
// wrappers chain with restore, focus actions route, and the 3D track toggle
// renders.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(projectRoot, "plugins/camera-plus");

class StubObject {}
class StubObjectList extends Array {}
class StubLayer extends StubObject {
  constructor() {
    super();
    this.properties = {};
    this.children = [];
    this.effects = [];
  }
  static create(type) {
    const t = new StubLayer();
    t.type = type;
    return t;
  }
}
StubLayer.prototype.update = function () { return "layer-update"; };
StubLayer.prototype.unload = function () { return "layer-unload"; };
StubLayer.prototype.load = function () { return "layer-load"; };
class StubSceneLayer extends StubLayer {}
StubSceneLayer.prototype.update = function () { return "scene-update"; };
StubSceneLayer.prototype.unload = function () { return "scene-unload"; };

function fakeElement() {
  const styleObj = {};
  const el = {
    children: [],
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    appendChild(c) { el.children.push(c); try { c.parentElement = el; } catch (_e) {} return c; },
    insertBefore(c, ref) {
      const at = el.children.indexOf(ref);
      if (at < 0) el.children.push(c);
      else el.children.splice(at, 0, c);
      try { c.parentElement = el; } catch (_e) {}
      return c;
    },
    remove() {
      try {
        if (el.parentElement && Array.isArray(el.parentElement.children)) {
          const at = el.parentElement.children.indexOf(el);
          if (at >= 0) el.parentElement.children.splice(at, 1);
        }
      } catch (_e) { /* ignore */ }
    },
    setAttribute(k, v) { el[k] = v; },
    querySelector: () => null,
  };
  // Like DOM CSSStyleDeclaration: assigning css text never replaces the object.
  Object.defineProperty(el, "style", {
    get: () => styleObj,
    set: () => {},
    configurable: true,
  });
  Object.defineProperty(el, "firstElementChild", { get: () => el.children[0] || null });
  return el;
}

class StubObject3D extends StubObject {
  static create(type) {
    const t = new StubObject3D();
    t.type = type;
    return t;
  }
}
StubObject3D.propertyDefinitions = {};
class StubCamera extends StubObject3D {}
StubCamera.propertyDefinitions = {};
StubCamera.prototype.load = function () { return "camera-load"; };

function createPZ() {
  const PZ = {
    object: StubObject,
    objectList: StubObjectList,
    object3d: StubObject3D,
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR2: 4, VECTOR3: 5, LIST: 6, COLOR: 7 },
      create: (def) => ({ def }),
    },
    propertyList: function () { return {}; },
    layer: Object.assign(StubLayer, {
      propertyDefinitions: {},
      scene: StubSceneLayer,
    }),
    sequence: {
      prototype: { update: function () { return "seq-update"; } },
      propertyDefinitions: {},
    },
    compositor: { prototype: { renderLayer: function () { return "rl"; }, reset: function () { return "reset"; } } },
    expression: { methods: {} },
    ui: {
      controls: {},
      timeline: { tracks: { prototype: { createTrackLabel: function () { return fakeElement(); } } } },
    },
    track: { video: function () {} },
    media: function () {},
  };
  PZ.media.prototype.load = function (payload) {
    this.data = payload && payload.data;
    this.preset = payload && payload.preset;
  };
  PZ.object3d.eulerOrders = [];
  PZ.object3d.camera = StubCamera;
  PZ.object3d.light = function () {};
  PZ.propertyList.prototype.load = function () { return "plist-load"; };
  return PZ;
}

function createTHREE() {
  return {
    RenderPass: { prototype: { render: function () { return "render"; } } },
    WebGLRenderTarget: function () { this.dispose = () => {}; },
    MeshDepthMaterial: function () {},
    LinearFilter: 1,
    NearestFilter: 2,
    RGBAFormat: 3,
    RGBADepthPacking: 4,
    Vector2: function () { this.set = () => {}; },
    Vector3: function () {
      this.set = () => {};
      this.distanceTo = () => 5;
    },
    Scene: function () { this.add = () => {}; },
    OrthographicCamera: function () {},
    PerspectiveCamera: function () {},
    Mesh: function () {},
    PlaneBufferGeometry: function () {},
    PlaneGeometry: function () {},
    Group: function () {},
    ShaderMaterial: function () {},
    MeshBasicMaterial: function () {},
    DoubleSide: 2,
    Texture: function () {},
  };
}

function loadRuntime() {
  const full = path.join(pluginDir, "camera-runtime.js");
  delete require.cache[require.resolve(full)];
  return require(full);
}

function activate(PZ, THREE, extra = {}) {
  const runtime = loadRuntime();
  const CM = {
    playback: { currentFrame: 0 },
    project: { sequence: { properties: {} }, media: [] },
    history: { startOperation() {}, finishOperation() {}, pushCommand() {} },
    propertyOps: { setExpression: (op) => { CM.lastExpression = op; } },
    timelineSelection: [],
    onProjectChanged: { watch() {} },
  };
  const context = {
    PZ,
    editor: CM,
    window: { THREE },
    getAsset: (kind, url) => {
      const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
      return fs.readFileSync(path.join(projectRoot, key), "utf8");
    },
    ...extra,
  };
  runtime.activate(context);
  return { runtime, CM };
}

test("camera sources define classes, methods, and focus UI", () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  const g = globalThis;
  const keep = { PZ: g.PZ, THREE: g.THREE, document: g.document };
  g.document = { createElement: () => fakeElement(), head: { appendChild() {} } };
  try {
    const { runtime, CM } = activate(PZ, THREE);
    assert.ok(PZ.layer.camera, "camera layer class");
    assert.notEqual(PZ.object3d.camera.propertyDefinitions.dof, undefined, "dof props");
    assert.ok(PZ.object3d.camera.propertyDefinitions.dofFocusDistance);
    // Depth of field lives on camera objects only: the sequence carries
    // no DOF controls (motion-blur controls stay).
    assert.equal(PZ.sequence.propertyDefinitions.dof, undefined, "no sequence dof");
    assert.equal(PZ.sequence.propertyDefinitions.dofAperture, undefined, "no sequence aperture");
    assert.equal(PZ.sequence.propertyDefinitions.dofFocusDistance, undefined);
    assert.equal(PZ.sequence.propertyDefinitions.dofNear, undefined);
    assert.equal(PZ.sequence.propertyDefinitions.dofFar, undefined);
    assert.ok(PZ.sequence.propertyDefinitions.motionBlurTrackFrame, "motion blur stays");
    assert.ok(PZ.vibrate, "vibrate class");
    assert.ok(THREE.SceneDof, "SceneDof pass");
    assert.equal(typeof PZ.sequence.prototype.getSharedCamera, "function");
    assert.equal(typeof PZ.sequence.prototype.applySharedCamera, "function");
    assert.equal(typeof PZ.ui.controls.showFocusTargetMenu, "function");
    assert.equal(typeof PZ.expression.methods.focusDistanceTo, "function");
    assert.equal(PZ.expression.methods.focusDistanceTo(null, null), 0);
    // Camera layer dispatches through the wrapped factory.
    const layer = PZ.layer.create(9);
    assert.equal(layer.type, 9);
    assert.ok(layer instanceof PZ.layer.camera);
    // Render pass + updates are wrapped.
    assert.ok(THREE.RenderPass.prototype.render.__cameraPlus);
    assert.ok(PZ.layer.prototype.update.__cameraPlus);
    assert.ok(PZ.layer.scene.prototype.update.__cameraPlusDof);
    runtime.deactivate();
    assert.equal(PZ.layer.create.__cameraPlus, undefined);
  } finally {
    for (const k of ["PZ", "THREE", "document"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});

test("focus actions route through the dispatcher", () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  const g = globalThis;
  const keep = { PZ: g.PZ, THREE: g.THREE, document: g.document, CM: g.CM };
  g.document = { createElement: () => fakeElement(), head: { appendChild() {} } };
  try {
    const { runtime, CM } = activate(PZ, THREE);
    g.PZ = PZ;
    g.CM = CM;
    const target = { getAddress: () => ["props", "dofFocusDistance"] };
    PZ.ui.controls.runPropertyAction({ editor: CM }, target, "focusDistanceUnlink", null);
    assert.deepEqual(CM.lastExpression, { property: ["props", "dofFocusDistance"], expression: null });
    runtime.deactivate();
  } finally {
    for (const k of ["PZ", "THREE", "document", "CM"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});

test("camera track preset lands in default and live project media", () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  const g = globalThis;
  const keep = { PZ: g.PZ, THREE: g.THREE, document: g.document };
  g.PZ = PZ;
  g.THREE = THREE;
  g.document = { createElement: (tag) => fakeElement(tag), head: { appendChild() {} } };
  try {
    const runtime = loadRuntime();
    const CM = {
      playback: { currentFrame: 0 },
      project: { sequence: { properties: {} }, media: [] },
      defaultProject: { media: [] },
      history: { startOperation() {}, finishOperation() {}, pushCommand() {} },
      timelineSelection: [],
      onProjectChanged: { watch() {} },
    };
    runtime.activate({
      PZ, editor: CM, window: { THREE },
      getAsset: (kind, url) => {
        const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
        return fs.readFileSync(path.join(projectRoot, key), "utf8");
      },
    });
    const hasPreset = (list) => list.some((m) => {
      try {
        return m.data[0].clips[0].object.type === 9;
      } catch (_e) {
        return false;
      }
    });
    assert.ok(hasPreset(CM.defaultProject.media), "default project gains Camera preset");
    assert.ok(hasPreset(CM.project.media), "live project gains Camera preset");
    assert.equal(
      CM.defaultProject.media.filter((m) => { try { return m.data[0].clips[0].object.type === 9; } catch (_e) { return false; } }).length,
      1,
      "no duplicates"
    );
    runtime.deactivate();
    assert.ok(!hasPreset(CM.defaultProject.media), "default preset removed");
    assert.ok(!hasPreset(CM.project.media), "live preset removed");
  } finally {
    for (const k of ["PZ", "THREE", "document"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});
test("existing labels gain the toggle without a redraw", () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  const g = globalThis;
  const keep = { PZ: g.PZ, THREE: g.THREE, document: g.document, CM: g.CM };
  const eyeButtons = [];
  const videoTracks = [{ track3d: false, clips: [] }];
  const CM = {
    playback: { currentFrame: 0 },
    project: { sequence: { properties: {}, videoTracks, audioTracks: [] }, media: [] },
    history: { startOperation() {}, finishOperation() {}, pushCommand() {} },
    timelineSelection: [],
    onProjectChanged: { watch() {} },
  };
  g.PZ = PZ;
  g.THREE = THREE;
  g.CM = CM;
  g.document = {
    createElement: (tag) => fakeElement(tag),
    head: { appendChild() {} },
    querySelectorAll: (sel) => {
      if (String(sel).includes("disable track")) return eyeButtons.slice();
      if (String(sel).includes("data-camera-track")) {
        const found = [];
        const walk = (el) => {
          for (const c of el.children || []) {
            if (c["data-camera-track"]) found.push(c);
            walk(c);
          }
        };
        for (const root of labelRoots) walk(root);
        return found;
      }
      return [];
    },
  };
  const labelRoots = [];
  try {
    const runtime = loadRuntime();
    runtime.activate({
      PZ, editor: CM, window: { THREE },
      getAsset: (kind, url) => {
        const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
        return fs.readFileSync(path.join(projectRoot, key), "utf8");
      },
    });
    // A pre-existing video label row: name span + eye button.
    const label = fakeElement();
    label.appendChild(fakeElement());
    const eye = fakeElement();
    eye.title = "disable track";
    label.appendChild(eye);
    eye.parentElement = label;
    label.appendChild(fakeElement());
    labelRoots.push(label);
    eyeButtons.push(eye);
    // Re-run the post-pass the module ran at enable (labels predate it).
    const before = label.children.length;
    runtime.deactivate();
    runtime.activate({
      PZ, editor: CM, window: { THREE },
      getAsset: (kind, url) => {
        const key = String(url).split(/[?#]/, 1)[0].replace(/^\.\//, "");
        return fs.readFileSync(path.join(projectRoot, key), "utf8");
      },
    });
    assert.ok(label.children.some((c) => c["data-camera-track"]), "toggle installed on stale label");
    assert.equal(label.children.length, before + 1);
    assert.equal(label.style.gridTemplateColumns, "1fr auto auto auto");
    assert.equal(label.children.length, before + 1);
    runtime.deactivate();
    assert.ok(!label.children.some((c) => c["data-camera-track"]), "toggle removed on disable");
  } finally {
    for (const k of ["PZ", "THREE", "document", "CM"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});
test("3D track toggle renders and bootstraps the follow", () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  const g = globalThis;
  const keep = { PZ: g.PZ, THREE: g.THREE, document: g.document };
  g.document = { createElement: (tag) => fakeElement(tag), head: { appendChild() {} } };
  try {
    const { runtime, CM } = activate(PZ, THREE);
    const track = { track3d: false };
    const panel = { timeline: { editor: CM } };
    const out = PZ.ui.timeline.tracks.prototype.createTrackLabel.call(panel, track, 0, 0);
    const btn = out.children.find((c) => c["data-camera-track"]);
    assert.ok(btn, "3D toggle appended");
    assert.equal(out.style.gridTemplateColumns, "1fr auto auto auto");
    btn.onclick();
    assert.equal(track.track3d, true);
    runtime.deactivate();
  } finally {
    for (const k of ["PZ", "THREE", "document"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});
