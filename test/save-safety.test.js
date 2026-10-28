"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, addProjectEntries, flush } = require("./project-files.test.js");

function setup() {
  const h = createHarness();
  const io = h.PZ.zoidiumProjectArchive;
  function archive(assets = {}, entries = []) {
    const a = new h.PZ.archive();
    addProjectEntries(a, { assets, sequence: {}, media: [] });
    for (const [name, data] of entries) a.addFile(name, new Blob([data]));
    return a;
  }
  return { h, io, archive };
}

test("empty, ZIP, truncated gzip, and incomplete TAR containers never reach the loader", async () => {
  const { h, io, archive } = setup();
  const valid = await io.encode(archive());
  const incomplete = new Blob([new Uint8Array(512)]).stream().pipeThrough(new CompressionStream("gzip"));
  for (const blob of [new Blob([]), new Blob(["PK\x03\x04"]), valid.slice(0, valid.size - 8), await new Response(incomplete).blob()]) {
    await assert.rejects(h.projectFiles.openValidatedArchive(blob, "open"), { name: "ProjectDataError" });
  }
});

test("missing entries, empty assets, wrong sizes, and wrong hashes identify the asset", async () => {
  const { h, io, archive } = setup();
  const name = await io.hash(new Blob(["correct image"]));
  const assets = { [name]: { sha256: name, filename: "scene-image.png", size: 13, source: 1 } };
  for (const entries of [[], [[name, ""]], [[name, "short"]], [[name, "changed image"]]]) {
    await assert.rejects(h.projectFiles.openValidatedArchive(await io.encode(archive(assets, entries)), "restore"), /scene-image\.png/);
  }
});

test("full integrity hashes detect same-size mutations in non-asset entries", async () => {
  const { h, io, archive } = setup();
  const a = archive({}, [["plugin-data", "12345"]]);
  const integrity = await io.integrity(a);
  a.addFileString("zoidium.json", JSON.stringify({ name: "test", integrity }));
  a.peekFile("plugin-data").data = new Blob(["54321"]);
  await assert.rejects(h.projectFiles.openValidatedArchive(await io.encode(a), "restore"), /plugin-data.*SHA-256/);
});

test("huge entry headers are rejected before allocating their declared data", async () => {
  const { h, io, archive } = setup();
  const compressed = await io.encode(archive());
  const raw = new Uint8Array(await new Response(compressed.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  raw.set(new TextEncoder().encode((1024 * 1024 * 1024).toString(8).padStart(11, "0") + "\0"), 124);
  raw.fill(32, 148, 156);
  const sum = raw.subarray(0, 512).reduce((total, value) => total + value, 0);
  raw.set(new TextEncoder().encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
  const bad = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
  await assert.rejects(h.projectFiles.openValidatedArchive(bad, "open"), /oversized.*meta/);
});

test("failed write and close abort the writable without clearing the dirty flag", async () => {
  for (const fail of ["write", "close"]) {
    const h = createHarness();
    const editor = h.makeEditor();
    let aborted = 0;
    let committed = false;
    editor._zoidiumSaveFileHandle = { async createWritable() { return {
      async write() { if (fail === "write") throw new Error("Write failed"); },
      async close() { if (fail === "close") throw new Error("Close failed"); committed = true; },
      async abort() { aborted += 1; },
    }; } };
    assert.equal(await editor.save(), null);
    assert.equal(aborted, 1);
    assert.equal(committed, false);
    assert.equal(editor.project.ui.dirty, true);
    assert.equal(h.downloads(), 0);
  }
});

test("a damaged writer output is decoded and rejected before createWritable or download", async () => {
  const h = createHarness();
  let opened = 0;
  h.PZ.zoidiumProjectArchive.encode = async () => new Blob(["damaged"]);
  const editor = h.makeEditor();
  editor._zoidiumSaveFileHandle = { async createWritable() { opened += 1; } };
  assert.equal(await editor.save(), null);
  assert.equal(opened, 0);
  assert.equal(h.downloads(), 0);
});

function fastTimers(callback, ms) {
  const timer = setTimeout(callback, ms === 10000 ? 100 : ms);
  if (ms === 60000) timer.unref();
  return timer;
}

test("pending serialization and asset reads settle with precise errors and preserve the old file", async () => {
  for (const kind of ["serializer", "asset"]) {
    const h = createHarness({ setTimeout: fastTimers });
    const editor = h.makeEditor();
    let writes = 0;
    if (kind === "serializer") h.PZ.project.save = () => new Promise(() => {});
    else editor.project.assets.list.image = { key: "image", file: { size: 4, arrayBuffer: () => new Promise(() => {}) } };
    editor._zoidiumSaveFileHandle = { async createWritable() { writes += 1; } };
    assert.equal(await editor.save(), null);
    assert.equal(writes, 0);
    assert.equal(editor._zoidiumSavePromise, null);
    assert.equal(editor.project.ui.dirty, true);
    const error = h.events.find(event => event.type === "zoidium:project-error");
    assert.match(error.detail.message, kind === "asset" ? /Entry image.*did not finish/ : /Project serialization.*did not finish/);
  }
});

test("unreadable assets can be recovered partially, while damaged project JSON cannot", async () => {
  const { h, io, archive } = setup();
  const a = archive({ missing: { sha256: "missing", source: 1, filename: "font.ttf" } });
  try { await h.projectFiles.openValidatedArchive(await io.encode(a), "open"); assert.fail(); }
  catch (error) { assert.ok(error.partialArchive); assert.match(error.message, /font.ttf/); }
  a.peekFile("project").data = new Blob(["bad json"]);
  try { await h.projectFiles.openValidatedArchive(await io.encode(a), "open"); assert.fail(); }
  catch (error) { assert.equal(error.partialArchive, undefined); }
});

test("slow nested loading is awaited on open instead of failing a valid project", async () => {
  const h = createHarness({ setTimeout: fastTimers });
  const editor = h.makeEditor();
  let finish;
  const child = { defaultName: "Texture object", loading: new Promise(resolve => { finish = resolve; }) };
  editor.loadedProject = { children: [child] };
  const loading = editor.loadProject({});
  // Well past the 10 s save deadline (100 ms under fastTimers).
  await new Promise(resolve => setTimeout(resolve, 300));
  finish();
  assert.equal(await loading, editor.loadedProject);
});

test("a save that waits on a stuck object lets the user keep waiting or save now", async () => {
  const h = createHarness({ setTimeout: fastTimers });
  const editor = h.makeEditor();
  const answers = [false, true];
  const prompts = [];
  h.windowObject.ZoidiumUI = { async confirm(options) { prompts.push(options); return answers.shift(); } };
  editor.project.children = [{ defaultName: "Image material", loading: new Promise(() => {}) }];
  const result = await h.projectFiles.createArchive(editor, { interactive: true });
  assert.equal(prompts.length, 2);
  assert.match(prompts[0].message, /Image material loading has not finished/);
  assert.equal(prompts[0].confirmLabel, "Save now");
  assert.ok(result.blob.size > 0);
  await h.projectFiles.openValidatedArchive(result.blob, "open");
});

test("a failed protective backup asks before replacing the project", async () => {
  for (const proceed of [true, false]) {
    const h = createHarness();
    const editor = h.makeEditor();
    const failure = new Error("Restore-point storage is full.");
    const prompts = [];
    h.windowObject.__zoidiumRestoreParts = { panel: { async createSnapshot() { throw failure; } } };
    h.windowObject.ZoidiumUI = { async confirm(options) { prompts.push(options); return proceed; } };
    const backup = h.projectFiles.backupBeforeReplace(editor, "opening another project");
    if (proceed) await backup;
    else await assert.rejects(backup, /storage is full/);
    assert.match(prompts[0].message, /opening another project \(Restore-point storage is full\.\)/);
  }
});

test("I/O deadlines grow with the data size", () => {
  const { io } = setup();
  assert.equal(io.budget(0), 10000);
  assert.equal(io.budget(4096), 10000);
  assert.equal(io.budget(400 * 1024 * 1024), 110000);
  assert.equal(io.budget(1024, 60000), 60000);
  assert.ok(io.MAX_BYTES >= 2048 * 1024 * 1024);
});

test("a completed save cannot attach its old file handle to a replacement project", async () => {
  const h = createHarness();
  const editor = h.makeEditor();
  let writing;
  const ready = new Promise(resolve => { writing = resolve; });
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const oldHandle = { async createWritable() { return {
    async write() { writing(); await gate; }, async close() {}, async abort() {},
  }; } };
  editor._zoidiumSaveFileHandle = oldHandle;
  const save = editor.save();
  await ready;
  const next = { assets: { list: {} }, ui: { dirty: true, onChanged: { watch() {}, unwatch() {} } } };
  editor.project = next;
  editor._zoidiumSaveFileHandle = null;
  finish();
  await save;
  assert.equal(editor._zoidiumSaveFileHandle, null);
  assert.equal(next.ui.dirty, true);
});

// A reference to an asset that is not in the project is kept and reported:
// refusing would lose every other change and no bytes exist to keep.
async function danglingOf(h, io, a) {
  const decoded = await h.projectFiles.openValidatedArchive(await io.encode(a), "restore");
  return (await h.projectFiles.validateProjectArchive(decoded, "restore")).danglingAssets;
}

test("an asset property whose descriptor vanished from the asset table is reported, not fatal", async () => {
  const { h, io, archive } = setup();
  const a = archive();
  const project = { assets: {}, media: [], sequence: { properties: { font: "a".repeat(32) } } };
  a.peekFile("project").data = new Blob([JSON.stringify(project)]);
  assert.deepEqual(Array.from(await danglingOf(h, io, a)), ["project.sequence.properties.font (" + "a".repeat(32) + ")"]);
});

test("pending writable operations abort and clear the save state", async () => {
  for (const kind of ["write", "close"]) {
    const h = createHarness({ setTimeout: fastTimers });
    const editor = h.makeEditor();
    let aborted = false;
    const pending = new Promise(() => {});
    editor._zoidiumSaveFileHandle = { async createWritable() { return {
      write: () => kind === "write" ? pending : Promise.resolve(),
      close: () => kind === "close" ? pending : Promise.resolve(),
      async abort() { aborted = true; },
    }; } };
    assert.equal(await editor.save(), null);
    assert.equal(aborted, true);
    assert.equal(editor._zoidiumSavePromise, null);
    assert.equal(editor.project.ui.dirty, true);
    assert.equal(h.downloads(), 0);
  }
});

test("a writable returned after the deadline is aborted without receiving bytes", async () => {
  let deadline, opened;
  const openingStarted = new Promise(resolve => { opened = resolve; });
  const h = createHarness({ setTimeout(callback, ms) {
    if (ms === 10000) deadline = callback;
    const timer = setTimeout(callback, ms);
    if (ms === 60000) timer.unref();
    return timer;
  } });
  const editor = h.makeEditor();
  let finishOpening;
  const opening = new Promise(resolve => { finishOpening = resolve; });
  let aborted = false;
  let written = false;
  editor._zoidiumSaveFileHandle = { createWritable() { opened(); return opening; } };
  const saving = editor.save();
  await openingStarted;
  deadline();
  assert.equal(await saving, null);
  finishOpening({ async abort() { aborted = true; }, async write() { written = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted, true);
  assert.equal(written, false);
  assert.equal(editor.project.ui.dirty, true);
});

test("animated asset references retain their field name during validation", async () => {
  const { h, io, archive } = setup();
  const a = archive();
  const project = { assets: {}, media: [], sequence: { properties: { font: { keyframes: [{ value: "a".repeat(32) }] } } } };
  a.peekFile("project").data = new Blob([JSON.stringify(project)]);
  assert.match((await danglingOf(h, io, a))[0], /font.keyframes.0.value/);
});

test("invalid integrity records fail with the entry name and cannot be opened partially", async () => {
  const { h, io, archive } = setup();
  const a = archive();
  a.addFileString("zoidium.json", JSON.stringify({ integrity: { project: null } }));
  await assert.rejects(h.projectFiles.openValidatedArchive(await io.encode(a), "open"), error => {
    assert.equal(error.name, "ProjectDataError");
    assert.match(error.message, /integrity record.*project/);
    assert.equal(error.partialArchive, undefined);
    return true;
  });
});

test("an edit during a protective backup cancels project replacement", async () => {
  const h = createHarness();
  const editor = h.makeEditor();
  h.windowObject.__zoidiumRestoreParts = { panel: { async createSnapshot() { editor.project.ui.onChanged.update(); } } };
  await assert.rejects(h.projectFiles.backupBeforeReplace(editor, "New"), /current project changed/);
});

test("plugin texture maps and imported data references without metadata are reported", async () => {
  const { h, io, archive } = setup();
  for (const field of ["roughnessMap", "importedLutData", "nodeImage"]) {
    const a = archive();
    a.peekFile("project").data = new Blob([JSON.stringify({ assets: {}, media: [], sequence: { properties: { [field]: "b".repeat(32) } } })]);
    assert.match((await danglingOf(h, io, a))[0], new RegExp(field));
  }
});

test("a save keeps a stale node-image selection instead of refusing the whole project", async () => {
  const h = createHarness();
  const editor = h.makeEditor();
  h.PZ.project.save = archive => addProjectEntries(archive, { assets: {}, media: [],
    sequence: { properties: { material: { properties: { nodeImage: "c".repeat(64) } } } } });
  const result = await h.projectFiles.createArchive(editor, { interactive: true });
  assert.ok(result.blob.size > 0);
  await h.projectFiles.openValidatedArchive(result.blob, "open");
});

test("pending object and plugin initialization never serialize default project state", async () => {
  for (const kind of ["object", "plugin"]) {
    const h = createHarness({ setTimeout: fastTimers });
    const editor = h.makeEditor();
    let serialized = false;
    const original = h.PZ.project.save;
    h.PZ.project.save = function (...args) { serialized = true; return original(...args); };
    if (kind === "object") editor.project.children = [{ defaultName: "Image material", loading: new Promise(() => {}) }];
    else editor.project._zoidiumPluginActivationPending = new Promise(() => {});
    assert.equal(await editor.save(), null);
    assert.equal(serialized, false);
    assert.equal(h.downloads(), 0);
    assert.equal(editor.project.ui.dirty, true);
    assert.match(h.events.find(event => event.type === "zoidium:project-error").detail.message,
      kind === "object" ? /Image material loading.*did not finish/ : /Project plugin activation.*did not finish/);
  }
});

test("a slow asset read in a user save asks to keep waiting and closes the question when it finishes", async () => {
  const h = createHarness({ setTimeout: fastTimers });
  const editor = h.makeEditor();
  let finishRead;
  const prompts = [];
  h.windowObject.AbortController = AbortController;
  h.windowObject.ZoidiumUI = {
    confirm(options) {
      prompts.push(options);
      // The user leaves the question open; the read finishes meanwhile.
      if (prompts.length === 1) setTimeout(() => finishRead(new Uint8Array([1, 2, 3, 4]).buffer), 150);
      return new Promise(resolve => options.signal.addEventListener("abort", () => resolve(false)));
    },
  };
  editor.project.assets.list.video = { key: "video", sha256: "video", filename: "clip.mp4",
    file: { size: 4, arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) } };
  const result = await h.projectFiles.createArchive(editor, { interactive: true });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].message, /Entry video \(clip\.mp4\) is taking longer than expected/);
  assert.equal(prompts[0].confirmLabel, "Keep waiting");
  assert.equal(prompts[0].signal.aborted, true);
  assert.ok(result.blob.size > 0);
});

test("a slow asset read stops only when the user chooses to stop saving", async () => {
  const h = createHarness({ setTimeout: fastTimers });
  const editor = h.makeEditor();
  const answers = [true, false];
  const prompts = [];
  h.windowObject.ZoidiumUI = { async confirm(options) { prompts.push(options); return answers.shift(); } };
  editor.project.assets.list.video = { key: "video", sha256: "video", filename: "clip.mp4",
    file: { size: 4, arrayBuffer: () => new Promise(() => {}) } };
  await assert.rejects(h.projectFiles.createArchive(editor, { interactive: true }), /Entry video \(clip\.mp4\) was stopped/);
  assert.equal(prompts.length, 2, "keep waiting re-arms the same budget once");
});

test("automatic saves still fail at the deadline instead of asking", async () => {
  const h = createHarness({ setTimeout: fastTimers });
  const editor = h.makeEditor();
  let prompts = 0;
  h.windowObject.ZoidiumUI = { async confirm() { prompts += 1; return true; } };
  editor.project.assets.list.video = { key: "video", sha256: "video", filename: "clip.mp4",
    file: { size: 4, arrayBuffer: () => new Promise(() => {}) } };
  await assert.rejects(h.projectFiles.createArchive(editor, {}), /did not finish within 10 seconds/);
  assert.equal(prompts, 0);
});

// Builds a gzip'd TAR from raw [name, data, type] records, like other writers.
async function rawTar(records, { endMarker = true } = {}) {
  const chunks = [];
  for (const [name, data, type = "0"] of records) {
    const bytes = new TextEncoder().encode(data);
    const header = new Uint8Array(512);
    header.set(new TextEncoder().encode(name.slice(0, 99)), 0);
    header.set(new TextEncoder().encode("0000644\0"), 100);
    header.set(new TextEncoder().encode(bytes.length.toString(8).padStart(11, "0") + "\0"), 124);
    header.fill(32, 148, 156);
    header[156] = type.charCodeAt(0);
    header.set(new TextEncoder().encode("ustar\0" + "00"), 257);
    const sum = header.reduce((total, value) => total + value, 0);
    header.set(new TextEncoder().encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
    chunks.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
  }
  if (endMarker) chunks.push(new Uint8Array(1024));
  return new Response(new Blob(chunks).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

test("archives from other TAR writers open: ./ names, PAX and GNU long names, no end marker", async () => {
  const { h } = setup();
  const meta = JSON.stringify({ version: "1.0.102" });
  const project = JSON.stringify({ assets: {}, media: [], sequence: {} });
  // A PAX record is "<length> path=<name>\n"; the length counts itself.
  const pax = (path) => { const body = " path=" + path + "\n"; return (body.length + 2) + body; };
  const variants = [
    [["./", "", "5"], ["./meta", meta], ["./project", project]],
    [["PaxHeader", pax("meta"), "x"], ["ignored-short-name", meta], ["././@LongLink", "project\0", "L"], ["ignored", project], ["pax_global_header", "9 a=b\n", "g"]],
  ];
  for (const records of variants) {
    for (const endMarker of [true, false]) {
      const archive = await h.projectFiles.openValidatedArchive(await rawTar(records, { endMarker }), "open");
      assert.deepEqual(archive.files.map((entry) => entry.name).sort(), ["meta", "project"]);
    }
  }
  await assert.rejects(h.projectFiles.openValidatedArchive(await rawTar([["link", "meta", "2"]]), "open"), { name: "ProjectDataError" });
});

test("deeply nested compositions are not refused by a nesting limit", async () => {
  const { h, io } = setup();
  const sequence = {};
  let nested = sequence;
  for (let level = 0; level < 400; level += 1) {
    nested.children = [{}];
    nested = nested.children[0];
  }
  const a = new h.PZ.archive();
  addProjectEntries(a, { assets: {}, sequence, media: [] });
  await h.projectFiles.openValidatedArchive(await io.encode(a), "open");
});

test("an unavailable Restore panel asks before replacing the project instead of refusing to open", async () => {
  for (const proceed of [true, false]) {
    const h = createHarness();
    const prompts = [];
    h.windowObject.__zoidiumRestoreParts = null;
    h.windowObject.ZoidiumUI = { async confirm(options) { prompts.push(options); return proceed; } };
    const backup = h.projectFiles.backupBeforeReplace(h.makeEditor(), "opening another project");
    if (proceed) await backup;
    else await assert.rejects(backup, /restore-point storage is not ready/);
    assert.equal(prompts[0].confirmLabel, "Continue without backup");
  }
});

function fireBeforeUnload(listener) {
  const event = { returnValue: undefined, preventDefault() { this.defaultPrevented = true; } };
  listener(event);
  return event;
}

function gatedWriteHandle(onWrite) {
  return { async createWritable() { return {
    async write(blob) { await onWrite(blob); },
    async close() {},
    async abort() {},
  }; } };
}

test("a leave-page guard asks before unloading only while a save is pending", async () => {
  const h = createHarness();
  const editor = h.makeEditor();
  let writeStarted = false;
  let finishWrite;
  const writeGate = new Promise((resolve) => { finishWrite = resolve; });
  editor._zoidiumSaveFileHandle = gatedWriteHandle(async () => { writeStarted = true; await writeGate; });
  assert.deepEqual(h.listeners.beforeunload || [], []);
  const saving = editor.save();
  assert.equal((h.listeners.beforeunload || []).length, 1, "the guard is installed synchronously with the save");
  while (!writeStarted) await flush(1);
  const event = fireBeforeUnload(h.listeners.beforeunload[0]);
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.returnValue, "");
  finishWrite();
  await saving;
  assert.deepEqual(h.listeners.beforeunload || [], [], "the guard is removed after success");
});

test("the leave-page guard is removed after a failed or cancelled save", async () => {
  const h = createHarness();
  const editor = h.makeEditor();
  let writeStarted = false;
  let finishWrite;
  const writeGate = new Promise((resolve) => { finishWrite = resolve; });
  editor._zoidiumSaveFileHandle = gatedWriteHandle(async () => {
    writeStarted = true;
    await writeGate;
    throw new Error("Write failed");
  });
  const saving = editor.save();
  assert.equal((h.listeners.beforeunload || []).length, 1);
  while (!writeStarted) await flush(1);
  finishWrite();
  assert.equal(await saving, null);
  assert.deepEqual(h.listeners.beforeunload || [], [], "the guard is removed after an error");

  const cancelled = createHarness();
  let rejectPicker;
  cancelled.windowObject.showSaveFilePicker = () => new Promise((resolve, reject) => { rejectPicker = reject; });
  const cancelling = cancelled.makeEditor().save();
  assert.equal((cancelled.listeners.beforeunload || []).length, 1);
  const abort = new Error("The user aborted a request.");
  abort.name = "AbortError";
  rejectPicker(abort);
  assert.equal(await cancelling, null);
  assert.deepEqual(cancelled.listeners.beforeunload || [], [], "the guard is removed after a cancel");
  assert.equal(cancelled.events.filter((event) => event.type === "zoidium:notification").length, 0);
});

test("a save shows one keep-open notice until it finishes", async () => {
  for (const via of ["remembered", "picker"]) {
    const h = createHarness();
    const editor = h.makeEditor();
    const writable = gatedWriteHandle(async () => {});
    if (via === "remembered") editor._zoidiumSaveFileHandle = writable;
    else h.windowObject.showSaveFilePicker = async () => ({ name: "picked.pz", ...writable });
    await editor.save();
    const notices = h.events.filter((event) => event.type === "zoidium:notification");
    assert.equal(notices.length, 1, "one notice per " + via + " save");
    assert.equal(notices[0].detail.title, "Saving...");
    assert.match(notices[0].detail.message, /Keep this page open until saving finishes/);
    assert.ok(h.events.some((event) => event.type === "zoidium:project-saved"));
  }
});

test("a failure after the picker warns that the chosen file may be empty", async () => {
  const h = createHarness();
  h.windowObject.showSaveFilePicker = async () => ({ name: "new.pz" });
  h.PZ.project.save = () => { throw new Error("Serialization failed."); };
  assert.equal(await h.makeEditor().save(), null);
  const buildError = h.events.find((event) => event.type === "zoidium:project-error");
  assert.match(buildError.detail.message, /chosen file may now be empty/);
  assert.match(buildError.detail.message, /Save again to replace it/);
  assert.doesNotMatch(buildError.detail.message, /Download/);

  const written = createHarness();
  const writable = gatedWriteHandle(async () => { throw new Error("Write failed"); });
  written.windowObject.showSaveFilePicker = async () => ({ name: "new.pz", ...writable });
  assert.equal(await written.makeEditor().save(), null);
  const writeError = written.events.find((event) => event.type === "zoidium:project-error");
  assert.match(writeError.detail.message, /chosen file may now be empty/);
  assert.match(writeError.detail.message, /or use Download/);
  assert.equal(typeof writeError.detail.download, "function");

  const resaved = createHarness();
  const editor = resaved.makeEditor();
  editor._zoidiumSaveFileHandle = gatedWriteHandle(async () => { throw new Error("Write failed"); });
  assert.equal(await editor.save(), null);
  const resaveError = resaved.events.find((event) => event.type === "zoidium:project-error");
  assert.match(resaveError.detail.message, /Write failed/);
  assert.doesNotMatch(resaveError.detail.message, /empty/);
});

test("opening a 0-byte file names the interrupted save and the restore points", async () => {
  const h = createHarness();
  await assert.rejects(h.projectFiles.openValidatedArchive(new Blob([]), "open"), (error) => {
    assert.equal(error.name, "ProjectDataError");
    assert.match(error.message, /cannot be opened.*file is empty/);
    assert.match(error.message, /probably interrupted/);
    assert.match(error.message, /RESTORE POINTS/);
    return true;
  });
  await assert.rejects(h.projectFiles.openValidatedArchive(new Blob([]), "save"), /The archive is empty/);
});
