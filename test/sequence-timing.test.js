"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");
const { loadEngine } = require("./precomp-fixtures.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { createCharacters } = require("../plugins/text-plus/text-plus-2d-properties.js");
const { createControlsStore } = require("../plugins/expressions-plus/controls.js");
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(options) {
  const defaultRate = options && options.defaultRate !== undefined ? options.defaultRate : 30;
  const context = host(), { PZ } = context;
  context.DOMAIN = "";
  context.fetch = async url => {
    const file = require("node:path").join(process.env.ZOIDIUM_RESOURCE_DIR || ".zoidium-resources", String(url).replace(/^\/tools\/clipmaker\//, ""));
    return { text: async () => fs.readFileSync(file, "utf8") };
  };
  const project = new PZ.project(); project.sequence.properties.load(); project.sequence.length = 180;
  const editor = editorFor(PZ, project), notes = [];
  editor.onSequenceChanged = new PZ.observable();
  context.AudioContext = class {
    constructor() { this.state = "suspended"; }
    createAnalyser() { return { connect() {} }; }
  };
  editor.playback = new PZ.ui.playback(editor);
  context.ZoidiumUI = { notify(detail) { notes.push(detail); } };
  const defaultSettings = { rate: defaultRate, setCalls: [] };
  context.ZoidiumDefaultProjectSettings = {
    getFrameRate() { return defaultSettings.rate; },
    setFrameRate(value) { defaultSettings.rate = value; defaultSettings.setCalls.push(value); },
  };
  const settingsCalls = [];
  context.ZoidiumSettings = { setDefaultFrameRate(value) { settingsCalls.push(value); return true; } };
  vm.runInContext(fs.readFileSync("plugins/core/sequence-timing.js", "utf8"), context);
  const ops = new PZ.ui.properties(editor);
  function clip(audio = false, start = 0, length = 90, trackIndex = 0, layerType = 1) {
    const tracks = audio ? project.sequence.audioTracks : project.sequence.videoTracks;
    while (tracks.length <= trackIndex) tracks.push(audio ? new PZ.track.audio() : new PZ.track.video());
    const item = audio ? new PZ.clip.audio() : new PZ.clip.video(layerType);
    item.start = start; item.length = length; tracks[trackIndex].clips.push(item);
    item.properties.load(); item.object.properties.load();
    return item;
  }
  function edit(rate, live = false) {
    const property = editor.sequence.properties.rate, oldValue = property.get();
    editor.history.startOperation();
    if (live) property.set(rate);
    ops.setValue({ property: property.getAddress(), ...(live ? { oldValue } : { value: rate }) });
    editor.history.finishOperation();
  }
  return { context, PZ, project, editor, notes, ops, clip, edit, sequence: project.sequence,
    defaultSettings, settingsCalls };
}
function animate(property, first = 0, last = 100, end = 30) {
  property.keyframes.splice(0, property.keyframes.length);
  property.load({ animated: true, keyframes: [
    { frame: 0, value: first, tween: 257, controlPoints: [[-4, -3], [8, 17]] },
    { frame: end, value: last, tween: 257, controlPoints: [[-9, -20], [5, 2]] },
  ] });
}
function close(actual, expected, epsilon = 1e-8) { assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`); }

test("native rate UI edit preserves all tracks, media seconds, markers, curves and one history entry", async () => {
  const h = fixture(), { sequence, editor, PZ } = h;
  const first = h.clip(false, 0, 90), second = h.clip(false, 90, 90), audio = h.clip(true, 15, 150);
  h.clip(false, 20, 60, 1); h.clip(true, 20, 60, 1);
  first.offset = 5;
  animate(first.object.properties.opacity);
  const curve = first.object.properties.opacity, samples = [0, 3.25, 15, 29.75, 30].map(frame => curve.get(frame));
  sequence.properties.markers.addKeyframe(new PZ.keyframe("Beat", 30.25));
  editor.playback.currentFrame = 31.5;
  const before = copy(h.project), mediaTimes = copy(audio.properties.time);
  h.edit(60, true);
  assert.equal(editor.history.undoStack.length, 1);
  assert.equal(sequence.length, 360); assert.equal(second.start, 180); assert.equal(first.endFrame, second.start);
  assert.equal(first.offset, 10); assert.equal(audio.start, 30); assert.equal(audio.length, 300);
  assert.equal(sequence.videoTracks[1].clips[0].start, 40); assert.equal(sequence.audioTracks[1].clips[0].length, 120);
  assert.equal(sequence.properties.markers.keyframes[0].frame, 60.5);
  assert.equal(editor.playback.currentFrame, 63);
  [0, 3.25, 15, 29.75, 30].forEach((frame, i) => close(curve.get(frame * 2), samples[i]));
  assert.deepEqual(Array.from(audio.properties.time.keyframes, key => key.value), mediaTimes.keyframes.map(key => key.value));
  assert.equal(audio.properties.time.keyframes[1].frame, 300);
  const after = copy(h.project);
  editor.history.undo(); assert.deepEqual(copy(h.project), before); assert.equal(first.offset, 5); assert.equal(editor.playback._exactFrame, 31.5);
  assert.equal(editor.playback.currentFrame, 32);
  editor.history.redo(); assert.deepEqual(copy(h.project), after);
  h.edit(30); assert.deepEqual(copy(h.project), before);
  await Promise.resolve();
  assert.match(h.notes.at(-1).message, /Expressions.*frame/);
});

test("fractional frame positions survive native lookup and serialization without clip collapse", () => {
  const h = fixture(), first = h.clip(false, 1, 1), second = h.clip(false, 2, 1);
  animate(first.object.properties.opacity, 0, 1, 1);
  h.edit(1);
  close(first.start, 1 / 30); close(first.length, 1 / 30); close(first.endFrame, second.start);
  assert.ok(first.length > 0 && second.length > 0);
  const prop = first.object.properties.opacity;
  close(prop.get(1 / 60), .5, .25); assert.equal(prop.getKeyframe(1 / 30).value, 1);
  const reloaded = new h.PZ.property.dynamic.keyframes(prop.definition); reloaded.load(copy(prop));
  close(reloaded.keyframes[1].frame, 1 / 30); close(reloaded.get(1 / 60), prop.get(1 / 60));
  h.edit(30); close(first.start, 1); close(first.length, 1); close(second.start, 2);
});

test("Text+ characters, Shape+ contents, Expressions+ controls and plugin value units", () => {
  const h = fixture(), { PZ, sequence } = h;
  const layer = h.clip(false, 0, 180, 0, 7).object;
  const textShape = PZ.shape.create(0); layer.objects.push(textShape); textShape.load({ operations: [] });
  const characters = createCharacters(PZ, layer);
  animate(characters.delayPerCharacter, 2, 5);
  animate(characters.charPosition.objects[0], 10, 30);
  const { Content } = createModel(PZ), content = new Content("group"); content.load();
  const contents = new PZ.objectList(layer, Content); layer.children.push(contents); contents.push(content);
  animate(content.properties.rotation, 0, 90);
  const controls = createControlsStore({ PZ, patch(holder, key, wrapper) { holder[key] = wrapper(holder[key]); } });
  const slider = controls.add(sequence, "Slider", "Progress"); animate(slider, 0, 100);
  const echo = new PZ.effect(); echo.type = "echo"; layer.effects.push(echo);
  echo.properties.addAll({ delay: { name: "Echo delay (frames)", dynamic: true, type: 0, value: 3 },
    echoes: { name: "Echoes", dynamic: true, type: 0, value: 4 },
    seed: { name: "Seed", dynamic: true, type: 0, value: 42 } }); echo.properties.load();
  animate(echo.properties.delay, 3, 6); animate(echo.properties.echoes, 4, 8);
  const frameExpression = new PZ.expression("frame"); slider.expression = frameExpression;
  const before = copy(h.project);
  h.edit(60);
  assert.equal(characters.delayPerCharacter.keyframes[1].frame, 60);
  assert.equal(characters.delayPerCharacter.keyframes[1].value, 10);
  assert.equal(characters.charPosition.objects[0].keyframes[1].frame, 60);
  assert.equal(characters.charPosition.objects[0].keyframes[1].value, 30);
  assert.equal(content.properties.rotation.keyframes[1].frame, 60);
  assert.equal(slider.keyframes[1].frame, 60); assert.equal(slider.keyframes[1].value, 100);
  assert.equal(slider.expression, frameExpression);
  assert.equal(echo.properties.delay.keyframes[1].value, 12);
  assert.equal(echo.properties.delay.keyframes[1].controlPoints[0][1], -40);
  assert.equal(echo.properties.echoes.keyframes[1].value, 8); assert.equal(echo.properties.seed.get(), 42);
  h.editor.history.undo(); assert.deepEqual(copy(h.project), before);
});

test("notice Undo affects only its own latest history operation", async () => {
  const h = fixture(); h.clip(); h.edit(60);
  await Promise.resolve();
  h.notes[0].action.run(); assert.equal(h.sequence.properties.rate.get(), 30);
  h.editor.history.redo();
  h.editor.history.startOperation();
  h.ops.setValue({ property: h.sequence.properties.name.getAddress(), value: "Later edit" });
  h.editor.history.finishOperation();
  h.notes[0].action.run(); assert.equal(h.sequence.properties.name.get(), "Later edit");
  assert.match(h.notes.at(-1).message, /later edits/);
});

test("a load or unrelated edit never scans or rescales timing", () => {
  const h = fixture(), clip = h.clip();
  let visits = 0; clip.getAddress = () => { visits++; throw new Error("Unexpected timeline scan"); };
  h.sequence.properties.rate.load(24);
  h.editor.history.startOperation();
  h.ops.setValue({ property: h.sequence.properties.name.getAddress(), value: "Renamed" });
  h.editor.history.finishOperation();
  assert.equal(visits, 0); assert.equal(clip.length, 90); assert.equal(h.sequence.length, 180);
  assert.equal(h.notes.length, 0);
});

test("stored Precomp+ timelines, offsets, render caches, and parked Main share the new rate", () => {
  const h = fixture(), { PZ, project } = h;
  loadEngine(PZ);
  const mainClip = h.clip(false, 0, 180);
  const data = [{ type: 0, clips: [copy(mainClip)] }];
  data[0].clips[0].object = { type: 2, compId: "inner", offset: 12,
    properties: {}, effects: [], objects: [] };
  const media = new PZ.media(); project.media.push(media); media.comp = { id: "outer" };
  media.properties.load(); media.data = copy(data); media.loaded = true;
  const nested = new PZ.media(); project.media.push(nested); nested.comp = { id: "inner" };
  nested.properties.load(); nested.loaded = true; nested.data = [{ type: 0, clips: [copy(mainClip)] }];
  // Install only the engine's composition layer adoption path. The host hook
  // installation itself is covered by the Precomp+ suite.
  const engineState = PZ.precomp.timingState(project);
  assert.equal(engineState.length, 2);
  const before = copy(media.data);
  h.edit(60); assert.equal(media.data[0].clips[0].length, 360);
  assert.equal(media.data[0].clips[0].object.offset, 24); assert.equal(nested.data[0].clips[0].length, 360);
  h.editor.history.undo(); assert.deepEqual(copy(media.data), before);
  h.editor.history.redo(); assert.equal(media.data[0].clips[0].object.offset, 24);
});


test("native property controls commit and cancel the rate and timing together", () => {
  const h = fixture(), property = h.sequence.properties.rate;
  h.clip();
  const row = { closest: () => ({ pz_controls: { editor: h.editor, propertyOps: h.ops } }) };
  const input = { parentElement: row };
  const before = copy(h.project);
  h.PZ.ui.controls.editStart.call(input, property);
  property.set(60);
  h.PZ.ui.controls.editFinish.call(input, property, false);
  assert.equal(h.sequence.length, 360); assert.equal(h.editor.history.undoStack.length, 1);
  h.editor.history.undo(); assert.deepEqual(copy(h.project), before);
  h.PZ.ui.controls.editStart.call(input, property);
  property.set(24);
  h.PZ.ui.controls.editFinish.call(input, property, true);
  assert.deepEqual(copy(h.project), before); assert.equal(h.editor.history.undoStack.length, 0);
});

test("rate history resolves addresses after a later object deletion and recreation", () => {
  const h = fixture(), clip = h.clip(); animate(clip.object.properties.opacity);
  const before = copy(h.project);
  h.edit(60);
  const saved = copy(clip), track = clip.parent;
  track.splice(0, 1);
  const replacement = new h.PZ.clip.video(1); track.push(replacement);
  replacement.start = saved.start; replacement.length = saved.length;
  replacement.properties.load(saved.properties); replacement.object.properties.load(saved.object.properties);
  assert.notEqual(replacement, clip);
  h.editor.history.undo(); assert.deepEqual(copy(h.project), before);
  h.editor.history.redo(); assert.equal(replacement.object.properties.opacity.keyframes[1].frame, 60);
});

test("an open Precomp+ rescales parked Main, serialized controls and nested render instances", async () => {
  const h = fixture(), { PZ, project, sequence } = h;
  const engine = loadEngine(PZ), uninstall = engine.install();
  try {
    const source = h.clip(false, 0, 90), data = [{ type: 0, clips: [copy(source)] }];
    const media = new PZ.media(); project.media.push(media);
    media.comp = { id: "source" }; media.properties.load(); media.data = data; media.loaded = true;
    const compClip = h.clip(false, 90, 90, 0, 2);
    await compClip.object.load({ type: 2, compId: "source", offset: 15, properties: {}, effects: [], objects: [] });
    const cachedClip = compClip.object.nestedTracks()[0].clips[0];
    assert.equal(cachedClip.length, 90);
    h.edit(60);
    assert.equal(compClip.object.offset, 30);
    assert.notEqual(compClip.object.nestedTracks()[0].clips[0], cachedClip);
    assert.equal(compClip.object.nestedTracks()[0].clips[0].length, 180);
    h.editor.history.undo(); assert.equal(compClip.object.nestedTracks()[0].clips[0].length, 90);
    const controls = createControlsStore({ PZ, patch(holder, key, wrapper) { holder[key] = wrapper(holder[key]); } });
    const slider = controls.add(sequence, "Slider"); animate(slider, 0, 100);
    assert.equal(engine.openComp(h.editor, "source").ok, true);
    h.edit(60);
    const parked = engine.timingState(project).find(root => root.id === engine.MAIN_ID).data;
    assert.equal(parked.properties.rate, 60); assert.equal(parked.length, 360);
    assert.equal(JSON.parse(parked.properties.zoidiumControls).controls[0].keyframes[1].frame, 60);
    h.editor.history.undo();
    assert.equal(engine.timingState(project).find(root => root.id === engine.MAIN_ID).data.properties.rate, 30);
    h.editor.history.redo();
    assert.equal(engine.openComp(h.editor, "main").ok, true);
    assert.equal(sequence.properties.rate.get(), 60); assert.equal(sequence.videoTracks[0].clips[0].length, 180);
    assert.equal(controls.list(sequence)[0].keyframes[1].frame, 60);
  } finally { uninstall(); }
});


test("Camera+ master-track channels scale, while FPS, seconds, counters and shutter fractions keep their units", () => {
  const h = fixture(), { PZ, context, sequence } = h;
  const scene = h.clip(false, 20, 100, 0, 4).object;
  const parts = {};
  new Function("PZ", "THREE", "parts", fs.readFileSync("plugins/camera-plus/camera-class.js", "utf8"))(PZ, context.THREE, parts);
  new Function("PZ", "THREE", "parts", fs.readFileSync("plugins/camera-plus/vibrate.js", "utf8"))(PZ, context.THREE, parts);
  const Camera = parts.camera.createClass(PZ, context.THREE, parts.vibrate);
  scene.threeObj = new context.THREE.Object3D();
  const camera = new Camera(); scene.objects.push(camera);
  camera.properties.load();
  animate(camera.properties.position.objects[0], 0, 20);
  animate(sequence.properties.motionBlurSamples, 4, 8);
  const originalShutter = sequence.properties.motionBlurShutter.get();
  const effects = [];
  for (const [type, field, value] of [["posterizetime", "fps", 12], ["timedisplacement", "maxTime", 1.5],
    ["timeoffset", "offset", -3], ["timecode", "startingFrame", 100], ["ccwidetime", "forwardSteps", 3]]) {
    const effect = new PZ.effect(); effect.type = type; scene.effects.push(effect);
    effect.properties.add(field, { name: field, dynamic: true, type: 0, value }); effect.properties.load();
    effects.push(effect.properties[field]);
  }
  h.edit(60);
  assert.equal(camera.properties.position.objects[0].keyframes[1].frame, 60);
  assert.equal(sequence.properties.motionBlurSamples.keyframes[1].frame, 60);
  assert.equal(sequence.properties.motionBlurSamples.keyframes[1].value, 8);
  assert.equal(sequence.properties.motionBlurShutter.get(), originalShutter);
  assert.deepEqual(effects.map(property => property.get()), [12, 1.5, -6, 100, 3]);
});


test("frame rate notice offers Undo, keep, and make-default actions in order", async () => {
  const h = fixture({ defaultRate: 30 }); h.clip(); h.edit(60);
  await Promise.resolve();
  const actions = h.notes.at(-1).actions;
  assert.equal(actions.length, 3);
  assert.deepEqual([...actions.map(entry => entry.label)], ["Undo", "Just this project", "Make 60 fps default"]);
  assert.equal(h.notes.at(-1).action.label, "Undo");
});

test("frame rate notice hides Make default when the new rate already matches", async () => {
  const h = fixture({ defaultRate: 60 }); h.clip(); h.edit(60);
  await Promise.resolve();
  assert.deepEqual([...h.notes.at(-1).actions.map(entry => entry.label)], ["Undo", "Just this project"]);
});

test("Make default stores the new rate and confirms it", async () => {
  const h = fixture({ defaultRate: 30 }); h.clip(); h.edit(60);
  await Promise.resolve();
  h.notes.at(-1).actions[2].run();
  assert.deepEqual(h.settingsCalls, [60]);
  assert.equal(h.notes.at(-1).title, "New projects will use 60 fps.");
});

test("Make default keeps fractional rates exact", async () => {
  const h = fixture({ defaultRate: 30 }); h.clip(); h.edit(29.97);
  await Promise.resolve();
  const actions = h.notes.at(-1).actions;
  assert.equal(actions[2].label, "Make 29.97 fps default");
  actions[2].run();
  assert.deepEqual(h.settingsCalls, [29.97]);
  assert.equal(h.notes.at(-1).title, "New projects will use 29.97 fps.");
});

test("adjacent boundaries agree exactly even when floating subtraction loses a bit", () => {
  const h = fixture(); h.sequence.properties.rate.set(3);
  const first = h.clip(false, 7, 25), second = h.clip(false, 32, 25);
  h.edit(1);
  assert.equal(first.endFrame, second.start);
  close(second.start, 32 / 3);
  h.editor.history.undo(); assert.equal(first.start, 7); assert.equal(first.length, 25); assert.equal(second.start, 32);
});
