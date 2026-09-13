"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  PATCH_MARKER,
  ZOOM_MULTIPLIER,
  FRAME_TIME_FORMAT,
  applyTimelineDefaults,
  installTimelineDefaults,
} = require("../plugins/core/videoeditor-timeline-defaults");

const projectRoot = path.resolve(__dirname, "..");
const patchSource = fs.readFileSync(
  path.join(projectRoot, "plugins", "core", "videoeditor-timeline-defaults.js"),
  "utf8"
);

// Video Editor 2 builds its timeline with `new PZ.ui.timeline(VE)` and assigns
// `zoom = .012` afterwards, so the fixture mirrors that order.
const VIDEOEDITOR_ZOOM = 0.012;

function createLayout() {
  const records = { timelines: [], calls: 0, statics: null };

  function Timeline(editorInstance) {
    this.editorInstance = editorInstance;
    this.zoom = 1;
    this.timeFormat = 0;
    records.timelines.push(this);
  }
  Timeline.tracks = { marker: "tracks" };
  Timeline.keyframes = { marker: "keyframes" };

  const ui = { timeline: Timeline };
  const editor = {};
  const other = {};

  editor.setUpEditor = function setUpEditor() {
    records.calls += 1;
    records.constructorDuringSetup = ui.timeline;
    records.statics = { tracks: ui.timeline.tracks, keyframes: ui.timeline.keyframes };
    const main = new ui.timeline(editor);
    main.zoom = VIDEOEDITOR_ZOOM;
    new ui.timeline(other);
    return "setup-result";
  };

  return { records, Timeline, ui, editor, other };
}

test("Video Editor setup starts wider and in frame numbers", () => {
  const layout = createLayout();
  assert.equal(installTimelineDefaults(layout.editor, layout.ui, "videoeditor"), true);

  const result = layout.editor.setUpEditor();

  assert.equal(result, "setup-result", "setup still returns its own value");
  assert.equal(layout.records.calls, 1);
  const main = layout.records.timelines[0];
  assert.equal(main.timeFormat, FRAME_TIME_FORMAT);
  assert.equal(main.timeFormat, 2, "matches Clipmaker 3's raw frame numbers");
  assert.equal(main.zoom, VIDEOEDITOR_ZOOM * ZOOM_MULTIPLIER);
  assert.equal(main.zoom, 0.36, "30x the Video Editor default width");
  assert.equal(layout.editor[PATCH_MARKER], true);
});

test("the original timeline constructor is restored after setup", () => {
  const layout = createLayout();
  installTimelineDefaults(layout.editor, layout.ui, "videoeditor");

  layout.editor.setUpEditor();

  assert.notEqual(
    layout.records.constructorDuringSetup,
    layout.Timeline,
    "the proxy replaces the constructor while setup runs"
  );
  assert.equal(layout.ui.timeline, layout.Timeline, "the constructor is restored afterwards");
  assert.deepEqual(layout.records.statics, {
    tracks: layout.Timeline.tracks,
    keyframes: layout.Timeline.keyframes,
  });
});

test("timelines belonging to another editor are left alone", () => {
  const layout = createLayout();
  installTimelineDefaults(layout.editor, layout.ui, "videoeditor");
  layout.editor.setUpEditor();

  const secondary = layout.records.timelines[1];
  assert.equal(secondary.editorInstance, layout.other);
  assert.equal(secondary.zoom, 1);
  assert.equal(secondary.timeFormat, 0);
});

test("Clipmaker is not patched", () => {
  const layout = createLayout();
  const original = layout.editor.setUpEditor;

  assert.equal(installTimelineDefaults(layout.editor, layout.ui, "clipmaker"), false);
  assert.equal(layout.editor.setUpEditor, original);
  assert.equal(layout.editor[PATCH_MARKER], undefined);
});

test("the patch installs once per editor", () => {
  const layout = createLayout();
  assert.equal(installTimelineDefaults(layout.editor, layout.ui, "videoeditor"), true);
  const wrapped = layout.editor.setUpEditor;

  assert.equal(installTimelineDefaults(layout.editor, layout.ui, "videoeditor"), false);
  assert.equal(layout.editor.setUpEditor, wrapped, "setUpEditor is wrapped once");

  layout.editor.setUpEditor();
  assert.equal(layout.records.timelines[0].zoom, 0.36, "the zoom is scaled once");
});

test("install refuses an incomplete runtime", () => {
  assert.equal(installTimelineDefaults(null, {}, "videoeditor"), false);
  assert.equal(installTimelineDefaults({}, { timeline() {} }, "videoeditor"), false);
  assert.equal(installTimelineDefaults({ setUpEditor() {} }, {}, "videoeditor"), false);
  assert.equal(installTimelineDefaults({ setUpEditor() {} }, { timeline: 1 }, "videoeditor"), false);
});

test("applyTimelineDefaults keeps a non-numeric zoom but still switches the format", () => {
  const timeline = { zoom: undefined, timeFormat: 0 };

  assert.equal(applyTimelineDefaults(timeline), true);
  assert.equal(timeline.timeFormat, FRAME_TIME_FORMAT);
  assert.equal(timeline.zoom, undefined);
  assert.equal(applyTimelineDefaults(timeline), false, "applied once per timeline");
});

test("the script self-installs on a Video Editor page", () => {
  const context = { ZOIDIUM_LAYOUT: "videoeditor" };
  context.window = context;

  function Timeline(editorInstance) {
    this.editorInstance = editorInstance;
    this.zoom = 1;
    this.timeFormat = 0;
  }
  context.PZ = { ui: { timeline: Timeline } };
  context.VE = {
    setUpEditor() {
      this.timeline = new context.PZ.ui.timeline(context.VE);
      this.timeline.zoom = VIDEOEDITOR_ZOOM;
    },
  };

  vm.runInNewContext(patchSource, context);
  context.VE.setUpEditor();

  assert.equal(context.VE.timeline.zoom, 0.36);
  assert.equal(context.VE.timeline.timeFormat, 2);
  assert.equal(context.VE.__zoidiumVideoEditorTimelineDefaultsPatch, true);
  assert.equal(context.PZ.ui.timeline, Timeline, "the constructor is restored");
});

test("the script leaves a Clipmaker page untouched", () => {
  const original = function setUpEditor() {};
  const context = { ZOIDIUM_LAYOUT: "clipmaker" };
  context.window = context;
  context.PZ = { ui: { timeline: function Timeline() {} } };
  context.VE = { setUpEditor: original };

  vm.runInNewContext(patchSource, context);

  assert.equal(context.VE.setUpEditor, original);
  assert.equal(context.VE.__zoidiumVideoEditorTimelineDefaultsPatch, undefined);
});

// The patch mirrors two defaults the CM3 layouts ship. These checks read the
// real bundles from the Git-ignored resource cache so an upstream change to
// either default fails here instead of silently showing the wrong ruler.
// The cache is optional (pnpm run setup downloads it), so they skip when the
// bundles are absent.

function loadCm3() {
  const files = {
    ui: "ui-1.0.72.js",
    videoeditor: "videoeditor-2.0.69.js",
    clipmaker: "clipmaker-3.0.106.js",
  };
  const loaded = {};
  for (const [key, name] of Object.entries(files)) {
    const filePath = path.join(projectRoot, ".zoidium-resources", name);
    if (!fs.existsSync(filePath)) return null;
    loaded[key] = fs.readFileSync(filePath, "utf8");
  }
  return loaded;
}

// Pull one `PZ.x.prototype.y = function ... {}` out of a single-line bundle by
// brace matching from the assignment, so the real minified body runs.
function extractFunction(source, assignment) {
  const start = source.indexOf(assignment);
  assert.notEqual(start, -1, `bundle contains ${assignment}`);
  const bodyStart = source.indexOf("{", start + assignment.length);
  assert.notEqual(bodyStart, -1, `${assignment} has a body`);
  let depth = 0;
  let inString = null;
  for (let cursor = bodyStart; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (inString) {
      if (character === "\\") cursor += 1;
      else if (character === inString) inString = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      inString = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  throw new Error(`unterminated body for ${assignment}`);
}

const cm3 = loadCm3();

test("CM3 formatTime returns frame numbers for timeFormat 2", { skip: !cm3 }, () => {
  const prototype = {};
  const define = new Function(
    "PZ",
    extractFunction(cm3.ui, "PZ.ui.timeline.prototype.formatTime=function")
  );
  define({ ui: { timeline: { prototype } } });

  const frameRate = 30;
  const format = (timeFormat, seconds) =>
    prototype.formatTime.call({ timeFormat, editor: { playback: { frameRate } } }, seconds);

  assert.equal(format(2, 2.5), 75, "timeFormat 2 is the raw frame number");
  assert.equal(format(0, 60), "00:01:00.000", "the Video Editor default renders timecode");
  assert.equal(format(1, 60), "00:01:00:00", "timeFormat 1 renders HH:MM:SS:FF");
});

test("the layouts still ship the defaults this patch mirrors", { skip: !cm3 }, () => {
  assert.match(cm3.videoeditor, /\.zoom=\.012\b/, "Video Editor 2 zooms its timeline to .012");
  assert.match(cm3.clipmaker, /\.timeFormat=2\b/, "Clipmaker 3 asks for frame numbers");
});
