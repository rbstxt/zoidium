"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const packDir = path.resolve(__dirname, "../plugins/magic-looks");
function readPack(file) { return fs.readFileSync(path.join(packDir, file), "utf8"); }

function makeTexture(counter) {
  return function DataTexture(data, w, h) {
    this.data = data;
    this.width = w;
    this.height = h;
    let flag = false;
    Object.defineProperty(this, "needsUpdate", {
      get() { return flag; },
      set(v) { flag = v; if (v) counter.uploads++; },
    });
  };
}

function loadEffect() {
  const source = readPack("looks-fx.js");
  const PZ = { property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7 } } };
  const counter = { uploads: 0 };
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = (a, b) => { this.x = a; this.y = b; }; },
    Vector3: function (x, y, z) {
      this.x = x; this.y = y; this.z = z;
      this.set = (a, b, c) => { this.x = a; this.y = b; this.z = c; };
    },
    ShaderMaterial: function (opts) { this.uniforms = opts.uniforms; this.dispose = () => {}; },
    ShaderPass: function (mat) { this.uniforms = mat.uniforms; this.enabled = true; this.material = mat; },
    DataTexture: makeTexture(counter),
    RGBFormat: 1,
    LinearFilter: 1,
    ClampToEdgeWrapping: 1,
  };
  const store = {};
  function FakeProp(def) {
    this.def = def;
    this.v = def.value;
  }
  FakeProp.prototype.get = function () { return this.v; };
  FakeProp.prototype.set = function (v) { this.v = v; };
  const fakeThis = {
    _zoidiumGetAsset: (kind, url) => readPack(String(url).split("/").pop().split("?")[0]),
    properties: {
      addAll(defs) {
        for (const k of Object.keys(defs)) {
          if (!(k in store)) {
            store[k] = new FakeProp(defs[k]);
            this[k] = store[k];
          }
        }
      },
      load() {},
      store,
    },
  };
  new Function("PZ", "THREE", source).call(fakeThis, PZ, THREE);
  return { fakeThis, PZ, THREE, store, counter };
}

test("enabling Color Contrast runs its fixed contrast without editing another value", async () => {
  const { fakeThis: effect, store } = loadEffect();
  await effect.load({});
  effect.update(0);
  assert.equal(effect.pass.enabled, false);
  store.ccEnable.v = 1;
  effect.update(0);
  assert.equal(effect.pass.enabled, true);
  assert.equal(effect.pass.uniforms.u_chainCount.value, 1);
  assert.equal(effect.pass.uniforms.u_chain.value[0], 0);
  store.ccEnable.v = 0;
  effect.update(0);
  assert.equal(effect.pass.enabled, false);
});

test("a dirty tool never activates an unchanged neighbour", async () => {
  const { fakeThis: effect, store } = loadEffect();
  await effect.load({});
  store.conContrast.v = 0.6;
  effect.update(0);
  assert.deepEqual(Object.keys(effect._looksActiveTools).filter(k => effect._looksActiveTools[k]), ["contrast"]);
  store.wcWarmCool.v = 0.7;
  effect.update(0);
  assert.equal(effect.pass.uniforms.u_chainCount.value, 2);
  store.conEnable.v = 0;
  effect.update(0);
  assert.equal(effect.pass.uniforms.u_chainCount.value, 1);
  assert.equal(effect.pass.uniforms.u_chain.value[0], 9);
});

test("repeated updates and seeks restore identical shader inputs", async () => {
  const { fakeThis: effect, store } = loadEffect();
  await effect.load({});
  store.cruGamma.v = 2.8;
  store.wcWarmCool.v = 0.7;
  const snapshot = () => JSON.stringify(effect.pass.uniforms, (k, v) => k === "needsUpdate" ? undefined : v);
  effect.update(20);
  const frame = snapshot();
  effect.update(90);
  effect.update(0);
  effect.update(20);
  assert.equal(snapshot(), frame);
});

test("Noir keeps a tonal range and neutral channels on a grayscale ramp", () => {
  const { fakeThis: effect } = loadEffect();
  const Looks = effect.looksTest.Looks;
  const state = Looks.tools.defaultState();
  const noir = Looks.tools.PRESETS.find(p => p.id === "noir");
  for (const [id, patch] of Object.entries(noir.tools)) Object.assign(state.tools[id].p, patch.p);
  const luts = Looks.grade.buildFrameLuts(state.tools);
  const values = [0, 0.125, 0.25, 0.5, 0.75, 1].map(x => {
    const c = Looks.grade.gradePixel([x, x, x], [0.5, 0.5], state.tools, state.on, () => [x,x,x], [960,540], luts);
    assert.ok(Math.abs(c[0]-c[1]) < 1e-9 && Math.abs(c[1]-c[2]) < 1e-9);
    return c[0];
  });
  assert.ok(values[1] < 0.01);
  assert.ok(values[3] > 0.2 && values[3] < 0.4);
  assert.ok(values[5] >= 1);
  assert.ok(values.every((v, i) => !i || v >= values[i-1]));
});

test("manager cleanup is registered before the property renderer changes", () => {
  const module = { exports: {} };
  new Function("module", "exports", "plugin", readPack("looks-setup.js"))(module, module.exports, {});
  const original = function () {};
  const PZ = { ui: { controls: { createControls: original }, properties: function () {} } };
  let dispose;
  module.exports.activate({
    PZ,
    editor: {},
    ui: {},
    getAsset: (kind, url) => readPack(url.split("/").pop()),
    lifecycle: { onDispose(fn) {
      assert.equal(PZ.ui.controls.createControls, original);
      dispose = fn;
    } },
  });
  assert.equal(typeof dispose, "function");
  assert.notEqual(PZ.ui.controls.createControls, original);
  dispose();
  assert.equal(PZ.ui.controls.createControls, original);
  assert.doesNotThrow(dispose);
});

test("a window for a replaced project cannot write into the new project", () => {
  const module = { exports: {} };
  new Function("module", "exports", readPack("looks-setup.js") +
    "\nmodule.exports.qa = { state, effectInProject, createSession };")(module, module.exports);
  const { state, effectInProject, createSession } = module.exports.qa;
  const originalProject = {};
  const effect = {
    parent: {},
    parentProject: originalProject,
    properties: { value: { get() { return 0; }, set() { throw new Error("stale live write"); } } },
  };
  state.editor = { project: originalProject, history: { startOperation() { throw new Error("stale history edit"); } } };
  state.ops = { setValue() { throw new Error("wrong project address"); } };
  assert.equal(effectInProject(effect), true);
  state.editor.project = {};
  assert.equal(effectInProject(effect), false);
  const session = createSession(effect);
  assert.doesNotThrow(() => session.live("value", 1));
  assert.equal(session.commit([{ key: "value", value: 1 }]), false);
  effect.parentProject = null;
  assert.equal(effectInProject(effect), false);
  effect.parent = null;
  assert.equal(effectInProject(effect), false);
});

test("Vignette Strength darkens corners with its default neutral tint", () => {
  const { fakeThis: effect } = loadEffect();
  const Looks = effect.looksTest.Looks;
  const state = Looks.tools.defaultState();
  state.tools.vignette.p.strength = 1;
  const on = Object.fromEntries(Object.keys(state.on).map(k => [k, k === "vignette" ? 1 : 0]));
  const luts = Looks.grade.buildFrameLuts(state.tools);
  const grade = uv => Looks.grade.gradePixel([0.5,0.5,0.5], uv, state.tools, on, () => [0.5,0.5,0.5], [16,16], luts);
  assert.equal(grade([0.5,0.5])[0], 0.5);
  assert.ok(grade([0,0])[0] < 0.3);
});

test("Edge Softness Blur Size affects the image at its fresh default radius", () => {
  const { fakeThis: effect } = loadEffect();
  const Looks = effect.looksTest.Looks;
  const state = Looks.tools.defaultState();
  state.tools["edge-softness"].p.blurSize = 0.1;
  const on = Object.fromEntries(Object.keys(state.on).map(k => [k, k === "edge-softness" ? 1 : 0]));
  const sample = uv => uv[0] > 0.85 ? [1,1,1] : [0,0,0];
  const c = Looks.grade.gradePixel([1,1,1], [0.9,0.9], state.tools, on, sample, [16,16], Looks.grade.buildFrameLuts(state.tools));
  assert.ok(c[0] < 0.95);
});
