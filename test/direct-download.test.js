"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  install,
  isDownloadPage,
} = require("../zoidium/direct-download");

function flush(rounds = 8) {
  let chain = Promise.resolve();
  for (let index = 0; index < rounds; index += 1) {
    chain = chain.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return chain;
}

// Mimics the File handle the CM3 workers post back for the origin-private file
// named "out": it stays valid until a later render, save, or cleanup rewrites
// the file, and then every read fails.
function fileBackedExport(bytes) {
  const data = new Uint8Array(bytes);
  const state = { source: new Blob([data]) };
  const blob = {
    name: "out",
    // A File handle keeps the length it reported when it was created.
    size: data.length,
    slice(start, end) {
      return state.source.slice(start, end);
    },
    stream() {
      return state.source.stream();
    },
    arrayBuffer() {
      return state.source.arrayBuffer();
    },
  };
  return {
    blob,
    invalidate() {
      state.source = null;
    },
  };
}

class FakeButton {
  constructor(onclick) {
    this.tagName = "BUTTON";
    this.onclick = onclick;
    this.listeners = [];
  }

  addEventListener(type, listener, capture) {
    if (type === "click") this.listeners.push({ listener, capture });
  }

  click() {
    let stopped = false;
    const event = {
      preventDefault() {},
      stopImmediatePropagation() {
        stopped = true;
      },
    };
    for (const entry of this.listeners.filter((value) => value.capture)) {
      entry.listener(event);
      if (stopped) return;
    }
    if (this.onclick) this.onclick(event);
    if (stopped) return;
    for (const entry of this.listeners.filter((value) => !value.capture)) {
      entry.listener(event);
      if (stopped) return;
    }
  }
}

function makeFinishedPage(globalObject) {
  const button = new FakeButton(() => globalObject.open("download.html", "_blank"));
  return { lastElementChild: button, button };
}

function createWindow() {
  const forwarded = [];
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
    open: function () {
      forwarded.push(Array.from(arguments));
      return "opened";
    },
  };
  globalObject.window = globalObject;

  function DeviceExport() {
    this.params = { format: "webm_vp8_opus" };
  }
  DeviceExport.prototype.createFinishedPage = function () {
    return makeFinishedPage(globalObject);
  };
  function FrameExport() {
    this.params = { format: "png" };
  }
  FrameExport.prototype.createFinishedPage = function () {
    return makeFinishedPage(globalObject);
  };
  globalObject.PZ.ui.export.device = DeviceExport;
  globalObject.PZ.ui.export.frame = FrameExport;
  return { errors, forwarded, globalObject, DeviceExport, FrameExport };
}

test("download page detection accepts only the legacy local target", () => {
  const base = "https://example.test/tools/clipmaker/";
  assert.equal(isDownloadPage("download.html", base), true);
  assert.equal(isDownloadPage("/download/", base), true);
  assert.equal(isDownloadPage("https://other.test/download.html", base), false);
  assert.equal(isDownloadPage("project.pz", base), false);
});

test("each finished page downloads the Blob captured when it was created", async () => {
  const { globalObject, DeviceExport, FrameExport, forwarded } = createWindow();
  const downloads = [];
  install(globalObject, {
    downloadArtifact(blob, filename) {
      downloads.push({ blob, filename });
    },
  });

  const video = new Blob(["video"]);
  globalObject.PZ.downloadBlob = video;
  globalObject.PZ.downloadFilename = "video.webm";
  const videoPage = new DeviceExport().createFinishedPage();

  const image = new Blob(["image"]);
  globalObject.PZ.downloadBlob = image;
  globalObject.PZ.downloadFilename = "image.png";
  const imagePage = new FrameExport().createFinishedPage();

  // Saving a project after both renders must not affect either page.
  globalObject.PZ.downloadBlob = new Blob(["project"]);
  globalObject.PZ.downloadFilename = "project.pz";
  videoPage.button.click();
  imagePage.button.click();
  await flush();

  assert.deepEqual(
    downloads.map((entry) => [entry.blob, entry.filename]),
    [
      [video, "video.webm"],
      [image, "image.png"],
    ],
  );
  assert.deepEqual(forwarded, []);
});

test("cleanup of one render cannot invalidate another finished page", async () => {
  const { globalObject, DeviceExport } = createWindow();
  const downloads = [];
  install(globalObject, {
    downloadArtifact(blob, filename) {
      downloads.push({ blob, filename });
    },
  });

  const first = new Blob(["first"]);
  globalObject.PZ.downloadBlob = first;
  globalObject.PZ.downloadFilename = "video.webm";
  const page = new DeviceExport().createFinishedPage();
  globalObject.PZ.downloadBlob = null;
  globalObject.PZ.downloadFilename = null;
  page.button.click();
  await flush();

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].blob, first);
});

test("a file-backed export is copied before a save reuses the shared file", async () => {
  const { globalObject, DeviceExport } = createWindow();
  const downloads = [];
  install(globalObject, {
    downloadArtifact(blob, filename) {
      downloads.push({ blob, filename });
    },
  });

  const entry = fileBackedExport([1, 2, 3, 4, 5]);
  globalObject.PZ.downloadBlob = entry.blob;
  globalObject.PZ.downloadFilename = "video.webm";
  const page = new DeviceExport().createFinishedPage();

  // The copy starts while the render still owns the file, then a project save
  // rewrites it before the user clicks Download.
  await flush();
  entry.invalidate();

  page.button.click();
  await flush();

  assert.equal(downloads.length, 1);
  assert.notEqual(downloads[0].blob, entry.blob);
  assert.equal(downloads[0].filename, "video.webm");
  assert.deepEqual(
    new Uint8Array(await downloads[0].blob.arrayBuffer()),
    new Uint8Array([1, 2, 3, 4, 5]),
  );
});

test("an unreadable file-backed export reports an error instead of a wrong file", async () => {
  const { errors, globalObject, DeviceExport } = createWindow();
  const downloads = [];
  install(globalObject, {
    downloadArtifact(blob, filename) {
      downloads.push({ blob, filename });
    },
  });

  const entry = fileBackedExport([1, 2, 3]);
  globalObject.PZ.downloadBlob = entry.blob;
  globalObject.PZ.downloadFilename = "video.webm";
  const page = new DeviceExport().createFinishedPage();
  entry.invalidate();
  await flush();

  page.button.click();
  await flush();

  assert.deepEqual(downloads, []);
  assert.ok(errors.some((message) => /temporary file/.test(message)));
});

test("a missing legacy Blob reports an error without opening a blank tab", () => {
  const { errors, forwarded, globalObject } = createWindow();
  install(globalObject, { downloadArtifact() {} });

  assert.equal(globalObject.open("download.html", "_blank"), null);
  assert.equal(forwarded.length, 0);
  assert.ok(errors.some((message) => /no longer available/.test(message)));
});

test("non-download windows still use the original open implementation", () => {
  const { forwarded, globalObject } = createWindow();
  install(globalObject, { downloadArtifact() {} });

  assert.equal(globalObject.open("https://example.test/about"), "opened");
  assert.deepEqual(forwarded, [["https://example.test/about"]]);
});
