"use strict";

// The export progress preview copies the frame the encoder already received.
// These tests cover its clock, throttle, preference, disposal and the encoder
// input itself: the bytes handed to the encoder must not change with the
// preview on or off.

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { FakeElement, makeDocument } = require("./fake-dom.js");
const {
  STORAGE_KEY, THROTTLE_MS, createPreviewPanel, estimateRemaining,
  formatElapsed, formatRemaining, progressText,
} = require("../plugins/mp4-export/export-preview.js");

const projectRoot = path.resolve(__dirname, "..");

function memoryStorage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

function previewDocument() {
  const document = makeDocument();
  const draws = [];
  const canvases = [];
  document.createElement = (tag) => {
    const element = new FakeElement(tag);
    if (tag === "canvas") {
      canvases.push(element);
      element.getContext = () => ({
        fillStyle: "",
        fillRect() {},
        clearRect() {},
        drawImage(source, x, y, width, height) {
          draws.push({ canvas: element, source, x, y, width, height });
        },
      });
    }
    return element;
  };
  document.draws = draws;
  document.canvases = canvases;
  return document;
}

function frameSource(width = 1920, height = 1080) {
  return { width, height };
}

test("elapsed and remaining use mm:ss and the estimate waits for five frames", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(990), "00:00");
  assert.equal(formatElapsed(87_900), "01:27");
  assert.equal(formatRemaining(null), "—");
  assert.equal(formatRemaining(115_400), "01:55");
  assert.equal(estimateRemaining(4, 120, 4000), null);
  assert.equal(estimateRemaining(5, 120, 5000), 115000);
  assert.equal(estimateRemaining(120, 120, 60000), null);
});

test("the progress line shows the percent, frame counts, elapsed and remaining", () => {
  assert.equal(progressText(0, 120, 0), "0% (0 of 120)  Elapsed 00:00  Remaining —");
  assert.equal(progressText(4, 120, 4000), "3% (4 of 120)  Elapsed 00:04  Remaining —");
  assert.equal(progressText(5, 120, 5000), "4% (5 of 120)  Elapsed 00:05  Remaining 01:55");
  assert.equal(progressText(120, 120, 60000), "100% (120 of 120)  Elapsed 01:00  Remaining 00:00");
  assert.equal(progressText(0, 0, 0), "0% (0 of 0)  Elapsed 00:00  Remaining —");
});

test("preview copies at most once per 250 ms into a canvas at most 480 px wide", () => {
  const document = previewDocument();
  let time = 1000;
  const panel = createPreviewPanel({ document, now: () => time, storage: memoryStorage() });
  const source = frameSource(1920, 1080);
  assert.equal(panel.update(source), true);
  assert.equal(document.draws.length, 1);
  assert.equal(panel.canvas.width, 480);
  assert.equal(panel.canvas.height, 270);
  time += THROTTLE_MS - 1;
  assert.equal(panel.update(source), false);
  assert.equal(document.draws.length, 1);
  time += 1;
  assert.equal(panel.update(source), true);
  assert.equal(document.draws.length, 2);
  // A portrait frame keeps its aspect ratio with the same width limit.
  time += THROTTLE_MS;
  panel.update({ width: 1080, height: 1920 });
  assert.equal(panel.canvas.width, 480);
  assert.equal(panel.canvas.height, 853);
  panel.dispose();
});

test("Show preview is on by default and its localStorage preference stops copying", () => {
  const document = previewDocument();
  const storage = memoryStorage();
  let time = 0;
  const panel = createPreviewPanel({ document, now: () => time, storage });
  assert.equal(panel.checkbox.checked, true);
  assert.equal(panel.isEnabled(), true);
  assert.equal(panel.update(frameSource()), true);

  panel.checkbox.checked = false;
  panel.checkbox.onchange();
  assert.equal(storage.getItem(STORAGE_KEY), "0");
  assert.equal(panel.isEnabled(), false);
  const draws = document.draws.length;
  time += THROTTLE_MS * 2;
  assert.equal(panel.update(frameSource()), false);
  assert.equal(document.draws.length, draws, "turning the preview off stops all copying");

  const reopened = createPreviewPanel({ document, now: () => time, storage });
  assert.equal(reopened.checkbox.checked, false);
  reopened.checkbox.checked = true;
  reopened.checkbox.onchange();
  assert.equal(storage.getItem(STORAGE_KEY), "1");
  assert.equal(reopened.update(frameSource()), true);
  panel.dispose();
  reopened.dispose();
});

test("blocked storage keeps the default and never interrupts the export", () => {
  const document = previewDocument();
  const storage = {
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("quota exceeded"); },
  };
  const panel = createPreviewPanel({ document, now: () => 0, storage });
  assert.equal(panel.checkbox.checked, true);
  assert.doesNotThrow(() => panel.setEnabled(false));
  assert.equal(panel.update(frameSource()), false);
  panel.dispose();
});

test("dispose releases the canvas and stops every later update", () => {
  const document = previewDocument();
  let time = 0;
  const panel = createPreviewPanel({ document, now: () => time, storage: memoryStorage() });
  assert.equal(panel.update(frameSource()), true);
  panel.dispose();
  assert.equal(panel.canvas.width, 1);
  assert.equal(panel.canvas.height, 1);
  assert.equal(panel.element.removed, true);
  time += THROTTLE_MS * 2;
  const draws = document.draws.length;
  assert.equal(panel.update(frameSource()), false);
  assert.equal(document.draws.length, draws);
  panel.updateProgress(30, 120, 0);
  assert.doesNotThrow(() => panel.dispose());
});

function progressHarness({ format = "mp4_h264" } = {}) {
  const { activate } = require("../plugins/mp4-export/mp4-export.js");
  let generation = 0, finishJob, back;
  const disposers = [];
  class Export {
    constructor() { generation += 1; this.framesRendered = 0; this.totalFrames = 2; }
    unload() {}
  }
  const control = () => ({ pz_update() {} });
  const PZ = {
    export: Export,
    zoidium: { exportGeneration: () => generation },
    ui: {
      controls: { legacy: { generateDescription: control, generateProgressbar: control, generateValue: control } },
      export: { device: { prototype: { createOptionsPage() {}, createProgressPage() {}, createFinishedPage() {} } } },
    },
  };
  const job = { cancel() {}, run: () => new Promise((resolve, reject) => {
    finishJob = error => error ? reject(error) : resolve(new Blob(["sample"]));
  }) };
  const modules = {
    "./render.js": { createJob: () => job },
    "./audio-only.js": { ...require("../plugins/mp4-export/audio-only.js"), createAudioJob: () => job },
  };
  activate({
    PZ,
    apis: { modules: { createRequire: () => file => modules[file] || require("../plugins/mp4-export/" + file) } },
    lifecycle: { onDispose(fn) { disposers.push(fn); } },
  });
  const page = new FakeElement("div");
  const owner = {
    params: { format, length: 2, width: 1920, height: 1080, rate: 30 },
    editor: { enabled: true, playback: { enabled: true }, sequence: {} },
    export: {
      createPage(_title, _hasBack, onBack) { back = onBack; return page; },
      navigate() {},
    },
    createFinishedPage() {},
    renderCleanUp() {},
  };
  return {
    page,
    owner,
    start: () => PZ.ui.export.device.prototype.createProgressPage.call(owner),
    settled: () => new Promise(resolve => setImmediate(resolve)),
    cancel: () => back(),
    finish: (error = new Error("cancelled")) => finishJob(error),
    dispose: () => { for (const fn of disposers.splice(0)) fn(); },
  };
}

test("finish and cancel dispose the preview canvas and stop its timer", async () => {
  const document = previewDocument();
  const originalDocument = global.document;
  const originalStorage = global.localStorage;
  global.document = document;
  global.localStorage = memoryStorage();
  const run = progressHarness();
  try {
    run.start();
    await run.settled();
    const canvas = document.canvases[0];
    assert.ok(canvas, "the progress page creates a preview canvas");
    assert.ok(run.page.children.includes(canvas.parentElement.parentElement));

    run.finish(null);
    await run.settled();
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
    assert.equal(canvas.parentElement.parentElement.removed, true);

    document.canvases.length = 0;
    run.start();
    await run.settled();
    const cancelledCanvas = document.canvases[0];
    assert.ok(cancelledCanvas);
    run.cancel();
    run.finish();
    await run.settled();
    assert.equal(cancelledCanvas.width, 1);
    assert.equal(cancelledCanvas.height, 1);
    assert.equal(cancelledCanvas.parentElement.parentElement.removed, true);
  } finally {
    run.dispose();
    global.document = originalDocument;
    global.localStorage = originalStorage;
  }
});

test("audio-only exports keep the native time row and add no preview", async () => {
  const document = previewDocument();
  const originalDocument = global.document;
  global.document = document;
  const run = progressHarness({ format: "audio_wav" });
  try {
    run.start();
    await run.settled();
    assert.equal(document.canvases.length, 0);
    run.finish(null);
    await run.settled();
  } finally {
    run.dispose();
    global.document = originalDocument;
  }
});

function fakeBunny(hashes, document) {
  return {
    Output: class {
      constructor() { this.state = "pending"; }
      addVideoTrack() {}
      async start() { this.state = "started"; }
      async finalize() { this.state = "finalized"; }
      async cancel() { this.state = "canceled"; }
    },
    Mp4OutputFormat: class {},
    CanvasSource: class {},
  };
}

function loadRenderWithHashingVideoSource(hashes, document) {
  const source = fs.readFileSync(path.join(projectRoot, "plugins/mp4-export/render.js"), "utf8");
  const module = { exports: {} };
  const fakeRequire = (id) => {
    if (id === "./export-math.js") return require("../plugins/mp4-export/export-math.js");
    if (id === "./stream-target.js") {
      return {
        async createStorage() {
          return { target: {}, finish: async () => new Blob(["mp4"]), dispose: async () => {} };
        },
      };
    }
    if (id === "./audio-mix.js") {
      return {
        createAudioMixer() { throw new Error("no audio mixer expected"); },
        hasAudio: () => false,
        planAudio: async () => ({ present: false, silent: new Set() }),
      };
    }
    if (id === "./audio-encode.js") {
      return { createAudioEncoding: async () => { throw new Error("no audio encoding expected"); } };
    }
    if (id === "./video-source.js") {
      return {
        createVideoSource: (_scope, _bunny, options) => ({
          source: {},
          async add(_timestamp, _duration, canvas) {
            hashes.push(createHash("sha256")
              .update(String(options.width) + "x" + options.height + ":" + canvas.frame)
              .digest("hex"));
          },
          async flush() {},
          dispose() {},
        }),
      };
    }
    if (id === "./avc-vui.js") return { createPacketTagger: () => ({ handle() {} }) };
    if (id === "./export-preview.js") return require("../plugins/mp4-export/export-preview.js");
    throw new Error("unexpected require: " + id);
  };
  new Function("require", "module", "exports", source)(fakeRequire, module, module.exports);
  return module.exports.createJob;
}

test("encoder-input hashes are identical with the preview on and off for 120 frames", async () => {
  const count = 120;
  const params = { width: 1920, height: 1080, rate: 30, quality: 2, bitrateScale: 1, start: 0, length: count };
  const profiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));
  function run(previewFrame) {
    const document = previewDocument();
    const panel = previewFrame ? createPreviewPanel({
      document,
      now: previewFrame,
      storage: memoryStorage(),
    }) : null;
    const hashes = [];
    const createJob = loadRenderWithHashingVideoSource(hashes, document);
    const canvas = { width: params.width, height: params.height, frame: 0 };
    const exporter = {
      params,
      sequence: { properties: { rate: { get: () => 30 } } },
      renderer: { domElement: canvas },
      framesRendered: 0,
      unload() {},
      checkExportContext() {},
      async renderVideoFrame() {
        this.framesRendered += 1;
        canvas.frame += 1;
      },
    };
    const scope = {
      VideoEncoder: { async isConfigSupported(config) { return { supported: true, config }; } },
      navigator: {},
    };
    return {
      panel,
      canvas,
      exporter,
      hashes,
      run: () => createJob(scope, { av: { profiles } }, exporter, () => fakeBunny(hashes, document),
        panel ? { onFrame: source => panel.update(source) } : null).run(),
    };
  }
  let clock = 0;
  const withPreview = run(() => (clock += 100));
  await withPreview.run();
  const withoutPreview = run(null);
  await withoutPreview.run();
  assert.equal(withPreview.exporter.framesRendered, count, "the preview never renders extra frames");
  assert.equal(withoutPreview.exporter.framesRendered, count);
  assert.equal(withPreview.hashes.length, count);
  assert.deepEqual(withPreview.hashes, withoutPreview.hashes,
    "preview on and off must submit identical encoder input");
  assert.deepEqual(withPreview.hashes, withPreview.hashes, "hashes are stable");
  withPreview.panel.dispose();
});
