"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadRestore, flush } = require("./restore-database.test.js");
const { createHarness } = require("./project-files.test.js");

async function restoreHarness() {
  let fingerprint = "content-1", builds = 0;
  const h = loadRestore({ projectFiles: { createArchive: async (_editor, options) => {
    if (await options.shouldSkip(fingerprint)) return { skipped: true };
    builds++;
    return { blob: new Blob([fingerprint]), projectName: "project", assetCount: 0, fingerprint };
  } } });
  await flush();
  return Object.assign(h, { panelApi: h.sandbox.__zoidiumRestoreParts.panel,
    store: h.sandbox.__zoidiumRestoreParts.store, builds: () => builds,
    edit: () => { fingerprint = "content-2"; } });
}

test("pre-replace reuses verified matching content, but an edit creates a new point", async () => {
  const h = await restoreHarness();
  const first = await h.panelApi.createSnapshot(false, false);
  assert.equal(await h.panelApi.createSnapshot(false, false, { reuse: true }), null);
  assert.equal(h.builds(), 1);
  h.edit();
  const second = await h.panelApi.createSnapshot(false, false, { reuse: true });
  assert.equal(h.builds(), 2);
  assert.notEqual(first.id, second.id);
  assert.equal(await second.blob.text(), "content-2");
});

test("a deleted or damaged matching restore point cannot suppress a dirty backup", async () => {
  for (const damage of ["deleted", "corrupt"]) {
    const h = await restoreHarness();
    const first = await h.panelApi.createSnapshot(false, false);
    if (damage === "deleted") await h.store.deleteSnapshot(first.id);
    else {
      const records = h.idb.databases["zoidium-restore-points"].stores.snapshots.records;
      records.get(first.id).blob = new Blob(["corrupt"]);
    }
    await h.panelApi.createSnapshot(false, false, { reuse: true });
    assert.equal(h.builds(), 2, damage);
  }
});

test("pre-replace rechecks after an in-flight automatic backup", async () => {
  const h = await restoreHarness();
  let release;
  const original = h.projectFiles.createArchive;
  h.projectFiles.createArchive = async (...args) => {
    await new Promise(resolve => { release = resolve; });
    return original(...args);
  };
  const automatic = h.panelApi.createSnapshot(false, true);
  await flush();
  const replacing = h.panelApi.createSnapshot(false, false, { reuse: true });
  h.projectFiles.createArchive = original;
  release();
  await automatic;
  assert.equal(await replacing, null);
  assert.equal(h.builds(), 1);
});

test("pre-replace appends without waiting for another tab's Web Lock", async () => {
  const h = await restoreHarness();
  const calls = [];
  h.sandbox.AbortController = AbortController;
  h.sandbox.navigator = { locks: { request: async (name, options, task) => {
    calls.push(options);
    assert.equal(options.ifAvailable, true);
    assert.equal(options.signal, undefined, "Web Locks forbids signal with ifAvailable");
    return task(null);
  } } };
  await h.panelApi.createSnapshot(false, false, { reuse: true });
  assert.equal(calls.length, 1, "only nonblocking retention needs the lock");
  assert.equal((await h.store.listSnapshots()).length, 1);
});

test("a stale fallback lease cannot delay a pre-replace backup", async () => {
  const h = await restoreHarness();
  const db = await h.store.openDatabase();
  await new Promise(resolve => {
    const tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").put({ id: "__zoidium_restore_writer_lease__", token: "closed", expiresAt: Date.now() + 120000 });
    tx.oncomplete = resolve;
  });
  await h.panelApi.createSnapshot(false, false, { reuse: true });
  assert.equal((await h.store.listSnapshots()).length, 1);
  assert.equal(h.timeouts.filter(([, ms]) => ms === 100).length, 0);
});

test("New shows progress after 300 ms and acknowledges repeated clicks", async () => {
  const timers = [], notices = [], hidden = [];
  const h = createHarness({ setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} });
  const editor = h.makeEditor();
  let release, backups = 0, options;
  h.windowObject.__zoidiumRestoreParts = {
    panel: { createSnapshot: (_show, _auto, value) => { backups++; options = value; return new Promise(resolve => { release = resolve; }); } },
    toasts: { showToast: value => notices.push(value), hideProgress: token => hidden.push(token) },
  };
  const first = editor.new();
  assert.equal(notices.length, 0);
  timers.find(value => value.ms === 300).fn();
  assert.equal(notices[0].title, "Creating a new project");
  const second = editor.new();
  assert.equal(notices[1].title, "Already working");
  assert.equal(backups, 1);
  assert.equal(options.reuse, true);
  release();
  await Promise.all([first, second]);
  assert.equal(hidden.length, 1);
  assert.equal(editor._zoidiumTransitionPromise, null);
});

test("failed dirty backup keeps the project unless the user approves replacement", async () => {
  const h = createHarness(), editor = h.makeEditor(), current = editor.project;
  let questions = 0;
  h.windowObject.__zoidiumRestoreParts = { panel: { createSnapshot: async () => { throw new Error("Storage full"); } } };
  h.windowObject.ZoidiumUI = { confirm: async () => { questions++; return false; } };
  await editor.new();
  assert.equal(questions, 1);
  assert.equal(editor.project, current);
  assert.ok(h.events.some(event => event.type === "zoidium:project-error"));
});

test("an edit during skip validation prevents replacement", async () => {
  const h = createHarness(), editor = h.makeEditor();
  await assert.rejects(h.projectFiles.createArchive(editor, { shouldSkip() {
    editor.project.ui.onChanged.update();
    return true;
  } }), /current project changed/);
});

test("project spans record failures without recording project content", async () => {
  const io = require("../plugins/core/project-archive.js"), events = [];
  const previous = global.ZOIDIUM_DEBUG_LOG;
  global.ZOIDIUM_DEBUG_LOG = { record: (type, detail) => events.push({ type, detail }) };
  try {
    await assert.rejects(io.span("decode", async () => { throw new Error("private document"); }), /private document/);
    assert.equal(events[0].detail.status, "failed");
    assert.equal(events[0].detail.name, "decode");
    assert.equal(JSON.stringify(events).includes("private document"), false);
  } finally { global.ZOIDIUM_DEBUG_LOG = previous; }
});

test("Backup now still creates an explicit manual point when content is unchanged", async () => {
  const h = await restoreHarness();
  await h.panelApi.createSnapshot(false, false);
  const second = await h.panelApi.createSnapshot(true, false);
  assert.equal(second.automatic, false);
  assert.equal(h.builds(), 2);
  assert.equal((await h.store.listSnapshots()).length, 2);
});

test("immutable Blob digests are reusable and mutable array edits are rehashed", async () => {
  const io = require("../plugins/core/project-archive.js");
  const bytes = new Uint8Array([1, 2, 3]);
  const blob = new Blob([bytes]);
  const first = await io.hash(blob);
  assert.equal(await io.hash(blob), first);
  assert.equal(await io.hash(bytes), first);
  bytes[0] = 9;
  assert.notEqual(await io.hash(bytes), first);
  assert.equal(await io.hash(blob), first);
});

test("a pre-replace write failure retains prior points while maintenance is locked", async () => {
  const h = await restoreHarness();
  await h.panelApi.createSnapshot(false, false);
  h.edit();
  const db = await h.store.openDatabase(), original = db.transaction;
  db.transaction = function (...args) {
    const tx = original.apply(db, args), objectStore = tx.objectStore;
    tx.objectStore = function (...values) {
      const store = objectStore.apply(tx, values);
      store.add = function () { throw Object.assign(new Error("Full"), { name: "QuotaExceededError" }); };
      return store;
    };
    return tx;
  };
  h.sandbox.AbortController = AbortController;
  h.sandbox.navigator = { locks: { request: async (_name, _options, task) => task(null) } };
  await assert.rejects(h.panelApi.createSnapshot(false, false, { reuse: true }), /storage is full/);
  assert.equal((await h.store.listSnapshots()).length, 1);
});

test("pre-replace maintenance uses valid native Web Locks options", async () => {
  const h = await restoreHarness();
  h.sandbox.AbortController = AbortController;
  h.sandbox.navigator = { locks: navigator.locks };
  await h.panelApi.createSnapshot(false, false, { reuse: true });
  assert.equal((await h.store.listSnapshots()).length, 1);
});
