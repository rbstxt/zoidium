"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { install } = require("./mp4-export-pages-fixture.cjs");
const { MP4_FORMAT } = require("../plugins/mp4-export/export-math.js");
const { WAV, M4A } = require("../plugins/mp4-export/audio-only.js");

test("MP4 deactivation restores connected options pages and native controls", () => {
  const { Device, deactivate } = install();
  const nativePage = Device.prototype.createOptionsPage;
  try {
    const first = new Device(), second = new Device();
    const firstPage = first.createOptionsPage(), secondPage = second.createOptionsPage();
    assert.equal(firstPage.isConnected, true);
    assert.equal(firstPage.format.options.length, 4);
    firstPage.format.selectedIndex = 1;
    firstPage.format.onchange();
    assert.equal(first.params.format, MP4_FORMAT);
    assert.equal(firstPage.quality.disabled, true);
    assert.match(firstPage.quality.title, /MP4 quality/);
    firstPage.format.selectedIndex = 0;
    firstPage.format.onchange();
    assert.equal(firstPage.format.nativeChanges, 1);
    assert.equal(firstPage.quality.disabled, false);
    firstPage.format.selectedIndex = 1;
    firstPage.format.onchange();
    deactivate();
    assert.notEqual(Device.prototype.createOptionsPage, nativePage);
    for (const [owner, page] of [[first, firstPage], [second, secondPage]]) {
      assert.equal(page.format.options.length, 1);
      assert.equal(owner.params.format, "mkv");
      assert.equal(page.format.selectedIndex, 0);
      assert.equal(page.quality.disabled, false);
      assert.equal(page.quality.title, "Native quality");
      page.format.onchange();
      assert.ok(page.format.nativeChanges >= 1);
      assert.equal(page.isConnected, true);
    }
  } finally { deactivate(); }
});

test("MP4 cleanup preserves a later control wrapper and changed quality title", () => {
  const { Device, deactivate } = install();
  try {
    const owner = new Device(), page = owner.createOptionsPage();
    const laterChange = () => {};
    page.format.onchange = laterChange;
    page.quality.title = "Changed by another extension";
    deactivate();
    assert.equal(page.format.onchange, laterChange);
    assert.equal(page.quality.title, "Changed by another extension");
  } finally { deactivate(); }
});

for (const alphaOrder of ["first", "last"]) {
  test(`audio hides alpha controls and restores them with the alpha listener ${alphaOrder}`, () => {
    const { Device, deactivate } = install({ alphaOrder });
    const owner = new Device();
    const page = owner.createOptionsPage();
    const [label, hint] = page.alphaRows;
    const [input] = label.children;
    function choose(prefix) {
      const select = page.format;
      select.selectedIndex = select.options.findIndex(option => option.text.startsWith(prefix));
      assert.notEqual(select.selectedIndex, -1);
      if (alphaOrder === "first") select.dispatchEvent(new Event("change"));
      select.onchange();
      if (alphaOrder === "last") select.dispatchEvent(new Event("change"));
    }
    function checkAlpha() {
      assert.equal(label.style.display, "flex");
      input.checked = true;
      input.dispatchEvent(new Event("change"));
      assert.equal(owner.params.transparentBackground, true);
    }
    try {
      for (const [extension, format] of [[".wav", WAV], [".m4a", M4A]]) {
        choose(".webm");
        assert.equal(hint.style.display, "none");
        checkAlpha();
        choose(extension);
        assert.equal(owner.params.format, format);
        assert.equal(label.style.display, "none");
        assert.equal(hint.style.display, "none");
        assert.equal(hint.textContent, "");
        assert.equal(input.disabled, true);
        assert.equal(input.checked, false);
        assert.equal(Object.hasOwn(owner.params, "transparentBackground"), false);
      }
      choose(".mp4");
      assert.equal(label.style.display, "none");
      assert.equal(hint.style.display, "");
      assert.equal(hint.textContent, "H.264 MP4 has no alpha channel.");
      choose(".webm");
      assert.equal(input.checked, false);
      checkAlpha();
      choose(".wav");
      page.isConnected = false;
      const reopened = owner.createOptionsPage();
      const [reopenedLabel, reopenedHint] = reopened.alphaRows;
      assert.equal(reopenedLabel.style.display, "flex");
      assert.equal(reopenedLabel.children[0].checked, false);
      assert.equal(reopenedHint.style.display, "none");
      assert.equal(owner.params.format, "mkv_vp8_opus");
      assert.equal(Object.hasOwn(owner.params, "transparentBackground"), false);

      reopened.format.selectedIndex = reopened.format.options.findIndex(option => option.text.startsWith(".wav"));
      reopened.format.onchange();
      assert.equal(reopenedLabel.style.display, "none");
      deactivate();
      assert.equal(reopened.format.selectedIndex, 0);
      assert.equal(owner.params.format, "mkv_vp8_opus");
      assert.equal(reopenedLabel.style.display, "flex");
      assert.equal(reopenedHint.style.display, "none");
    } finally { deactivate(); }
  });
}

test("MP4 bookkeeping collects 100 closed pages and devices while connected pages remain restorable", () => {
  const result = spawnSync(process.execPath, ["--expose-gc", "-e", `
    const assert = require("node:assert/strict");
    const { install } = require("./test/mp4-export-pages-fixture.cjs");
    (async () => {
      const { Device, deactivate } = install();
      const live = new Device(), connected = live.createOptionsPage();
      connected.format.selectedIndex = 1;
      connected.format.onchange();
      function abandon() {
        const owner = new Device(), page = owner.createOptionsPage();
        page.isConnected = false;
        return [new WeakRef(page), new WeakRef(owner)];
      }
      const refs = Array.from({ length: 100 }, abandon).flat();
      try {
        for (let i = 0; i < 12; i++) { await new Promise(setImmediate); global.gc(); }
        assert.equal(refs.filter(ref => ref.deref() !== undefined).length, 0,
          "closed options pages and devices must be collectible with the plugin active");
        assert.equal(connected.quality.disabled, true);
        deactivate();
        assert.equal(connected.format.options.length, 1);
        assert.equal(connected.quality.disabled, false);
        assert.equal(live.params.format, "mkv");
      } finally { deactivate(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, ".."), encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

function progressHarness() {
  const { activate } = require("../plugins/mp4-export/mp4-export.js");
  let generation = 0, finishJob;
  const disposers = [];
  class Export {
    constructor() { generation += 1; this.framesRendered = 0; this.totalFrames = 1; }
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
  let back;
  const owner = {
    params: { format: "mp4_h264" },
    editor: { enabled: true, playback: { enabled: true }, sequence: {} },
    export: {
      createPage(_title, _hasBack, onBack) { back = onBack; return { appendChild: item => item }; },
      navigate() {},
    },
    createFinishedPage() {},
    renderCleanUp() {},
  };
  const start = () => PZ.ui.export.device.prototype.createProgressPage.call(owner);
  const settled = () => new Promise(resolve => setImmediate(resolve));
  return { Export, owner, start, settled, cancel: () => back(), finish: (error = new Error("cancelled")) => finishJob(error),
    dispose: () => { for (const fn of disposers.splice(0)) fn(); } };
}

test("WAV, M4A and MP4 telemetry records the format at start, completion and failure", async () => {
  const original = global.ZOIDIUM_DEBUG_LOG;
  const events = [];
  global.ZOIDIUM_DEBUG_LOG = {
    recordExportStart: ({ format }) => events.push(["start", format]),
    recordExportComplete: ({ format, filename }) => events.push(["complete", format, filename]),
    recordExportError: (_error, { format }) => events.push(["error", format]),
  };
  const run = progressHarness();
  try {
    for (const [format, extension, name] of [[WAV, "wav", "audio"], [M4A, "m4a", "audio"], [MP4_FORMAT, "mp4", "video"]]) {
      run.owner.params.format = format;
      run.start();
      await run.settled();
      run.finish(null);
      await run.settled();
      run.start();
      await run.settled();
      run.finish(new Error("encoder failed"));
      await run.settled();
      assert.deepEqual(events.splice(0), [
        ["start", extension], ["complete", extension, name + "." + extension],
        ["start", extension], ["error", extension],
      ]);
    }
  } finally {
    run.dispose();
    global.ZOIDIUM_DEBUG_LOG = original;
  }
});

test("a cancelled MP4 job returns the editor when no other render started", async () => {
  const run = progressHarness();
  run.start();
  await run.settled();
  run.cancel();
  assert.equal(run.owner.editor.enabled, false);
  run.finish();
  await run.settled();
  assert.equal(run.owner.editor.enabled, true);
  assert.equal(run.owner.editor.playback.enabled, true);
  run.dispose();
});

test("a cancelled MP4 job leaves the editor to a render that started after it", async () => {
  const run = progressHarness();
  run.start();
  await run.settled();
  run.cancel();
  // A native render took over before the cancelled frame finished.
  new run.Export();
  run.owner.editor.enabled = false;
  run.owner.editor.playback.enabled = false;
  run.finish();
  await run.settled();
  assert.equal(run.owner.editor.enabled, false);
  assert.equal(run.owner.editor.playback.enabled, false);
  run.dispose();
});
