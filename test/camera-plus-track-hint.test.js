"use strict";

// Camera+ 3D-track guidance: detection logic and the property-panel hint.
// A Camera+ only drives layers on video tracks with 3D enabled, so while no
// video track has 3D on, the Camera+ panel shows a note (plus a one-click
// button through the track header's own undoable toggle) and the project
// gets one toast. Nothing is serialized and rendering is untouched.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const harness = require("./camera-plus-harness.js");

const TYPE = "zoidium:camera-plus/camera";
const CONTROL_ID = "camera-plus/focus-tools";

function loadHintPart() {
  const parts = {};
  const source = fs.readFileSync(path.join(harness.pluginDir, "track-hint.js"), "utf8");
  vm.runInNewContext(source, { parts });
  return parts.hint;
}

function projectWithTracks(flags) {
  return { sequence: { videoTracks: flags.map((track3d) => ({ track3d, clips: [] })) } };
}

// Minimal fake DOM: createElement returns a node with the list operations the
// control uses.
function fakeDocument() {
  function node() {
    return {
      className: "",
      children: [],
      parentNode: null,
      firstChild: null,
      innerText: "",
      appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        if (!this.firstChild) this.firstChild = child;
        return child;
      },
      insertBefore(child, before) {
        child.parentNode = this;
        const at = this.children.indexOf(before);
        this.children.splice(at < 0 ? 0 : at, 0, child);
        this.firstChild = this.children[0] || null;
        return child;
      },
      removeChild(child) {
        const at = this.children.indexOf(child);
        if (at >= 0) this.children.splice(at, 1);
        child.parentNode = null;
        this.firstChild = this.children[0] || null;
        return child;
      },
    };
  }
  return { createElement: () => node() };
}

test("detection reads only the live track3d flags", () => {
  const hint = loadHintPart();
  assert.equal(hint.needsHint(null), false);
  assert.equal(hint.needsHint({}), false, "no sequence, no hint");
  assert.equal(hint.needsHint({ sequence: {} }), false, "no tracks, no hint");
  assert.equal(hint.needsHint(projectWithTracks([])), false);
  assert.equal(hint.needsHint(projectWithTracks([false, false])), true);
  assert.equal(hint.needsHint(projectWithTracks([false, true])), false);
  assert.equal(hint.needsHint(projectWithTracks([true])), false);
  assert.equal(hint.projectHas3DTrack(projectWithTracks([0, ""])), false);
  assert.equal(hint.firstTrackWithout3D(projectWithTracks([true, false, false])).number, 2);
  assert.equal(hint.firstTrackWithout3D(projectWithTracks([true])), null);
  assert.equal(hint.enableLabel({ number: 2 }), "Enable 3D on track 2");
});

test("maybeNotify fires once per project and stays silent with 3D on", () => {
  const hint = loadHintPart();
  const seen = [];
  const host = (project, notified) => ({
    getProject: () => project,
    notify: (detail) => seen.push(detail),
    notified,
  });
  const plain = projectWithTracks([false]);
  const notified = new Set();
  assert.equal(hint.maybeNotify(host(plain, notified)), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].title, "Camera+");
  assert.ok(seen[0].message.includes("3D"), "message names the toggle");
  assert.equal(hint.maybeNotify(host(plain, notified)), false, "second panel, same project: silent");
  assert.equal(seen.length, 1);
  assert.equal(hint.maybeNotify(host(projectWithTracks([false]), notified)), true, "a new project is notified");
  assert.equal(hint.maybeNotify(host(projectWithTracks([true]), new Set())), false);
  assert.equal(hint.maybeNotify(host({}, new Set())), false);
  assert.equal(hint.maybeNotify(null), false);
  assert.equal(hint.maybeNotify({}), false, "no getProject, no crash");
});

test("a throwing toast still marks the project as notified", () => {
  const hint = loadHintPart();
  const notified = new Set();
  const project = projectWithTracks([false]);
  assert.equal(hint.maybeNotify({
    getProject: () => project,
    notify: () => { throw new Error("toasts unavailable"); },
    notified,
  }), true);
  assert.equal(notified.has(project), true);
});

test("panel shows the note, one toast, and the enable button; 3D hides the hint", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  try {
    globalThis.CM = ctx.editor;
    const track = { track3d: false, clips: [] };
    ctx.project.sequence = { videoTracks: [track] };
    ctx.project.ui = ctx.project.ui || {};
    const scene = new ctx.PZ.layer.scene();
    const cameraPlus = scene.push(ctx.registry.instantiate(TYPE));
    const property = cameraPlus.properties.depthOfField.focusTools;
    const spec = ctx.apis.propertyControls.registered.get(CONTROL_ID);
    assert.ok(spec, "focus control registered");

    // Capture notes, button rows, and toasts through the harness UI fakes.
    const notes = [];
    const buttonRows = [];
    const toasts = [];
    const originalNote = ctx.zoidiumUI.controls.note;
    const originalButtonRow = ctx.zoidiumUI.controls.buttonRow;
    ctx.zoidiumUI.controls.note = (message, variant) => {
      notes.push(message);
      return originalNote(message, variant);
    };
    ctx.zoidiumUI.controls.buttonRow = (buttons) => {
      buttonRows.push(buttons);
      return originalButtonRow(buttons);
    };
    ctx.context.ui.notify = (detail) => toasts.push(detail);

    const wrap = spec.create(property, { document: fakeDocument() });
    assert.ok(wrap, "control built");
    assert.equal(notes.length, 1, "one hint note while no 3D track");
    assert.ok(notes[0].includes("3D"), "note names the toggle");
    assert.equal(toasts.length, 1, "one toast on first panel");
    assert.equal(toasts[0].title, "Camera+");
    const enableRow = buttonRows.find((buttons) => buttons.some((b) => /^Enable 3D on track/.test(b.title)));
    assert.ok(enableRow, "one-click enable button present");
    assert.equal(enableRow[0].title, "Enable 3D on track 1");

    // Second panel for the same project: note again, but no second toast.
    spec.create(property, { document: fakeDocument() });
    assert.equal(notes.length, 2, "persistent note on every panel");
    assert.equal(toasts.length, 1, "toast stays once per project");

    // The one-click button uses the track header's undoable toggle.
    ctx.editor.log.length = 0;
    enableRow[0].onClick();
    assert.equal(track.track3d, true, "toggle applied");
    assert.deepEqual(ctx.editor.log.map((entry) => entry[0]).slice(0, 2), ["start", "finish"], "one history operation");

    // With 3D on, fresh panels carry no hint and no toast.
    notes.length = 0;
    const clean = spec.create(property, { document: fakeDocument() });
    assert.equal(notes.length, 0, "hint hidden once a 3D track exists");
    assert.equal(toasts.length, 1);
    assert.ok(clean, "focus buttons still built");
  } finally {
    runtime.deactivate();
    delete globalThis.CM;
  }
});

test("disabling the plugin removes the hint control with everything else", () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  assert.ok(ctx.apis.propertyControls.registered.has(CONTROL_ID));
  runtime.deactivate();
  assert.equal(ctx.apis.propertyControls.registered.has(CONTROL_ID), false);
});

test("track-hint copy is English-only and render/save neutral", () => {
  const hintSource = harness.readPluginSource("track-hint.js");
  assert.equal(/window\.ZoidiumI18n/.test(hintSource), false);
  for (const pattern of [/Math\.random/, /Date\.now|performance\.now|requestAnimationFrame/, /document\.body\.appendChild/, /window\.open\(/, /toJSON|properties\.add/]) {
    assert.equal(pattern.test(hintSource), false, "track-hint.js must not match " + pattern);
  }
  const focusSource = harness.readPluginSource("focus-ui.js");
  assert.equal(/properties\.add/.test(focusSource), false, "hint adds no serialized property");
});
