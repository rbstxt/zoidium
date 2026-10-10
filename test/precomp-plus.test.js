"use strict";

// Precomp+ runtime: the Comps tab, the Compositions window and the Pre-compose
// dialog, driven through a fake ZoidiumUI and document. Covers window
// open/close, the disable guard and disposal restoring the host.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createPZ, projectRoot } = require("./precomp-fixtures.js");

const runtimePath = path.join(projectRoot, "plugins/precomp-plus/precomp-runtime.js");

function fakeElement(tag) {
  const classes = new Set();
  const el = {
    tagName: tag,
    children: [],
    className: "",
    innerText: "",
    title: "",
    value: "",
    style: {},
    attrs: {},
    listeners: {},
    _text: "",
    appendChild(child) { el.children.push(child); return child; },
    remove() { el.removed = true; },
    focus() {},
    contains(target) { return target === el || el.children.indexOf(target) >= 0; },
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    setAttribute(key, value) { el.attrs[key] = value; },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    querySelector(selector) {
      if (selector === "input") return (el._input = el._input || fakeElement("input"));
      if (selector === "span") return (el._span = el._span || fakeElement("span"));
      return null;
    },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, "textContent", {
    get() { return el._text; },
    set(value) {
      el._text = String(value);
      if (el._text === "") el.children = [];
    },
  });
  return el;
}

function fakeDocument() {
  const listeners = {};
  const body = fakeElement("body");
  return {
    body: body,
    listeners: listeners,
    createElement: fakeElement,
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((held) => held !== fn);
    },
  };
}

function findButton(root, title) {
  const stack = [root];
  while (stack.length) {
    const node = stack.shift();
    if (node.specs) {
      const hit = node.specs.find((spec) => spec.title === title);
      if (hit) return hit;
    }
    (node.children || []).forEach((child) => stack.push(child));
  }
  return null;
}

function createHarness() {
  const PZ = createPZ();
  PZ.ui.properties = class {
    constructor(editor) { this.editor = editor; }
    setValue({ property, value, oldValue }) {
      const previous = oldValue !== undefined ? oldValue : property.get();
      property.set(value);
      this.editor.history.pushCommand((p) => p.property.set(p.value), { property: property, value: previous });
    }
  };
  const project = new PZ.project();
  project.sequence.videoTracks.push(new PZ.track.video());
  const editor = new PZ.Editor(project);
  const notes = [];
  const windows = [];
  const tabs = [];
  const panels = [];
  const document = fakeDocument();
  const controls = {
    note(message, variant) {
      const el = fakeElement("p");
      el.className = "zoidium-note" + (variant ? " " + variant : "");
      el.textContent = message;
      notes.push(el);
      return { element: el };
    },
    text(options) {
      const el = fakeElement("div");
      el.opts = options;
      return { element: el };
    },
    list(options) {
      const el = fakeElement("ul");
      el.opts = options;
      return { element: el };
    },
    buttonRow(specs) {
      const el = fakeElement("div");
      el.specs = specs;
      return { element: el };
    },
  };
  const kit = {
    controls,
    notify(detail) { kit.notified.push(detail); },
    notified: [],
    createPageHeader(text) { const el = fakeElement("div"); el.textContent = text; return el; },
    createMenubarTab(options) {
      const tab = fakeElement("a");
      tab.opts = options;
      tab.span = fakeElement("span");
      tab.querySelector = (selector) => (selector === "span" ? tab.span : null);
      tabs.push(tab);
      panels.push(options.panel);
      return tab;
    },
    removeMenubarTab(tab) { tab.removed = true; },
    openWindow(options) {
      const win = {
        id: options.id,
        options: options,
        open: true,
        subtitle: options.subtitle,
        body: fakeElement("div"),
        isOpen() { return this.open; },
        setSubtitle(value) { this.subtitle = value; },
        focus() {},
        close() {
          if (!this.open) return;
          this.open = false;
          (this.cleanups || []).forEach((fn) => fn());
        },
      };
      windows.push(win);
      const cleanup = options.mount ? options.mount(win.body, win) : null;
      win.cleanups = typeof cleanup === "function" ? [cleanup] : [];
      return win;
    },
    getWindow(id) {
      return windows.find((win) => win.id === id && win.open) || null;
    },
  };
  const lifecycle = { cleanups: [], onDispose(fn) { this.cleanups.push(fn); return fn; }, async dispose() { for (const fn of this.cleanups.splice(0).reverse()) await fn(); } };
  // The host closes plugin-owned windows on disposal.
  lifecycle.onDispose(() => windows.forEach((win) => { if (win.open) win.close(); }));
  const context = {
    PZ: PZ,
    editor: editor,
    document: document,
    window: { ZoidiumUI: kit, confirm: () => true },
    lifecycle: lifecycle,
    getAsset(kind, url) {
      const file = String(url).replace(/^\.\//, "").split(/[?#]/, 1)[0];
      return fs.readFileSync(path.join(projectRoot, file), "utf8");
    },
    ui: {
      openWindow(options) { return kit.openWindow(Object.assign({}, options, { id: "precomp-plus:" + options.id })); },
      getWindow(id) { return kit.getWindow("precomp-plus:" + id); },
      controls: controls,
      // Mirrors ZoidiumUI.createSidePanel: a standard panel inside a menubar
      // tab, removed on disposal like every context.ui registration.
      sidePanel(options) {
        const panel = fakeElement("div");
        panel.appendChild(kit.createPageHeader(options.title));
        const body = fakeElement("div");
        panel.appendChild(body);
        const tab = kit.createMenubarTab({ title: options.tabTitle || options.title, icon: options.icon, panel, tabClass: options.tabClass, position: options.position });
        lifecycle.onDispose(() => kit.removeMenubarTab(tab));
        return { element: panel, body, tab, remove() { kit.removeMenubarTab(tab); } };
      },
    },
  };
  return { PZ, project, editor, tracks: editor.timeline.tracks, kit, context, windows, tabs, panels, notes, lifecycle, document };
}

function loadModule() {
  const source = fs.readFileSync(runtimePath, "utf8");
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

function addVideo(h, start, length, name) {
  const clip = new h.PZ.Clip(0);
  clip.start = start;
  clip.length = length;
  clip.properties.name.v = name;
  h.project.sequence.videoTracks[0].clips.push(clip);
  return clip;
}

// Window refreshes are queued with a timer after project changes.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function openFromTab(h) {
  findButton(h.panels[0], "Open Compositions").onClick();
  return h.windows[h.windows.length - 1];
}

test("activation adds the Comps tab and hooks; disposal restores the host", async () => {
  const h = createHarness();
  const updateBefore = h.PZ.track.prototype.update;
  const mod = loadModule();
  mod.activate(h.context);

  assert.notEqual(h.PZ.track.prototype.update, updateBefore, "engine hooks installed");
  assert.equal(h.tabs.length, 1);
  assert.equal(h.tabs[0].opts.title, "Comps");
  assert.equal(mod.isInUse(), false, "no compositions yet");

  await h.lifecycle.dispose();
  assert.equal(h.PZ.track.prototype.update, updateBefore, "host update restored");
  assert.equal(h.tabs[0].removed, true, "tab removed");
  assert.equal(mod.isInUse(), false);
});

test("the Compositions window opens from the tab, is reused while open, and reopens after close", () => {
  const h = createHarness();
  loadModule().activate(h.context);

  const first = openFromTab(h);
  assert.equal(first.id, "precomp-plus:compositions");
  assert.equal(first.subtitle, "Main");
  assert.equal(openFromTab(h), first, "an open window is focused, not duplicated");
  assert.equal(h.windows.length, 1);

  first.close();
  assert.equal(first.isOpen(), false);
  const second = openFromTab(h);
  assert.notEqual(second, first);
  assert.equal(second.isOpen(), true);
});

test("pre-compose from the window creates a named composition and reports it", () => {
  const h = createHarness();
  const mod = loadModule();
  mod.activate(h.context);
  const a = addVideo(h, 0, 30, "A");
  const b = addVideo(h, 30, 30, "B");
  h.tracks.selectedClips = [a, b];

  const comps = openFromTab(h);
  findButton({ specs: comps.options.footer }, "Pre-compose selection").onClick();
  const dialog = h.windows[h.windows.length - 1];
  assert.equal(dialog.id, "precomp-plus:precompose");
  assert.equal(dialog.body.children[0].opts.value, "Comp 1", "default name");
  dialog.options.footer[0].onClick();

  assert.equal(dialog.isOpen(), false, "dialog closes on success");
  assert.equal(h.project.media.length, 1);
  assert.equal(h.project.sequence.videoTracks[0].clips.length, 1);
  const note = h.kit.notified.at(-1);
  assert.equal(note.title, "Pre-composed Comp 1");
  assert.match(note.message, /Moved 2 video clips into "Comp 1"/);
  assert.equal(mod.isInUse(), true, "compositions block disabling");
});

test("an invalid name keeps the dialog open and says why", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  h.tracks.selectedClips = [addVideo(h, 0, 30, "A")];

  findButton({ specs: openFromTab(h).options.footer }, "Pre-compose selection").onClick();
  const dialog = h.windows[h.windows.length - 1];
  dialog.body.children[0].opts.onInput("Main");
  dialog.options.footer[0].onClick();

  assert.equal(dialog.isOpen(), true);
  const message = dialog.body.children[dialog.body.children.length - 1];
  assert.match(message.textContent, /reserved/);
  assert.equal(h.project.media.length, 0, "nothing was created");
});

test("rename, duplicate and delete run from the window; delete is refused while used", async () => {
  const h = createHarness();
  const mod = loadModule();
  mod.activate(h.context);
  h.tracks.selectedClips = [addVideo(h, 0, 30, "A"), addVideo(h, 30, 30, "B")];
  const comps = openFromTab(h);
  findButton({ specs: comps.options.footer }, "Pre-compose selection").onClick();
  h.windows[h.windows.length - 1].options.footer[0].onClick();
  await tick();

  const original = h.project.media[0];
  const originalId = original.comp.id;
  const listed = (win) => win.body.children.find((el) => el.opts && el.opts.items);

  // Select the original, then duplicate it; the copy becomes the selection.
  listed(comps).opts.onSelect(originalId);
  findButton(comps.body, "Duplicate").onClick();
  assert.equal(h.project.media.length, 2);
  const copy = h.project.media[1];
  assert.equal(copy.properties.name.v, "Comp 1 copy");

  // Select the original (used by Main) and try to delete it.
  listed(comps).opts.onSelect(originalId);
  findButton(comps.body, "Delete").onClick();
  assert.equal(h.project.media.length, 2, "used composition kept");
  const refusal = h.kit.notified.at(-1);
  assert.equal(refusal.title, "Delete");
  assert.match(refusal.message, /used by 1 clip in Main/);

  // Rename through the name field.
  listed(comps).opts.onSelect(copy.comp.id);
  comps.body.children.find((el) => el.opts && el.opts.label === "Name").opts.onChange("Credits");
  assert.equal(copy.properties.name.v, "Credits");

  // The unused copy can be deleted.
  findButton(comps.body, "Delete").onClick();
  assert.equal(h.project.media.length, 1);
});

test("activating a composition shows it in the subtitle and tab; Back to Main restores both", async () => {
  const h = createHarness();
  loadModule().activate(h.context);
  h.tracks.selectedClips = [addVideo(h, 0, 30, "A")];
  const comps = openFromTab(h);
  findButton({ specs: comps.options.footer }, "Pre-compose selection").onClick();
  h.windows[h.windows.length - 1].options.footer[0].onClick();
  await tick();
  const id = h.project.media[0].comp.id;

  comps.body.children.find((el) => el.opts && el.opts.items).opts.onActivate(id);
  assert.equal(comps.subtitle, "Editing Comp 1");
  assert.equal(h.tabs[0].span.textContent, "Comps: Comp 1");
  assert.equal(h.editor.project.sequence.videoTracks[0].clips[0].properties.name.v, "A", "comp contents are open");

  findButton(comps.body, "Back to Main").onClick();
  assert.equal(comps.subtitle, "Main");
  assert.equal(h.tabs[0].span.textContent, "Comps");
  assert.equal(h.editor.project.sequence.videoTracks[0].clips[0].object.compId, id, "Main shows the composition clip");
});

test("closing the compositions window unsubscribes it from project changes", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const comps = openFromTab(h);
  const watchers = h.project.ui.onChanged.watchers.length;
  comps.close();
  assert.equal(h.project.ui.onChanged.watchers.length, watchers - 1);
});

function rightClick(h, clip) {
  const el = h.tracks.container.querySelectorAll(".clip").find((candidate) => candidate.pz_object === clip);
  assert.ok(el, "timeline element exists for the clip");
  h.PZ.ui.timeline.tracks.prototype.clipContextMenu.call(h.tracks, {
    currentTarget: el,
    preventDefault() {},
    stopPropagation() {},
    clientX: 60,
    clientY: 60,
  });
  return el;
}

function openMenu(h) {
  const menus = h.document.body.children.filter((child) => child.tagName === "ul");
  return menus[menus.length - 1];
}

function clickItem(menu, label) {
  const item = menu.children.find((li) => li.innerText === label);
  assert.ok(item, "menu has item " + label);
  item.onclick({ stopPropagation() {}, preventDefault() {} });
  return item;
}

test("right-click shows the composition menu; Pre-compose opens the dialog", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const clip = addVideo(h, 0, 30, "A");

  rightClick(h, clip);
  const menu = openMenu(h);
  assert.ok(menu, "menu opened");
  assert.match(menu.children[0].innerText, /^Source: A \(Video\)/);
  assert.deepEqual(
    menu.children.slice(1).map((li) => li.innerText),
    ["Rename layer", "Reveal source in Project", "Pre-compose selected", "Open source composition",
      "Duplicate", "Split at playhead (C)", "Delete"]
  );

  clickItem(menu, "Pre-compose selected");
  const dialog = h.windows[h.windows.length - 1];
  assert.equal(dialog.id, "precomp-plus:precompose", "Pre-compose opens the existing dialog");

  assert.equal(menu.removed, true, "choosing an item closes the menu");
});

test("Open source composition opens comp clips and explains plain clips", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const clip = addVideo(h, 0, 30, "A");
  h.tracks.selectedClips = [clip];
  assert.equal(h.PZ.precomp.precompose(h.editor, "Comp 1").ok, true);

  const main = h.project.sequence.videoTracks[0].clips[0];
  rightClick(h, main);
  clickItem(openMenu(h), "Open source composition");
  assert.equal(h.PZ.precomp.activeName(h.editor), "Comp 1", "comp clip opens its composition");
  h.PZ.precomp.openComp(h.editor, null);

  const plain = addVideo(h, 40, 10, "Plain");
  rightClick(h, plain);
  clickItem(openMenu(h), "Open source composition");
  const note = h.kit.notified.at(-1);
  assert.equal(note.title, "Open source composition");
  assert.match(note.message, /did not come from a composition/);
});

test("Reveal source falls back to describing the source when nothing matches", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  rightClick(h, addVideo(h, 0, 30, "A"));
  clickItem(openMenu(h), "Reveal source in Project");
  const note = h.kit.notified.at(-1);
  assert.equal(note.title, "Reveal source in Project");
  assert.match(note.message, /Source: A \(Video\)/);
});

test("Delete and Duplicate each run in one undo step", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  addVideo(h, 0, 30, "A");
  const b = addVideo(h, 30, 30, "B");
  const names = () => h.project.sequence.videoTracks[0].clips.map((clip) => clip.properties.name.v);

  const undoDepth = h.editor.history.undoStack.length;
  rightClick(h, b);
  clickItem(openMenu(h), "Delete");
  assert.deepEqual(names(), ["A"]);
  assert.equal(h.editor.history.undoStack.length, undoDepth + 1, "delete is one undo step");
  h.editor.history.undo();
  assert.deepEqual(names(), ["A", "B"]);

  rightClick(h, h.project.sequence.videoTracks[0].clips[0]);
  clickItem(openMenu(h), "Duplicate");
  assert.deepEqual(names(), ["A", "A", "B"]);
  assert.equal(h.editor.history.undoStack.length, undoDepth + 1, "duplicate is one undo step");
  h.editor.history.undo();
  assert.deepEqual(names(), ["A", "B"]);
});

test("Split divides the clip in one undo step", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const clip = addVideo(h, 0, 30, "A");

  const undoDepth = h.editor.history.undoStack.length;
  rightClick(h, clip);
  clickItem(openMenu(h), "Split at playhead (C)");
  const clips = h.project.sequence.videoTracks[0].clips;
  assert.equal(clips.length, 2, "clip split in two");
  assert.equal(clips[0].length + clips[1].length, 30);
  assert.equal(h.editor.history.undoStack.length, undoDepth + 1, "split is one undo step");
  h.editor.history.undo();
  assert.equal(h.project.sequence.videoTracks[0].clips.length, 1);
  assert.equal(h.project.sequence.videoTracks[0].clips[0].length, 30);
});

test("Rename edits the layer name in one undo step", () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const clip = addVideo(h, 0, 30, "A");
  clip.properties.name.getAddress = function () { return this; };

  const undoDepth = h.editor.history.undoStack.length;
  const el = rightClick(h, clip);
  clickItem(openMenu(h), "Rename layer");
  const input = el.appended[el.appended.length - 1];
  assert.equal(input.value, "A");
  input.value = "Titles";
  input.onblur();
  assert.equal(clip.properties.name.v, "Titles");
  assert.equal(h.editor.history.undoStack.length, undoDepth + 1, "rename is one undo step");
  h.editor.history.undo();
  assert.equal(clip.properties.name.v, "A");
});

test("Escape closes the menu; disposal restores the host menu", async () => {
  const h = createHarness();
  const before = h.PZ.ui.timeline.tracks.prototype.clipContextMenu;
  loadModule().activate(h.context);
  assert.notEqual(h.PZ.ui.timeline.tracks.prototype.clipContextMenu, before, "menu installed");

  rightClick(h, addVideo(h, 0, 30, "A"));
  const menu = openMenu(h);
  h.document.listeners.keydown.forEach((fn) => fn({ key: "Escape", stopPropagation() {} }));
  assert.equal(menu.removed, true, "Escape closes the menu");

  rightClick(h, h.project.sequence.videoTracks[0].clips[0]);
  const reopened = openMenu(h);
  await h.lifecycle.dispose();
  assert.equal(h.PZ.ui.timeline.tracks.prototype.clipContextMenu, before, "host menu restored");
  assert.equal(reopened.removed, true, "open menus close on disable");
});
