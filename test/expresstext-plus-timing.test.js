"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { fixture, ROOT } = require("./helpers/expresstext-host.cjs");
const { editorFor } = require("./helpers/editor-identity-host.cjs");
const { loadEngine } = require("./precomp-fixtures.js");
const copy = value => JSON.parse(JSON.stringify(value));
const durationKeys = ["shakeDelay", "plainDelay", "randomDelay", "formulaDelay", "splineDelay",
  "orbitDelay", "repeaterDelay", "repeaterLag", "twistDelay", "wrapDelay", "voronoiDelay"];

function timingFixture() {
  const h = fixture(), { PZ, project, container } = h;
  project.sequence.properties.load();
  project.sequence.length = 180;
  const track = new PZ.track.video(); project.sequence.videoTracks.push(track);
  const clip = new PZ.clip.video(4); clip.start = 0; clip.length = 180; track.clips.push(clip);
  clip.properties.load(); clip.object.properties.load(); clip.object.threeObj = new h.THREE.Object3D();
  project.objects.splice(0, 1); clip.object.objects.push(container);
  const editor = editorFor(PZ, project);
  const realm = vm.createContext({ PZ, window: {}, console });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "plugins/core/sequence-timing.js"), "utf8"), realm);
  const operations = new PZ.ui.properties(editor);
  function edit(value) {
    editor.history.startOperation();
    operations.setValue({ property: project.sequence.properties.rate.getAddress(), value });
    editor.history.finishOperation();
  }
  return { ...h, clip, editor, edit };
}
function animate(property) {
  property.keyframes.splice(0, property.keyframes.length);
  property.load({ animated: true, keyframes: [
    { frame: 0, value: 30, tween: 257, controlPoints: [[-4, -3], [8, 17]] },
    { frame: 30, value: 60, tween: 257, controlPoints: [[-9, -20], [5, 2]] },
  ] });
}
function row(section, key) { return section.objects.find(item => item.definition.effectorKey === key); }
function sections(h) {
  const groups = h.T.effectorEntryDefs(h.PZ).map(def => h.section(def.name, {}));
  return groups.flatMap(section => Array.from(section.objects)).filter(item => durationKeys.includes(item.definition.effectorKey));
}

test("changing 30 fps to 60 fps preserves ExpressText stagger duration in seconds", () => {
  const h = timingFixture();
  try {
    const delay = row(h.section("Plain", { plainDelay: 30 }), "plainDelay");
    const beforeSeconds = delay.get(0) / h.project.sequence.properties.rate.get();
    h.edit(60);
    assert.equal(delay.get(0) / h.project.sequence.properties.rate.get(), beforeSeconds);
  } finally { h.close(); }
});

for (const animated of [false, true]) {
  test(`all declared ExpressText+ frame durations scale with undo and redo, animated=${animated}`, () => {
    const h = timingFixture();
    try {
      const durations = sections(h);
      assert.equal(durations.length, durationKeys.length);
      for (const property of durations) {
        if (animated) animate(property);
        else property.set(30, 0);
      }
      const frequency = row(h.section("Shake", { shakeFrequency: 2 }), "shakeFrequency");
      const copies = row(h.section("Repeater", { repeaterCopies: 4 }), "repeaterCopies");
      const chunks = row(h.section("Voronoi", { voronoiChunks: 8 }), "voronoiChunks");
      const speed = row(h.section("Random", { randomAnimationSpeed: 50 }), "randomAnimationSpeed");
      if (animated) for (const property of [frequency, copies, chunks, speed]) animate(property);
      const original = durations.map(copy);
      const otherOriginal = [frequency, copies, chunks, speed].map(copy);
      const sampleFrames = [0, 3.25, 15, 29.75, 30];
      const samples = durations.map(property => sampleFrames.map(frame => property.get(frame)));
      h.edit(60);
      for (let i = 0; i < durations.length; i++) {
        const property = durations[i];
        assert.equal(property.keyframes.at(-1).value, animated ? 120 : 60);
        if (animated) {
          assert.equal(property.keyframes[1].frame, 60);
          assert.equal(property.keyframes[1].controlPoints[0][1], -40);
        }
        sampleFrames.forEach((frame, j) => assert.ok(Math.abs(property.get(frame * 2) - samples[i][j] * 2) < 1e-8));
      }
      [frequency, copies, chunks, speed].forEach((property, i) => {
        assert.deepEqual(Array.from(property.keyframes, key => key.value), otherOriginal[i].keyframes.map(key => key.value));
      });
      const after = durations.map(copy);
      h.editor.history.undo(); assert.deepEqual(durations.map(copy), original);
      h.editor.history.redo(); assert.deepEqual(durations.map(copy), after);
      h.edit(30); assert.deepEqual(durations.map(copy), original);
    } finally { h.close(); }
  });
}

test("stored compositions scale declared section rows and legacy effectors without changing definitions", () => {
  const h = timingFixture();
  try {
    const durations = sections(h);
    durations.forEach((property, index) => index % 2 ? animate(property) : property.set(30, 0));
    h.section("Shake", { shakeFrequency: 2 });
    h.section("Repeater", { repeaterCopies: 4 });
    h.section("Voronoi", { voronoiChunks: 8 });
    loadEngine(h.PZ);
    const media = new h.PZ.media(); h.project.media.push(media);
    media.comp = { id: "express" }; media.properties.load(); media.loaded = true;
    media.data = [{ type: 0, clips: [copy(h.clip)] }];
    const savedContainer = media.data[0].clips[0].object.objects[0];
    // Legacy effector objects still use stable serialized property names.
    savedContainer.objects.push({ type: "zoidium:expresstext-plus/plain", properties: {
      plainDelay: { animated: false, keyframes: [{ frame: 0, value: 30, controlPoints: [[-10, 0], [10, 0]] }] },
    } });
    const before = copy(media.data);
    h.edit(60);
    const after = copy(media.data), stored = media.data[0].clips[0].object.objects[0];
    for (let i = 0; i < stored.customProperties.length; i++) {
      const section = stored.customProperties[i];
      assert.deepEqual(section.type, before[0].clips[0].object.objects[0].customProperties[i].type);
      section.objects.forEach((value, index) => {
        const key = section.type.objects[index].effectorKey;
        const old = before[0].clips[0].object.objects[0].customProperties[i].objects[index];
        if (durationKeys.includes(key)) {
          value.keyframes.forEach((frame, k) => {
            assert.equal(frame.value, old.keyframes[k].value * 2, key);
            assert.equal(frame.frame, old.keyframes[k].frame * 2, key);
            assert.equal(frame.controlPoints[0][1], old.keyframes[k].controlPoints[0][1] * 2, key);
          });
        } else if (value.keyframes) assert.deepEqual(value.keyframes.map(key => key.value), old.keyframes.map(key => key.value));
      });
    }
    assert.equal(stored.objects[0].properties.plainDelay.keyframes[0].value, 60);
    h.editor.history.undo(); assert.deepEqual(copy(media.data), before);
    h.editor.history.redo(); assert.deepEqual(copy(media.data), after);
    h.edit(30); assert.deepEqual(copy(media.data), before);
  } finally { h.close(); }
});
