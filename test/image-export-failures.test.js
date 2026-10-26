"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync("plugins/core/image-export-options.js", "utf8");

function fixture() {
  const pages = [], timers = new Set(), unhandled = [], calls = [];
  let render = async () => new Blob(["image"], { type: "image/png" });
  const exporter = { unloads: 0, unload() { this.unloads++; } };
  const editor = { enabled: true, playback: { enabled: true } };
  class Frame {
    constructor() { this.editor = editor; this.params = { format: "jpg" }; }
    createOptionsPage() {}
    render(value) { assert.equal(value, exporter); return render(); }
    renderCleanUp() { PZ.downloadBlob = null; editor.enabled = editor.playback.enabled = true; }
    createErrorPage() { return { title: "Render error", children: [], appendChild(el) { this.children.push(el); } }; }
    // Model CM3's fulfillment-only caller. Observe the resulting rejection so
    // the regression can assert it without failing the whole Node test process.
    createProgressPage() {
      editor.enabled = editor.playback.enabled = false;
      const timer = {};
      timers.add(timer);
      this.pending = this.render(exporter).then(blob => {
        timers.delete(timer);
        if (blob === undefined) pages.push(this.createErrorPage());
        else {
          PZ.downloadBlob = blob;
          PZ.downloadFilename = "image." + this.params.format;
          pages.push({ title: "Render complete" });
        }
        exporter.unload();
      });
      this.pending.catch(error => unhandled.push(error));
      return { title: "Rendering..." };
    }
  }
  const PZ = { ui: { export: { frame: Frame }, controls: { legacy: {
    generateDescription(spec) { return { innerHTML: spec.content, textContent: "" }; },
  } } }, imageEncoder: {
    canvasToBlob(canvas, format, quality, extra) {
      calls.push({ receiver: this, canvas, format, quality, extra });
      return canvas.toBlob("image/" + format, quality);
    },
  } };
  const sandbox = vm.createContext({ PZ });
  const install = () => vm.runInContext(source, sandbox);
  install();
  return { PZ, Frame, pages, timers, unhandled, editor, exporter, calls, install,
    setRender(fn) { render = fn; } };
}

for (const quality of [0, 0.25, 0.5, 0.75, 1]) {
  test(`JPG canvas requests image/jpeg and retains quality ${quality}`, async () => {
    const f = fixture(), blob = new Blob(["encoded JPEG"], { type: "image/jpeg" });
    const canvas = { toBlob(type, value) {
      assert.equal(type, "image/jpeg"); assert.equal(value, quality); return Promise.resolve(blob);
    } };
    const result = await f.PZ.imageEncoder.canvasToBlob(canvas, "jpg", quality, "extra");
    assert.equal(result, blob);
    assert.equal(f.calls[0].format, "jpeg");
    assert.equal(f.calls[0].receiver, f.PZ.imageEncoder);
    assert.equal(f.calls[0].extra, "extra");
  });
}

for (const format of ["png", "webp", "jpeg"]) test(`${format} encoding passes through unchanged`, async () => {
  const f = fixture(), result = {};
  const canvas = { toBlob(type, quality) {
    assert.equal(type, "image/" + format); assert.equal(quality, 0.75); return result;
  } };
  assert.equal(f.PZ.imageEncoder.canvasToBlob(canvas, format, 0.75), result);
});

for (const message of [
  "WebGL context lost at output index 0, project frame 12, time 0.400000s (before preparation). Start a new export.",
  'Video decode failed for clip "Broken <img src=x onerror=alert(1)>", requested media time 0.400000s, output frame 0, stage metadata: Failed.',
]) test(`frame progress displays the diagnostic and restores the editor: ${message.split(" ")[0]}`, async () => {
  const f = fixture(), owner = new f.Frame();
  const error = new Error(message);
  f.setRender(() => Promise.reject(error));
  assert.equal(owner.createProgressPage().title, "Rendering...");
  await owner.pending.catch(() => {});
  assert.deepEqual(f.unhandled, [], "native caller has no unhandled render rejection");
  assert.equal(f.pages[0]?.title, "Render error");
  assert.equal(f.pages[0].children.at(-1).textContent, "Image export failed. " + message);
  assert.equal(f.pages[0].children.at(-1).innerHTML, "", "diagnostic is text, never HTML");
  assert.equal(f.timers.size, 0);
  assert.equal(f.exporter.unloads, 1);
  assert.equal(f.editor.enabled, true);
  assert.equal(f.editor.playback.enabled, true);
  assert.equal(f.PZ.downloadBlob, null);
  assert.equal(f.PZ.downloadFilename, undefined);
  // A new attempt succeeds and does not retain the earlier error.
  const blob = new Blob(["retry"]);
  f.setRender(async () => blob);
  owner.createProgressPage();
  await owner.pending;
  assert.equal(f.pages.at(-1).title, "Render complete");
  assert.equal(f.PZ.downloadBlob, blob);
  assert.equal(f.PZ.downloadFilename, "image.jpg");
  assert.equal(owner.createErrorPage().children.length, 0);
});

test("successful capture retains the Blob, filename, cleanup, and page flow", async () => {
  const f = fixture(), owner = new f.Frame(), blob = new Blob(["same bytes"]);
  f.setRender(async () => blob);
  owner.createProgressPage();
  await owner.pending;
  assert.equal(f.PZ.downloadBlob, blob);
  assert.equal(f.PZ.downloadFilename, "image.jpg");
  assert.equal(f.pages[0].title, "Render complete");
  assert.equal(f.timers.size, 0);
  assert.equal(f.exporter.unloads, 1);
  assert.equal(f.editor.enabled, false, "native finished-page exit restores the editor");
});

test("reinstall keeps one encoder and one frame render wrapper", () => {
  const f = fixture();
  const before = [f.PZ.imageEncoder.canvasToBlob, f.Frame.prototype.render, f.Frame.prototype.createErrorPage];
  f.install();
  assert.deepEqual([f.PZ.imageEncoder.canvasToBlob, f.Frame.prototype.render, f.Frame.prototype.createErrorPage], before);
});
