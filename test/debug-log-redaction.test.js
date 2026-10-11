"use strict";

// Characterization pins for zoidium/debug-log.js redaction and journal
// behavior. These pin the exact output of the ORIGINAL single-file script so
// the round-9 split (journal/redaction, crash capture, export and UI) keeps
// identical behavior: secret/path redaction, truncation, the 200-event cap,
// and the journal storage keys.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function debugLogSources() {
  // After the split this loads the part files in browser order; before it,
  // the single entry file. The assertions below are unchanged either way.
  const candidates = [
    "zoidium/debug-journal.js",
    "zoidium/debug-crash.js",
    "zoidium/debug-log.js",
  ];
  if (candidates.every((relative) => fs.existsSync(path.join(projectRoot, relative)))) {
    return candidates.map((relative) => fs.readFileSync(path.join(projectRoot, relative), "utf8"));
  }
  return [fs.readFileSync(path.join(projectRoot, "zoidium", "debug-log.js"), "utf8")];
}

function storage(values) {
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
}

function loadDebugLog(localValues, sessionValues) {
  const windowEvents = eventTarget();
  const documentEvents = eventTarget();
  const document = {
    ...documentEvents,
    visibilityState: "visible",
    createElement(tagName) {
      if (tagName === "canvas") return { getContext() { return null; } };
      return { style: {}, appendChild() {}, remove() {}, click() {} };
    },
  };
  let id = 0;
  const PZ = {
    zoidium: {
      define(name, api) {
        this[name] = api;
        return api;
      },
      getDebugPlugins() {
        return [];
      },
      getDebugProjectUsage() {
        return { totalInstances: 0, missingInstances: 0, items: [] };
      },
    },
  };
  const context = {
    Blob,
    Date,
    Error,
    Math,
    PZ,
    URL,
    ZOIDIUM_RUNTIME: { version: "test", policy: {} },
    addEventListener: windowEvents.addEventListener,
    console: { error() {}, warn() {} },
    crypto: { randomUUID: () => `id-${++id}` },
    devicePixelRatio: 1,
    dispatchEvent() {},
    document,
    innerHeight: 720,
    innerWidth: 1280,
    localStorage: storage(localValues),
    location: { href: "http://127.0.0.1/", origin: "http://127.0.0.1" },
    navigator: {
      hardwareConcurrency: 8,
      language: "en",
      platform: "test",
      userAgent: "Mozilla/5.0 Chrome/120.0.0.0",
    },
    open() {},
    performance: {},
    screen: { height: 1080, width: 1920 },
    sessionStorage: storage(sessionValues),
    setInterval() { return 1; },
    setTimeout() { return 0; },
    clearTimeout() {},
  };
  context.window = context;
  vm.createContext(context);
  for (const source of debugLogSources()) {
    vm.runInContext(source, context, { filename: "debug-log-part.js" });
  }
  return { api: context.ZOIDIUM_DEBUG_LOG, context, documentEvents, windowEvents };
}

test("recorded secrets and local paths are redacted in events and the snapshot", () => {
  const loaded = loadDebugLog(new Map(), new Map());
  loaded.api.record("noise", {
    auth: "Authorization: Bearer abc123token",
    password: "password=hunter2",
    query: "https://example.invalid/edit?token=abc123&next=1",
    path: "opened /Users/alice/project.pz",
  });
  const entry = loaded.api.getSnapshot().events.find((item) => item.type === "noise");
  assert.ok(entry, "expected the recorded event");
  assert.match(entry.auth, /Bearer \[redacted\]/);
  assert.doesNotMatch(entry.auth, /abc123token/);
  assert.match(entry.password, /\[redacted\]/);
  assert.doesNotMatch(entry.password, /hunter2/);
  assert.match(entry.query, /token=\[redacted\]/);
  assert.doesNotMatch(entry.query, /abc123/);
  assert.match(entry.path, /\/Users\/\[redacted\]/);
  assert.doesNotMatch(entry.path, /alice/);
});

test("window errors redact error messages and filenames", () => {
  const loaded = loadDebugLog(new Map(), new Map());
  const error = new Error("password=hunter2 at /Users/alice");
  error.stack = "Error: password=hunter2\n at /Users/alice/app.js:1:1";
  loaded.windowEvents.dispatch("error", {
    error,
    filename: "https://example.invalid/edit?token=abc123",
    lineno: 1,
    colno: 1,
  });
  const exceptions = loaded.api.getSnapshot().exceptions;
  assert.equal(exceptions.length, 1);
  assert.doesNotMatch(exceptions[0].message, /hunter2/);
  assert.doesNotMatch(exceptions[0].filename, /abc123/);
  assert.doesNotMatch(exceptions[0].stack || "", /alice/);
});

test("long recorded text is truncated to 2400 characters", () => {
  const loaded = loadDebugLog(new Map(), new Map());
  loaded.api.record("noise", { big: "x".repeat(5000) });
  const entry = loaded.api.getSnapshot().events.find((item) => item.type === "noise");
  assert.ok(entry.big.length <= 2401, `expected truncation, got ${entry.big.length}`);
  assert.match(entry.big, /…$/);
});

test("only the newest 200 in-memory events are kept", () => {
  const loaded = loadDebugLog(new Map(), new Map());
  for (let index = 0; index < 250; index += 1) {
    loaded.api.record("noise", { index });
  }
  const events = loaded.api.getSnapshot().events;
  assert.equal(events.length, 200);
  assert.equal(events[0].index, 50);
  assert.equal(events.at(-1).index, 249);
});

test("the journal persists under the v2 key and the tab id is reused", () => {
  const localValues = new Map();
  const sessionValues = new Map();
  loadDebugLog(localValues, sessionValues);
  assert.ok(localValues.has("zoidium.debug-log.journal.v2"), "journal key written");
  const journal = JSON.parse(localValues.get("zoidium.debug-log.journal.v2"));
  assert.equal(journal.schemaVersion, 2);
  assert.equal(journal.sessions.length, 1);
  assert.equal(journal.sessions[0].status, "active");
  assert.ok(sessionValues.has("zoidium.debug-log.tab.v1"), "tab key written");
});

test("setPhase is reflected in later records and the session", () => {
  const loaded = loadDebugLog(new Map(), new Map());
  loaded.api.setPhase("ready");
  loaded.api.record("noise", { index: 1 });
  const events = loaded.api.getSnapshot().events;
  assert.equal(events.at(-1).phase, "ready");
});
