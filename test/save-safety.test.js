"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness, addProjectEntries } = require("./project-files.test.js");

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
    const started = Date.now();
    assert.equal(await editor.save(), null);
    assert.ok(Date.now() - started < 2000);
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

test("an asset property whose descriptor vanished from the asset table is rejected", async () => {
  const { h, io, archive } = setup();
  const a = archive();
  const project = { assets: {}, media: [], sequence: { properties: { font: "a".repeat(32) } } };
  a.peekFile("project").data = new Blob([JSON.stringify(project)]);
  await assert.rejects(h.projectFiles.openValidatedArchive(await io.encode(a), "restore"), /project.sequence.properties.font.*has no asset metadata/);
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
  const h = createHarness({ setTimeout: fastTimers });
  const editor = h.makeEditor();
  let finishOpening;
  const opening = new Promise(resolve => { finishOpening = resolve; });
  let aborted = false;
  let written = false;
  editor._zoidiumSaveFileHandle = { createWritable: () => opening };
  assert.equal(await editor.save(), null);
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
  await assert.rejects(h.projectFiles.openValidatedArchive(await io.encode(a), "restore"), /font.keyframes.0.value.*has no asset metadata/);
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

test("plugin texture maps and imported data references require asset metadata", async () => {
  const { h, io, archive } = setup();
  for (const field of ["roughnessMap", "importedLutData"]) {
    const a = archive();
    a.peekFile("project").data = new Blob([JSON.stringify({ assets: {}, media: [], sequence: { properties: { [field]: "b".repeat(32) } } })]);
    await assert.rejects(h.projectFiles.openValidatedArchive(await io.encode(a), "restore"), new RegExp(field + ".*has no asset metadata"));
  }
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
