"use strict";

// Coverage for the true-datamosh export module
// (plugins/openzoid-legacy/datamosh-export.js). The real module and the real
// bundled renderer run against a fake export device page, a fake editor and a
// tiny synthetic WebM (2 keyframes, 5 video frames). The tests check that the
// options page gains an off-by-default dropdown, that an export with the pass
// off is byte-identical, that full-video and at-cuts passes replace the blob
// with a moshed file plus the finished note, that failures fall back to the
// clean render, and that disposal restores the host prototypes.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const LEGACY = "plugins/openzoid-legacy/";

// Synthetic WebM: Info (1ms scale), one V_VP8 video track, clusters at 0ms
// (key + 2 predicted) and 1000ms (key + 1 predicted).
const WEBM_BASE64 =
  "GkXfo4AYU4Bn5hVJqWaIKtexhAAPQkAWVK5rjK6K14EBhoVWX1ZQOB9DtnWk54EAo4mBAACAnAEqECCjiYEAIQCFASoQIKOJgQBCAIUBKhAgH0O2dZrnggPoo4mBAACAnAEqECCjiYEAIQCFASoQIA==";

function webmBytes() {
  return new Uint8Array(Buffer.from(WEBM_BASE64, "base64"));
}

function fakeEl(name) {
  const element = {
    name: name || "el",
    children: [],
    appendChild(child) {
      element.children.push(child);
      return child;
    },
    insertBefore(child, before) {
      const at = element.children.indexOf(before);
      if (at < 0) element.children.push(child);
      else element.children.splice(at, 0, child);
      return child;
    },
    get lastElementChild() {
      return element.children[element.children.length - 1];
    },
  };
  return element;
}

function loadModule() {
  const source = fs.readFileSync(path.join(root, LEGACY + "datamosh-export.js"), "utf8");
  const module = { exports: {} };
  new Function("module", "exports", "plugin", source)(module, module.exports, {});
  return module.exports;
}

function renderSource() {
  return fs.readFileSync(path.join(root, LEGACY + "datamosh-render.js"), "utf8");
}

function createHarness() {
  const dropdowns = [];
  const navigated = [];
  const finishedCalls = [];
  const PZ = {
    downloadBlob: null,
    downloadFilename: "video.webm",
    ui: {
      export: {},
      controls: {
        legacy: {
          generateDropdown(options, owner) {
            dropdowns.push({ options, owner });
            return fakeEl("dropdown:" + options.title);
          },
          generateDescription({ content }) {
            return fakeEl("desc");
          },
        },
      },
    },
  };
  class Device {
    constructor(exporter, editor) {
      this.export = exporter;
      this.editor = editor;
      this.params = null;
    }
    createOptionsPage() {
      this.params = { format: "webm_vp8_opus" };
      const page = fakeEl("options");
      page.appendChild(fakeEl("start"));
      return page;
    }
    createFinishedPage() {
      finishedCalls.push(this.params);
      const page = fakeEl("finished");
      page.appendChild(fakeEl("desc"));
      page.appendChild(fakeEl("spacer"));
      page.appendChild(fakeEl("download"));
      return page;
    }
    renderCleanUp() {}
  }
  PZ.ui.export.device = Device;
  const exporter = {
    createPage() {
      return fakeEl("progress");
    },
    navigate(page) {
      navigated.push(page);
    },
  };
  const editor = {
    sequence: {
      properties: { rate: { get: () => 30 } },
      videoTracks: [{ clips: [{ start: 0, length: 60 }] }],
    },
  };
  const disposers = [];
  const context = {
    PZ,
    editor,
    getAsset: (type, assetPath) => {
      assert.equal(type, "text");
      assert.equal(assetPath, "./plugins/openzoid-legacy/datamosh-render.js");
      return renderSource();
    },
    lifecycle: {
      onDispose(cleanup) {
        disposers.push(cleanup);
      },
    },
  };
  return { PZ, Device, exporter, editor, context, dropdowns, navigated, finishedCalls, disposers };
}

function flushAsync(rounds = 10) {
  return (async () => {
    for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
  })();
}

test("activation installs the renderer and the options dropdown, off by default", () => {
  const h = createHarness();
  const plugin = loadModule();
  plugin.activate(h.context);
  assert.ok(h.PZ.datamoshRender, "PZ.datamoshRender installed");
  assert.equal(typeof h.PZ.datamoshRender.mosh, "function");
  assert.equal(typeof h.PZ.datamoshRender.probe, "function");

  const device = new h.Device(h.exporter, h.editor);
  const page = device.createOptionsPage();
  assert.equal(h.dropdowns.length, 1);
  assert.equal(h.dropdowns[0].options.title, "True datamosh");
  assert.equal(h.dropdowns[0].options.items, "off;full video;at clip cuts");
  assert.equal(h.dropdowns[0].options.get(), 0, "off by default");
  h.dropdowns[0].options.set(1);
  assert.equal(device.params.mosh, 1);
  assert.ok(page.children.length >= 3, "dropdown and hint inserted before Start");

  for (const dispose of h.disposers) dispose();
  assert.equal(h.PZ.datamoshRender, undefined, "renderer removed on disposal");
  assert.equal(h.PZ.ui.export.device.prototype.createOptionsPage.__openzoidTrueMosh, undefined);
});

test("an export with the pass off is byte-identical", async () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const device = new h.Device(h.exporter, h.editor);
  device.createOptionsPage();
  const bytes = webmBytes();
  h.PZ.downloadBlob = new Blob([bytes], { type: "video/webm" });
  const page = device.createFinishedPage();
  assert.equal(page.name, "finished", "passes straight through to the finished page");
  assert.equal(h.navigated.length, 0, "no extra navigation");
  assert.equal(await h.PZ.downloadBlob.arrayBuffer().then((b) => b.byteLength), bytes.length);
  assert.equal(h.PZ.downloadFilename, "video.webm");
});

test("full-video mosh replaces the blob and records the finished note", async () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const device = new h.Device(h.exporter, h.editor);
  device.createOptionsPage();
  device.params.mosh = 1;
  const bytes = webmBytes();
  h.PZ.downloadBlob = new Blob([bytes], { type: "video/webm" });
  const progress = device.createFinishedPage();
  assert.equal(progress.name, "progress", "a mosh status page shows first");
  await flushAsync();
  assert.equal(h.navigated.length, 1, "the finished page follows the pass");
  const delivered = new Uint8Array(await h.PZ.downloadBlob.arrayBuffer());
  assert.notDeepEqual(Array.from(delivered), Array.from(bytes), "the file differs");
  assert.equal(h.PZ.downloadFilename, "video-moshed.webm");
  assert.equal(device.moshNote, "TRUE MOSH: dropped 1 of 2 keyframes (5 video frames).");
  assert.deepEqual(
    Array.from(h.PZ.datamoshRender.probe(delivered).keyframes.map((k) => k.ts)),
    [0],
    "the delivered file moshes",
  );
  const finished = h.navigated[0];
  assert.equal(finished.children.length, 4, "the note joins the finished page");
});

test("at-cuts mosh drops keyframes near clip cuts only", async () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const device = new h.Device(h.exporter, h.editor);
  device.createOptionsPage();
  device.params.mosh = 2;
  // Two one-second clips: cuts at 0, 1000 and 2000 ms, so the 1000 ms
  // keyframe sits inside a cut window while the first keyframe is kept.
  h.editor.sequence.videoTracks = [{ clips: [{ start: 0, length: 30 }, { start: 30, length: 30 }] }];
  h.PZ.downloadBlob = new Blob([webmBytes()], { type: "video/webm" });
  device.createFinishedPage();
  await flushAsync();
  assert.equal(h.PZ.downloadFilename, "video-moshed.webm");
  assert.equal(device.moshNote, "TRUE MOSH: dropped 1 of 2 keyframes (5 video frames).");
});

test("a failed pass falls back to the clean render with a failure note", async () => {
  const h = createHarness();
  loadModule().activate(h.context);
  const device = new h.Device(h.exporter, h.editor);
  device.createOptionsPage();
  device.params.mosh = 1;
  const clean = new Blob([new Uint8Array([1, 2, 3])], { type: "video/webm" });
  h.PZ.downloadBlob = clean;
  device.createFinishedPage();
  await flushAsync();
  assert.equal(h.PZ.downloadBlob, clean, "the clean blob is delivered");
  assert.equal(h.PZ.downloadFilename, "video.webm");
  assert.match(device.moshNote, /failed.*clean render delivered/);
  assert.equal(h.navigated.length, 1);
});
