"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createStore, hashBytes, earlySafeMode } = require("../zoidium/community-plugin-store");
const P = require("../zoidium/community-package");
const manifest = JSON.parse(fs.readFileSync(require.resolve("../examples/community-filter/manifest.json"), "utf8"));
function file(version = "1", id = manifest.id, source = "throw new Error('guest must never run');") {
  const m = structuredClone(manifest); m.version = version;
  m.effects.forEach(e => { e.id = e.id.replace(m.id, id); }); m.id = id;
  return new Blob([JSON.stringify({ schemaVersion: 1, manifest: m, assets: { [m.entry]: source } })]);
}
function memory() {
  let value = null;
  return {
    async load() { return structuredClone(value); },
    async commit(revision, next) {
      if ((value?.revision || 0) !== revision) { const e = new Error("revision conflict"); e.code = "REVISION_CONFLICT"; throw e; }
      value = structuredClone(next);
    },
    edit(change) { change(value); },
  };
}
async function setup(options = {}) { const adapter = memory(), store = createStore({ adapter, ...options }); await store.open(); return { store, adapter }; }
async function install(store, version = "1") { return store.importFile(file(version), store.view().revision); }
async function approve(store) { const v = store.view(), p = v.packages[0]; return store.approve(p.id, p.hash, v.revision); }
async function update(store, version = "2") {
  await install(store, version); await approve(store);
  await store.stageOnReload(manifest.id, store.view().revision);
  return store.open({ reload: true });
}
let networkRequests = 0;
const networkDescriptors = new Map();
test.before(() => {
  for (const api of ["fetch", "XMLHttpRequest", "WebSocket"]) {
    networkDescriptors.set(api, Object.getOwnPropertyDescriptor(globalThis, api));
    Object.defineProperty(globalThis, api, { configurable: true, writable: true, value: function () { networkRequests++; throw new Error("network forbidden"); } });
  }
});
test.after(() => {
  for (const [api, prior] of networkDescriptors) {
    if (prior) Object.defineProperty(globalThis, api, prior);
    else delete globalThis[api];
  }
  assert.equal(networkRequests, 0, "all store paths make zero network API calls");
});
test("local imports and management never execute guest code or call network APIs", async () => {
  const { store } = await setup();
  let view = await install(store);
  assert.equal(view.packages[0].readiness, "Needs approval");
  assert.equal(view.packages[0].selected, await hashBytes(new Uint8Array(await file().arrayBuffer())));
  await approve(store);
  assert.equal(store.view().packages[0].readiness, "Unavailable until rendering support lands");
  await install(store, "2"); await store.cancel(manifest.id, store.view().revision);
  await update(store); await store.rollback(manifest.id, store.view().revision);
  await store.open({ reload: true });
  await store.quarantine(manifest.id, "Test quarantine", store.view().revision);
  await store.uninstall(manifest.id, store.view().revision);
  assert.equal(networkRequests, 0);
  assert.deepEqual(store.view().packages, []);
});
test("import accepts native local bytes only and checks byte limits before reading", async () => {
  const { store } = await setup({ limits: { ...P.LIMITS, packageBytes: 4 } });
  for (const input of ["https://example.invalid/a", "/local/path", new Uint8Array(4), { size: 1, arrayBuffer() { throw new Error("read"); } }]) {
    await assert.rejects(store.importFile(input, 0), /local/);
  }
  const big = new Blob(["12345"]); big.arrayBuffer = () => { throw new Error("must not read oversized input"); };
  await assert.rejects(store.importFile(big, 0), /size limit/);
  assert.equal(store.view().revision, 0);
});
test("exact bytes determine approval and identity collisions fail without writes", async () => {
  const { store } = await setup(); await install(store); await approve(store);
  await assert.rejects(install(store), /already installed/);
  await install(store, "2");
  assert.equal(store.view().packages[0].approved, false);
  await assert.rejects(store.approve(manifest.id, "sha256-" + "A".repeat(43) + "=", store.view().revision), /cannot be approved/);
  await assert.rejects(store.stageOnReload(manifest.id, store.view().revision), /Approve/);
  for (const occupied of [[manifest.id], [manifest.effects[0].id]]) {
    const { store: blocked } = await setup({ occupied });
    await assert.rejects(install(blocked), /collision/); assert.equal(blocked.view().revision, 0);
  }
});
test("installed package claims are checked, including retained rollback and pending bytes", async () => {
  const { store, adapter } = await setup(); await install(store);
  // A different package cannot claim another package's effect ID.
  const m = structuredClone(manifest); m.id = "community-" + "f".repeat(32);
  const bytes = new Blob([JSON.stringify({ schemaVersion: 1, manifest: m, assets: { [m.entry]: "" } })]);
  await assert.rejects(store.importFile(bytes, store.view().revision), /ownership/);
  adapter.edit(v => { v.records.push(structuredClone(v.records[0])); });
  await assert.rejects(store.open(), /Corrupt/);
});
test("quota counts selected, rollback, and pending bytes and cancels reclaim bytes", async () => {
  const size = file().size;
  const { store } = await setup({ limits: { ...P.LIMITS, storageBytes: size * 2 + 8 } });
  await install(store); await approve(store); await update(store);
  assert.equal(store.view().bytes, file().size + file("2").size);
  await assert.rejects(install(store, "3"), /quota/);
  assert.equal(store.view().packages[0].pending, null);
  const other = await setup({ limits: { ...P.LIMITS, installed: 1 } }); await install(other.store);
  await assert.rejects(other.store.importFile(file("1", "community-" + "e".repeat(32)), other.store.view().revision), /quota/);
  await other.store.uninstall(manifest.id, other.store.view().revision); assert.equal(other.store.view().bytes, 0);
});
test("read-back hash failure quarantines without selecting or approving corrupt bytes", async () => {
  const adapter = memory(), original = adapter.commit;
  let writes = 0;
  adapter.commit = async (revision, next) => { await original(revision, next); if (++writes === 1) adapter.edit(v => { Object.values(v.blobs)[0][0] ^= 1; }); };
  const store = createStore({ adapter }); await store.open();
  await assert.rejects(install(store), /hash verification/);
  const p = store.view().packages[0];
  assert.equal(p.selected, null); assert.equal(p.readiness, "Quarantined"); assert.deepEqual(p.approvals, []);
});
test("interrupted import commit recovers to quarantine and can be cancelled", async () => {
  const adapter = memory(), load = adapter.load;
  let reads = 0;
  adapter.load = () => { if (++reads === 2) throw new Error("interrupted read-back"); return load(); };
  const store = createStore({ adapter }); await store.open(); await assert.rejects(install(store), /interrupted/);
  const next = createStore({ adapter }); await next.open();
  assert.match(next.view().packages[0].quarantine, /interrupted/);
  await next.cancel(manifest.id, next.view().revision); assert.equal(next.view().bytes, 0);
});
test("failed atomic commits keep the old package selection", async () => {
  const { store, adapter } = await setup(); await install(store); await approve(store);
  const before = store.view(); adapter.commit = async () => { throw new Error("write interrupted"); };
  await assert.rejects(install(store, "2"), /interrupted/); assert.deepEqual(store.view(), before);
});
test("multi-tab revisions reject stale imports, approvals, cancellations, and reload commits", async () => {
  const { store: first, adapter } = await setup(), second = createStore({ adapter }); await second.open();
  await install(first);
  await assert.rejects(install(second, "2"), { code: "REVISION_CONFLICT" });
  await second.open(); await approve(first);
  await assert.rejects(second.cancel(manifest.id, second.view().revision), { code: "REVISION_CONFLICT" });
  await assert.rejects(second.approve(manifest.id, second.view().packages[0].hash, second.view().revision), { code: "REVISION_CONFLICT" });
  await second.open(); assert.equal(second.view().packages[0].approved, true);
  await assert.rejects(second.uninstall(manifest.id, 0), { code: "REVISION_CONFLICT" });
});
test("updates require exact approval and explicit reload selection with one rollback", async () => {
  const { store } = await setup(); await install(store); await approve(store);
  const original = store.view().packages[0].selected;
  await install(store, "2"); await approve(store);
  await store.open({ reload: true }); assert.equal(store.view().packages[0].selected, original);
  await store.stageOnReload(manifest.id, store.view().revision);
  assert.equal(store.view().packages[0].readiness, "Pending reload");
  await store.open({ reload: true }); const updated = store.view().packages[0].selected;
  assert.notEqual(updated, original); assert.equal(store.view().packages[0].previous, original);
  await store.rollback(manifest.id, store.view().revision);
  assert.equal(store.view().packages[0].selected, updated);
  await store.open({ reload: true }); assert.equal(store.view().packages[0].selected, original);
  assert.equal(store.view().packages[0].previous, updated);
  assert.equal(store.view().bytes, file().size + file("2").size);
});
test("missing, edited, or evicted bytes are quarantined before any evaluation", async () => {
  for (const corrupt of [v => { delete v.blobs[v.records[0].selected]; }, v => { v.blobs[v.records[0].selected][2] ^= 1; }]) {
    const { store, adapter } = await setup(); await install(store); await approve(store); adapter.edit(corrupt);
    await store.open(); assert.equal(store.view().packages[0].readiness, "Quarantined");
    await assert.rejects(store.beforeEvaluation(), { code: "RENDERING_UNAVAILABLE" });
  }
});
test("safe mode and activation-attempt records are checked before evaluation", async () => {
  assert.equal(earlySafeMode({ search: "?communitySafeMode=1" }), true);
  assert.equal(earlySafeMode({ search: "?communitySafeMode=0" }), false);
  const { store, adapter } = await setup(); await install(store); await approve(store);
  await store.setSafeMode(true, store.view().revision);
  await assert.rejects(store.beforeEvaluation(), { code: "COMMUNITY_SAFE_MODE" });
  await store.setSafeMode(false, store.view().revision);
  adapter.edit(v => { v.attempts.push({ id: manifest.id, hash: v.records[0].selected }); });
  await assert.rejects(store.beforeEvaluation(), { code: "ACTIVATION_INTERRUPTED" });
  assert.match(store.view().packages[0].quarantine, /did not finish/);
  await assert.rejects(store.setEnabled(manifest.id, true, store.view().revision), /Approve/);
});
test("storage failure and incompatible schema fail closed", async () => {
  const store = createStore({ adapter: { load() { throw new Error("storage denied"); } } });
  await assert.rejects(store.open(), /denied/); await assert.rejects(store.importFile(file(), 0), /not opened/);
  const { store: other, adapter } = await setup(); await install(other);
  adapter.edit(v => { v.schemaVersion = 99; }); await assert.rejects(other.open(), /Unsupported/);
});

test("enable intent persists without making activation available", async () => {
  const { store, adapter } = await setup(); await install(store); await approve(store);
  await store.setEnabled(manifest.id, true, store.view().revision);
  const next = createStore({ adapter }); await next.open();
  assert.equal(next.view().packages[0].enabled, true);
  assert.equal(next.view().activationAvailable, false);
  await assert.rejects(next.beforeEvaluation(), { code: "RENDERING_UNAVAILABLE" });
});


test("cancellation during read-back cannot resurrect an import on the same store", async t => {
  const { store } = await setup();
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let calls = 0, resume, reached;
  const paused = new Promise(resolve => { reached = resolve; });
  const continuation = new Promise(resolve => { resume = resolve; });
  t.mock.method(crypto.subtle, "digest", async (...args) => {
    if (++calls === 2) { reached(); await continuation; }
    return digest(...args);
  });
  const importing = install(store);
  await paused;
  await store.cancel(manifest.id, store.view().revision);
  resume();
  await assert.rejects(importing, { code: "REVISION_CONFLICT" });
  await store.open();
  assert.deepEqual(store.view().packages, []);
  assert.equal(store.view().bytes, 0);
});
