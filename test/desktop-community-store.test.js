"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createDiskAdapter, filename } = require("../desktop/community-plugins.cjs");
const { createStore } = require("../zoidium/community-plugin-store");
const manifest = require("../examples/community-filter/manifest.json");
function file(version = "1") {
  return new Blob([JSON.stringify({ schemaVersion: 1, manifest: { ...manifest, version }, assets: { [manifest.entry]: "function prepareEffect() { return {uniforms:{gain:1}}; }" } })]);
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoidium-community-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const adapter = createDiskAdapter(root), store = createStore({ adapter }); await store.open();
  return { root, adapter, store };
}
async function install(store, version = "1") {
  await store.importFile(file(version), store.view().revision);
  const item = store.view().packages[0]; await store.approve(item.id, item.hash, store.view().revision);
  return item.hash;
}
test("desktop packages, approvals, updates, and one rollback survive fresh adapter instances", async t => {
  const { root, store } = await fixture(t), first = await install(store);
  await store.setEnabled(manifest.id, true, store.view().revision);
  const second = await install(store, "2");
  await store.stageOnReload(manifest.id, store.view().revision);
  const reopened = createStore({ adapter: createDiskAdapter(root) }); await reopened.open({ reload: true });
  let item = reopened.view().packages[0];
  assert.equal(item.selected, second); assert.equal(item.previous, first); assert.equal(item.enabled, true);
  await reopened.rollback(manifest.id, reopened.view().revision);
  const next = createStore({ adapter: createDiskAdapter(root) }); await next.open({ reload: true });
  item = next.view().packages[0]; assert.equal(item.selected, first); assert.equal(item.previous, second);
  assert.equal(item.enabled, false); assert.deepEqual(item.approvals.sort(), [first, second].sort());
  const packages = path.join(root, "community-plugins/packages");
  assert.equal((await fs.readFile(path.join(packages, filename(first)))).toString(), await file().text());
  await next.uninstall(manifest.id, next.view().revision); assert.deepEqual(await fs.readdir(packages), []);
});
test("desktop interrupted temporary writes and orphan packages do not change the selected index", async t => {
  const { root, store } = await fixture(t), hash = await install(store);
  await fs.writeFile(path.join(root, "community-plugins/index.json.interrupted.tmp"), "broken");
  await fs.writeFile(path.join(root, "community-plugins/packages", "0".repeat(64) + ".json"), "orphan");
  const reopened = createStore({ adapter: createDiskAdapter(root) }); await reopened.open({ reload: true });
  assert.equal(reopened.view().packages[0].selected, hash);
  await reopened.setEnabled(manifest.id, true, reopened.view().revision);
  assert.deepEqual(await fs.readdir(path.join(root, "community-plugins/packages")), [filename(hash)]);
});
test("desktop revision conflicts leave the selected bytes and approval unchanged", async t => {
  const { adapter, store } = await fixture(t); await install(store);
  const stale = await adapter.load();
  await store.setSafeMode(true, store.view().revision);
  const next = structuredClone(stale); next.revision++;
  await assert.rejects(adapter.commit(stale.revision, next), { code: "REVISION_CONFLICT" });
  assert.equal((await adapter.load()).safeMode, true);
});
test("desktop rejects path, URL, malformed index, and symlink attacks without reading external packages", async t => {
  for (const hash of ["../index.json", "/tmp/package", "https://example.invalid", "sha256-.."]) assert.throws(() => filename(hash), /hash/);
  const { root, adapter, store } = await fixture(t), hash = await install(store);
  const next = await adapter.load(); next.revision++;
  next.blobs[hash] = new Uint8Array([0]);
  await assert.rejects(adapter.commit(next.revision - 1, next), /hash/);
  const target = path.join(root, "community-plugins/packages", filename(hash));
  await fs.rm(target); await fs.symlink(path.join(root, "external.json"), target);
  await fs.writeFile(path.join(root, "external.json"), "external");
  await assert.rejects(adapter.load(), error => ["ELOOP", "EMLINK"].includes(error.code));
});
test("desktop corrupt bytes quarantine before activation and remain uninstallable", async t => {
  const { root, store } = await fixture(t), hash = await install(store);
  await fs.writeFile(path.join(root, "community-plugins/packages", filename(hash)), "corrupt");
  const reopened = createStore({ adapter: createDiskAdapter(root) }); await reopened.open();
  assert.match(reopened.view().packages[0].quarantine, /hash/);
  await assert.rejects(reopened.beforeEvaluation(manifest.id, hash));
  await reopened.uninstall(manifest.id, reopened.view().revision);
  assert.deepEqual(reopened.view().packages, []);
});
test("desktop activation interruption and launch safe mode preserve management without evaluation", async t => {
  const { root, adapter, store } = await fixture(t), hash = await install(store);
  const state = await adapter.load(); state.records[0].enabled = true;
  state.attempts = [{ id: manifest.id, hash }]; state.revision++;
  await adapter.commit(state.revision - 1, state);
  const reopened = createStore({ adapter: createDiskAdapter(root), safeMode: true }); await reopened.open({ reload: true });
  assert.equal(reopened.view().safeMode, true); assert.match(reopened.view().packages[0].quarantine, /did not finish/);
  await assert.rejects(reopened.beforeEvaluation(manifest.id, hash), { code: "COMMUNITY_SAFE_MODE" });
  await reopened.uninstall(manifest.id, reopened.view().revision);
});
