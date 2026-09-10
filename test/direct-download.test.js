"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  install,
  isDownloadPage,
} = require("../zoidium/direct-download");

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

test("each finished page downloads the Blob captured when it was created", () => {
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

  assert.deepEqual(
    downloads.map((entry) => [entry.blob, entry.filename]),
    [
      [video, "video.webm"],
      [image, "image.png"],
    ],
  );
  assert.deepEqual(forwarded, []);
});

test("cleanup of one render cannot invalidate another finished page", () => {
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

  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].blob, first);
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
