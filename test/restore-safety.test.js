"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { loadRestore, flush } = require("./restore-database.test.js");

async function harness() {
  const h = loadRestore();
  await flush();
  h.store = h.sandbox.__zoidiumRestoreParts.store;
  return h;
}
function record(id, blob = new Blob(["project bytes"])) {
  return { id, blob, createdAt: Date.now(), projectName: "same name", automatic: true, owner: "tab-1" };
}

test("stored bytes are read back and hashed before a snapshot is accepted", async () => {
  const h = await harness();
  await h.store.saveSnapshot(record("good"));
  const point = await h.store.getSnapshot("good");
  point.blob = new Blob(["changed bytes"]);
  await assert.rejects(h.store.verifySnapshot(point), /wrong size or SHA-256/);
  assert.ok((await h.store.getSnapshot("good")).integrity);
});

test("a colliding snapshot ID cannot overwrite the existing backup", async () => {
  const h = await harness();
  await h.store.saveSnapshot(record("shared-id"));
  const db = await h.store.openDatabase();
  const transaction = db.transaction;
  db.transaction = function (...args) {
    const tx = transaction.apply(db, args);
    const objectStore = tx.objectStore;
    tx.objectStore = function (...values) {
      const store = objectStore.apply(tx, values);
      const add = store.add;
      store.add = function (value) {
        if (h.idb.databases["zoidium-restore-points"].stores.snapshots.records.has(value.id)) {
          const error = new Error("Duplicate restore point"); error.name = "ConstraintError"; throw error;
        }
        return add.call(store, value);
      };
      return store;
    };
    return tx;
  };
  await assert.rejects(h.store.saveSnapshot(record("shared-id", new Blob(["other tab"]))), /Duplicate/);
  assert.equal(await (await h.store.getSnapshot("shared-id")).blob.text(), "project bytes");
});

test("quota retries drop an old extra point but preserve the last verified backup", async () => {
  const h = await harness();
  const old = record("old"); old.createdAt -= 20000;
  await h.store.saveSnapshot(old);
  const good = record("last-good"); good.createdAt -= 10000;
  await h.store.saveSnapshot(good);
  const db = await h.store.openDatabase();
  const transaction = db.transaction;
  let failures = 0;
  db.transaction = function (...args) {
    const tx = transaction.apply(db, args);
    const objectStore = tx.objectStore;
    tx.objectStore = function (...values) {
      const store = objectStore.apply(tx, values);
      const add = store.add;
      store.add = function (value) {
        if (value.id === "new" && failures++ === 0) {
          const error = new Error("Full"); error.name = "QuotaExceededError"; throw error;
        }
        return add.call(store, value);
      };
      return store;
    };
    return tx;
  };
  await h.store.saveSnapshot(record("new"));
  assert.equal(await h.store.getSnapshot("old"), undefined);
  assert.ok(await h.store.getSnapshot("last-good"));
  assert.ok(await h.store.getSnapshot("new"));
});

test("restore validation failure leaves the current project and good point intact", async () => {
  const h = await harness();
  await h.store.saveSnapshot(record("good"));
  const current = h.editor.project;
  h.projectFiles.openValidatedArchive = async () => { throw new Error("Bad project entry"); };
  await assert.rejects(h.sandbox.__zoidiumRestoreParts.snapshots.loadSnapshotForAction({ id: "good" }), /Bad project entry/);
  assert.equal(h.editor.project, current);
  assert.ok(await h.store.getSnapshot("good"));
});

test("an expired writer lease is reclaimed and hidden from restore-point lists", async () => {
  const h = await harness();
  const db = await h.store.openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", "readwrite");
    tx.objectStore("snapshots").put({ id: "__zoidium_restore_writer_lease__", token: "closed-tab", expiresAt: Date.now() - 1 });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  await h.store.saveSnapshot(record("new-good"));
  assert.deepEqual(Array.from(await h.store.listSnapshots(), value => value.id), ["new-good"]);
  assert.equal(await h.store.getSnapshot("__zoidium_restore_writer_lease__"), undefined);
});

test("Web Locks guard the complete write and read-back operation", async () => {
  const h = await harness();
  const calls = [];
  h.sandbox.AbortController = AbortController;
  h.sandbox.navigator = { locks: { async request(name, options, task) {
    calls.push({ name, signal: options.signal });
    return task();
  } } };
  await h.store.saveSnapshot(record("locked-good"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "zoidium-restore-writer");
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.ok((await h.store.getSnapshot("locked-good")).integrity);
});
