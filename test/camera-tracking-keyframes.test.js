"use strict";

// Regression coverage for the Camera+ keyframe-duplication freeze:
// backfilled tracking properties (depth/rotationX/...) must never carry
// two same-frame keyframes, because a second same-frame keyframe wedges the
// keyframe binary search on later no-arg reads (compositeDepth) and freezes
// the page. Fakes below mirror the stock core contracts faithfully,
// including the data-less load() re-seed and the search itself.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(projectRoot, "plugins/camera-plus");

function closestIndex(keyframes, e) {
  let t = e | 0;
  let r = keyframes.length - 1;
  for (;;) {
    if (r <= t) return r;
    const i = t + ((r - t) >> 1);
    const a = keyframes[i].frame;
    if (a === e) return i;
    if (a > e) r = i;
    else if (a < e) t = i + 1;
    else throw new Error("unorderable keyframe search");
  }
}

function fakeProp(def) {
  return {
    def,
    keyframes: [],
    load(e) {
      if (e && e.keyframes) {
        for (const k of e.keyframes) this.keyframes.push({ frame: k.frame, value: k.value });
      } else if (e === undefined || e === null) {
        // Stock core: a data-less load seeds a default keyframe.
        this.keyframes.push({ frame: 0, value: this.def.value });
      }
    },
    get(e) {
      const r = closestIndex(this.keyframes, e);
      const i = this.keyframes[r];
      if (i.frame > e && r > 0) return this.keyframes[r - 1].value;
      if (!(i.frame < e)) return i.value;
      const next = this.keyframes[r + 1];
      if (!next) return i.value;
      return i.value;
    },
    set(value, frame) {
      const r = closestIndex(this.keyframes, frame);
      this.keyframes[r].value = value;
    },
  };
}

function FakePropertyList() {}
FakePropertyList.prototype.add = function (k, v) { this[k] = v; };
FakePropertyList.prototype.addAll = function (defs) {
  if (!defs) return;
  for (const k of Object.keys(defs)) this.add(k, fakeProp(defs[k]));
};
FakePropertyList.prototype.load = function (e) {
  const data = e || {};
  for (const k of Object.keys(this)) {
    if (this[k] && typeof this[k].load === "function") this[k].load(data[k]);
  }
};

class StubObject {}
class StubObjectList extends Array {}
class StubObject3D extends StubObject {
  static create(type) {
    const t = new StubObject3D();
    t.type = type;
    return t;
  }
}
StubObject3D.propertyDefinitions = {};
class StubLayer {
  constructor() {
    this.properties = new FakePropertyList();
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
StubLayer.prototype.load = function (d) {
  if (this.properties && typeof this.properties.load === "function") {
    this.properties.load(d && d.properties);
  }
  return "layer-load";
};
class StubSceneLayer extends StubLayer {}

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
    remove() {},
    setAttribute(k, v) { el[k] = v; },
    querySelector: () => null,
  };
  Object.defineProperty(el, "style", { get: () => styleObj, set: () => {}, configurable: true });
  return el;
}

function createPZ() {
  const PZ = {
    object: StubObject,
    objectList: StubObjectList,
    object3d: StubObject3D,
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR2: 4, VECTOR3: 5, LIST: 6, COLOR: 7 },
      create: (def) => fakeProp(def),
    },
    propertyList: FakePropertyList,
    layer: Object.assign(StubLayer, { propertyDefinitions: {}, scene: StubSceneLayer }),
    sequence: { prototype: { update: function () { return "seq-update"; } }, propertyDefinitions: {} },
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
  PZ.object3d.camera = { propertyDefinitions: {} };
  PZ.object3d.light = function () {};
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
    Vector3: function () { this.set = () => {}; this.distanceTo = () => 5; },
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

test("tracking props never duplicate keyframes across loads", { timeout: 10000 }, () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  const g = globalThis;
  const keep = { PZ: g.PZ, THREE: g.THREE, document: g.document };
  g.PZ = PZ;
  g.THREE = THREE;
  g.document = { createElement: () => fakeElement(), head: { appendChild() {} } };
  try {
    const runtime = loadRuntime();
    const CM = {
      playback: { currentFrame: 0 },
      project: { sequence: { properties: {} }, media: [] },
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
    assert.ok(PZ.layer.prototype.load.__cameraPlus, "layer load wrapped");
    assert.ok(PZ.propertyList.prototype.load.__cameraPlus, "propertyList load guarded");

    const layer = new PZ.layer();
    layer.load();
    for (const key of ["depth", "motionBlurAmount", "rotationX", "rotationY"]) {
      assert.ok(layer.properties[key], key + " backfilled");
      assert.equal(layer.properties[key].keyframes.length, 1, key + " seeded once");
    }
    // Data-less reloads must not seed again (this duplicated frame-0
    // keyframes before the guard and froze the render loop).
    layer.load();
    layer.load({});
    for (const key of ["depth", "motionBlurAmount", "rotationX", "rotationY"]) {
      assert.equal(layer.properties[key].keyframes.length, 1, key + " still single");
    }
    // No-arg reads terminate on the single keyframe.
    assert.equal(layer.properties.depth.get(), 0);
    layer.properties.depth.set(5, 0);
    assert.equal(layer.properties.depth.get(), 5);
    assert.equal(layer.properties.depth.get(0), 5);

    // Saved values adopt onto the backfilled controls (backfill runs
    // before the native load instead of dropping unknown data keys).
    const loaded = new PZ.layer();
    loaded.load({ properties: { depth: { keyframes: [{ frame: 0, value: 4 }] } } });
    assert.equal(loaded.properties.depth.get(0), 4);

    runtime.deactivate();
    assert.equal(PZ.propertyList.prototype.load.__cameraPlus, undefined, "guard restored");
  } finally {
    for (const k of ["PZ", "THREE", "document"]) {
      if (keep[k] === undefined) delete g[k];
      else g[k] = keep[k];
    }
  }
});
