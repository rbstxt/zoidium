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
  const localValues = new Map();
  const sessionValues = new Map();
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
    localStorage: storage(localValues),
    sessionStorage: storage(sessionValues),
    clearTimeout: timers.clearTimeout,
    setTimeout: timers.setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(readSource("zoidium/debug-journal.js"), context, { filename: "debug-journal.js" });
  return { journal: context.__zoidiumDebugParts.journal, runTimers: timers.run, localValues };
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

test("startup verification spans leave older records in the persisted journal", () => {
  const { journal, runTimers, localValues } = loadJournal();
  journal.initializeJournal();
  for (let index = 0; index < 105; index += 1) {
    journal.record("marker", { index });
  }
  for (let point = 0; point < 20; point += 1) {
    for (let span = 0; span < 5; span += 1) {
      journal.record("project-span", { name: "verify restore point", durationMs: span, status: "complete" });
    }
  }
  for (let index = 0; index < 3; index += 1) {
    journal.record("project-span", { name: "verify restore point", durationMs: index, status: "failed" });
  }
  runTimers();
  const persisted = JSON.parse(localValues.get("zoidium.debug-log.journal.v2"));
  const events = persisted.sessions.at(-1).events;
  assert.ok(events.length <= 120);
  assert.equal(events.filter((entry) => entry.type === "marker").length, 105);
  assert.equal(events.filter((entry) => entry.type === "project-span" && entry.status !== "failed").length, 10);
  assert.equal(events.filter((entry) => entry.type === "project-span" && entry.status === "failed").length, 3);
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

function flush(rounds = 8) {
  let chain = Promise.resolve();
  for (let index = 0; index < rounds; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

function installDeviceWorld({ debugLog, params, renderBehavior } = {}) {
  const { install } = require("../zoidium/direct-download");
  const { causeChain } = require("../zoidium/debug-journal");
  const records = [];
  const errors = [];
  const globalObject = {
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    PZ: { downloadBlob: null, downloadFilename: null, ui: { export: {} } },
    console: { error: (message) => errors.push(message) },
    dispatchEvent: (event) => errors.push(event.detail.message),
    location: { href: "https://example.test/tools/clipmaker/" },
    open() {},
  };
  if (debugLog !== false) {
    globalObject.ZOIDIUM_DEBUG_LOG = {
      recordExportStart(details) {
        records.push({ type: "export-start", ...details });
      },
      recordExportComplete(details) {
        records.push({ type: "export-complete", ...details });
      },
      recordExportError(error, details) {
        records.push({ type: "export-error", error: error.message, causes: causeChain(error), ...details });
      },
    };
  }
  globalObject.window = globalObject;
  function DeviceExport() {
    this.params = params || { format: "webm_vp8_opus" };
  }
  DeviceExport.prototype.createProgressPage = function () {
    return {};
  };
  DeviceExport.prototype.createFinishedPage = function () {
    return {};
  };
  if (renderBehavior !== "absent") {
    DeviceExport.prototype.render = renderBehavior || (function () {
      return {};
    });
  }
  DeviceExport.prototype.createErrorPage = function () {
    return {};
  };
  globalObject.PZ.ui.export.device = DeviceExport;
  install(globalObject, { downloadArtifact() {} });
  return { records, errors, globalObject, DeviceExport };
}

test("an MP4 finished page records no second export-complete", () => {
  const { records, globalObject, DeviceExport } = installDeviceWorld({ params: { format: "mp4_h264" } });
  globalObject.PZ.downloadBlob = new Blob(["video"]);
  globalObject.PZ.downloadFilename = "video.mp4";
  new DeviceExport().createFinishedPage();
  assert.equal(records.filter((entry) => entry.type === "export-complete").length, 0);
});

test("a native render failure records the real error message and causes", async () => {
  const failure = new TypeError("Failed to fetch");
  failure.cause = new Error("encoder ran out of memory");
  const { records, DeviceExport } = installDeviceWorld({ renderBehavior() {
    throw failure;
  } });
  const device = new DeviceExport();
  assert.throws(() => device.render());
  device.createErrorPage();
  const error = records.find((entry) => entry.type === "export-error");
  assert.ok(error);
  assert.match(error.error, /Failed to fetch/);
  assert.ok(error.causes.some((cause) => /Failed to fetch/.test(cause)));
  assert.ok(error.causes.some((cause) => /out of memory/.test(cause)));
});

test("a native error page without a stashed error records nothing and still renders", () => {
  const { records, DeviceExport } = installDeviceWorld({});
  new DeviceExport().createErrorPage();
  assert.equal(records.filter((entry) => entry.type === "export-error").length, 0);
});

test("a native error page records the message CM3 passes when nothing was stashed", () => {
  const { records, DeviceExport } = installDeviceWorld({});
  new DeviceExport().createErrorPage("Output was empty.");
  const error = records.find((entry) => entry.type === "export-error");
  assert.ok(error);
  assert.equal(error.error, "Output was empty.");
  assert.equal(error.stage, "render");
});

test("device lifecycle hooks tolerate a missing debug log", () => {
  const { DeviceExport } = installDeviceWorld({ debugLog: false, renderBehavior() {
    throw new TypeError("Failed to fetch");
  } });
  const device = new DeviceExport();
  device.createProgressPage();
  assert.throws(() => device.render());
  assert.deepEqual(device.createErrorPage(), {});
  device.createFinishedPage();
});

test("non-export download failures record no export-error", async () => {
  const { records, errors, globalObject } = installDeviceWorld({});
  assert.equal(globalObject.open("download.html", "_blank"), null);
  await flush();
  assert.equal(records.filter((entry) => entry.type === "export-error").length, 0);
  assert.ok(errors.some((message) => /no longer available/.test(message)));
  globalObject.PZ.downloadBlob = new Blob(["project"]);
  globalObject.PZ.downloadFilename = "project.pz";
  globalObject.open("download.html", "_blank");
  await flush();
  assert.equal(records.filter((entry) => entry.type === "export-error").length, 0);
});

test("a failing export download still records export-error with its format", async () => {
  const { install } = require("../zoidium/direct-download");
  const records = [];
  const globalObject = {
    PZ: { downloadBlob: null, downloadFilename: null, ui: { export: {} } },
    location: { href: "https://example.test/tools/clipmaker/" },
    open() {},
    ZOIDIUM_DEBUG_LOG: {
      recordExportError(error, details) {
        records.push({ error: error.message, ...details });
      },
    },
  };
  globalObject.window = globalObject;
  install(globalObject, { downloadArtifact() { return Promise.reject(new Error("drive full")); } });
  globalObject.PZ.downloadBlob = new Blob(["video"]);
  globalObject.PZ.downloadFilename = "video.webm";
  globalObject.open("download.html", "_blank");
  await flush();
  assert.equal(records.length, 1);
  assert.equal(records[0].format, "webm");
  assert.equal(records[0].stage, "download");
});
