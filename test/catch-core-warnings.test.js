"use strict";

// Coverage for the round-10 catch-core triage: failures that were previously
// swallowed silently now warn once per distinct key without changing the
// recovery behavior.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function readSource(relative) {
  return fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
}

test("matchesSnapshot warns once per restore point on fingerprint failure", async () => {
  const warnings = [];
  const windowObject = {
    console: { warn(...args) { warnings.push(args); } },
    PZ: {
      archive: class {
        async untar() { throw new Error("unreadable archive"); }
      },
      zoidium: { projectFiles: {} },
    },
    CM: {},
  };
  windowObject.__zoidiumRestoreParts = {
    store: {
      getSnapshot: async () => null,
      loadAssets: async () => [],
    },
  };
  windowObject.window = windowObject;
  const context = vm.createContext(windowObject);
  vm.runInContext(readSource("zoidium/project-restore-snapshots.js"), context, {
    filename: "project-restore-snapshots.js",
  });
  const matchesSnapshot = windowObject.__zoidiumRestoreParts.snapshots.matchesSnapshot;

  const record = { id: "point-a", blob: {} };
  assert.equal(await matchesSnapshot(record, "fingerprint"), false);
  assert.equal(await matchesSnapshot(record, "fingerprint"), false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /project-restore/);

  // A different restore point warns again; recovery is still false.
  assert.equal(await matchesSnapshot({ id: "point-b", blob: {} }, "fingerprint"), false);
  assert.equal(warnings.length, 2);
});

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.tokens.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.tokens.delete(token));
  }

  toggle(token, force) {
    const active = force === undefined ? !this.tokens.has(token) : Boolean(force);
    if (active) this.tokens.add(token);
    else this.tokens.delete(token);
    return active;
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class FakeElement {
  constructor() {
    this.children = [];
    this.className = "";
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.textContent = "";
    this.title = "";
    this.type = "";
    this.tabIndex = -1;
    this.hidden = false;
    this.isConnected = true;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener() {}

  remove() {}

  focus() {}

  blur() {}

  contains() {
    return false;
  }

  closest() {
    return null;
  }
}

test("window validity failure warns once and still closes the window", () => {
  const warnings = [];
  const timers = [];
  const windowObject = {
    console: {
      warn(...args) { warnings.push(args); },
      error() {},
    },
    document: {
      body: new FakeElement(),
      activeElement: null,
      createElement() { return new FakeElement(); },
      createElementNS() { return new FakeElement(); },
      addEventListener() {},
    },
    localStorage: null,
    innerWidth: 1280,
    innerHeight: 720,
    setInterval(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearInterval() {},
    addEventListener() {},
    removeEventListener() {},
  };
  windowObject.window = windowObject;
  windowObject.globalThis = windowObject;
  const context = vm.createContext(windowObject);
  vm.runInContext(readSource("zoidium/ui-kit-windows.js"), context, {
    filename: "ui-kit-windows.js",
  });
  const windows = windowObject.ZoidiumUIBuilder.windows;

  function throwingWindow(id) {
    return windows.openWindow({
      id,
      title: "Throwing",
      collapsible: false,
      maximizable: false,
      resizable: false,
      isValid() { throw new Error("boom"); },
    });
  }

  const first = throwingWindow("warn-once-a");
  assert.equal(first.isOpen(), true);
  assert.equal(timers.length, 1);
  timers[0]();
  timers[0]();
  assert.equal(first.isOpen(), false);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /validity check failed/);

  // A different window id warns again.
  const second = throwingWindow("warn-once-b");
  timers[timers.length - 1]();
  assert.equal(second.isOpen(), false);
  assert.equal(warnings.length, 2);
});
