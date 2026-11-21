"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");

function fixture() {
  const context = host();
  const { PZ, THREE } = context;
  PZ.asset.shader.prototype.getShader = async () => "";
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/core/scene-backdrop.js"), "utf8"), context);
  const project = new PZ.project();
  project.load({ assets: {}, media: [], sequence: { properties: {}, length: 30, audioTracks: [],
    videoTracks: [{ properties: {}, clips: [{ start: 0, length: 30, type: 4,
      object: { type: 4, properties: {}, objects: [], effects: [] } }] }],
    clipLinks: { links: {}, seed: 0 } } });
  const scene = project.sequence.videoTracks[0].clips[0].object;
  return { context, PZ, THREE, project, scene, properties: scene.properties.childProperties };
}

function rendererFor(THREE, draws) {
  const clear = new THREE.Color().setRGB(0.2, 0.3, 0.4);
  return {
    alpha: 0.1,
    getClearColor: () => clear,
    getClearAlpha() { return this.alpha; },
    setClearColor(color, alpha) { clear.copy(color); this.alpha = alpha; },
    getContextAttributes: () => ({ premultipliedAlpha: true }),
    render(_scene, _camera, target, forceClear) { draws.push([target, clear.toArray(), this.alpha, forceClear]); },
  };
}

test("a saved scene without a backdrop keeps its native render call", () => {
  const { THREE, scene, properties } = fixture();
  const draws = [];
  const renderer = rendererFor(THREE, draws);
  const target = {};
  assert.equal(properties.zoidiumBackdropMode.get(), 0);
  scene.pass.render(renderer, target, null, true);
  assert.deepEqual(JSON.parse(JSON.stringify(draws)), [[{}, [0.2, 0.3, 0.4], 0.1, true]]);
});

test("solid backdrop settings use native history and survive project save and reload", () => {
  const { PZ, project, properties } = fixture();
  const editor = editorFor(PZ, project);
  const ui = new PZ.ui.properties(editor);
  const mode = properties.zoidiumBackdropMode;
  const color = properties.zoidiumBackdropColor;
  const opacity = properties.zoidiumBackdropOpacity;
  editor.history.startOperation();
  ui.setValue({ property: mode.getAddress(), value: 1 });
  ui.setValue({ property: color.getAddress(), value: [1, 0.5, 0.25] });
  ui.setValue({ property: opacity.getAddress(), value: 0.5 });
  editor.history.finishOperation();
  assert.equal(mode.get(), 1);
  editor.history.undo();
  assert.equal(mode.get(), 0);
  assert.equal(opacity.get(), 1);
  editor.history.redo();
  assert.equal(mode.get(), 1);
  const copy = new PZ.project();
  copy.load(JSON.parse(JSON.stringify(project)));
  const restored = copy.sequence.videoTracks[0].clips[0].object.properties.childProperties;
  assert.equal(restored.zoidiumBackdropMode.get(), 1);
  assert.deepEqual(Array.from(restored.zoidiumBackdropColor.get()), [1, 0.5, 0.25]);
  assert.equal(restored.zoidiumBackdropOpacity.get(), 0.5);
});

test("a solid backdrop affects only the scene color render and restores renderer state", () => {
  const { THREE, scene, properties } = fixture();
  const draws = [];
  const renderer = rendererFor(THREE, draws);
  const pass = scene.pass;
  const target = {};
  const motion = {};
  pass.envMap.render = () => renderer.render(pass.scene, {}, {}, true);
  pass.motionBlur.render = () => renderer.render(pass.scene, pass.camera, motion, true);
  properties.zoidiumBackdropMode.set(1);
  properties.zoidiumBackdropColor.set([0.9, 0.6, 0.3]);
  properties.zoidiumBackdropOpacity.set(0.5);
  const render = renderer.render;
  pass.render(renderer, target, null, true);
  assert.deepEqual(draws.map(([, rgb, alpha]) => [Array.from(rgb), alpha]), [
    [[0.2, 0.3, 0.4], 0.1],
    [[0.2, 0.3, 0.4], 0.1],
    [[0.45, 0.3, 0.15], 0.5],
  ]);
  assert.equal(renderer.render, render);
  assert.deepEqual(Array.from(renderer.getClearColor().toArray()), [0.2, 0.3, 0.4]);
  assert.equal(renderer.getClearAlpha(), 0.1);
});

test("Camera+ can draw a premultiplied solid backdrop without changing the depth pass", () => {
  const { PZ, THREE, scene, properties } = fixture();
  const draws = [];
  const renderer = rendererFor(THREE, draws);
  renderer.getContextAttributes = () => ({ premultipliedAlpha: false });
  properties.zoidiumBackdropMode.set(1);
  properties.zoidiumBackdropColor.set([1, 0.5, 0]);
  properties.zoidiumBackdropOpacity.set(0.5);
  const drawColor = PZ.zoidium.sceneBackdrop.drawColor;
  drawColor(scene.threeObj, renderer, () => renderer.render(scene.threeObj, null, "color", true));
  renderer.render(scene.threeObj, null, "depth", true);
  assert.deepEqual(draws.map(([target, rgb, alpha]) => [target, Array.from(rgb), alpha]), [
    ["color", [0.5, 0.25, 0], 0.5],
    ["depth", [0.2, 0.3, 0.4], 0.1],
  ]);
  assert.throws(() => drawColor(scene.threeObj, renderer, () => { throw new Error("Draw failed"); }), /Draw failed/);
  assert.equal(renderer.getClearAlpha(), 0.1);
});

test("the solid backdrop clear is premultiplied whatever the context attributes say", () => {
  for (const premultipliedAlpha of [true, false, undefined]) {
    const { PZ, THREE, scene, properties } = fixture();
    const draws = [];
    const renderer = rendererFor(THREE, draws);
    renderer.getContextAttributes = () => ({ premultipliedAlpha });
    properties.zoidiumBackdropMode.set(1);
    properties.zoidiumBackdropColor.set([0.8, 0.4, 0.2]);
    properties.zoidiumBackdropOpacity.set(0.5);
    PZ.zoidium.sceneBackdrop.drawColor(scene.threeObj, renderer, () => renderer.render(scene.threeObj, null, "color", true));
    assert.deepEqual(draws.map(([, rgb, alpha]) => [Array.from(rgb).map(v => +v.toFixed(6)), alpha]), [[[0.4, 0.2, 0.1], 0.5]]);
  }
});

test("a scene that saved only the backdrop mode gets the missing properties", () => {
  const { PZ } = fixture();
  const project = new PZ.project();
  const json = JSON.parse(JSON.stringify(fixture().project));
  const props = json.sequence.videoTracks[0].clips[0].object.properties.childProperties;
  props.zoidiumBackdropMode = 1;
  delete props.zoidiumBackdropColor; delete props.zoidiumBackdropOpacity;
  project.load(json);
  const restored = project.sequence.videoTracks[0].clips[0].object.properties.childProperties;
  assert.equal(restored.zoidiumBackdropMode.get(), 1);
  assert.deepEqual(Array.from(restored.zoidiumBackdropColor.get()), [0, 0, 0]);
  assert.equal(restored.zoidiumBackdropOpacity.get(), 1);
});
