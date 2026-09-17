"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const debugLogSource = fs.readFileSync(
  path.join(__dirname, "..", "zoidium", "debug-log.js"),
  "utf8"
);

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

function loadDebugLog(localValues, sessionValues, options = {}) {
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
  let id = options.idStart || 0;
  const PZ = {
    zoidium: {
      define(name, api) {
        this[name] = api;
        return api;
      },
      getDebugPlugins() {
        return options.plugins || [];
      },
      getDebugProjectUsage() {
        return options.projectUsage || {
          totalInstances: 0,
          missingInstances: 0,
          items: [],
        };
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
    performance: options.performance || {},
    screen: { height: 1080, width: 1920 },
    sessionStorage: storage(sessionValues),
    setInterval() { return 1; },
    setTimeout() { return 1; },
  };
  context.window = context;
  vm.runInNewContext(debugLogSource, context);
  return {
    api: context.ZOIDIUM_DEBUG_LOG,
    documentEvents,
    windowEvents,
  };
}

test("an exception survives a crashed page session and appears after reload", () => {
  const localValues = new Map();
  const sessionValues = new Map();
  const usage = {
    totalInstances: 850,
    missingInstances: 0,
    items: [{
      pluginId: "native-fx",
      pluginName: "Native FX",
      kind: "effect",
      itemId: "echo",
      itemName: "Echo",
      count: 850,
      missingCount: 0,
    }],
  };
  const first = loadDebugLog(localValues, sessionValues, { projectUsage: usage });
  first.windowEvents.dispatch("zoidium:ready", { detail: { failedScripts: [] } });
  const error = new Error("Echo allocation failed");
  error.stack = "Error: Echo allocation failed\n at /plugins/native-fx/native-fx.js:10:2";
  first.windowEvents.dispatch("error", {
    error,
    filename: "/plugins/native-fx/native-fx.js",
    lineno: 10,
    colno: 2,
  });
  for (let index = 0; index < 150; index += 1) {
    first.api.record("noise", { index });
  }

  assert.match(localValues.get("zoidium.debug-log.journal.v2"), /Echo allocation failed/);

  // A renderer crash does not emit pagehide. Loading again with the same tab
  // storage must recover the still-active session.
  const second = loadDebugLog(localValues, sessionValues, { idStart: 20 });
  const snapshot = second.api.getSnapshot();
  const previous = snapshot.previousSessions.at(-1);

  assert.equal(previous.status, "interrupted");
  assert.equal(previous.exitReason, "no-clean-page-shutdown");
  assert.ok(snapshot.exceptions.some((entry) => entry.message === "Echo allocation failed"));
  assert.equal(snapshot.crashAnalysis.category, "uncaught-exception");
  assert.equal(snapshot.crashAnalysis.candidatePlugins[0].id, "native-fx");
  assert.equal(snapshot.crashAnalysis.candidatePlugins[0].evidence, "error-reference");
  assert.equal(snapshot.crashAnalysis.candidatePlugins[0].instanceCount, 850);
});

test("pagehide marks a normal reload as closed instead of interrupted", () => {
  const localValues = new Map();
  const sessionValues = new Map();
  const first = loadDebugLog(localValues, sessionValues);

  first.windowEvents.dispatch("pagehide", { persisted: false });
  const second = loadDebugLog(localValues, sessionValues, { idStart: 20 });
  const previous = second.api.getSnapshot().previousSessions.at(-1);

  assert.equal(previous.status, "closed");
  assert.equal(previous.exitReason, "pagehide");
});

test("health samples are retained for memory-pressure analysis", () => {
  const localValues = new Map();
  const sessionValues = new Map();
  const first = loadDebugLog(localValues, sessionValues, {
    performance: {
      memory: {
        usedJSHeapSize: 950,
        totalJSHeapSize: 975,
        jsHeapSizeLimit: 1000,
      },
    },
  });

  const second = loadDebugLog(localValues, sessionValues, { idStart: 20 });
  const snapshot = second.api.getSnapshot();

  assert.equal(snapshot.crashAnalysis.category, "memory-pressure");
  assert.equal(snapshot.previousSessions.at(-1).health.maxHeapRatio, 0.95);
});

test("plugin usage milestones survive a crash during project load", () => {
  const localValues = new Map();
  const sessionValues = new Map();
  const first = loadDebugLog(localValues, sessionValues);
  first.documentEvents.dispatch("zoidium:project-load-start", {
    detail: { pluginCount: 1 },
  });
  first.documentEvents.dispatch("zoidium:plugin-usage-progress", {
    detail: {
      pluginId: "native-fx",
      pluginName: "Native FX",
      kind: "effect",
      itemId: "echo",
      itemName: "Echo",
      count: 1024,
    },
  });

  const second = loadDebugLog(localValues, sessionValues, { idStart: 20 });
  const analysis = second.api.getSnapshot().crashAnalysis;
  const candidate = analysis.candidatePlugins.find((plugin) => plugin.id === "native-fx");

  assert.equal(analysis.category, "unclean-session-end");
  assert.equal(candidate.evidence, "project-workload");
  assert.equal(candidate.instanceCount, 1024);
  assert.equal(candidate.topItems[0].id, "echo");
});
