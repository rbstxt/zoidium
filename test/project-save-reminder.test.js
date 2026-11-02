"use strict";

// Coverage for zoidium/project-save-reminder.js: the Save-button dot badge,
// its tooltip lines, the threshold setting, and state transitions (new,
// opened, edited, saved, save failed, save-as, restore). The script runs
// unmodified in a fake browser; every assertion goes through its real event
// listeners, timers, and badge element. The toolbar Save button is faked with
// the same title CM3 assigns it ("save (ctrl-s)").

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
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.type = "";
    this.writes = { text: 0, class: 0, display: 0, title: 0 };
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
    let titleValue = "";
    Object.defineProperty(this, "title", {
      get() {
        return titleValue;
      },
      set(value) {
        this.writes.title += 1;
        titleValue = String(value);
      },
      configurable: true,
    });
    const writes = this.writes;
    let displayValue = "";
    this.style = {};
    Object.defineProperty(this.style, "display", {
      get() {
        return displayValue;
      },
      set(value) {
        writes.display += 1;
        displayValue = String(value);
      },
      configurable: true,
    });
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter((value) => value !== child);
    child.parent = null;
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
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

  querySelectorAll(selector) {
    const found = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (selector === "button[title]" && child.tagName === "BUTTON" && child.getAttribute("title")) {
          found.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  fire(type, event) {
    for (const listener of (this.listeners[type] || []).slice()) listener(event || {});
  }
}

function makeProject() {
  return { ui: { onChanged: new Observable() } };
}

const SAVE_TITLE = "save (ctrl-s)";

function makeToolbarButton(title) {
  const button = new FakeElement("button");
  button.setAttribute("title", title);
  button.title = title;
  return button;
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
  const actions = new FakeElement("div");
  actions.classList.add("zoidium-project-actions");
  actions.appendChild(makeToolbarButton("new (ctrl-m)"));
  actions.appendChild(makeToolbarButton("open (ctrl-o)"));
  const saveButton = makeToolbarButton(SAVE_TITLE);
  actions.appendChild(saveButton);
  actions.appendChild(makeToolbarButton("undo (ctrl-z)"));
  actions.appendChild(makeToolbarButton("redo (ctrl-y)"));
  const note = new FakeElement("div");
  note.classList.add("zoidium-restore-note");

  const anchorsPresent = { value: anchors };
  const roots = [label, actions, note];
  const documentObject = {
    body: new FakeElement("body"),
    createElement(tag) {
      return new FakeElement(tag);
    },
    querySelector(selector) {
      if (!anchorsPresent.value) return null;
      if (selector === ".zoidium-project-actions") return actions;
      if (selector === ".zoidium-restore-note") return note;
      for (const root of roots) {
        if (selector === ".zoidium-project-name" && root === label) return label;
        const found = root.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (!anchorsPresent.value) return [];
      const found = [];
      for (const root of roots) found.push(...root.querySelectorAll(selector));
      return found;
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

  function saveButtonOf() {
    return actions.querySelectorAll("button[title]").find((button) => /^save(\s|\()/i.test(button.title));
  }

  function badge() {
    const current = saveButtonOf();
    return current ? current.querySelector(".zoidium-save-reminder-dot") : null;
  }

  function setting() {
    return note.querySelector(".zoidium-save-reminder-setting select");
  }

  function resetWrites() {
    for (const root of roots) {
      const visit = (element) => {
        element.writes.text = 0;
        element.writes.class = 0;
        element.writes.display = 0;
        element.writes.title = 0;
        for (const child of element.children) visit(child);
      };
      visit(root);
    }
  }
  resetWrites();

  function mutate() {
    for (const observer of observers.slice()) observer.callback();
  }

  return {
    editor, label, actions, note, toasts, backing, intervals, globalListeners, observers,
    advance, fire, edit, badge, setting, saveButtonOf, resetWrites, mutate,
    now: () => now,
    setAnchors(value) {
      anchorsPresent.value = value;
    },
  };
}

function badgeTitle(h) {
  return h.saveButtonOf().title;
}

test("a new project shows a muted badge and names the state in the tooltip", () => {
  const h = createHarness();
  const dot = h.badge();
  assert.ok(dot, "expected the badge to be installed on the Save button");
  assert.equal(dot.style.display, "", "expected a visible badge for a never-saved project");
  assert.ok(!dot.classList.contains("is-overdue"));
  assert.equal(dot.getAttribute("aria-hidden"), "true");
  const lines = badgeTitle(h).split("\n");
  assert.equal(lines[0], SAVE_TITLE, "expected the button label and shortcut first");
  assert.equal(lines[1], "Not saved to disk");
  assert.match(lines[2], /stay in this browser only/);
  assert.ok(h.saveButtonOf().classList.contains("zoidium-save-reminder-host"));

  h.edit();
  h.advance(20 * 60000);
  assert.equal(h.badge().style.display, "");
  assert.ok(!h.badge().classList.contains("is-overdue"));
  assert.match(badgeTitle(h), /Not saved to disk/);
});

test("opened projects start clean; an edit starts the unsaved count", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  assert.equal(h.badge().style.display, "none", "expected no dot when the project is saved");
  assert.equal(badgeTitle(h), SAVE_TITLE, "expected the plain button tooltip when saved");

  h.edit();
  assert.equal(h.badge().style.display, "");
  assert.match(badgeTitle(h), /Unsaved · 0 min/);
  assert.match(badgeTitle(h), /stay in this browser only/);
  assert.ok(badgeTitle(h).startsWith(SAVE_TITLE + "\n"));
  assert.ok(!h.badge().classList.contains("is-overdue"));

  h.advance(9 * 60000 + 30000);
  assert.match(badgeTitle(h), /Unsaved · 9 min/);
  assert.ok(!h.badge().classList.contains("is-overdue"));

  h.advance(30000);
  assert.match(badgeTitle(h), /Unsaved · 10 min/);
  assert.ok(h.badge().classList.contains("is-overdue"));
});

test("saving clears the badge; save-as counts as a disk save", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(12 * 60000);
  assert.match(badgeTitle(h), /Unsaved · 12 min/);

  h.editor._zoidiumSaveFileHandle = { name: "project.pz" };
  h.fire("zoidium:project-saved", { editor: h.editor, filename: "project.pz" });
  assert.equal(h.badge().style.display, "none");
  assert.equal(badgeTitle(h), SAVE_TITLE);
  assert.ok(!h.badge().classList.contains("is-overdue"));

  // Saving again under a picked name (save-as) stays clean.
  h.editor._zoidiumSaveFileHandle = { name: "renamed.pz" };
  h.fire("zoidium:project-saved", { editor: h.editor, filename: "renamed.pz" });
  assert.equal(h.badge().style.display, "none");

  // Later edits count from the save.
  h.edit();
  assert.match(badgeTitle(h), /Unsaved · 0 min/);
});

test("a failed save keeps counting from the first unsaved change", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(3 * 60000);
  h.fire("zoidium:project-error", { editor: h.editor, message: "Write failed" });
  assert.match(badgeTitle(h), /Unsaved · 3 min/);
  h.advance(9 * 60000);
  assert.match(badgeTitle(h), /Unsaved · 12 min/);
  assert.ok(h.badge().classList.contains("is-overdue"));
});

test("a project change clears the unsaved timer", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(25 * 60000);
  assert.match(badgeTitle(h), /Unsaved · 25 min/);

  // Opening another project starts clean, with the watcher moved over.
  const previous = h.editor.project;
  h.editor.project = makeProject();
  h.editor._rev = 0;
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  assert.equal(h.badge().style.display, "none");
  assert.equal(badgeTitle(h), SAVE_TITLE);
  assert.ok(!h.badge().classList.contains("is-overdue"));
  h.resetWrites();
  h.advance(60000);
  assert.equal(h.saveButtonOf().writes.title, 0, "expected no tooltip writes while clean");
  assert.equal(h.badge().writes.display, 0, "expected no badge writes while clean");

  // Edits to the detached project no longer count.
  previous.ui.onChanged.update();
  assert.equal(h.badge().style.display, "none");

  // A new project was never saved to a file.
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "new" });
  assert.match(badgeTitle(h), /Not saved to disk/);
});

test("a restore restarts the count instead of inheriting the old timer", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  h.advance(25 * 60000);
  assert.ok(h.badge().classList.contains("is-overdue"));

  h.editor.project = makeProject();
  h.editor._rev = 0;
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "restore" });
  assert.match(badgeTitle(h), /Unsaved · 0 min/);
  assert.ok(!h.badge().classList.contains("is-overdue"));

  // A restore of a never-saved project stays on Not saved to disk.
  const fresh = createHarness();
  fresh.fire("zoidium:project-changed", { editor: fresh.editor, reason: "restore" });
  assert.match(badgeTitle(fresh), /Not saved to disk/);
});

test("a rebuilt toolbar gets a fresh badge without moving the button", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();

  // CM3 rebuilds the toolbar: swap in a new Save button element.
  const actions = h.actions;
  const old = h.saveButtonOf();
  const index = actions.children.indexOf(old);
  actions.removeChild(old);
  const rebuilt = makeToolbarButton(SAVE_TITLE);
  actions.children.splice(index, 0, rebuilt);
  rebuilt.parent = actions;
  h.mutate();
  assert.ok(h.badge(), "expected the badge to reinstall after a rebuild");
  assert.equal(h.badge().parent, h.saveButtonOf());
  assert.match(badgeTitle(h), /Unsaved · 0 min/);
  assert.ok(badgeTitle(h).startsWith(SAVE_TITLE + "\n"));
  // The badge is absolutely positioned inside the button, so the toolbar
  // order is unchanged: New, Open, Save, Undo, Redo.
  const order = actions.querySelectorAll("button[title]").map((button) => button.getAttribute("title"));
  assert.deepEqual(order, ["new (ctrl-m)", "open (ctrl-o)", SAVE_TITLE, "undo (ctrl-z)", "redo (ctrl-y)"]);
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
  assert.equal(h.badge().style.display, "none");
  assert.equal(badgeTitle(h), SAVE_TITLE, "expected no tooltip line when off");
  h.advance(60 * 60000);
  assert.equal(h.badge().style.display, "none");
  assert.equal(badgeTitle(h), SAVE_TITLE);

  select.value = "20";
  select.fire("change", { target: select });
  assert.equal(h.backing["zoidium.save-reminder"], "20");
  assert.equal(h.badge().style.display, "");
  assert.match(badgeTitle(h), /Unsaved · 60 min/);
  assert.ok(h.badge().classList.contains("is-overdue"));

  // A fresh install keeps counting from the first change, and the 20-minute
  // threshold applies from the start.
  const later = createHarness({ stored: "20" });
  assert.equal(later.setting().value, "20");
  later.fire("zoidium:project-changed", { editor: later.editor, reason: "open" });
  later.edit();
  later.advance(19 * 60000);
  assert.ok(!later.badge().classList.contains("is-overdue"));
  later.advance(60000);
  assert.ok(later.badge().classList.contains("is-overdue"));
});

test("stored settings fall back to the 10-minute default and stay off when off", () => {
  for (const stored of ["banana", "7", "-5", ""]) {
    const h = createHarness({ stored });
    assert.equal(h.setting().value, "10", `stored ${JSON.stringify(stored)}`);
    assert.equal(h.badge().style.display, "");
  }
  const off = createHarness({ stored: "0" });
  assert.equal(off.setting().value, "0");
  assert.equal(off.badge().style.display, "none");
  assert.equal(badgeTitle(off), SAVE_TITLE);
});

test("events from another editor are ignored", () => {
  const h = createHarness();
  h.fire("zoidium:project-changed", { editor: {}, reason: "open" });
  assert.match(badgeTitle(h), /Not saved to disk/);
  h.fire("zoidium:project-saved", { editor: {} });
  assert.match(badgeTitle(h), /Not saved to disk/);
});

test("the badge refreshes on a 30-second tick and installs late anchors", () => {
  const delays = [];
  const h = createHarness({ anchors: false });
  for (const timer of h.intervals.values()) delays.push(timer.ms);
  assert.ok(delays.includes(30000), "expected the 30 s refresh tick");
  assert.ok(delays.includes(250), "expected the install retry tick");

  h.setAnchors(true);
  h.advance(250);
  assert.ok(h.badge(), "expected the badge to install once the toolbar exists");
  assert.ok(h.setting(), "expected the setting to install once the panel exists");
  assert.match(badgeTitle(h), /Not saved to disk/);

  h.fire("zoidium:project-changed", { editor: h.editor, reason: "open" });
  h.edit();
  assert.match(badgeTitle(h), /Unsaved · 0 min/);
  h.resetWrites();
  h.advance(15000);
  assert.equal(h.saveButtonOf().writes.title, 0, "expected no repaint between ticks");
  h.advance(15000);
  assert.equal(h.saveButtonOf().writes.title, 0, "expected no repaint for an unchanged minute");
  h.advance(60000);
  assert.match(badgeTitle(h), /Unsaved · 1 min/);
  assert.equal(h.saveButtonOf().writes.title, 1, "expected exactly one repaint for the new minute");
});

test("pagehide stops the timers", () => {
  const h = createHarness();
  assert.ok(h.intervals.size > 0);
  for (const listener of (h.globalListeners.pagehide || []).slice()) listener();
  assert.equal(h.intervals.size, 0);
});
