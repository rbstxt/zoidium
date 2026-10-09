"use strict";

// Precomp+ engine: pre-compose, undo, serialization round trips, nested time
// mapping, nested video scheduling, cycle rejection and deletion rules. Runs
// against the fake CM3 model in precomp-fixtures.js.

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createEnvironment, addClip, addCompMedia, reloadProject,
} = require("./precomp-fixtures.js");

function clipJSON(start, length, name, options) {
  const opts = options || {};
  const object = opts.compId
    ? { type: 2, compId: opts.compId, offset: opts.offset || 0, properties: {}, effects: [], objects: [] }
    : { type: 0, properties: {}, effects: [] };
  return { start, length, properties: { name: name }, link: null, hasMedia: !!opts.hasMedia, object };
}

function trackNames(track) {
  return track.clips.map((clip) => clip.properties.name.v);
}

// CM3 runs every timeline delete inside a history operation.
function deleteClips(env, clips) {
  env.editor.history.startOperation();
  env.tracks.deleteClips(clips.map((clip) => ({ pz_object: clip })));
  env.editor.history.finishOperation();
}

function makeABSelection(env) {
  const A = addClip(env, 0, { start: 0, length: 30, name: "A" });
  const B = addClip(env, 0, { start: 30, length: 30, name: "B" });
  return { A, B };
}

// Renders Main at frame t the way the compositor does: track.update, then the
// active layer updates with clip-local time.
function renderAt(env, t) {
  const track = env.project.sequence.videoTracks[0];
  track.update(t);
  const layer = track.layer;
  if (layer) layer.update(t - layer.parent.start);
  return layer;
}

test("pre-compose moves selected video clips into one composition clip", () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  const C = addClip(env, 1, { start: 10, length: 20, name: "C" });
  const audioTrack = new env.PZ.track.audio();
  env.project.sequence.audioTracks.push(audioTrack);
  const audio = new env.PZ.Clip(0);
  audio.start = 0;
  audio.length = 60;
  audioTrack.clips.push(audio);
  env.tracks.selectedClips = [A, B, audio];

  const result = env.engine.precompose(env.editor, "Intro");
  assert.equal(result.ok, true, result.message);
  assert.equal(result.moved, 2);
  assert.equal(result.audioKept, 1);

  const seq = env.project.sequence;
  assert.equal(seq.videoTracks[0].clips.length, 1, "selection replaced by one clip");
  const composite = seq.videoTracks[0].clips[0];
  assert.equal(composite.start, 0);
  assert.equal(composite.length, 60);
  assert.equal(composite.object.compId, result.id);
  assert.equal(seq.videoTracks[1].clips[0], C, "unselected clips stay");
  assert.equal(seq.audioTracks[0].clips[0], audio, "audio is left on Main");

  const media = env.project.media.find((m) => m.comp && m.comp.id === result.id);
  assert.equal(media.properties.name.v, "Intro");
  assert.deepEqual(media.data[0].clips.map((c) => c.start), [0, 30], "clip starts rebased to comp time 0");
  assert.equal(media.data[0].clips[0].link, null);
});

test("pre-compose is one undo step that restores Main", () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  env.tracks.selectedClips = [A, B];
  assert.equal(env.engine.precompose(env.editor, "Intro").ok, true);
  assert.equal(env.project.media.length, 1);

  env.editor.history.undo();
  assert.deepEqual(trackNames(env.project.sequence.videoTracks[0]), ["A", "B"]);
  assert.equal(env.project.media.length, 0, "composition removed by undo");
});

test("pre-compose refuses when unselected clips overlap the selection on a track", () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  addClip(env, 0, { start: 40, length: 10, name: "X" });
  env.tracks.selectedClips = [A, B];

  const result = env.engine.precompose(env.editor, "Intro");
  assert.equal(result.ok, false);
  assert.match(result.message, /overlap/);
  assert.equal(env.project.media.length, 0);
  assert.equal(env.project.sequence.videoTracks[0].clips.length, 3);
});

test("names are validated and defaults count up", () => {
  const env = createEnvironment();
  assert.equal(env.engine.nextCompName(env.project), "Comp 1");
  const { A } = makeABSelection(env);
  env.tracks.selectedClips = [A];
  assert.equal(env.engine.precompose(env.editor, "").ok, false);
  assert.equal(env.engine.precompose(env.editor, "main").ok, false);
  addCompMedia(env, "c-intro", "Intro", [{ type: 0, clips: [] }]);
  const duplicate = env.engine.precompose(env.editor, "intro");
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message, /already exists/);
  assert.equal(env.engine.nextCompName(env.project), "Comp 1");
});

test("save and reload keep Main and every composition", async () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  env.tracks.selectedClips = [A, B];
  const { id } = env.engine.precompose(env.editor, "Intro");

  const json = JSON.parse(JSON.stringify(env.project));
  const loaded = await reloadProject(env, json);
  const editor = new env.PZ.Editor(loaded);

  const rows = env.engine.entries(editor);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isMain, true);
  assert.equal(rows[1].id, id);
  assert.equal(rows[1].name, "Intro");
  assert.equal(rows[1].uses, 1);
  assert.equal(rows[1].length, 60);
  assert.equal(loaded.sequence.videoTracks[0].clips[0].object.compId, id);
  assert.equal(env.engine.hasComps(loaded), true);
});

test("saving while a composition is open writes Main and the live composition", () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  env.tracks.selectedClips = [A, B];
  const { id } = env.engine.precompose(env.editor, "Intro");
  const mainBefore = JSON.parse(JSON.stringify(env.project.sequence));

  assert.equal(env.engine.openComp(env.editor, id).ok, true);
  assert.equal(env.engine.isEditing(env.project), true);
  addClip(env, 0, { start: 60, length: 10, name: "D" });

  const json = JSON.parse(JSON.stringify(env.project));
  assert.deepEqual(json.sequence.videoTracks, mainBefore.videoTracks, "Main is the snapshot, not the comp");
  const media = json.media.find((m) => m.comp.id === id);
  assert.deepEqual(media.data[0].clips.map((c) => c.properties.name), ["A", "B", "D"]);

  assert.equal(env.engine.openComp(env.editor, null).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(env.project.sequence)), mainBefore);
  const again = env.project.media.find((m) => m.comp.id === id);
  assert.equal(again.data[0].clips.length, 3, "edits made in the composition are kept");
});

test("switching compositions and back to Main keeps undo history empty", () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  env.tracks.selectedClips = [A, B];
  const { id } = env.engine.precompose(env.editor, "Intro");
  assert.ok(env.editor.history.undoStack.length > 0);
  env.engine.openComp(env.editor, id);
  assert.equal(env.editor.history.undoStack.length, 0);
  assert.equal(env.engine.activeName(env.editor), "Intro");
  env.engine.openComp(env.editor, null);
  assert.equal(env.engine.activeName(env.editor), null);
});

test("nested clips render at comp time = clip-local time + offset, in any order", () => {
  const env = createEnvironment();
  const data = [{ type: 0, clips: [clipJSON(0, 30, "P"), clipJSON(30, 30, "Q")] }];
  addCompMedia(env, "X", "X", data);
  addClip(env, 0, { start: 100, length: 60, compId: "X", offset: 0 });
  addClip(env, 0, { start: 200, length: 60, compId: "X", offset: 15 });

  // Each composition clip builds its own nested layers; label both instances.
  const track = env.project.sequence.videoTracks[0];
  const labels = new Map();
  track.clips.forEach((clip) => {
    clip.object.nestedTracks()[0].clips.forEach((child, i) => labels.set(child.object, i === 0 ? "P" : "Q"));
  });
  const names = (layer) => (layer ? layer.objects.map((o) => labels.get(o)) : null);
  const [first, second] = track.clips.map((clip) => clip.object);
  const P1 = first.nestedTracks()[0].clips[0].object;
  const P2 = second.nestedTracks()[0].clips[0].object;

  // [frame, expected active child, comp-time reasoning]
  const expected = [
    [215, "Q"], // offset 15 at start 200: comp time 30, so Q at local 0
    [110, "P"], // comp time 10 for the first clip: P at local 10
    [200, "P"], // offset 15: comp time 15, so P at local 15
    [130, "Q"], // comp time 30: Q at local 0
    [99, null], // before any composition clip
  ];
  // Read the active children at render time: the same layer objects are reused.
  const render = (order) => order.map(([t]) => {
    const layer = renderAt(env, t);
    return { t: t, names: names(layer) };
  });
  render(expected).forEach(({ t, names: got }, i) => {
    const want = expected[i][1];
    assert.deepEqual(got, want === null ? null : [want], "active child at " + t);
  });
  assert.equal(P1.updates.includes(10), true, "first P updated at local 10");
  assert.equal(P2.updates.at(-1), 15, "second P last updated at local 15");
  assert.equal(P2.updates.includes(15), true);

  // Reverse order yields identical active children.
  render(expected.slice().reverse()).reverse().forEach(({ t, names: got }, i) => {
    const want = expected[i][1];
    assert.deepEqual(got, want === null ? null : [want], "order-independent at " + t);
  });
});

test("nested video is scheduled at its mapped Main-time window", () => {
  const env = createEnvironment();
  addCompMedia(env, "X", "X", [{ type: 0, clips: [clipJSON(0, 30, "V", { hasMedia: true })] }]);
  addClip(env, 0, { start: 100, length: 20, compId: "X", offset: 10 });
  env.PZ.schedule.analyzeSequence(env.project.sequence);

  const proxy = env.project.sequence.lastVideoItems.find((item) => item.origin !== undefined);
  assert.ok(proxy, "a proxy item exists for the nested video clip");
  assert.equal(proxy.start, 100);
  assert.equal(proxy.length, 20, "window is clipped to the composition clip");
  const V = proxy.object;
  proxy.update(105);
  assert.equal(V.updates.at(-1), 15, "local time = frame - start + offset");
  assert.equal(proxy.properties.time.get(0), 10, "media time at window start");
});

test("a composition cannot contain itself, directly or through another composition", () => {
  const env = createEnvironment();
  addCompMedia(env, "X", "X", [{ type: 0, clips: [] }]);
  addCompMedia(env, "Y", "Y", [{ type: 0, clips: [clipJSON(0, 30, "ref", { compId: "X" })] }]);

  assert.equal(env.engine.openComp(env.editor, "X").ok, true);
  const direct = addClip(env, 0, { start: 0, length: 30, compId: "X" });
  env.tracks.selectedClips = [direct];
  let result = env.engine.precompose(env.editor, "Bad");
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot contain itself/);

  deleteClips(env, [direct]);
  const indirect = addClip(env, 0, { start: 0, length: 30, compId: "Y" });
  env.tracks.selectedClips = [indirect];
  result = env.engine.precompose(env.editor, "Bad");
  assert.equal(result.ok, false, "Y contains X, so X would contain itself");
  assert.match(result.message, /cannot contain itself/);
  assert.equal(env.project.media.length, 2, "no composition was created");
});

test("a composition used by a clip cannot be deleted; unused ones can", () => {
  const env = createEnvironment();
  const { A, B } = makeABSelection(env);
  env.tracks.selectedClips = [A, B];
  const { id } = env.engine.precompose(env.editor, "Intro");

  const refused = env.engine.removeComp(env.editor, id);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /used by 1 clip in Main/);

  const usedClip = env.project.sequence.videoTracks[0].clips[0];
  deleteClips(env, [usedClip]);
  assert.equal(env.engine.removeComp(env.editor, id).ok, true);
  assert.equal(env.engine.hasComps(env.project), false, "no compositions left to block disable");
});

test("deleting the open composition returns to Main first", () => {
  const env = createEnvironment();
  addCompMedia(env, "U", "Unused", [{ type: 0, clips: [clipJSON(0, 30, "u")] }]);
  assert.equal(env.engine.openComp(env.editor, "U").ok, true);
  assert.equal(env.engine.removeComp(env.editor, "U").ok, true);
  assert.equal(env.engine.isEditing(env.project), false);
  assert.equal(env.project.media.length, 0);
});

test("duplicate copies data under a new id; rename enforces unique names", () => {
  const env = createEnvironment();
  addCompMedia(env, "X", "Intro", [{ type: 0, clips: [clipJSON(0, 30, "a")] }]);
  addCompMedia(env, "Z", "Outro", [{ type: 0, clips: [] }]);

  const copy = env.engine.duplicateComp(env.editor, "X");
  assert.equal(copy.ok, true);
  assert.notEqual(copy.id, "X");
  const dup = env.project.media.find((m) => m.comp.id === copy.id);
  assert.equal(dup.properties.name.v, "Intro copy");
  assert.deepEqual(dup.data, env.project.media.find((m) => m.comp.id === "X").data);

  assert.equal(env.engine.renameComp(env.editor, copy.id, "Outro").ok, false);
  assert.equal(env.engine.renameComp(env.editor, copy.id, "Credits").ok, true);
  assert.equal(dup.properties.name.v, "Credits");
});

test("composition clips that carry footage keep the footage through a round trip", async () => {
  const env = createEnvironment();
  addCompMedia(env, "X", "X", [{ type: 0, clips: [clipJSON(0, 30, "V", { hasMedia: true })] }]);
  addClip(env, 0, { start: 0, length: 30, compId: "X" });
  const loaded = await reloadProject(env, JSON.parse(JSON.stringify(env.project)));
  const editor = new env.PZ.Editor(loaded);
  assert.equal(env.engine.entries(editor)[1].length, 30);
  const track = loaded.sequence.videoTracks[0];
  assert.equal(track.clips[0].object.compId, "X");
});

test("Media panel deletion guards references in Main and compositions and restores on uninstall", () => {
  const env = createEnvironment();
  env.uninstall();
  const calls = [];
  class MediaPanel {
    deleteMedia(params) {
      calls.push(params.address);
      assert.ok(this.editor.history.operation, "native deletion keeps its history operation");
      this.editor.history.pushCommand(() => {}, {});
      this.editor.project.media.splice(params.address[1], 1);
      return "deleted";
    }
  }
  env.PZ.ui.media = MediaPanel;
  const original = MediaPanel.prototype.deleteMedia;
  const uninstall = env.engine.install();
  const panel = new MediaPanel();
  panel.editor = env.editor;
  const previousAlert = globalThis.alert;
  const messages = [];
  globalThis.alert = (message) => messages.push(message);
  try {
    addCompMedia(env, "X", "Intro", [{ type: 0, clips: [] }]);
    addCompMedia(env, "Y", "Outer", [{ type: 0, clips: [clipJSON(0, 30, "Nested", { compId: "X" })] }]);
    addClip(env, 0, { start: 0, length: 30, compId: "X" });
    panel.deleteMedia({ address: ["media", 0] });
    assert.equal(calls.length, 0);
    assert.match(messages[0], /Main.*Outer/);
    env.engine.openComp(env.editor, "Y");
    panel.deleteMedia({ address: ["media", 0] });
    assert.equal(calls.length, 0, "checks Main's saved tracks while a comp is open");
    env.engine.openComp(env.editor, null);
    const unused = addCompMedia(env, "Z", "Unused", [{ type: 0, clips: [] }]);
    env.engine.openComp(env.editor, "Z");
    env.editor.history.startOperation();
    assert.equal(panel.deleteMedia({ address: ["media", env.project.media.indexOf(unused)] }), "deleted");
    env.editor.history.finishOperation();
    assert.equal(env.engine.isEditing(env.project), false);
  } finally {
    globalThis.alert = previousAlert;
    uninstall();
  }
  assert.equal(MediaPanel.prototype.deleteMedia, original);
});

test("video and frame exports block an open comp at options and Start, leaving Main export intact", () => {
  const env = createEnvironment();
  env.uninstall();
  class ExportUI {
    createOptionsPage() { return "options"; }
    createProgressPage() { return "started"; }
  }
  const options = ExportUI.prototype.createOptionsPage;
  const progress = ExportUI.prototype.createProgressPage;
  env.PZ.ui.export = { device: ExportUI, frame: class extends ExportUI {} };
  env.PZ.ui.controls = { legacy: { generateDescription: ({ content }) => content } };
  const uninstall = env.engine.install();
  try {
    addCompMedia(env, "X", "Intro", [{ type: 0, clips: [] }]);
    for (const kind of ["device", "frame"]) {
      const exporter = new env.PZ.ui.export[kind]();
      exporter.editor = env.editor;
      exporter.export = { createPage: () => ({ appendChild(text) { this.message = text; } }) };
      assert.equal(exporter.createOptionsPage(), "options");
      env.engine.openComp(env.editor, "X");
      assert.match(exporter.createOptionsPage().message, /Return to Main/);
      assert.match(exporter.createProgressPage().message, /Return to Main/);
      assert.equal(env.engine.isEditing(env.project), true, "blocking does not change the live timeline");
      env.engine.openComp(env.editor, null);
      assert.equal(exporter.createProgressPage(), "started");
    }
  } finally { uninstall(); }
  assert.equal(ExportUI.prototype.createOptionsPage, options);
  assert.equal(ExportUI.prototype.createProgressPage, progress);
  assert.equal(Object.hasOwn(env.PZ.ui.export.frame.prototype, "createOptionsPage"), false);
  assert.equal(Object.hasOwn(env.PZ.ui.export.frame.prototype, "createProgressPage"), false);
});


test("finds the timeline through native window split panels before any timeline event", () => {
  const env = createEnvironment();
  env.uninstall();
  env.editor.windows = [{ panel: { panels: [{ panels: [env.editor.timeline] }] } }];
  delete env.editor.timeline;
  const uninstall = env.engine.install();
  try {
    assert.equal(env.engine.selectionSummary(env.editor).ready, true);
  } finally { uninstall(); }
});

test("composition saves declare the plugin requirement, including while editing a comp", () => {
  const env = createEnvironment();
  assert.equal(env.project.toJSON().plugins, undefined);
  addCompMedia(env, "X", "Intro", [{ type: 0, clips: [] }]);
  let json = env.project.toJSON();
  assert.equal(json.plugins.filter((plugin) => plugin.id === "precomp-plus").length, 1);
  assert.deepEqual(json.plugins[0].features, ["compositions"]);
  env.engine.openComp(env.editor, "X");
  json = env.project.toJSON();
  assert.equal(json.plugins.filter((plugin) => plugin.id === "precomp-plus").length, 1);
});

test("uninstall disables hooks even when another plugin wraps above them", () => {
  const env = createEnvironment();
  addCompMedia(env, "X", "Intro", [{ type: 0, clips: [] }]);
  const ours = env.PZ.media.prototype.toJSON;
  env.PZ.media.prototype.toJSON = function () { return ours.apply(this, arguments); };
  assert.equal(env.project.media[0].toJSON().comp.id, "X");
  env.uninstall();
  assert.equal(env.project.media[0].toJSON().comp, undefined);
});
