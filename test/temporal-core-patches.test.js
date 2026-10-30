"use strict";

// A15: coverage for the core patch modules that had none —
// render-aspect-ratio.js, video-frame-export.js, export-fps.js and
// image-export-options.js. Each test pins wrapper chaining (the original is
// saved and still invoked with its arguments), idempotent reinstall, and the
// option-page rows each patch adds.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(projectRoot, relative), "utf8");

function fakeElement(tag) {
  return {
    tag,
    children: [],
    style: {},
    value: "",
    innerText: "",
    classList: { add() {} },
    setAttribute() {},
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    querySelector() { return null; },
    parentElement: null,
  };
}

const documentStub = { createElement: (tag) => fakeElement(tag) };

// ---------------------------------------------------------------------------
// render-aspect-ratio.js
// ---------------------------------------------------------------------------

function aspectSandbox() {
  const calls = { renderSequence: 0, renderLayer: 0, compositeScene: 0, unload: 0 };
  class Compositor {}
  Compositor.prototype.renderSequence = function (frame) {
    calls.renderSequence += 1;
    this.lastFrame = frame;
    return "sequence";
  };
  Compositor.prototype.renderLayer = function () {
    calls.renderLayer += 1;
    return "layer";
  };
  Compositor.prototype.compositeScene = function () {
    calls.compositeScene += 1;
    return "scene";
  };
  Compositor.prototype.unload = function () {
    calls.unload += 1;
    return "unload";
  };
  function OriginalExport(sequence, params) {
    this.sequence = sequence;
    this.params = params;
    this.compositor = null;
  }
  OriginalExport.prototype.describe = function () { return "original-export"; };
  let devicePage = null;
  const deviceCalls = { createOptionsPage: 0 };
  class Device {}
  Device.prototype.createOptionsPage = function () {
    deviceCalls.createOptionsPage += 1;
    return devicePage;
  };
  const PZ = {
    compositor: Compositor,
    export: OriginalExport,
    ui: {
      export: { device: Device },
      controls: { legacy: { generateDropdown: (spec) => ({ dropdown: spec }) } },
    },
  };
  const sandbox = { console, PZ, document: documentStub };
  vm.createContext(sandbox);
  vm.runInContext(read("plugins/core/render-aspect-ratio.js"), sandbox, {
    filename: "render-aspect-ratio.js",
  });
  return {
    sandbox, PZ, calls, deviceCalls, OriginalExport, Device,
    setDevicePage: (page) => { devicePage = page; },
  };
}

test("aspect compositor patch delegates when no render settings are present", () => {
  const { PZ, calls } = aspectSandbox();
  assert.equal(PZ.compositor.prototype.__zoidiumRenderAspectRatioPatch, true);
  const compositor = Object.create(PZ.compositor.prototype);
  assert.equal(compositor.renderSequence(12), "sequence");
  assert.deepEqual([calls.renderSequence, compositor.lastFrame], [1, 12]);
});

test("aspect compositor patch restores the camera and ratio after a render", () => {
  const { PZ } = aspectSandbox();
  const compositor = Object.create(PZ.compositor.prototype);
  const viewportOf = (w, h) => ({
    x: 0, y: 0, z: w, w: h, set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; },
  });
  const mixScale = {
    x: 1, y: 1,
    set(x, y) { this.x = x; this.y = y; },
    clone() { return { x: this.x, y: this.y }; },
    copy(other) { this.x = other.x; this.y = other.y; },
  };
  Object.assign(compositor, {
    __zoidiumRenderSettings: { mode: "cover" },
    _sequence: { properties: { resolution: { get: () => [1920, 1080] } } },
    readBuffer: { width: 1920, height: 1080, viewport: viewportOf(1920, 1080) },
    writeBuffer: { width: 1920, height: 1080, viewport: viewportOf(1920, 1080) },
    screenBuffers: [],
    accumBuffers: [],
    mixPass: { uniforms: { uvScale: { value: mixScale } } },
    copyPass: { render() {} },
    camera: {
      left: -960, right: 960, top: 540, bottom: -540, near: 0, far: 1, zoom: 1,
      updateProjectionMatrix() {},
    },
  });
  compositor.renderSequence(3);
  assert.deepEqual(
    [compositor.camera.left, compositor.camera.right, compositor.camera.top, compositor.camera.bottom],
    [-960, 960, 540, -540],
    "camera restored after the aspect render",
  );
  assert.ok(!("ratio" in compositor) || compositor.ratio === undefined);
  assert.deepEqual([mixScale.x, mixScale.y], [1, 1], "mix scale restored");
  assert.equal(compositor.lastFrame, 3, "original renderSequence still ran");
});

test("aspect export wrapper syncs params only for aspect renders", () => {
  const { PZ, OriginalExport } = aspectSandbox();
  assert.equal(PZ.export.__zoidiumAspectRatioPatch, true);
  assert.equal(PZ.export.prototype, OriginalExport.prototype, "prototype preserved");

  const aspect = new PZ.export({}, {
    __zoidiumAspectRender: true, width: 1920, height: 1080, aspectRatio: [4, 3],
  });
  assert.deepEqual(Array.from([aspect.params.width, aspect.params.height]), [1920, 1440]);
  assert.deepEqual(Array.from(aspect.params.aspectRatio), [4, 3]);
  assert.equal(aspect.params.aspectRatioMode, 0, "cover keeps mode 0");
  assert.equal(aspect.describe(), "original-export", "original prototype intact");

  const plain = new PZ.export({}, { width: 800, height: 600 });
  assert.deepEqual(Array.from([plain.params.width, plain.params.height]), [800, 600]);
});

test("aspect device page adds ratio rows and resyncs on resolution change", () => {
  const { PZ, deviceCalls, setDevicePage } = aspectSandbox();
  assert.ok(PZ.ui.export.device.prototype.__zoidiumAspectRatioPatch);

  // A null page passes through the original untouched.
  setDevicePage(null);
  const owner = { params: { width: 1920, height: 1080 }, editor: {} };
  assert.equal(PZ.ui.export.device.prototype.createOptionsPage.call(owner), null);
  assert.equal(deviceCalls.createOptionsPage, 1, "original page builder still runs");

  const inserted = [];
  const container = { insertBefore: (node) => inserted.push(node) };
  const outer = fakeElement("div");
  outer.parentElement = container;
  const inner = fakeElement("div");
  inner.parentElement = outer;
  const resolutionSelect = fakeElement("select");
  resolutionSelect.changed = false;
  resolutionSelect.onchange = function () { resolutionSelect.changed = true; };
  resolutionSelect.parentElement = inner;
  const page = {
    querySelector: () => resolutionSelect,
    querySelectorAll: () => [],
    appendChild: () => {},
  };
  setDevicePage(page);
  const result = PZ.ui.export.device.prototype.createOptionsPage.call(owner);
  assert.equal(result, page);
  assert.equal(deviceCalls.createOptionsPage, 2);
  assert.equal(owner.params.__zoidiumDeviceRender, true);
  assert.deepEqual(Array.from(owner.params.aspectRatio), [16, 9]);
  assert.equal(owner.params.aspectRatioMode, 0);
  assert.equal(inserted.length, 2, "ratio row and mode row inserted");
  assert.equal(typeof inserted[0].pz_update, "function", "ratio row refreshes");
  assert.equal(inserted[1].dropdown.title, "Aspect ratio mode");
  assert.equal(inserted[1].dropdown.get(), 0, "cover mode reads back as 0");

  owner.params.aspectRatio = [4, 3];
  inserted[0].pz_update();
  resolutionSelect.onchange({});
  assert.equal(resolutionSelect.changed, true, "original resolution handler kept");
  assert.deepEqual(Array.from([owner.params.width, owner.params.height]), [1920, 1440]);
});

test("aspect reinstall is a no-op", () => {
  const { sandbox, PZ } = aspectSandbox();
  const compositorRender = PZ.compositor.prototype.renderSequence;
  const exportCtor = PZ.export;
  const devicePage = PZ.ui.export.device.prototype.createOptionsPage;
  vm.runInContext(read("plugins/core/render-aspect-ratio.js"), sandbox, {
    filename: "render-aspect-ratio.js",
  });
  assert.equal(PZ.compositor.prototype.renderSequence, compositorRender);
  assert.equal(PZ.export, exportCtor);
  assert.equal(PZ.ui.export.device.prototype.createOptionsPage, devicePage);
});

// ---------------------------------------------------------------------------
// export-fps.js + image-export-options.js option pages
// ---------------------------------------------------------------------------

function devicePageHarness(sources) {
  const dropdowns = [];
  const calls = { originalOptionsPage: 0 };
  const frameRateRow = {
    replacement: null,
    parentElement: {},
    replaceWith(row) { this.replacement = row; },
  };
  const frameRateSelect = {
    options: [{ text: "30" }, { text: "60" }],
    closest: () => frameRateRow,
  };
  const page = {
    querySelector: () => null,
    querySelectorAll: (selector) => (
      selector === "select.pz-inputbox" ? [frameRateSelect] : []
    ),
    appendChild(child) {
      child.parentElement = page;
      page.children.push(child);
      return child;
    },
    children: [],
  };
  class Device {}
  Device.prototype.createOptionsPage = function () {
    calls.originalOptionsPage += 1;
    return page;
  };
  const PZ = {
    ui: {
      export: { device: Device },
      controls: {
        legacy: {
          generateDropdown: (spec, owner) => {
            dropdowns.push({ spec, owner });
            return { dropdown: spec };
          },
        },
      },
    },
  };
  const sandbox = { console, PZ, document: documentStub };
  vm.createContext(sandbox);
  for (const source of sources) vm.runInContext(read(source), sandbox, { filename: source });
  return { sandbox, PZ, calls, dropdowns, page, frameRateRow, Device };
}

test("export fps page replaces the 30/60 select with a free fps input", () => {
  const { PZ, calls, frameRateRow } = devicePageHarness(["plugins/core/export-fps.js"]);
  assert.ok(PZ.ui.export.device.prototype.__zoidiumExportFpsPatch);
  const owner = {
    params: { rate: 30, length: 300 },
    editor: { sequence: { length: 300, properties: { rate: { get: () => 30 } } } },
  };
  PZ.ui.export.device.prototype.createOptionsPage.call(owner);
  assert.equal(calls.originalOptionsPage, 1, "original page builder still runs");
  assert.ok(frameRateRow.replacement, "frame-rate row replaced");
  const row = frameRateRow.replacement;
  assert.equal(typeof row.pz_update, "function");
  assert.equal(row.children.length, 2, "title plus controls");
  const input = row.children[1].children[0];
  assert.equal(input.style.width, "90px");
  assert.equal(input.value, "30", "input reflects the current rate");

  input.value = "60";
  input.onchange();
  assert.equal(owner.params.rate, 60);
  assert.equal(owner.params.length, 600, "export length follows the rate");

  input.value = "999";
  input.onchange();
  assert.equal(owner.params.rate, 240, "clamped to MAX_FPS");

  input.value = "0.2";
  input.onchange();
  assert.equal(owner.params.rate, 1, "clamped to MIN_FPS");

  input.value = "not a number";
  input.onchange();
  assert.equal(owner.params.rate, 1, "unparseable input keeps the fallback");

  input.value = "６０";
  input.onchange();
  assert.equal(owner.params.rate, 60, "full-width digits normalized");
});

test("export fps reinstall is a no-op", () => {
  const { sandbox, PZ } = devicePageHarness(["plugins/core/export-fps.js"]);
  const before = PZ.ui.export.device.prototype.createOptionsPage;
  vm.runInContext(read("plugins/core/export-fps.js"), sandbox, {
    filename: "export-fps.js",
  });
  assert.equal(PZ.ui.export.device.prototype.createOptionsPage, before);
});

function framePageHarness() {
  const dropdowns = [];
  const calls = { originalOptionsPage: 0, navigate: 0 };
  const appended = [];
  const startButton = {};
  const page = {
    querySelector: () => null,
    querySelectorAll: (selector) => (
      selector === "button.propbutton" ? [startButton] : []
    ),
    appendChild(child) {
      appended.push(child);
      return child;
    },
  };
  class Frame {}
  Frame.prototype.createOptionsPage = function () {
    calls.originalOptionsPage += 1;
    return page;
  };
  const PZ = {
    ui: {
      export: { frame: Frame },
      controls: {
        legacy: {
          generateDropdown: (spec, owner) => {
            dropdowns.push({ spec, owner });
            return { dropdown: spec };
          },
        },
      },
    },
  };
  const sandbox = { console, PZ, document: documentStub };
  vm.createContext(sandbox);
  vm.runInContext(read("plugins/core/image-export-options.js"), sandbox, {
    filename: "image-export-options.js",
  });
  return { sandbox, PZ, calls, dropdowns, appended, startButton, page };
}

test("image export page adds resolution and aspect rows before the format row", () => {
  const { PZ, calls, dropdowns, appended, startButton } = framePageHarness();
  assert.ok(PZ.ui.export.frame.prototype.__zoidiumImageExportOptionsPatch);
  const owner = {
    params: {},
    editor: {
      sequence: { properties: { resolution: { get: () => [1920, 1080] } } },
      playback: { currentFrame: 42 },
    },
    export: { navigate: (page, flag) => { calls.navigate += 1; calls.navigateFlag = flag; } },
    createProgressPage: () => ({ progress: true }),
  };
  const page = PZ.ui.export.frame.prototype.createOptionsPage.call(owner);
  assert.equal(calls.originalOptionsPage, 1, "original page builder still runs");
  assert.equal(appended.length, 3, "resolution + ratio + mode rows added");
  assert.equal(owner.params.aspectRatioMode, 0);
  assert.deepEqual(Array.from(owner.params.aspectRatio), [16, 9], "reduced sequence ratio");
  assert.deepEqual(Array.from([owner.params.width, owner.params.height]), [1920, 1080]);
  assert.equal(
    Object.keys(owner.params).includes("__zoidiumAspectRender"),
    false,
    "aspect flag stays non-enumerable",
  );

  const resolution = dropdowns.find((entry) => entry.spec.title === "Resolution");
  assert.ok(resolution, "resolution dropdown registered");
  resolution.spec.set(0);
  assert.deepEqual(Array.from([owner.params.width, owner.params.height]), [426, 240]);

  const mode = dropdowns.find((entry) => entry.spec.title === "Aspect ratio mode");
  assert.ok(mode, "aspect mode dropdown registered");
  mode.spec.set(1);
  assert.equal(owner.params.aspectRatioMode, 1);

  assert.equal(typeof startButton.onclick, "function", "start handler overridden");
  startButton.onclick();
  assert.equal(owner.params.start, 42);
  assert.equal(calls.navigate, 1);
  assert.equal(calls.navigateFlag, true);
  void page;
});

test("image export reinstall is a no-op", () => {
  const { sandbox, PZ } = framePageHarness();
  const before = PZ.ui.export.frame.prototype.createOptionsPage;
  vm.runInContext(read("plugins/core/image-export-options.js"), sandbox, {
    filename: "image-export-options.js",
  });
  assert.equal(PZ.ui.export.frame.prototype.createOptionsPage, before);
});

// ---------------------------------------------------------------------------
// video-frame-export.js decode path
// ---------------------------------------------------------------------------

function videoFrameSandbox() {
  class Schedule {}
  Schedule.prototype.prepare = async function () {};
  class Export {}
  Export.prototype.getVideoFrame = async function () { return 0; };
  const PZ = { schedule: Schedule, export: Export };
  const sandbox = {
    console, PZ, setTimeout, clearTimeout, queueMicrotask, Promise, AbortController,
  };
  vm.createContext(sandbox);
  vm.runInContext(read("plugins/core/video-frame-export.js"), sandbox, {
    filename: "video-frame-export.js",
  });
  return { sandbox, PZ };
}

function fakeVideo({ duration = 10, readyState = 4 } = {}) {
  const listeners = {};
  let presentedTime = 0;
  const video = {
    readyState,
    duration,
    seeking: false,
    src: "video",
    currentSrc: "video",
    error: null,
    _time: 0,
    get currentTime() { return this._time; },
    set currentTime(value) {
      this._time = value;
      presentedTime = value;
      queueMicrotask(() => fire("seeked"));
    },
    addEventListener(type, listener) {
      (listeners[type] = listeners[type] || []).push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = (listeners[type] || []).filter((entry) => entry !== listener);
    },
    requestVideoFrameCallback(callback) {
      queueMicrotask(() => callback(0, { mediaTime: presentedTime }));
      return 1;
    },
    cancelVideoFrameCallback() {},
  };
  function fire(type) {
    for (const listener of (listeners[type] || []).slice()) listener();
  }
  video.__fire = fire;
  return video;
}

test("decodeFrame seeks exactly and clamps to the media duration", async () => {
  const { PZ } = videoFrameSandbox();
  const diagnostics = PZ.videoFrameExportDiagnostics;
  diagnostics.enabled = true;
  diagnostics.clear();

  const video = fakeVideo({ duration: 10 });
  const schedule = Object.create(PZ.schedule.prototype);
  schedule.el = video;
  schedule.texture = { needsUpdate: false };

  await schedule.decodeFrame(4);
  assert.equal(video.currentTime, 4);
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(schedule.__zoidiumVideoExportState.requestedTime, 4);
  assert.equal(schedule.__zoidiumVideoExportState.presentedMediaTime, 4);

  await schedule.decodeFrame(999);
  assert.ok(
    Math.abs(video.currentTime - (10 - 1e-7)) < 1e-9,
    "clamped below the duration",
  );

  await schedule.decodeFrame(999);
  assert.equal(diagnostics.records.length, 3, "every decode is recorded");
  assert.equal(diagnostics.records.at(-1).reused, true, "repeat frame reuses without reseek");
  assert.equal(video.currentTime, schedule.__zoidiumVideoExportState.requestedTime);
  diagnostics.enabled = false;
});

test("decodeFrame waits for metadata when the video is not ready", async () => {
  const { PZ } = videoFrameSandbox();
  const video = fakeVideo({ readyState: 0 });
  const schedule = Object.create(PZ.schedule.prototype);
  schedule.el = video;
  schedule.texture = { needsUpdate: false };
  const pending = schedule.decodeFrame(2);
  video.readyState = 2;
  video.__fire("loadedmetadata");
  await pending;
  assert.equal(video.currentTime, 2);
});

test("video-frame-export reinstall is a no-op", () => {
  const { sandbox, PZ } = videoFrameSandbox();
  const decode = PZ.schedule.prototype.decodeFrame;
  const frame = PZ.export.prototype.getVideoFrame;
  vm.runInContext(read("plugins/core/video-frame-export.js"), sandbox, {
    filename: "video-frame-export.js",
  });
  assert.equal(PZ.schedule.prototype.decodeFrame, decode);
  assert.equal(PZ.export.prototype.getVideoFrame, frame);
});

test("exact decode excludes playback schedule writes until queued requests settle", async () => {
  const { PZ } = videoFrameSandbox();
  const { installSchedulePatch } = require("../plugins/core/playback-seek-sync");
  let updates = 0, pauses = 0;
  PZ.schedule.prototype.update = () => { updates++; };
  installSchedulePatch(PZ.schedule.prototype);
  const video = fakeVideo();
  video.pause = () => { pauses++; };
  const schedule = Object.assign(new PZ.schedule(), { el: video, texture: {}, playing: true });
  const first = schedule.decodeFrame(2);
  const second = schedule.decodeFrame(4);
  schedule.update(99, 30);
  assert.equal(updates, 0);
  assert.equal(schedule.__zoidiumExactDecodePending, 2);
  await first;
  schedule.update(99, 30);
  assert.equal(updates, 0, "queued requests retain ownership");
  await second;
  assert.equal(schedule.__zoidiumExactDecodePending, 0);
  assert.equal(video.currentTime, 4);
  assert.equal(schedule.playing, false);
  assert.equal(pauses, 2);
  schedule.update(99, 30);
  assert.equal(updates, 1, "native updates resume after decoding");
});

test("failed exact decode releases playback ownership", async () => {
  const { PZ } = videoFrameSandbox();
  const schedule = Object.assign(new PZ.schedule(), { el: fakeVideo(), texture: {} });
  schedule.el.error = new Error("Synthetic decode failure");
  await assert.rejects(schedule.decodeFrame(2), /Synthetic decode failure/);
  assert.equal(schedule.__zoidiumExactDecodePending, 0);
});
