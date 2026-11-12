"use strict";

// Guards for two JSON.parse(JSON.stringify(...)) clone sites that throw when
// the value serializes to undefined (an object whose toJSON() returns
// undefined, a top-level undefined, or a function): JSON.stringify yields
// undefined and JSON.parse(undefined) throws a SyntaxError.
//   site 1: plugins/camera-plus/shared-camera.js swapToggle disable path,
//           which clones a live item.effect when 3D tracking turns off.
//   site 2: zoidium/plugin-apis.js track load, which clones each extra
//           data[key] into the retained-fields table.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

// ---- site 2: zoidium/plugin-apis.js ----

function trackHost() {
  const vm = require("node:vm");
  class Track { load(data) { this.clips = data.clips; } toJSON() { return { type: 0, clips: this.clips }; } }
  const context = { PZ: { track: Track }, console };
  vm.runInNewContext(fs.readFileSync(path.join(root, "zoidium", "plugin-apis.js"), "utf8"), context);
  return { Track };
}

function poisoned(marker) {
  const value = { marker };
  value.toJSON = () => undefined;
  return value;
}

test("track load leaves a field whose serializer returns undefined absent instead of throwing", () => {
  const { Track } = trackHost();
  const track = new Track();
  assert.doesNotThrow(() => track.load({ type: 0, clips: [], mystery: poisoned(7) }));
  const saved = track.toJSON();
  assert.equal(saved.mystery, undefined);
  assert.ok(!Object.hasOwn(saved, "mystery"), "the field stays absent as plain JSON would leave it");
});

test("track load leaves undefined and function values absent instead of throwing", () => {
  const { Track } = trackHost();
  const track = new Track();
  assert.doesNotThrow(() => track.load({ type: 0, clips: [], gone: undefined, run: function () {} }));
  const saved = track.toJSON();
  assert.ok(!Object.hasOwn(saved, "gone"), "undefined stays absent");
  assert.ok(!Object.hasOwn(saved, "run"), "functions stay absent");
});

test("track load still clones normal values with shape and key order intact", () => {
  const { Track } = trackHost();
  const track = new Track();
  const source = { b: 2, a: [1, { c: null }] };
  track.load({ type: 0, clips: [], extension: source });
  // The clone crosses the vm realm, so re-root it before comparing.
  const saved = JSON.parse(JSON.stringify(track.toJSON()));
  assert.deepStrictEqual(saved.extension, { b: 2, a: [1, { c: null }] });
  assert.deepStrictEqual(Object.keys(saved.extension), ["b", "a"]);
  saved.extension.a.push(9);
  assert.deepStrictEqual(source, { b: 2, a: [1, { c: null }] }, "the clone stays detached");
});

// ---- site 1: plugins/camera-plus/shared-camera.js ----

function cameraHost(makeEffect) {
  const source = fs.readFileSync(path.join(root, "plugins", "camera-plus", "shared-camera.js"), "utf8");
  class SceneLayer {}
  class AdjustmentLayer {}
  class VideoTrack {}
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2 }, create: (definition) => Object.assign({}, definition) },
    layer: {
      prototype: { load() {}, update() { return 0; }, unload() {} },
      scene: SceneLayer,
      adjustment: AdjustmentLayer,
    },
    compositor: { prototype: { renderLayer() {}, renderSequence() {} } },
    sequence: { prototype: {} },
    effect: { create: makeEffect },
    track: { video: VideoTrack },
  };
  const parts = {
    camera: { OBJECT_TYPE: 4242 },
    cameraSearch: () => ({ plan: () => null, update() {} }),
    sharedDepth: () => ({ begin() {}, finish() { return false; }, end() {} }),
  };
  new Function("PZ", "THREE", "parts", source)(PZ, {}, parts);
  let undo = null;
  const editor = {
    project: { ui: {} },
    history: {
      startOperation() {},
      finishOperation() {},
      pushCommand(fn, info) { undo = { fn, info }; },
    },
  };
  const apis = {
    timeline: {
      registerTrackField() { return () => {}; },
      registerTrackButton() { return () => {}; },
      refreshTrackButtons() {},
    },
    media: { registerPreset() { return () => {}; } },
    layers: { registerType() { return () => {}; } },
  };
  const shared = parts.shared({
    PZ, THREE: {}, apis, teardown: [],
    patchMethod: (holder, key, replacement) => { holder[key] = replacement; },
    migrateCameraData: (data) => data,
    syncScene() {},
    findActiveCamera() { return null; },
    nativeCameraObjectOf() { return null; },
    plugin: { id: "camera-plus" },
    getProject: () => null,
  });
  return { shared, editor, takeUndo: () => undo };
}

function enableThenUndo(makeEffect) {
  const { shared, editor, takeUndo } = cameraHost(makeEffect);
  const layer = { effects: [] };
  const track = { track3d: false, clips: [{ object: layer }] };
  shared.toggleTrack3d(track, editor);
  assert.equal(track.track3d, true, "setup: enabling 3D tracking attaches a live effect");
  assert.equal(layer.effects.length, 1);
  const undo = takeUndo();
  const item = undo.info.effects[0];
  assert.doesNotThrow(() => undo.fn(undo.info), "undo (tracking off) must not throw");
  return { track, layer, item };
}

test("disabling 3D tracking falls back to the default when the effect serializes to undefined", () => {
  const { track, layer, item } = enableThenUndo((type) => ({
    type,
    load() { return null; },
    unload() { this.unloaded = true; },
    toJSON() { return undefined; },
  }));
  assert.equal(track.track3d, false);
  assert.deepStrictEqual(item.data, { type: "transform" }, "absent-effect default, as when toJSON is missing");
  assert.equal(layer.effects.length, 0);
  assert.equal(item.effect.unloaded, true);
});

test("disabling 3D tracking still clones a normal effect with shape and key order intact", () => {
  const serialized = { type: "transform", properties: { speed: 2, name: "x" } };
  const { item } = enableThenUndo((type) => ({
    type,
    load() { return null; },
    unload() {},
    toJSON: () => serialized,
  }));
  assert.deepStrictEqual(item.data, { type: "transform", properties: { speed: 2, name: "x" } });
  assert.deepStrictEqual(Object.keys(item.data), ["type", "properties"]);
  assert.notStrictEqual(item.data, serialized, "the clone stays detached");
});
