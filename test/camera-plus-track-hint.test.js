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

// Minimal fake DOM: createElement returns a node with the list operations,
// parent links, and style bag the control uses.
function fakeDocument() {
  function node(tag) {
    const el = {
      tagName: String(tag || "div").toUpperCase(),
      className: "",
      children: [],
      parentNode: null,
      firstChild: null,
      innerText: "",
      style: {},
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
      closest(selector) {
        const sel = String(selector || "");
        if (sel.charAt(0) === ".") {
          const want = sel.slice(1);
          let at = this;
          while (at) {
            if (String(at.className || "").split(/\s+/).includes(want)) return at;
            at = at.parentNode;
          }
          return null;
        }
        const wantTag = sel.toUpperCase();
        let at = this;
        while (at) {
          if (at.tagName === wantTag) return at;
          at = at.parentNode;
        }
        return null;
      },
    };
    Object.defineProperty(el, "parentElement", { get() { return el.parentNode; }, configurable: true });
    return el;
  }
  return { createElement: (tag) => node(tag) };
}

// Object-tree skeleton around the Camera+ property list: UL.tree with the
// object's header row followed by the property UL, as the editor builds it.
function buildPanel(document) {
  const tree = document.createElement("ul");
  tree.className = "tree";
  const header = document.createElement("li");
  header.className = "parent toplevel";
  tree.appendChild(header);
  const list = document.createElement("ul");
  tree.appendChild(list);
  const activeRow = document.createElement("li");
  list.appendChild(activeRow);
  const focusRow = document.createElement("li");
  list.appendChild(focusRow);
  return { tree, header, list, activeRow, focusRow };
}

function topHintOf(list) {
  return list.children.find((child) => String(child.className || "").split(/\s+/).includes("zoidium-camera-track-hint-top")) || null;
}

function drainTasks() {
  return new Promise((resolve) => setImmediate(resolve));
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

test("panel shows a top-row note, one toast, and the enable button; 3D hides it", async () => {
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

    // Capture notes, buttons, and toasts through the harness UI fakes.
    const doc = fakeDocument();
    const notes = [];
    const clicked = [];
    const toasts = [];
    const originalNote = ctx.zoidiumUI.controls.note;
    const originalButton = ctx.zoidiumUI.controls.button;
    ctx.zoidiumUI.controls.note = (message, variant) => {
      notes.push(message);
      return originalNote(message, variant);
    };
    ctx.zoidiumUI.controls.button = (options) => {
      clicked.push(options);
      return originalButton(options);
    };
    ctx.context.ui.notify = (detail) => toasts.push(detail);

    // The Focus row itself carries only the focus buttons, exactly as
    // without the guidance: no note elements inside it.
    const panel = buildPanel(doc);
    const wrap = spec.create(property, { document: doc });
    assert.ok(wrap, "control built");
    assert.equal(wrap.children.length, 1, "focus row holds only the button row");
    assert.equal(toasts.length, 1, "one toast on first panel");
    assert.equal(toasts[0].title, "Camera+");
    assert.equal(notes.length, 0, "top row syncs after the row attaches to the panel");

    // Attaching the row and refreshing (as the panel build does) prepends
    // the hint as the first row of the property list.
    panel.focusRow.appendChild(wrap);
    await drainTasks();
    if (typeof wrap.pz_refresh === "function") wrap.pz_refresh();
    const top = topHintOf(panel.list);
    assert.ok(top, "hint row prepended to the property list");
    assert.equal(panel.list.firstChild, top, "hint is the first row, above the camera properties");
    assert.equal(top.style.maxWidth, "100%", "no scroller in the fake panel: row fills its list");
    assert.equal(notes.length, 1, "one hint note while no 3D track");
    assert.ok(notes[0].includes("3D"), "note names the toggle");
    const enable = clicked.find((options) => /^Enable 3D on track/.test(options.title));
    assert.ok(enable, "one-click enable button present");
    assert.equal(enable.title, "Enable 3D on track 1");

    // Second panel for the same project: note again, but no second toast.
    const panel2 = buildPanel(doc);
    const wrap2 = spec.create(property, { document: doc });
    panel2.focusRow.appendChild(wrap2);
    await drainTasks();
    if (typeof wrap2.pz_refresh === "function") wrap2.pz_refresh();
    assert.ok(topHintOf(panel2.list), "persistent note on every panel");
    assert.equal(toasts.length, 1, "toast stays once per project");

    // The one-click button uses the track header's undoable toggle, and the
    // top row disappears without reselecting.
    ctx.editor.log.length = 0;
    enable.onClick();
    assert.equal(track.track3d, true, "toggle applied");
    assert.deepEqual(ctx.editor.log.map((entry) => entry[0]).slice(0, 2), ["start", "finish"], "one history operation");
    assert.equal(topHintOf(panel.list), null, "hint row removed after enabling 3D");

    // Undo surfaces the stale flag again: a panel refresh brings the row back.
    track.track3d = false;
    if (typeof wrap.pz_refresh === "function") wrap.pz_refresh();
    assert.ok(topHintOf(panel.list), "hint row back after undo");

    // With 3D on, fresh panels carry no hint and no toast.
    track.track3d = true;
    notes.length = 0;
    const panel3 = buildPanel(doc);
    const clean = spec.create(property, { document: doc });
    panel3.focusRow.appendChild(clean);
    await drainTasks();
    if (typeof clean.pz_refresh === "function") clean.pz_refresh();
    assert.equal(topHintOf(panel3.list), null, "hint hidden once a 3D track exists");
    assert.equal(notes.length, 0);
    assert.equal(toasts.length, 1);
    assert.ok(clean, "focus buttons still built");
  } finally {
    runtime.deactivate();
    delete globalThis.CM;
  }
});

test("the top row caps its width at the visible scroller", async () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  try {
    globalThis.CM = ctx.editor;
    ctx.project.sequence = { videoTracks: [{ track3d: false, clips: [] }] };
    const scene = new ctx.PZ.layer.scene();
    const cameraPlus = scene.push(ctx.registry.instantiate(TYPE));
    const property = cameraPlus.properties.depthOfField.focusTools;
    const spec = ctx.apis.propertyControls.registered.get(CONTROL_ID);
    ctx.context.ui.notify = () => {};
    const doc = fakeDocument();
    const scroller = doc.createElement("div");
    scroller.className = "editorpanel";
    scroller.clientWidth = 300;
    const tree = doc.createElement("ul");
    tree.className = "tree";
    scroller.appendChild(tree);
    tree.appendChild(doc.createElement("li"));
    const list = doc.createElement("ul");
    tree.appendChild(list);
    const focusRow = doc.createElement("li");
    list.appendChild(focusRow);
    const wrap = spec.create(property, { document: doc });
    focusRow.appendChild(wrap);
    await drainTasks();
    if (typeof wrap.pz_refresh === "function") wrap.pz_refresh();
    assert.equal(topHintOf(list).style.maxWidth, "300px", "row wraps inside the visible width");
    scroller.clientWidth = 220;
    if (typeof wrap.pz_refresh === "function") wrap.pz_refresh();
    assert.equal(topHintOf(list).style.maxWidth, "220px", "refresh follows the scroller width");
  } finally {
    runtime.deactivate();
    delete globalThis.CM;
  }
});

test("the top row is skipped outside the object tree", async () => {
  const ctx = harness.createContext();
  const runtime = harness.loadRuntime();
  runtime.activate(ctx.context);
  try {
    globalThis.CM = ctx.editor;
    ctx.project.sequence = { videoTracks: [{ track3d: false, clips: [] }] };
    const scene = new ctx.PZ.layer.scene();
    const cameraPlus = scene.push(ctx.registry.instantiate(TYPE));
    const property = cameraPlus.properties.depthOfField.focusTools;
    const spec = ctx.apis.propertyControls.registered.get(CONTROL_ID);
    const toasts = [];
    ctx.context.ui.notify = (detail) => toasts.push(detail);
    // A nested group list, not the object tree: the note must not land in an
    // unrelated row, while the toast still fires once.
    const doc = fakeDocument();
    const group = doc.createElement("ul");
    const focusRow = doc.createElement("li");
    group.appendChild(focusRow);
    const wrap = spec.create(property, { document: doc });
    focusRow.appendChild(wrap);
    await drainTasks();
    if (typeof wrap.pz_refresh === "function") wrap.pz_refresh();
    assert.equal(group.children.length, 1, "no row injected into a nested list");
    assert.equal(toasts.length, 1, "toast still fires when the row cannot be placed");
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
