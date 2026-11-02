"use strict";

// Coverage for zoidium/project-save-reminder.js: state transitions (new,
// opened, edited, saved, save failed, save-as, restore), the threshold, the
// setting, and the cleared timer on project change. The script runs
// unmodified in a fake browser; every assertion goes through its real event
// listeners, timers, and status element.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "zoidium", "project-save-reminder.js"),
  "utf8",
);

class Observable {
  constructor() {
    this.watchers = [];
  }

  watch(callback) {
    this.watchers.push(callback);
  }

  unwatch(callback) {
    this.watchers = this.watchers.filter((value) => value !== callback);
  }

  update() {
    for (const watcher of this.watchers.slice()) watcher();
  }
}

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.tokens = new Set();
  }

  add(...names) {
    names.forEach((name) => this.tokens.add(name));
    this.element.writes.class += 1;
    this.sync();
  }

  remove(...names) {
    names.forEach((name) => this.tokens.delete(name));
    this.element.writes.class += 1;
    this.sync();
  }

  contains(name) {
    return this.tokens.has(name);
  }

  sync() {
    this.element.className = Array.from(this.tokens).join(" ");
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.parent = null;
    this.classList = new FakeClassList(this);
    // Real DOM keeps className and classList in sync; the reminder sets
    // className directly, so the fake mirrors that here.
    let className = "";
    Object.defineProperty(this, "className", {
      get() {
        return className;
      },
      set(value) {
        className = String(value);
        this.classList.tokens = new Set(className.split(/\s+/).filter(Boolean));
      },
      configurable: true,
    });
    this.style = {};
    this.attributes = {};
    this.listeners = {};
    this.title = "";
    this.value = "";
    this.type = "";
    this.writes = { text: 0, class: 0 };
    let text = "";
    Object.defineProperty(this, "textContent", {
      get() {
        return text;
      },
      set(value) {
        this.writes.text += 1;
        text = String(value);
      },
      configurable: true,
    });
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  matchesClass(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    const parts = String(selector).split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matchesClass(last)) return child;
        const found = visit(child);
        if (found) return found;
      }
      return null;
    };
    return visit(this);
  }

  fire(type, event) {
    for (const listener of (this.listeners[type] || []).slice()) listener(event || {});
  }
}

function makeProject() {
  return { ui: { onChanged: new Observable() } };
}

function createHarness({ stored = null, anchors = true } = {}) {
  let now = 0;
  let nextId = 1;
  const intervals = new Map();
  const globalListeners = {};
  const toasts = [];
  const backing = stored === null ? {} : { "zoidium.save-reminder": stored };

  const editor = { project: makeProject(), _rev: 0, saves: 0 };
  editor.save = function () {
    editor.saves += 1;
  };

  const label = new FakeElement("label");
  label.classList.add("zoidium-project-name");
  const input = new FakeElement("input");
  label.appendChild(input);
  const note = new FakeElement("div");
  note.classList.add("zoidium-restore-note");

  const anchorsPresent = { value: anchors };
  const documentObject = {
    body: new FakeElement("body"),
    createElement(tag) {
      return new FakeElement(tag);
    },
    querySelector(selector) {
      if (!anchorsPresent.value) return null;
      if (selector === ".zoidium-project-name") return label;
      if (selector === ".zoidium-restore-note") return note;
      return null;
    },
  };

  const observers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe() {}

    disconnect() {}
  }

  const sandbox = {
    PZ: { zoidium: { projectFiles: { getProjectRevision(target) { return target._rev || 0; } } } },
    CM: editor,
    document: documentObject,
    localStorage: {
      getItem(key) {
        return Object.hasOwn(backing, key) ? backing[key] : null;
      },
      setItem(key, value) {
        backing[key] = String(value);
      },
    },
    MutationObserver: FakeMutationObserver,
    setInterval(callback, ms) {
      const id = nextId;
      nextId += 1;
      intervals.set(id, { callback, ms, due: now + ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    addEventListener(type, listener) {
      if (!globalListeners[type]) globalListeners[type] = [];
      globalListeners[type].push(listener);
    },
    __zoidiumRestoreParts: { toasts: { showToast(detail) { toasts.push(detail); } } },
  };
  sandbox.window = sandbox;

  class ClockDate extends Date {
    static now() {
      return now;
    }
  }
  sandbox.Date = ClockDate;

  vm.runInNewContext(SOURCE, sandbox, { filename: "project-save-reminder.js" });

  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      let nextDue = Infinity;
      for (const [id, timer] of intervals) {
        if (timer.due < nextDue) {
          next = id;
          nextDue = timer.due;
        }
      }
      if (next === null || nextDue > end) break;
      now = nextDue;
      const timer = intervals.get(next);
      timer.callback();
      if (intervals.has(next)) timer.due = now + timer.ms;
    }
    now = end;
  }

  function fire(type, detail) {
    for (const listener of (globalListeners[type] || []).slice()) listener({ type, detail: detail || {} });
  }

  function edit() {
    editor._rev += 1;
    editor.project.ui.onChanged.update();
  }

  function button() {
    return label.querySelector(".zoidium-save-reminder");
  }

  function setting() {
    return note.querySelector(".zoidium-save-reminder-setting select");
  }

  return {
    editor, label, note, toasts, backing, intervals, globalListeners, observers,
    advance, fire, edit, button, setting,
    now: () => now,
    setAnchors(value) {
      anchorsPresent.value = value;
    },
  };
}

test("a new project shows Not saved to disk, even after edits", () => {
  const h = createHarness();
  const status = h.button();
  assert.ok(status, "expected the status button to be installed");
  assert.equal(status.textContent, "Not saved to disk");
  assert.match(status.title, /stay in this browser only/);
  assert.equal(status.style.visibility, "visible");
  assert.ok(!status.classList.contains("is-overdue"));

  h.edit();
  h.advance(20 * 60000);
  assert.equal(h.button().textContent, "Not saved to disk");
  assert.ok(!h.button().classList.contains("is-overdue"));
});

test("opened projects start clean; an edit starts the unsaved count", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  assert.equal(h.button().textContent, "");
  assert.equal(h.button().style.visibility, "hidden");

  h.edit();
  assert.equal(h.button().textContent, "Unsaved · 0 min");
  assert.match(h.button().title, /stay in this browser only/);
  assert.equal(h.button().style.visibility, "visible");
  assert.ok(!h.button().classList.contains("is-overdue"));

  h.advance(9 * 60000 + 30000);
  assert.equal(h.button().textContent, "Unsaved · 9 min");
  assert.ok(!h.button().classList.contains("is-overdue"));

  h.advance(30000);
  assert.equal(h.button().textContent, "Unsaved · 10 min");
  assert.ok(h.button().classList.contains("is-overdue"));
});

test("saving clears the reminder; save-as counts as a disk save", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(12 * 60000);
  assert.equal(h.button().textContent, "Unsaved · 12 min");

  h.editor._zoidiumSaveFileHandle = { name: "project.pz" };
  h.fire("zoidium:project-saved", { editor: h.editor, filename: "project.pz" });
  assert.equal(h.button().textContent, "");
  assert.equal(h.button().style.visibility, "hidden");
  assert.ok(!h.button().classList.contains("is-overdue"));

  // Saving again under a picked name (save-as) stays clean.
  h.editor._zoidiumSaveFileHandle = { name: "renamed.pz" };
  h.fire("zoidium:project-saved", { editor: h.editor, filename: "renamed.pz" });
  assert.equal(h.button().textContent, "");

  // Later edits count from the save.
  h.edit();
  assert.equal(h.button().textContent, "Unsaved · 0 min");
});

test("a failed save keeps counting from the first unsaved change", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(3 * 60000);
  h.fire("zoidium:project-error", { editor: h.editor, message: "Write failed" });
  assert.equal(h.button().textContent, "Unsaved · 3 min");
  h.advance(9 * 60000);
  assert.equal(h.button().textContent, "Unsaved · 12 min");
  assert.ok(h.button().classList.contains("is-overdue"));
});

test("a project change clears the unsaved timer", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(25 * 60000);
  assert.equal(h.button().textContent, "Unsaved · 25 min");

  // Opening another project starts clean, with the watcher moved over.
  const previous = h.editor.project;
  h.editor.project = makeProject();
  h.editor._rev = 0;
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  assert.equal(h.button().textContent, "");
  assert.ok(!h.button().classList.contains("is-overdue"));
  const writes = h.button().writes.text;
  h.advance(60000);
  assert.equal(h.button().writes.text, writes, "expected no DOM writes while clean");

  // Edits to the detached project no longer count.
  previous.ui.onChanged.update();
  assert.equal(h.button().textContent, "");

  // A new project was never saved to a file.
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "new" });
  assert.equal(h.button().textContent, "Not saved to disk");
});

test("a restore restarts the count instead of inheriting the old timer", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(25 * 60000);
  assert.ok(h.button().classList.contains("is-overdue"));

  h.editor.project = makeProject();
  h.editor._rev = 0;
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "restore" });
  assert.equal(h.button().textContent, "Unsaved · 0 min");
  assert.ok(!h.button().classList.contains("is-overdue"));

  // A restore of a never-saved project stays on Not saved to disk.
  const fresh = createHarness();
  fresh.fire("zoidium:project-changed", { editor: fresh.editor, reason: "restore" });
  assert.equal(fresh.button().textContent, "Not saved to disk");
});

test("clicking the status runs Save", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.button().fire("click");
  assert.equal(h.editor.saves, 1);
});

test("the setting turns the reminder off and chooses the threshold", () => {
  const h = createHarness();
  const select = h.setting();
  assert.ok(select, "expected the Restore panel setting to be installed");
  assert.equal(select.value, "10");

  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();

  select.value = "0";
  select.fire("change", { target: select });
  assert.equal(h.backing["zoidium.save-reminder"], "0");
  assert.equal(h.toasts.length, 1);
  assert.match(h.toasts[0].message, /Save reminder: Off/);
  assert.equal(h.button().style.display, "none");
  h.advance(60 * 60000);
  assert.equal(h.button().style.display, "none");

  select.value = "20";
  select.fire("change", { target: select });
  assert.equal(h.backing["zoidium.save-reminder"], "20");
  assert.equal(h.button().style.display, "");
  assert.equal(h.button().textContent, "Unsaved · 60 min");
  assert.ok(h.button().classList.contains("is-overdue"));

  // A fresh install keeps counting from the first change, and the 20-minute
  // threshold applies from the start.
  const later = createHarness({ stored: "20" });
  assert.equal(later.setting().value, "20");
  later.fire("zoidium:project-changed", { editor: later.editor, reason: "open" });
  later.edit();
  later.advance(19 * 60000);
  assert.ok(!later.button().classList.contains("is-overdue"));
  later.advance(60000);
  assert.ok(later.button().classList.contains("is-overdue"));
});

test("stored settings fall back to the 10-minute default and stay off when off", () => {
  for (const stored of ["banana", "7", "-5", ""]) {
    const h = createHarness({ stored });
    assert.equal(h.setting().value, "10", `stored ${JSON.stringify(stored)}`);
    assert.equal(h.button().style.display, "");
  }
  const off = createHarness({ stored: "0" });
  assert.equal(off.setting().value, "0");
  assert.equal(off.button().style.display, "none");
});

test("events from another editor are ignored", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: {}, reason: "open" });
  assert.equal(h.button().textContent, "Not saved to disk");
  h.fire("zoidium:project-saved", { editor: {} });
  assert.equal(h.button().textContent, "Not saved to disk");
});

test("the status refreshes on a 30-second tick and installs late anchors", () => {
  const delays = [];
  const h = createHarness({ anchors: false });
  for (const timer of h.intervals.values()) delays.push(timer.ms);
  assert.ok(delays.includes(30000), "expected the 30 s refresh tick");
  assert.ok(delays.includes(250), "expected the install retry tick");

  h.setAnchors(true);
  h.advance(250);
  assert.ok(h.button(), "expected the button to install once the toolbar exists");
  assert.ok(h.setting(), "expected the setting to install once the panel exists");
  assert.equal(h.button().textContent, "Not saved to disk");

  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  assert.equal(h.button().textContent, "Unsaved · 0 min");
  const writes = h.button().writes.text;
  h.advance(15000);
  assert.equal(h.button().writes.text, writes, "expected no repaint between ticks");
  h.advance(15000);
  assert.equal(h.button().writes.text, writes, "expected no repaint for an unchanged minute");
  h.advance(60000);
  assert.equal(h.button().textContent, "Unsaved · 1 min");
  assert.equal(h.button().writes.text, writes + 1, "expected exactly one repaint for the new minute");
});

test("pagehide stops the timers", () => {
  const h = createHarness();
  assert.ok(h.intervals.size > 0);
  for (const listener of (h.globalListeners.pagehide || []).slice()) listener();
  assert.equal(h.intervals.size, 0);
});
