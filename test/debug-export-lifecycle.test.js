"use strict";

// C-a export lifecycle, C-b span flooding, C-c long-animation-frame
// attribution: Node coverage for the debug journal/log additions.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function readSource(relative) {
  return fs.readFileSync(path.join(projectRoot, relative), "utf8");
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

function createTimers() {
  const pending = new Map();
  let lastId = 0;
  return {
    setTimeout(callback) {
      lastId += 1;
      pending.set(lastId, callback);
      return lastId;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    run() {
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback();
      }
    },
  };
}

function loadJournal() {
  const timers = createTimers();
  const context = {
    Date,
    Error,
    Map,
    Math,
    Object,
    Array,
    JSON,
    Number,
    String,
    clearTimeout: timers.clearTimeout,
    setTimeout: timers.setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(readSource("zoidium/debug-journal.js"), context, { filename: "debug-journal.js" });
  return { journal: context.__zoidiumDebugParts.journal, runTimers: timers.run };
}

function loadDebugLog(options = {}) {
  const timers = createTimers();
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
    localStorage: storage(new Map()),
    location: { href: "http://127.0.0.1/", origin: "http://127.0.0.1" },
    navigator: { hardwareConcurrency: 8, language: "en", platform: "test", userAgent: "test" },
    open() {},
    performance: {},
    PerformanceObserver: options.PerformanceObserver,
    screen: { height: 1080, width: 1920 },
    sessionStorage: storage(new Map()),
    setInterval() { return 1; },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  context.window = context;
  vm.createContext(context);
  for (const relative of ["zoidium/debug-journal.js", "zoidium/debug-crash.js", "zoidium/debug-log.js"]) {
    vm.runInContext(readSource(relative), context, { filename: relative });
  }
  return { api: context.ZOIDIUM_DEBUG_LOG, context, runTimers: timers.run };
}

test("successful project spans share a small quota and never evict other records", () => {
  const { journal } = loadJournal();
  journal.initializeJournal();
  for (let index = 0; index < 100; index += 1) {
    journal.record("project-span", { name: "verify restore point", durationMs: index, status: "complete" });
  }
  for (let index = 0; index < 5; index += 1) {
    journal.record("marker", { index });
  }
  const events = journal.liveEvents();
  assert.equal(events.filter((entry) => entry.type === "marker").length, 5);
  const spans = events.filter((entry) => entry.type === "project-span" && entry.status !== "failed");
  assert.ok(spans.length <= 10, `expected at most 10 retained spans, saw ${spans.length}`);
  assert.ok(spans.length > 0);
});

test("failed project spans are still recorded in full", () => {
  const { journal } = loadJournal();
  journal.initializeJournal();
  for (let index = 0; index < 30; index += 1) {
    journal.record("project-span", { name: "verify restore point", durationMs: index, status: "complete" });
  }
  for (let index = 0; index < 3; index += 1) {
    journal.record("project-span", { name: "verify restore point", durationMs: index, status: "failed" });
  }
  const events = journal.liveEvents();
  assert.equal(events.filter((entry) => entry.type === "project-span" && entry.status === "failed").length, 3);
});

test("export start, complete and failure are recorded with a cause chain", () => {
  const { api } = loadDebugLog();
  api.recordExportStart({ format: "mp4", width: 1280, height: 720, fps: 30, frames: 90, bitrateScale: 2 });
  api.recordExportComplete({ format: "mp4", durationMs: 1200, bytes: 42 });
  const failure = new TypeError("Failed to fetch");
  failure.cause = new Error("socket hung up");
  api.recordExportError(failure, { format: "mp4", stage: "render" });
  const events = api.getSnapshot().events;
  const start = events.find((entry) => entry.type === "export-start");
  assert.equal(start.format, "mp4");
  assert.equal(start.frames, 90);
  assert.equal(start.bitrateScale, 2);
  const complete = events.find((entry) => entry.type === "export-complete");
  assert.equal(complete.bytes, 42);
  assert.equal(complete.durationMs, 1200);
  const error = events.find((entry) => entry.type === "export-error");
  assert.equal(error.stage, "render");
  assert.match(error.message, /Failed to fetch/);
  assert.ok(error.causes.some((cause) => /Failed to fetch/.test(cause)));
  assert.ok(error.causes.some((cause) => /socket hung up/.test(cause)));
});

test("export error redacts secrets and survives a missing debug log", () => {
  const { api } = loadDebugLog();
  const failure = new Error("Export failed. token=abc123");
  api.recordExportError(failure, { format: "webm", stage: "render" });
  const error = api.getSnapshot().events.find((entry) => entry.type === "export-error");
  assert.doesNotMatch(error.message, /abc123/);
  assert.equal(typeof api.recordExportStart, "function");
});

test("long animation frames record duration, blocking time and top scripts", () => {
  const callbacks = {};
  const seen = [];
  class FakeObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(options) {
      seen.push(options);
      callbacks[options.type] = this.callback;
    }
  }
  FakeObserver.supportedEntryTypes = ["longtask", "long-animation-frame"];
  const { api } = loadDebugLog({ PerformanceObserver: FakeObserver });
  assert.ok(seen.some((options) => options.type === "long-animation-frame"));
  callbacks["long-animation-frame"]({
    getEntries: () => [{
      duration: 63000,
      blockingDuration: 62000,
      scripts: [
        {
          duration: 50000,
          sourceURL: "https://example.test/tools/clipmaker/editor.js",
          sourceFunctionName: "renderFrame",
          invokerType: "classic-script",
        },
        {
          duration: 900,
          sourceURL: "https://example.test/tools/clipmaker/worker.js",
          sourceFunctionName: "",
          invokerType: "task",
        },
      ],
    }],
  });
  const event = api.getSnapshot().events.find((entry) => entry.type === "long-animation-frame");
  assert.equal(event.durationMs, 63000);
  assert.equal(event.blockingDurationMs, 62000);
  assert.ok(event.scripts.some((script) => /editor\.js/.test(script) && /renderFrame/.test(script)));
  assert.ok(!JSON.stringify(event).includes("clipmaker/editor"));
});

test("short animation frames are ignored and unsupported browsers stay silent", () => {
  let deliver;
  class FakeObserver {
    constructor(callback) {
      deliver = callback;
    }
    observe() {}
  }
  FakeObserver.supportedEntryTypes = ["longtask"];
  const { api } = loadDebugLog({ PerformanceObserver: FakeObserver });
  deliver({ getEntries: () => [{ duration: 1200 }] });
  const events = api.getSnapshot().events;
  assert.ok(events.some((entry) => entry.type === "long-task"));
  assert.ok(!events.some((entry) => entry.type === "long-animation-frame"));
});

test("a finished export page records completion through the download adapter", async () => {
  const { install } = require("../zoidium/direct-download");
  const records = [];
  const globalObject = {
    PZ: { downloadBlob: null, downloadFilename: null, ui: { export: {} } },
    location: { href: "https://example.test/tools/clipmaker/" },
    open() {},
    ZOIDIUM_DEBUG_LOG: {
      recordExportComplete(details) {
        records.push(details);
      },
      recordExportError(error, details) {
        records.push({ error: error.message, ...details });
      },
    },
  };
  globalObject.window = globalObject;
  function DeviceExport() {
    this.params = { format: "webm_vp8_opus" };
  }
  DeviceExport.prototype.createFinishedPage = function () {
    return {};
  };
  globalObject.PZ.ui.export.device = DeviceExport;
  install(globalObject, { downloadArtifact() {} });
  globalObject.PZ.downloadBlob = new Blob(["video"]);
  globalObject.PZ.downloadFilename = "video.webm";
  new DeviceExport().createFinishedPage();
  assert.equal(records.length, 1);
  assert.equal(records[0].format, "webm");
  assert.equal(records[0].bytes, 5);
});
